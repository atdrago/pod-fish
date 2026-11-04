import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createContentStore } from '$lib/server/content/store';
import { validateContent } from './validate';

const FIXTURES = fileURLToPath(new URL('../../../../test/fixtures/content/', import.meta.url));

let folder: string;

const useFixture = async (name: string): Promise<void> => {
  await cp(join(FIXTURES, name), folder, { recursive: true });
};

const editJson = async (
  relativePath: string,
  edit: (value: Record<string, unknown>) => Record<string, unknown>
): Promise<void> => {
  const path = join(folder, relativePath);

  await writeFile(path, JSON.stringify(edit(JSON.parse(await readFile(path, 'utf8')))));
};

const failures = async () => {
  const found = validateContent(await createContentStore(folder).readSnapshot());

  return found.map(({ node, field }) => [node, field]);
};

beforeEach(async () => {
  folder = await mkdtemp(join(tmpdir(), 'pod-fish-validate-'));
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await rm(folder, { recursive: true, force: true });
});

describe('validateContent', () => {
  it.each(['basic', 'friday-minimum', 'full'])('passes the %s fixture', async (name) => {
    await useFixture(name);

    expect(await failures()).toStrictEqual([]);
  });

  it('names the live item and the status field for status="paused"', async () => {
    await useFixture('friday-minimum');
    await editJson('live/first-show/live.json', (value) => ({ ...value, status: 'paused' }));

    expect(await failures()).toContainEqual(['live:first-show', 'status']);
  });

  it('reports the empty channel of a first run', async () => {
    await createContentStore(folder).ensureShape();

    expect(await failures()).toStrictEqual([
      ['show', 'title'],
      ['show', 'link'],
      ['show', 'description']
    ]);
  });

  it('requires audio on a published episode, and not on a draft', async () => {
    await useFixture('basic');
    await editJson('episodes/pilot/episode.json', ({ media, ...value }) => value);

    expect(await failures()).toStrictEqual([['episode:pilot', 'media']]);
  });

  it('requires a content link on a published live item', async () => {
    await useFixture('friday-minimum');
    await editJson('live/first-show/live.json', ({ contentLink, ...value }) => value);

    expect(await failures()).toStrictEqual([['live:first-show', 'contentLink']]);
  });

  it('refuses a guid that two items share', async () => {
    await useFixture('basic');
    await editJson('live/first-show/live.json', (value) => ({
      ...value,
      guid: 'placeholder-pilot-guid'
    }));

    expect(await failures()).toStrictEqual([['live:first-show', 'guid']]);
  });
});
