import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createContentStore } from '$lib/server/content/store';
import type { NotifyResult } from '$lib/server/podping/notifier';
import { publish, type PublishDeps } from './publish';
import type { ObjectStore, PutInput } from './r2Client';

const FIXTURES = fileURLToPath(new URL('../../../../test/fixtures/content/', import.meta.url));
const AUDIO = 'placeholder audio bytes';
const AUDIO_SHA = createHash('sha256').update(AUDIO).digest('hex');
const CONFIG = {
  feedUrl: 'https://example.com/placeholder-show/feed.xml',
  mediaBaseUrl: 'https://example.com',
  objectKeyPrefix: 'placeholder-show'
};
const FEED_KEY = 'placeholder-show/feed.xml';
const MEDIA_KEY = `placeholder-show/media/pilot/${AUDIO_SHA.slice(0, 16)}-pilot.mp3`;

type StoredObject = { input: PutInput; bytes: Buffer };

let folder: string;
let events: string[];
let objects: Map<string, StoredObject>;

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

const createFakeObjectStore = (failOn?: (key: string) => boolean): ObjectStore => ({
  head: vi.fn((key: string) => {
    const object = objects.get(key);

    return Promise.resolve({
      ok: true as const,
      sha256: object?.input.sha256
    });
  }),
  put: vi.fn(async (input: PutInput) => {
    events.push(`put:${input.key === FEED_KEY ? 'feed' : 'media'}`);

    if (failOn?.(input.key) === true) {
      return { ok: false as const, status: 500 };
    }

    objects.set(input.key, { input, bytes: await collect(input) });

    return { ok: true as const };
  })
});

const readRecords = async (): Promise<Record<string, any>[]> => {
  const names = (await readdir(join(folder, 'publish'))).filter((name) => name.endsWith('.json'));

  return Promise.all(
    names
      .toSorted()
      .map(async (name) => JSON.parse(await readFile(join(folder, 'publish', name), 'utf8')))
  );
};

const servePublicFeed = async (): Promise<Response> => {
  const feed = objects.get(FEED_KEY);
  const record = (await readRecords()).at(-1);

  events.push(`verify:record-verified=${String(record?.verified)}`);

  return new Response(feed === undefined ? 'no feed yet' : feed.bytes.toString());
};

const createDeps = (overrides: Partial<PublishDeps> = {}): PublishDeps => {
  let tick = 0;

  return {
    store: createContentStore(folder),
    contentFolder: folder,
    objectStore: createFakeObjectStore(),
    fetch: vi.fn(servePublicFeed),
    notifier: {
      notify: vi.fn(() => {
        events.push('ping');

        return Promise.resolve<NotifyResult>({ ok: true, label: 'index re-fetch accepted' });
      })
    },
    clock: () => new Date(Date.UTC(2026, 10, 4, 16, 0, tick++)),
    sleep: vi.fn(() => Promise.resolve()),
    config: CONFIG,
    userAgent: 'placeholder-user-agent',
    ...overrides
  };
};

const writeAudio = async (): Promise<void> => {
  await mkdir(join(folder, 'episodes/pilot/media'), { recursive: true });
  await writeFile(join(folder, 'episodes/pilot/media/pilot.mp3'), AUDIO);
};

const editEpisode = async (
  edit: (record: Record<string, any>) => Record<string, any>
): Promise<void> => {
  const path = join(folder, 'episodes/pilot/episode.json');

  await writeFile(path, JSON.stringify(edit(JSON.parse(await readFile(path, 'utf8')))));
};

const logLines = (spy: { mock: { calls: unknown[][] } }): Record<string, unknown>[] =>
  spy.mock.calls.map((call) => JSON.parse(String(call[0])));

let logSpy: ReturnType<typeof vi.spyOn>;
let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(async () => {
  folder = await mkdtemp(join(tmpdir(), 'pod-fish-publish-'));
  events = [];
  objects = new Map();
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  await cp(join(FIXTURES, 'basic'), folder, { recursive: true });
  await writeAudio();
  await editEpisode((record) => ({
    ...record,
    media: { ...record.media, sha256: AUDIO_SHA, length: Buffer.byteLength(AUDIO) }
  }));
});

afterEach(async () => {
  vi.restoreAllMocks();
  await rm(folder, { recursive: true, force: true });
});

describe('the pipeline order', () => {
  it('uploads media, then the feed, then writes the record, then verifies, then pings', async () => {
    const result = await publish(createDeps(), { reason: 'update' });

    expect(result).toMatchObject({ ok: true, pingLabel: 'index re-fetch accepted' });
    expect(events).toStrictEqual(['put:media', 'put:feed', 'verify:record-verified=false', 'ping']);
  });

  it('marks the record verified and pinged at the end, with the keys and the hashes', async () => {
    await publish(createDeps(), { reason: 'update' });

    const [record] = await readRecords();

    expect(record).toMatchObject({
      reason: 'update',
      feedKey: FEED_KEY,
      feedUploaded: true,
      verified: true,
      pinged: true,
      pingResult: 'index re-fetch accepted',
      files: [
        {
          key: MEDIA_KEY,
          source: 'episodes/pilot/media/pilot.mp3',
          sha256: AUDIO_SHA,
          length: Buffer.byteLength(AUDIO),
          uploaded: true
        }
      ],
      liveItems: [
        {
          slug: 'first-show',
          guid: 'placeholder-first-show-guid',
          status: 'pending',
          start: '2026-11-06T20:00:00-05:00',
          end: '2026-11-06T22:00:00-05:00'
        }
      ]
    });
    expect(record.feedSha256).toBe(
      createHash('sha256')
        .update(objects.get(FEED_KEY)?.bytes ?? '')
        .digest('hex')
    );
    expect(record.failedStep).toBeUndefined();
    expect(record.finishedAt).toBeDefined();
  });

  it('hands the reason of the caller to the notifier', async () => {
    const deps = createDeps();

    await publish(deps, { reason: 'live' });

    expect(deps.notifier.notify).toHaveBeenCalledWith({ feedUrl: CONFIG.feedUrl, reason: 'live' });
  });
});

describe('the upload headers', () => {
  it('sends the feed as RSS with no-cache', async () => {
    await publish(createDeps(), { reason: 'update' });

    expect(objects.get(FEED_KEY)?.input).toMatchObject({
      contentType: 'application/rss+xml; charset=utf-8',
      cacheControl: 'no-cache'
    });
  });

  it('sends media as audio/mpeg with an immutable lifetime and the bytes of the file', async () => {
    await publish(createDeps(), { reason: 'update' });

    const media = objects.get(MEDIA_KEY);

    expect(media?.input).toMatchObject({
      contentType: 'audio/mpeg',
      cacheControl: 'public, max-age=31536000, immutable',
      sha256: AUDIO_SHA,
      length: Buffer.byteLength(AUDIO)
    });
    expect(media?.bytes.toString()).toBe(AUDIO);
  });
});

describe('change detection (AE11)', () => {
  it('sends no media PUT when the store already holds the hash, and still sends the feed', async () => {
    objects.set(MEDIA_KEY, {
      input: { sha256: AUDIO_SHA } as PutInput,
      bytes: Buffer.from(AUDIO)
    });

    const result = await publish(createDeps(), { reason: 'update' });

    expect(result).toMatchObject({ ok: true, uploaded: [], skipped: 1 });
    expect(events).toStrictEqual(['put:feed', 'verify:record-verified=false', 'ping']);
    expect((await readRecords())[0].files[0]).toMatchObject({ key: MEDIA_KEY, uploaded: false });
  });
});

describe('a failed upload (AE2)', () => {
  it('stops before the feed PUT, names the file, logs, and writes a failure record', async () => {
    const deps = createDeps({ objectStore: createFakeObjectStore((key) => key === MEDIA_KEY) });
    const result = await publish(deps, { reason: 'update' });

    expect(result).toMatchObject({
      ok: false,
      failedStep: 'upload',
      failedFile: 'episodes/pilot/media/pilot.mp3'
    });
    expect(events).toStrictEqual(['put:media']);
    expect(objects.has(FEED_KEY)).toBe(false);
    expect(deps.notifier.notify).not.toHaveBeenCalled();
    expect(logLines(errorSpy)).toContainEqual(
      expect.objectContaining({ event: 'publish_upload_failed', key: MEDIA_KEY, status: 500 })
    );
    expect((await readRecords())[0]).toMatchObject({
      failedStep: 'upload',
      failedFile: 'episodes/pilot/media/pilot.mp3',
      feedUploaded: false,
      verified: false,
      pinged: false
    });
  });

  it('names the keys that uploaded, and the next run skips them', async () => {
    await mkdir(join(folder, 'episodes/second/media'), { recursive: true });
    await writeFile(join(folder, 'episodes/second/media/second.mp3'), 'second audio');
    await writeFile(
      join(folder, 'episodes/second/episode.json'),
      JSON.stringify({
        revision: 1,
        title: 'Second',
        guid: 'placeholder-second-guid',
        description: 'The second episode.',
        pubDate: '2026-11-03T12:00:00.000Z',
        media: {
          file: 'second.mp3',
          sha256: createHash('sha256').update('second audio').digest('hex'),
          length: 12,
          type: 'audio/mpeg'
        }
      })
    );

    const failing = createDeps({
      objectStore: createFakeObjectStore((key) => key.includes('/media/pilot/'))
    });

    await publish(failing, { reason: 'update' });

    const [failedRecord] = await readRecords();
    const uploadedKeys = failedRecord.files
      .filter((file: { uploaded: boolean }) => file.uploaded)
      .map((file: { key: string }) => file.key);

    expect(uploadedKeys).toHaveLength(1);
    expect(uploadedKeys[0]).toContain('/media/second/');

    events.length = 0;

    const result = await publish(createDeps(), { reason: 'update' });

    expect(result).toMatchObject({ ok: true, skipped: 1 });
    expect(events.filter((event) => event === 'put:media')).toHaveLength(1);
  });

  it('leaves the public feed unchanged when the feed PUT itself fails, and sends no ping', async () => {
    const deps = createDeps({ objectStore: createFakeObjectStore((key) => key === FEED_KEY) });
    const result = await publish(deps, { reason: 'update' });

    expect(result).toMatchObject({ ok: false, failedStep: 'feed' });
    expect(deps.notifier.notify).not.toHaveBeenCalled();
    expect((await readRecords())[0]).toMatchObject({ failedStep: 'feed', feedUploaded: false });
  });
});

describe('verify (AE1)', () => {
  it('passes on the third try and pings once', async () => {
    let attempt = 0;
    const deps = createDeps({
      fetch: vi.fn(() => {
        attempt += 1;

        return Promise.resolve(
          new Response(attempt < 3 ? 'old body' : objects.get(FEED_KEY)?.bytes.toString())
        );
      }) as unknown as typeof fetch
    });
    const result = await publish(deps, { reason: 'update' });

    expect(result).toMatchObject({ ok: true });
    expect(deps.fetch).toHaveBeenCalledTimes(3);
    expect(deps.notifier.notify).toHaveBeenCalledOnce();
  });

  it('fails after the window with no ping, keeps the record unverified, and logs', async () => {
    const deps = createDeps({
      fetch: vi.fn(() => Promise.resolve(new Response('old body'))) as unknown as typeof fetch
    });
    const result = await publish(deps, { reason: 'update' });

    expect(result).toMatchObject({ ok: false, failedStep: 'verify' });
    expect(deps.notifier.notify).not.toHaveBeenCalled();
    expect((await readRecords())[0]).toMatchObject({
      feedUploaded: true,
      verified: false,
      pinged: false,
      failedStep: 'verify'
    });
    expect(logLines(logSpy)).toContainEqual(
      expect.objectContaining({ event: 'publish_verify_mismatch' })
    );
  });

  it('fails at once on a network error', async () => {
    const deps = createDeps({
      fetch: vi.fn(() => Promise.reject(new Error('offline'))) as unknown as typeof fetch
    });
    const result = await publish(deps, { reason: 'update' });

    expect(result).toMatchObject({ ok: false, failedStep: 'verify' });
    expect(deps.fetch).toHaveBeenCalledOnce();
    expect(deps.sleep).not.toHaveBeenCalled();
    expect(deps.notifier.notify).not.toHaveBeenCalled();
  });
});

describe('a failed ping', () => {
  it('keeps the record verified and unpinged, and names the reason', async () => {
    const deps = createDeps({
      notifier: {
        notify: vi.fn(() =>
          Promise.resolve<NotifyResult>({ ok: false, reason: 'The hub answered 403.' })
        )
      }
    });
    const result = await publish(deps, { reason: 'update' });

    expect(result).toMatchObject({
      ok: false,
      failedStep: 'ping',
      reason: 'The hub answered 403.'
    });
    expect((await readRecords())[0]).toMatchObject({
      verified: true,
      pinged: false,
      failedStep: 'ping',
      failedReason: 'The hub answered 403.'
    });
  });
});

describe('validation before any upload', () => {
  it('refuses an invalid feed, names the node and the field, and uploads nothing (R7)', async () => {
    await writeFile(
      join(folder, 'show.json'),
      JSON.stringify({ revision: 1, title: '', link: '', description: '', ttl: 5 })
    );

    const deps = createDeps();
    const result = await publish(deps, { reason: 'update' });

    expect(result).toMatchObject({
      ok: false,
      failedStep: 'validate',
      failures: expect.arrayContaining([expect.objectContaining({ node: 'show', field: 'title' })])
    });
    expect(deps.objectStore.put).not.toHaveBeenCalled();
    expect(await readRecords()).toStrictEqual([]);
  });

  it('refuses audio that does not match its record, before any upload', async () => {
    await writeFile(join(folder, 'episodes/pilot/media/pilot.mp3'), 'different bytes');

    const deps = createDeps();
    const result = await publish(deps, { reason: 'update' });

    expect(result).toMatchObject({
      ok: false,
      failedStep: 'validate',
      failedFile: 'episodes/pilot/media/pilot.mp3'
    });
    expect(deps.objectStore.put).not.toHaveBeenCalled();
  });

  it('refuses a missing audio file, before any upload', async () => {
    await rm(join(folder, 'episodes/pilot/media/pilot.mp3'));

    const deps = createDeps();
    const result = await publish(deps, { reason: 'update' });

    expect(result).toMatchObject({ ok: false, failedStep: 'validate' });
    expect(deps.objectStore.put).not.toHaveBeenCalled();
  });

  it('refuses a file type outside the table, before any upload', async () => {
    await editEpisode((record) => ({
      ...record,
      podcast: { transcripts: [{ file: 'notes.exe', type: 'text/plain' }] }
    }));
    await writeFile(join(folder, 'episodes/pilot/notes.exe'), 'x');

    const deps = createDeps();
    const result = await publish(deps, { reason: 'update' });

    expect(result).toMatchObject({ ok: false, failedStep: 'validate' });
    expect(deps.objectStore.put).not.toHaveBeenCalled();
  });
});

describe('sidecar paths (KTD11)', () => {
  const useTranscript = async (file: string): Promise<void> => {
    await editEpisode((record) => ({
      ...record,
      podcast: { transcripts: [{ file, type: 'text/vtt' }] }
    }));
  };

  it.each(['../../secret.vtt', '/etc/secret.vtt', 'a//b.vtt'])(
    'refuses %s before any upload, and logs the event',
    async (file) => {
      await useTranscript(file);

      const deps = createDeps();
      const result = await publish(deps, { reason: 'update' });

      expect(result).toMatchObject({ ok: false, failedStep: 'validate' });
      expect(deps.objectStore.put).not.toHaveBeenCalled();
      expect(logLines(logSpy)).toContainEqual(
        expect.objectContaining({ event: 'publish_sidecar_path_rejected' })
      );
    }
  );

  it('refuses a symlink, built at test time, before any upload', async () => {
    const outside = await mkdtemp(join(tmpdir(), 'pod-fish-outside-'));

    await writeFile(join(outside, 'secret.vtt'), 'secret');
    await symlink(join(outside, 'secret.vtt'), join(folder, 'episodes/pilot/link.vtt'));
    await useTranscript('link.vtt');

    const deps = createDeps();
    const result = await publish(deps, { reason: 'update' });

    expect(result).toMatchObject({
      ok: false,
      failedStep: 'validate',
      failedFile: expect.any(String)
    });
    expect(deps.objectStore.put).not.toHaveBeenCalled();
    expect(logLines(logSpy)).toContainEqual(
      expect.objectContaining({ event: 'publish_sidecar_path_rejected' })
    );
    await rm(outside, { recursive: true, force: true });
  });

  it('uploads a real sidecar, and the feed points at its hashed key', async () => {
    const contents = 'WEBVTT';
    const sha256 = createHash('sha256').update(contents).digest('hex');

    await writeFile(join(folder, 'episodes/pilot/pilot.vtt'), contents);
    await useTranscript('pilot.vtt');

    const result = await publish(createDeps(), { reason: 'update' });
    const key = `placeholder-show/media/pilot/${sha256.slice(0, 16)}-pilot.vtt`;

    expect(result).toMatchObject({ ok: true });
    expect(objects.get(key)?.input).toMatchObject({
      contentType: 'text/vtt',
      cacheControl: 'public, max-age=31536000, immutable'
    });
    expect(objects.get(FEED_KEY)?.bytes.toString()).toContain(`https://example.com/${key}`);
  });
});

describe('a draft (R9)', () => {
  it('uploads no media for a draft episode', async () => {
    await mkdir(join(folder, 'episodes/unfinished/media'), { recursive: true });
    await writeFile(join(folder, 'episodes/unfinished/media/draft.mp3'), 'draft audio');

    const result = await publish(createDeps(), { reason: 'update' });

    expect(result).toMatchObject({ ok: true });
    expect([...objects.keys()].filter((key) => key.includes('unfinished'))).toStrictEqual([]);
  });
});

describe('the channel artwork', () => {
  const ARTWORK = 'placeholder png bytes';
  const ARTWORK_SHA = createHash('sha256').update(ARTWORK).digest('hex');
  const ARTWORK_KEY = `placeholder-show/media/show/${ARTWORK_SHA.slice(0, 16)}-artwork.png`;

  const useArtwork = async (file: string): Promise<void> => {
    const path = join(folder, 'show.json');

    await writeFile(
      path,
      JSON.stringify({ ...JSON.parse(await readFile(path, 'utf8')), artwork: { file } })
    );
  };

  beforeEach(async () => {
    await mkdir(join(folder, 'media'), { recursive: true });
    await writeFile(join(folder, 'media/artwork.png'), ARTWORK);
  });

  it('uploads it as an immutable image, and the feed names its hashed URL', async () => {
    await useArtwork('media/artwork.png');

    const result = await publish(createDeps(), { reason: 'update' });
    const feed = objects.get(FEED_KEY)?.bytes.toString();

    expect(result).toMatchObject({ ok: true });
    expect(objects.get(ARTWORK_KEY)?.input).toMatchObject({
      contentType: 'image/png',
      cacheControl: 'public, max-age=31536000, immutable',
      sha256: ARTWORK_SHA
    });
    expect(objects.get(ARTWORK_KEY)?.bytes.toString()).toBe(ARTWORK);
    expect(feed).toContain(`<itunes:image href="https://example.com/${ARTWORK_KEY}"/>`);
    expect(feed).toContain(`<url>https://example.com/${ARTWORK_KEY}</url>`);
    expect((await readRecords())[0].files).toContainEqual(
      expect.objectContaining({ key: ARTWORK_KEY, source: 'media/artwork.png', uploaded: true })
    );
  });

  it('uploads the artwork before the feed', async () => {
    await useArtwork('media/artwork.png');
    await publish(createDeps(), { reason: 'update' });

    expect(events.indexOf('put:media')).toBeLessThan(events.indexOf('put:feed'));
  });

  it('refuses a missing artwork file before any upload', async () => {
    await useArtwork('media/missing.png');

    const deps = createDeps();
    const result = await publish(deps, { reason: 'update' });

    expect(result).toMatchObject({
      ok: false,
      failedStep: 'validate',
      failedFile: 'media/missing.png'
    });
    expect(deps.objectStore.put).not.toHaveBeenCalled();
  });

  it('refuses an artwork symlink before any upload', async () => {
    const outside = await mkdtemp(join(tmpdir(), 'pod-fish-outside-'));

    await writeFile(join(outside, 'secret.png'), 'secret');
    await symlink(join(outside, 'secret.png'), join(folder, 'media/link.png'));
    await useArtwork('media/link.png');

    const deps = createDeps();
    const result = await publish(deps, { reason: 'update' });

    expect(result).toMatchObject({ ok: false, failedStep: 'validate' });
    expect(deps.objectStore.put).not.toHaveBeenCalled();
    await rm(outside, { recursive: true, force: true });
  });

  it.each(['../secret.png', '/etc/secret.png'])(
    'refuses the artwork path %s before any upload',
    async (file) => {
      await useArtwork(file);

      const deps = createDeps();
      const result = await publish(deps, { reason: 'update' });

      expect(result).toMatchObject({ ok: false, failedStep: 'validate' });
      expect(deps.objectStore.put).not.toHaveBeenCalled();
    }
  );

  it('refuses a file type outside the table', async () => {
    await writeFile(join(folder, 'media/artwork.gif'), 'x');
    await useArtwork('media/artwork.gif');

    const deps = createDeps();
    const result = await publish(deps, { reason: 'update' });

    expect(result).toMatchObject({ ok: false, failedStep: 'validate' });
    expect(deps.objectStore.put).not.toHaveBeenCalled();
  });
});
