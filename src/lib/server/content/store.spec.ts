import { cp, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createContentStore } from './store';
import type { LiveItemRecord, PublishRecord } from './schemas';

const FIXTURE = fileURLToPath(new URL('../../../../test/fixtures/content/basic', import.meta.url));

let parentFolder: string;
let folder: string;

const logLines = (spy: { mock: { calls: unknown[][] } }): Record<string, unknown>[] =>
  spy.mock.calls.map((call) => JSON.parse(String(call[0])));

const useFixture = async (): Promise<void> => {
  await cp(FIXTURE, folder, { recursive: true });
};

const LIVE_ITEM: LiveItemRecord = {
  revision: 2,
  draft: false,
  title: 'Second show',
  guid: 'placeholder-second-show-guid',
  description: 'The second live show.',
  status: 'pending',
  start: '2026-11-13T20:00:00-05:00',
  durationMinutes: 120,
  enclosure: { url: 'https://example.com/live.mp3', type: 'audio/mpeg' }
};

const PUBLISH_RECORD: PublishRecord = {
  startedAt: '2026-11-04T16:00:00.000Z',
  builtAt: '2026-11-04T16:00:00.000Z',
  reason: 'update',
  feedKey: 'placeholder-show/feed.xml',
  feedSha256: 'abc',
  files: [],
  liveItems: [],
  feedUploaded: true,
  verified: false,
  pinged: false
};

beforeEach(async () => {
  parentFolder = await mkdtemp(join(tmpdir(), 'pod-fish-store-'));
  folder = join(parentFolder, 'show');
  await mkdir(folder);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await rm(parentFolder, { recursive: true, force: true });
});

describe('the first run (F1)', () => {
  it('creates show.json, the three folders, and the media rule in an empty folder', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);

    await createContentStore(folder).ensureShape();

    expect((await readdir(folder)).toSorted()).toStrictEqual([
      '.gitignore',
      'episodes',
      'live',
      'publish',
      'show.json'
    ]);
    expect(await readFile(join(folder, '.gitignore'), 'utf8')).toContain('episodes/*/media/');

    const snapshot = await createContentStore(folder).readSnapshot();

    expect(snapshot.problems).toStrictEqual([]);
    expect(snapshot.show?.ttl).toBe(5);
  });

  it('changes nothing on a second run', async () => {
    const store = createContentStore(folder);

    await store.ensureShape();
    await writeFile(join(folder, 'show.json'), '{"revision":9}\n');
    await writeFile(join(folder, '.gitignore'), 'kept\n');
    await store.ensureShape();

    expect(await readFile(join(folder, 'show.json'), 'utf8')).toBe('{"revision":9}\n');
    expect(await readFile(join(folder, '.gitignore'), 'utf8')).toBe('kept\n');
  });

  it('keeps a media file that is already in the folder', async () => {
    await mkdir(join(folder, 'episodes/001/media'), { recursive: true });
    await writeFile(join(folder, 'episodes/001/media/001.mp3'), 'audio');

    await createContentStore(folder).ensureShape();

    expect((await stat(join(folder, 'episodes/001/media/001.mp3'))).size).toBe(5);
  });
});

describe('reading the content folder', () => {
  it('returns the channel, the episodes with the draft flagged, and the live item', async () => {
    await useFixture();

    const snapshot = await createContentStore(folder).readSnapshot();

    expect(snapshot.problems).toStrictEqual([]);
    expect(snapshot.show).toMatchObject({ title: 'Placeholder Show', ttl: 5, revision: 3 });
    expect(snapshot.episodes.map(({ slug, record }) => [slug, record.draft])).toStrictEqual([
      ['pilot', false],
      ['unfinished', true]
    ]);
    expect(snapshot.liveItems).toHaveLength(1);
    expect(snapshot.liveItems[0].record).toMatchObject({
      durationMinutes: 120,
      contentLink: { href: 'https://example.com/placeholder-show' }
    });
  });

  it('reports a file with an unknown shape and logs its path, with no throw', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    await useFixture();
    await writeFile(
      join(folder, 'live/first-show/live.json'),
      JSON.stringify({ revision: 1, status: 'paused' })
    );

    const snapshot = await createContentStore(folder).readSnapshot();

    expect(snapshot.liveItems).toStrictEqual([]);
    expect(snapshot.problems.map(({ node, field }) => [node, field])).toContainEqual([
      'live:first-show',
      'status'
    ]);
    expect(logLines(spy)).toContainEqual(
      expect.objectContaining({
        event: 'content_file_invalid',
        key: 'live/first-show/live.json'
      })
    );
  });

  it('reports a misspelled key, which a hand edit can introduce', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    await useFixture();

    const path = join(folder, 'show.json');
    const show: unknown = JSON.parse(await readFile(path, 'utf8'));

    await writeFile(path, JSON.stringify({ ...(show as object), tittle: 'Typo' }));

    const snapshot = await createContentStore(folder).readSnapshot();

    expect(snapshot.show).toBeUndefined();
    expect(snapshot.problems.map(({ field }) => field)).toContain('tittle');
  });

  it('reports a file that is not JSON', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    await useFixture();
    await writeFile(join(folder, 'show.json'), '{ not json');

    const snapshot = await createContentStore(folder).readSnapshot();

    expect(snapshot.problems).toContainEqual({
      node: 'show',
      field: '',
      message: 'show.json is not valid JSON.'
    });
  });

  it('skips a folder that holds only media, and logs it', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    await useFixture();
    await mkdir(join(folder, 'episodes/no-record/media'), { recursive: true });

    const snapshot = await createContentStore(folder).readSnapshot();

    expect(snapshot.episodes.map(({ slug }) => slug)).not.toContain('no-record');
    expect(logLines(spy)).toContainEqual(
      expect.objectContaining({ event: 'content_item_without_record' })
    );
  });
});

describe('writing the content folder', () => {
  it('writes a record, and the next read returns it', async () => {
    const store = createContentStore(folder);

    await store.ensureShape();

    expect(await store.writeLiveItem('second-show', LIVE_ITEM)).toStrictEqual({ ok: true });
    expect((await store.readSnapshot()).liveItems[0].record).toStrictEqual(LIVE_ITEM);
    expect(await readdir(join(folder, 'live/second-show'))).toStrictEqual(['live.json']);
  });

  it('refuses a stale revision and leaves the file unchanged', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const store = createContentStore(folder);

    await store.ensureShape();
    await store.writeLiveItem('second-show', LIVE_ITEM);

    const before = await readFile(join(folder, 'live/second-show/live.json'), 'utf8');
    const result = await store.writeLiveItem('second-show', { ...LIVE_ITEM, title: 'Stale' });

    expect(result).toMatchObject({ ok: false, reason: 'stale' });
    expect(await readFile(join(folder, 'live/second-show/live.json'), 'utf8')).toBe(before);
    expect(logLines(spy)).toContainEqual(expect.objectContaining({ event: 'content_write_stale' }));
  });

  it('accepts a newer revision', async () => {
    const store = createContentStore(folder);

    await store.ensureShape();
    await store.writeLiveItem('second-show', LIVE_ITEM);

    expect(
      await store.writeLiveItem('second-show', { ...LIVE_ITEM, revision: 3, status: 'live' })
    ).toStrictEqual({ ok: true });
  });

  it('refuses a record that fails its schema', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const store = createContentStore(folder);

    await store.ensureShape();

    const result = await store.writeLiveItem('second-show', {
      ...LIVE_ITEM,
      status: 'paused'
    } as unknown as LiveItemRecord);

    expect(result).toMatchObject({ ok: false, reason: 'invalid' });
  });

  it.each(['../escape', '..', 'a/../../escape', '/etc/escape', '.hidden', 'a/b'])(
    'never writes outside the content folder for the slug %s',
    async (slug) => {
      vi.spyOn(console, 'log').mockImplementation(() => undefined);
      const store = createContentStore(folder);

      await store.ensureShape();

      const results = await Promise.all([
        store.writeLiveItem(slug, LIVE_ITEM),
        store.writeEpisode(slug, {
          revision: 1,
          draft: false,
          title: 'x',
          guid: 'x',
          description: 'x',
          pubDate: '2026-11-01T12:00:00.000Z'
        }),
        store.writePublishRecord(slug, PUBLISH_RECORD),
        store.deleteLiveItem(slug)
      ]);

      expect(results.map((result) => result.ok)).toStrictEqual([false, false, false, false]);
      expect(await readdir(parentFolder)).toStrictEqual(['show']);
    }
  );

  it('writes and rereads a publish record, and overwrites it on update', async () => {
    const store = createContentStore(folder);

    await store.ensureShape();
    await store.writePublishRecord('2026-11-04t16-00-00', PUBLISH_RECORD);
    await store.writePublishRecord('2026-11-04t16-00-00', { ...PUBLISH_RECORD, verified: true });

    expect(await store.readPublishRecords()).toStrictEqual([
      { name: '2026-11-04t16-00-00', record: { ...PUBLISH_RECORD, verified: true } }
    ]);
  });

  it('deletes a live item folder', async () => {
    const store = createContentStore(folder);

    await store.ensureShape();
    await store.writeLiveItem('second-show', LIVE_ITEM);

    expect(await store.deleteLiveItem('second-show')).toStrictEqual({ ok: true });
    expect((await store.readSnapshot()).liveItems).toStrictEqual([]);
  });
});
