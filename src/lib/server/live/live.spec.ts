import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createContentStore } from '$lib/server/content/store';
import type { NotifyResult } from '$lib/server/podping/notifier';
import { publish } from '$lib/server/publish/publish';
import type { ObjectStore, PutInput } from '$lib/server/publish/r2Client';
import { createLiveItem } from './createLiveItem';
import { deleteEnded } from './deleteEnded';
import { goLive } from './goLive';
import { retryLiveAction } from './retry';
import { loadLiveView, type LiveDeps } from './state';
import { stopLive } from './stop';

const FIXTURES = fileURLToPath(new URL('../../../../test/fixtures/content/', import.meta.url));
const FEED_KEY = 'placeholder-show/feed.xml';
const MOUNT_URL = 'https://example.com/placeholder-show/live.mp3';
const CONFIG = {
  feedUrl: 'https://example.com/placeholder-show/feed.xml',
  mediaBaseUrl: 'https://example.com',
  objectKeyPrefix: 'placeholder-show'
};
const NOW = new Date('2026-11-06T19:50:00.000Z');
const TWO_HOURS_LATER = '2026-11-06T21:50:00.000Z';

type Fakes = {
  feedBody?: string;
  failPut?: (key: string) => boolean;
  mountAnswer?: () => Promise<Response>;
  publicFetch?: () => Promise<Response>;
  notify?: () => Promise<NotifyResult>;
};

let folder: string;
let events: string[];
let objects: Map<string, Buffer>;
let fakes: Fakes;
let now: Date;

const collect = async (input: PutInput): Promise<Buffer> => {
  if (input.body instanceof Uint8Array) {
    return Buffer.from(input.body);
  }

  const chunks: Uint8Array[] = [];

  for await (const chunk of input.body) {
    chunks.push(chunk);
  }

  return Buffer.concat(chunks);
};

const audioResponse = (): Response =>
  new Response(new Uint8Array([255, 251]), { headers: { 'content-type': 'audio/mpeg' } });

const readLive = async (slug = 'first-show'): Promise<Record<string, any>> =>
  JSON.parse(await readFile(join(folder, `live/${slug}/live.json`), 'utf8'));

const readRecords = async (): Promise<Record<string, any>[]> => {
  const names = (await readdir(join(folder, 'publish'))).filter((name) => name.endsWith('.json'));

  return Promise.all(
    names
      .toSorted()
      .map(async (name) => JSON.parse(await readFile(join(folder, 'publish', name), 'utf8')))
  );
};

const createFakeObjectStore = (): ObjectStore => ({
  head: () => Promise.resolve({ ok: true, sha256: undefined }),
  put: async (input) => {
    events.push(`put:${input.key === FEED_KEY ? 'feed' : 'media'}`);

    if (fakes.failPut?.(input.key) === true) {
      return { ok: false, status: 500 };
    }

    objects.set(input.key, await collect(input));

    return { ok: true };
  }
});

const createDeps = (): LiveDeps => ({
  store: createContentStore(folder),
  contentFolder: folder,
  objectStore: createFakeObjectStore(),
  fetch: vi.fn(async (url: string) => {
    if (url === MOUNT_URL) {
      const local = await readLive().catch(() => undefined);

      events.push(`mount:status=${String(local?.status)}`);

      return (fakes.mountAnswer ?? (() => Promise.resolve(audioResponse())))();
    }

    if (fakes.publicFetch !== undefined) {
      return fakes.publicFetch();
    }

    const feed = objects.get(FEED_KEY);

    if (feed === undefined) {
      return new Response('none', { status: 404 });
    }

    const record = (await readRecords()).at(-1);

    events.push(`verify:verified=${String(record?.verified)}`);

    return new Response(feed.toString());
  }) as unknown as typeof fetch,
  notifier: {
    notify: vi.fn((input: { reason: string }) => {
      events.push(`ping:${input.reason}`);

      return (
        fakes.notify ??
        (() => Promise.resolve<NotifyResult>({ ok: true, label: 'index re-fetch accepted' }))
      )();
    })
  },
  clock: () => now,
  sleep: () => Promise.resolve(),
  config: CONFIG,
  userAgent: 'placeholder-user-agent',
  mountUrl: MOUNT_URL,
  showPageUrl: 'https://example.com/placeholder-show',
  readStreamStatus: () => Promise.resolve({ state: 'connected', listeners: 2 }),
  createGuid: () => 'placeholder-new-guid',
  isPublishInFlight: () => false
});

const editLive = async (
  edit: (record: Record<string, any>) => Record<string, any>,
  slug = 'first-show'
): Promise<void> => {
  const path = join(folder, `live/${slug}/live.json`);

  await writeFile(path, JSON.stringify(edit(JSON.parse(await readFile(path, 'utf8')))));
};

const useFixture = async (name: string): Promise<void> => {
  await cp(join(FIXTURES, name), folder, { recursive: true });
};

let logSpy: ReturnType<typeof vi.spyOn>;

const logged = (): Record<string, unknown>[] =>
  logSpy.mock.calls.map((call: unknown[]) => JSON.parse(String(call[0])));

beforeEach(async () => {
  folder = await mkdtemp(join(tmpdir(), 'pod-fish-live-'));
  events = [];
  objects = new Map();
  fakes = {};
  now = NOW;
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  await useFixture('friday-minimum');
  await createContentStore(folder).ensureShape();
});

afterEach(async () => {
  vi.restoreAllMocks();
  await rm(folder, { recursive: true, force: true });
});

describe('the Go live pipeline order', () => {
  it('checks the mount before the flip, publishes after the flip, and pings last (AE6)', async () => {
    const result = await goLive(createDeps());

    expect(result).toMatchObject({ ok: true, pingLabel: 'index re-fetch accepted' });
    expect(events).toStrictEqual([
      'mount:status=pending',
      'put:feed',
      'verify:verified=false',
      'ping:live'
    ]);
  });

  it('sets the status live, the start to now, the end two hours later, and the next revision', async () => {
    await goLive(createDeps());

    expect(await readLive()).toMatchObject({
      status: 'live',
      start: NOW.toISOString(),
      end: TWO_HOURS_LATER,
      revision: 2
    });
    expect(objects.get(FEED_KEY)?.toString()).toContain('status="live"');
    expect((await readRecords())[0]).toMatchObject({
      reason: 'live',
      verified: true,
      pinged: true,
      liveItems: [{ slug: 'first-show', status: 'live', start: NOW.toISOString() }]
    });
  });
});

describe('Go live refusals', () => {
  it('refuses when no live item exists', async () => {
    await rm(join(folder, 'live/first-show'), { recursive: true });

    expect(await goLive(createDeps())).toMatchObject({ ok: false, failedStep: 'refused' });
    expect(events).toStrictEqual([]);
  });

  it('refuses a draft live item and names it, and writes nothing', async () => {
    await editLive((record) => ({ ...record, draft: true }));

    const before = await readLive();
    const result = await goLive(createDeps());

    expect(result).toMatchObject({ ok: false, reason: expect.stringContaining('first-show') });
    expect(await readLive()).toStrictEqual(before);
    expect(events).toStrictEqual([]);
  });

  it('refuses a validation failure before the mount check, and names the node and the field', async () => {
    await editLive(({ contentLink, ...record }) => record);

    const result = await goLive(createDeps());

    expect(result).toMatchObject({
      ok: false,
      failedStep: 'validate',
      failures: [expect.objectContaining({ node: 'live:first-show', field: 'contentLink' })]
    });
    expect(events).toStrictEqual([]);
    expect((await readLive()).status).toBe('pending');
  });

  it.each([
    ['a 404', () => Promise.resolve(new Response('no', { status: 404 })), '404'],
    [
      'a 200 with text/html',
      () => Promise.resolve(new Response('<html>', { headers: { 'content-type': 'text/html' } })),
      'text/html'
    ]
  ])(
    'stops before any write on %s, and names the mount and the answer (AE13)',
    async (_name, answer, text) => {
      fakes.mountAnswer = answer;

      const before = await readLive();
      const result = await goLive(createDeps());

      expect(result).toMatchObject({ ok: false, failedStep: 'mount' });
      expect(result).toMatchObject({ reason: expect.stringContaining(MOUNT_URL) });
      expect(result).toMatchObject({ reason: expect.stringContaining(text) });
      expect(await readLive()).toStrictEqual(before);
      expect(objects.size).toBe(0);
      expect(await readRecords()).toStrictEqual([]);
      expect(logged()).toContainEqual(
        expect.objectContaining({ event: 'live_mount_check_failed' })
      );
    }
  );

  it('refuses an item whose stream URL differs from the configured mount, and names both (R19)', async () => {
    const itemUrl = 'https://example.com/placeholder-show/other.mp3';

    await editLive((record) => ({ ...record, enclosure: { ...record.enclosure, url: itemUrl } }));

    const before = await readLive();
    const result = await goLive(createDeps());

    expect(result).toMatchObject({ ok: false, failedStep: 'refused' });
    expect(result).toMatchObject({ reason: expect.stringContaining(itemUrl) });
    expect(result).toMatchObject({ reason: expect.stringContaining(MOUNT_URL) });
    expect(result).toMatchObject({ reason: expect.stringContaining('STREAM_MOUNT_URL') });
    expect(result).toMatchObject({ reason: expect.stringContaining('live/first-show/live.json') });
    expect(await readLive()).toStrictEqual(before);
    expect(events).toStrictEqual([]);
    expect(objects.size).toBe(0);
    expect(await readRecords()).toStrictEqual([]);
  });

  it.each([
    ['a missing media file', () => Promise.resolve()],
    [
      'a media file that does not match its record',
      async () => {
        await mkdir(join(folder, 'episodes/pilot/media'), { recursive: true });
        await writeFile(join(folder, 'episodes/pilot/media/pilot.mp3'), 'placeholder wrong bytes');
      }
    ]
  ])('stops before the mount check and the flip on %s (KTD9)', async (_name, arrange) => {
    await cp(join(FIXTURES, 'basic/episodes/pilot'), join(folder, 'episodes/pilot'), {
      recursive: true
    });
    await arrange();

    const before = await readLive();
    const result = await goLive(createDeps());

    expect(result).toMatchObject({
      ok: false,
      failedStep: 'validate',
      failedFile: 'episodes/pilot/media/pilot.mp3'
    });
    expect(await readLive()).toStrictEqual(before);
    expect(events).toStrictEqual([]);
    expect(objects.size).toBe(0);
    expect(await readRecords()).toStrictEqual([]);
  });

  it('refuses an item that is already live', async () => {
    await goLive(createDeps());
    events.length = 0;

    expect(await goLive(createDeps())).toMatchObject({ ok: false });
    expect(events).toStrictEqual([]);
  });
});

describe('Stop (AE7)', () => {
  it('flips to ended with the end now, publishes with liveEnd, and pings', async () => {
    await goLive(createDeps());
    events.length = 0;
    now = new Date('2026-11-06T21:30:00.000Z');

    const result = await stopLive(createDeps());

    expect(result).toMatchObject({ ok: true });
    expect(await readLive()).toMatchObject({
      status: 'ended',
      end: '2026-11-06T21:30:00.000Z',
      start: NOW.toISOString(),
      revision: 3
    });
    expect(events).toStrictEqual(['put:feed', 'verify:verified=false', 'ping:liveEnd']);
    expect(objects.get(FEED_KEY)?.toString()).toContain('status="ended"');
  });

  it('refuses when nothing is live', async () => {
    expect(await stopLive(createDeps())).toMatchObject({ ok: false });
    expect(events).toStrictEqual([]);
  });
});

describe('the Retry contract (AE14, R28)', () => {
  const publishPending = async (): Promise<void> => {
    expect(await publish(createDeps(), { reason: 'update' })).toMatchObject({ ok: true });
  };

  const failFeedPut = (): void => {
    fakes.failPut = (key) => key === FEED_KEY;
  };

  it('offers only publish after a failed feed upload, and keeps the times', async () => {
    failFeedPut();

    const result = await goLive(createDeps());
    const view = await loadLiveView(createDeps());

    expect(result).toMatchObject({ ok: false, failedStep: 'feed' });
    expect(await readLive()).toMatchObject({ status: 'live', start: NOW.toISOString() });
    expect(view.retry).toMatchObject({
      failedStep: 'feed',
      choices: ['publish'],
      preselected: 'publish',
      reason: expect.stringContaining('500')
    });
  });

  it('keeps the start and the end across a publish retry, and shows the old state until it succeeds', async () => {
    await goLive(createDeps());
    now = new Date('2026-11-06T21:30:00.000Z');
    failFeedPut();
    await stopLive(createDeps());

    const failedView = await loadLiveView(createDeps());

    expect(failedView.ended[0]).toMatchObject({
      status: 'ended',
      published: { status: 'live' }
    });

    fakes.failPut = undefined;
    now = new Date('2026-11-06T21:45:00.000Z');
    events.length = 0;

    const result = await retryLiveAction(createDeps(), 'publish');

    expect(result).toMatchObject({ ok: true });
    expect(await readLive()).toMatchObject({ status: 'ended', end: '2026-11-06T21:30:00.000Z' });
    expect(events).toStrictEqual(['put:feed', 'verify:verified=false', 'ping:liveEnd']);

    const view = await loadLiveView(createDeps());

    expect(view.retry).toBeNull();
    expect(view.ended[0]).toMatchObject({ published: { status: 'ended' } });
  });

  it('offers verify and publish after a verify timeout, with verify preselected', async () => {
    fakes.publicFetch = () => Promise.resolve(new Response('old body'));
    await goLive(createDeps());

    const view = await loadLiveView(createDeps());

    expect(view.retry).toMatchObject({
      failedStep: 'verify',
      choices: ['verify', 'publish'],
      preselected: 'verify'
    });
  });

  it('never offers a ping before verify has passed, and refuses one', async () => {
    fakes.publicFetch = () => Promise.resolve(new Response('old body'));

    const deps = createDeps();

    await goLive(deps);

    const pingsBefore = vi.mocked(deps.notifier.notify).mock.calls.length;
    const result = await retryLiveAction(deps, 'ping');

    expect(result).toMatchObject({ ok: false });
    expect(vi.mocked(deps.notifier.notify).mock.calls.length).toBe(pingsBefore);
    expect((await loadLiveView(deps)).retry?.choices).not.toContain('ping');
  });

  it('verify again uploads nothing, then pings with the first reason, and clears the failure', async () => {
    fakes.publicFetch = () => Promise.resolve(new Response('old body'));
    await goLive(createDeps());

    fakes.publicFetch = undefined;
    events.length = 0;

    const result = await retryLiveAction(createDeps(), 'verify');

    expect(result).toMatchObject({ ok: true });
    expect(events).toStrictEqual(['verify:verified=false', 'ping:live']);

    const records = await readRecords();

    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ verified: true, pinged: true });
    expect(records[0].failedStep).toBeUndefined();
    expect((await loadLiveView(createDeps())).retry).toBeNull();
  });

  it('offers only ping after a ping failure, and ping again sends only the ping', async () => {
    fakes.notify = () => Promise.resolve({ ok: false, reason: 'The hub answered 500.' });
    await goLive(createDeps());

    expect((await loadLiveView(createDeps())).retry).toMatchObject({
      failedStep: 'ping',
      choices: ['ping'],
      preselected: 'ping',
      reason: 'The hub answered 500.'
    });

    fakes.notify = undefined;
    events.length = 0;

    expect(await retryLiveAction(createDeps(), 'ping')).toMatchObject({ ok: true });
    expect(events).toStrictEqual(['ping:live']);
    expect((await readRecords())[0]).toMatchObject({ verified: true, pinged: true });
  });

  it('refuses a retry when nothing failed', async () => {
    await goLive(createDeps());
    events.length = 0;

    expect(await retryLiveAction(createDeps(), 'publish')).toMatchObject({ ok: false });
    expect(events.filter((event) => /^(?:put|ping):/.test(event))).toStrictEqual([]);
  });

  it('offers publish when a flip never reached a record, as after a crash mid-action', async () => {
    await publishPending();
    await editLive((record) => ({ ...record, status: 'live', revision: 2 }));

    expect((await loadLiveView(createDeps())).retry).toMatchObject({
      choices: ['publish'],
      preselected: 'publish'
    });

    events.length = 0;

    expect(await retryLiveAction(createDeps(), 'publish')).toMatchObject({ ok: true });
    expect(events).toContain('ping:live');
    expect((await loadLiveView(createDeps())).retry).toBeNull();
  });
});

describe('a flip after a failed run (R28)', () => {
  it('offers publish when no record is newer than the failed run, and refuses the old ping', async () => {
    fakes.notify = () => Promise.resolve({ ok: false, reason: 'The hub answered 500.' });
    await goLive(createDeps());
    await editLive((record) => ({ ...record, status: 'ended', revision: 3 }));

    expect((await loadLiveView(createDeps())).retry).toMatchObject({
      failedStep: 'publish',
      choices: ['publish'],
      preselected: 'publish',
      reason: expect.stringContaining('first-show')
    });

    fakes.notify = undefined;
    now = new Date('2026-11-06T21:30:00.000Z');
    events.length = 0;

    expect(await retryLiveAction(createDeps(), 'ping')).toMatchObject({
      ok: false,
      failedStep: 'refused'
    });
    expect(events).toStrictEqual([]);

    expect(await retryLiveAction(createDeps(), 'publish')).toMatchObject({ ok: true });
    expect(events).toContain('ping:liveEnd');
    expect((await loadLiveView(createDeps())).retry).toBeNull();
  });
});

describe('an ended item (AE16, R32)', () => {
  const endFirstShow = async (): Promise<void> => {
    await goLive(createDeps());
    await stopLive(createDeps());
  };

  const addPendingShow = async (): Promise<void> => {
    now = new Date('2026-11-13T12:00:00.000Z');

    expect(
      await createLiveItem(createDeps(), {
        title: 'Second show',
        description: 'The second show.',
        start: '2026-11-14T01:00:00.000Z',
        durationMinutes: 120
      })
    ).toMatchObject({ ok: true });
  };

  it('acts on the pending item when an ended item exists', async () => {
    await endFirstShow();
    await addPendingShow();

    const view = await loadLiveView(createDeps());

    expect(view.subject?.title).toBe('Second show');
    expect(view.ended.map((item) => item.slug)).toStrictEqual(['first-show']);

    const result = await goLive(createDeps());

    expect(result).toMatchObject({ ok: true });
    expect((await loadLiveView(createDeps())).subject?.status).toBe('live');
    expect((await readLive()).status).toBe('ended');
  });

  it('never returns an ended item to live: Go live refuses when only ended items exist', async () => {
    await endFirstShow();
    events.length = 0;

    expect(await goLive(createDeps())).toMatchObject({ ok: false });
    expect((await readLive()).status).toBe('ended');
    expect(events).toStrictEqual([]);
  });

  it('deletes an ended item and its listing', async () => {
    await endFirstShow();

    expect(await deleteEnded(createDeps(), 'first-show')).toMatchObject({ ok: true });
    expect(await readdir(join(folder, 'live'))).toStrictEqual([]);
    expect((await loadLiveView(createDeps())).ended).toStrictEqual([]);
  });

  it('deletes a plain ended item when no Retry plan exists', async () => {
    await endFirstShow();

    expect((await loadLiveView(createDeps())).retry).toBeNull();
    expect(await deleteEnded(createDeps(), 'first-show')).toStrictEqual({ ok: true });
    expect(await readdir(join(folder, 'live'))).toStrictEqual([]);
  });

  it('refuses to delete an ended item when a Stop failed at validate and left a Retry plan', async () => {
    await goLive(createDeps());
    await editLive(({ contentLink, ...record }) => record);
    now = new Date('2026-11-06T21:30:00.000Z');

    expect(await stopLive(createDeps())).toMatchObject({ ok: false, failedStep: 'validate' });
    expect(await readRecords()).toHaveLength(1);

    const result = await deleteEnded(createDeps(), 'first-show');

    expect(result).toMatchObject({ ok: false, reason: expect.stringContaining('Retry') });
    expect((await readLive()).status).toBe('ended');
  });

  it('refuses to delete an item that has not ended', async () => {
    expect(await deleteEnded(createDeps(), 'first-show')).toMatchObject({ ok: false });
    expect((await readLive()).status).toBe('pending');
  });

  it.each(['../escape', 'missing'])('refuses to delete the slug %s', async (slug) => {
    expect(await deleteEnded(createDeps(), slug)).toMatchObject({ ok: false });
  });
});

describe('creating a live item (AE5, R19)', () => {
  beforeEach(async () => {
    await rm(join(folder, 'live/first-show'), { recursive: true });
  });

  it('writes a pending item with the planned end and the configured stream settings', async () => {
    const result = await createLiveItem(createDeps(), {
      title: 'Friday show',
      description: 'The Friday show.',
      start: '2026-11-07T01:00:00.000Z',
      durationMinutes: 120
    });

    expect(result).toMatchObject({ ok: true, slug: '2026-11-07-friday-show' });
    expect(await readLive('2026-11-07-friday-show')).toMatchObject({
      revision: 1,
      draft: false,
      status: 'pending',
      title: 'Friday show',
      guid: 'placeholder-new-guid',
      start: '2026-11-07T01:00:00.000Z',
      end: '2026-11-07T03:00:00.000Z',
      durationMinutes: 120,
      enclosure: { url: MOUNT_URL, type: 'audio/mpeg' },
      contentLink: { href: 'https://example.com/placeholder-show' }
    });
  });

  it('refuses a second open item', async () => {
    const input = {
      title: 'One',
      description: 'One.',
      start: '2026-11-07T01:00:00.000Z',
      durationMinutes: 120
    };

    await createLiveItem(createDeps(), input);

    expect(await createLiveItem(createDeps(), { ...input, title: 'Two' })).toMatchObject({
      ok: false
    });
    expect(await readdir(join(folder, 'live'))).toHaveLength(1);
  });

  it('refuses when a draft live item exists, names it, and writes nothing', async () => {
    await createLiveItem(createDeps(), {
      title: 'One',
      description: 'One.',
      start: '2026-11-07T01:00:00.000Z',
      durationMinutes: 120
    });
    await editLive((record) => ({ ...record, draft: true }), '2026-11-07-one');

    const result = await createLiveItem(createDeps(), {
      title: 'Two',
      description: 'Two.',
      start: '2026-11-08T01:00:00.000Z',
      durationMinutes: 120
    });

    expect(result).toMatchObject({ ok: false, reason: expect.stringContaining('2026-11-07-one') });
    expect(await readdir(join(folder, 'live'))).toStrictEqual(['2026-11-07-one']);
  });

  it('adds a suffix when the slug exists', async () => {
    const input = {
      title: 'Show',
      description: 'A show.',
      start: '2026-11-07T01:00:00.000Z',
      durationMinutes: 60
    };

    await createLiveItem(createDeps(), input);
    await editLive((record) => ({ ...record, status: 'ended' }), '2026-11-07-show');

    expect(await createLiveItem(createDeps(), input)).toMatchObject({
      ok: true,
      slug: '2026-11-07-show-2'
    });
  });

  it.each([
    [{ title: '' }, 'title'],
    [{ start: 'tomorrow' }, 'start'],
    [{ durationMinutes: 0 }, 'durationMinutes']
  ])('refuses invalid input %j', async (change, field) => {
    const result = await createLiveItem(createDeps(), {
      title: 'Show',
      description: 'A show.',
      start: '2026-11-07T01:00:00.000Z',
      durationMinutes: 60,
      ...change
    });

    expect(result).toMatchObject({ ok: false, reason: expect.stringContaining(field) });
    expect(await readdir(join(folder, 'live'))).toStrictEqual([]);
  });
});

describe('the Live view', () => {
  const publicFeedSha = (): string =>
    createHash('sha256')
      .update(objects.get(FEED_KEY) ?? '')
      .digest('hex');

  it('shows nothing published before the first publish', async () => {
    expect(await loadLiveView(createDeps())).toMatchObject({
      publicFeed: { state: 'none' },
      subject: { slug: 'first-show', status: 'pending', published: null },
      source: { state: 'connected', listeners: 2 },
      failures: [],
      retry: null
    });
  });

  it('reads the published state from the record that matches the public feed', async () => {
    await goLive(createDeps());

    const view = await loadLiveView(createDeps());

    expect(view.publicFeed).toMatchObject({ state: 'matched', feedSha256: publicFeedSha() });
    expect(view.subject).toMatchObject({
      status: 'live',
      published: { status: 'live', start: NOW.toISOString(), end: TWO_HOURS_LATER }
    });
    expect(view.unpublishedChanges).toBe(0);
  });

  it('shows that a publish did not finish when the public feed matches no record', async () => {
    await goLive(createDeps());
    fakes.publicFetch = () => Promise.resolve(new Response('a feed from nowhere'));

    const view = await loadLiveView(createDeps());

    expect(view.publicFeed.state).toBe('unmatched');
    expect(view.retry).toMatchObject({ choices: ['verify', 'publish'], preselected: 'verify' });
  });

  it('shows the last record, labeled offline, when the feed cannot be fetched', async () => {
    await goLive(createDeps());
    fakes.publicFetch = () => Promise.reject(new Error('offline'));

    const view = await loadLiveView(createDeps());

    expect(view.publicFeed.state).toBe('offline');
    expect(view.subject?.published).toMatchObject({ status: 'live' });
  });

  it('counts each differing live item field, plus one for the generated feed', async () => {
    await goLive(createDeps());
    await editLive((record) => ({
      ...record,
      start: '2026-11-06T19:55:00.000Z',
      end: '2026-11-06T21:55:00.000Z',
      revision: 9
    }));

    expect((await loadLiveView(createDeps())).unpublishedChanges).toBe(3);
  });

  it('counts a channel edit after a publish as one change', async () => {
    await goLive(createDeps());

    const path = join(folder, 'show.json');
    const show = JSON.parse(await readFile(path, 'utf8'));

    await writeFile(path, JSON.stringify({ ...show, description: 'A new description.' }));

    expect((await loadLiveView(createDeps())).unpublishedChanges).toBe(1);
  });

  it('counts no change for a later clock, because the build time comes from the record', async () => {
    await goLive(createDeps());
    now = new Date('2026-11-06T20:30:00.000Z');

    expect((await loadLiveView(createDeps())).unpublishedChanges).toBe(0);
  });

  it('names a validation failure', async () => {
    await editLive(({ contentLink, ...record }) => record);

    expect((await loadLiveView(createDeps())).failures).toContainEqual(
      expect.objectContaining({ node: 'live:first-show', field: 'contentLink' })
    );
  });

  it('names a draft live item, and leaves no subject', async () => {
    await editLive((record) => ({ ...record, draft: true }));

    expect(await loadLiveView(createDeps())).toMatchObject({
      subject: null,
      draftSlugs: ['first-show']
    });
  });

  it('reports a publish in flight from the lock', async () => {
    const view = await loadLiveView({ ...createDeps(), isPublishInFlight: () => true });

    expect(view.publishInFlight).toBe(true);
  });
});
