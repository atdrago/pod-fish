import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SyntaxValidator } from 'fast-xml-validator';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createContentStore } from '$lib/server/content/store';
import { generateFeed, sha256Of } from './generate';
import { listSidecarReferences, type SidecarHashes } from './model';

const FIXTURES = fileURLToPath(new URL('../../../../test/fixtures/content/', import.meta.url));
const CONFIG = {
  feedUrl: 'https://example.com/placeholder-show/feed.xml',
  mediaBaseUrl: 'https://example.com',
  objectKeyPrefix: 'placeholder-show'
};
const BUILT_AT = new Date('2026-11-04T16:00:00.000Z');
const RFC_822 = /^[A-Z][a-z]{2}, \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} GMT$/;
const NO_SIDECARS: SidecarHashes = new Map();
const SIDECAR_HASH = 'f'.repeat(64);

const generateFromFixture = async (name: string, builtAt = BUILT_AT) => {
  const snapshot = await createContentStore(join(FIXTURES, name)).readSnapshot();

  expect(snapshot.problems).toStrictEqual([]);

  const sidecarHashes = new Map(
    listSidecarReferences(snapshot).map(({ source }) => [source, SIDECAR_HASH])
  );

  return generateFeed(snapshot, CONFIG, builtAt, sidecarHashes);
};

const removeElements = (xml: string, pattern: RegExp): string => xml.replace(pattern, '');

const ITEM = /<item>[\s\S]*?<\/item>/;
const LIVE_ITEM = /<podcast:liveItem\b[\s\S]*?<\/podcast:liveItem>/;

const sections = (xml: string) => {
  const item = ITEM.exec(xml)?.[0] ?? '';
  const live = LIVE_ITEM.exec(xml)?.[0] ?? '';
  const channel = removeElements(
    removeElements(xml, new RegExp(ITEM, 'g')),
    new RegExp(LIVE_ITEM, 'g')
  );

  return { channel, item, live };
};

let folder: string;

beforeEach(async () => {
  folder = await mkdtemp(join(tmpdir(), 'pod-fish-generate-'));
});

afterEach(async () => {
  vi.restoreAllMocks();
  await rm(folder, { recursive: true, force: true });
});

describe('the well-formedness check', () => {
  it('throws on a malformed document, so a pass means something', () => {
    expect(() => SyntaxValidator.validate('<a><b></a>')).toThrow();
  });
});

describe('the full fixture', () => {
  it.each([
    ['locked', 'channel'],
    ['funding', 'channel'],
    ['person', 'channel'],
    ['person', 'item'],
    ['person', 'live'],
    ['location', 'channel'],
    ['location', 'item'],
    ['trailer', 'channel'],
    ['license', 'channel'],
    ['license', 'item'],
    ['guid', 'channel'],
    ['value', 'channel'],
    ['value', 'item'],
    ['valueRecipient', 'channel'],
    ['valueRecipient', 'item'],
    ['valueTimeSplit', 'channel'],
    ['valueTimeSplit', 'item'],
    ['medium', 'channel'],
    ['image', 'channel'],
    ['image', 'item'],
    ['block', 'channel'],
    ['txt', 'channel'],
    ['txt', 'item'],
    ['remoteItem', 'channel'],
    ['podroll', 'channel'],
    ['updateFrequency', 'channel'],
    ['podping', 'channel'],
    ['publisher', 'channel'],
    ['chat', 'channel'],
    ['chat', 'item'],
    ['chat', 'live'],
    ['transcript', 'item'],
    ['chapters', 'item'],
    ['soundbite', 'item'],
    ['season', 'item'],
    ['episode', 'item'],
    ['alternateEnclosure', 'item'],
    ['source', 'item'],
    ['integrity', 'item'],
    ['socialInteract', 'item'],
    ['contentLink', 'live']
  ] as const)('emits podcast:%s at the %s level', async (tag, level) => {
    const { xml } = await generateFromFixture('full');

    expect(sections(xml)[level]).toMatch(new RegExp(`<podcast:${tag}[ >/]`));
  });

  it('covers all 31 active tags, with liveItem as the element that holds a live item', async () => {
    const { xml } = await generateFromFixture('full');
    const names = new Set([...xml.matchAll(/<podcast:([A-Za-z]+)/g)].map((match) => match[1]));

    expect(names.size).toBe(31);
    expect(names).toContain('liveItem');
  });

  it('never emits the deprecated podcast:images', async () => {
    const { xml } = await generateFromFixture('full');

    expect(xml).not.toContain('podcast:images');
  });

  it('parses as well-formed XML', async () => {
    const { xml } = await generateFromFixture('full');

    expect(() => SyntaxValidator.validate(xml)).not.toThrow();
  });

  it('points each sidecar reference at its hashed key under the show prefix', async () => {
    const { xml } = await generateFromFixture('full');

    expect(xml).toContain(
      'https://example.com/placeholder-show/media/pilot/ffffffffffffffff-pilot.vtt'
    );
    expect(xml).toContain(
      'https://example.com/placeholder-show/media/pilot/ffffffffffffffff-pilot.chapters.json'
    );
    expect(xml).toContain(
      'https://example.com/placeholder-show/media/pilot/ffffffffffffffff-pilot.png'
    );
    expect(xml).not.toContain('file=');
  });

  it('describes the audio with its URL, length, type, and duration', async () => {
    const { xml } = await generateFromFixture('full');
    const { item } = sections(xml);

    expect(item).toContain(
      '<enclosure url="https://example.com/placeholder-show/media/pilot/0000000000000000-pilot.mp3" length="1234" type="audio/mpeg"/>'
    );
    expect(item).toContain('<itunes:duration>30</itunes:duration>');
    expect(item).toContain('<guid isPermaLink="false">placeholder-pilot-guid</guid>');
  });
});

describe('the Friday-minimum fixture', () => {
  it('declares the namespace once at the root, with no episode in the feed', async () => {
    const { xml } = await generateFromFixture('friday-minimum');

    expect(xml.match(/xmlns:podcast="https:\/\/podcastindex\.org\/namespace\/1\.0"/g)).toHaveLength(
      1
    );
    expect(xml.indexOf('xmlns:podcast')).toBeLessThan(xml.indexOf('<channel>'));
    expect(xml).not.toContain('<item>');
  });

  it('emits the ttl, the self link, and the generator', async () => {
    const { xml } = await generateFromFixture('friday-minimum');

    expect(xml).toContain('<ttl>5</ttl>');
    expect(xml).toContain(
      '<atom:link href="https://example.com/placeholder-show/feed.xml" rel="self" type="application/rss+xml"/>'
    );
    expect(xml).toContain('<generator>pod-fish</generator>');
  });

  it('carries the attributes, the namespace child, and the five inserted children', async () => {
    const { xml } = await generateFromFixture('friday-minimum');
    const live = LIVE_ITEM.exec(xml)?.[0];

    expect(live).toContain('status="pending"');
    expect(live).toContain('start="2026-11-07T01:00:00.000Z"');
    expect(live).toContain('end="2026-11-07T03:00:00.000Z"');
    expect(live).toContain(
      '<podcast:contentLink href="https://example.com/placeholder-show">Listen live</podcast:contentLink>'
    );
    expect(live).toContain('<title>First show</title>');
    expect(live).toContain('<guid isPermaLink="false">placeholder-first-show-guid</guid>');
    expect(live).toContain(
      '<enclosure url="https://example.com/placeholder-show/live.mp3" type="audio/mpeg" length="0"/>'
    );
    expect(live).toContain('<description>The first live show.</description>');
    expect(live).toContain('<pubDate>Sat, 07 Nov 2026 01:00:00 GMT</pubDate>');
  });

  it('formats pubDate and lastBuildDate as RFC 822, and start as ISO 8601 with an offset', async () => {
    const { xml } = await generateFromFixture('friday-minimum');

    expect(/<pubDate>(.*?)<\/pubDate>/.exec(xml)?.[1]).toMatch(RFC_822);
    expect(/<lastBuildDate>(.*?)<\/lastBuildDate>/.exec(xml)?.[1]).toMatch(RFC_822);
    expect(/ start="(.*?)"/.exec(xml)?.[1]).toMatch(
      /^\d{4}-\d{2}-\d{2}T[\d:.]+(?:Z|[+-]\d{2}:\d{2})$/
    );
  });

  it('omits the end attribute when a live item has no end, and stays well-formed', async () => {
    await cp(join(FIXTURES, 'friday-minimum'), folder, { recursive: true });

    const path = join(folder, 'live/first-show/live.json');
    const {
      end: _end,
      contentLink: _contentLink,
      ...record
    } = JSON.parse(await readFile(path, 'utf8'));

    await writeFile(path, JSON.stringify(record));

    const snapshot = await createContentStore(folder).readSnapshot();
    const { xml } = generateFeed(snapshot, CONFIG, BUILT_AT, NO_SIDECARS);

    expect(xml).not.toContain(' end="');
    expect(xml).toContain('<title>First show</title>');
    expect(xml).toContain('</podcast:liveItem>');
    expect(() => SyntaxValidator.validate(xml)).not.toThrow();
  });

  it('keeps the title of a live item well-formed with hard characters', async () => {
    await cp(join(FIXTURES, 'friday-minimum'), folder, { recursive: true });

    const path = join(folder, 'live/first-show/live.json');
    const record = JSON.parse(await readFile(path, 'utf8'));
    const showPath = join(folder, 'show.json');
    const show = JSON.parse(await readFile(showPath, 'utf8'));

    await writeFile(path, JSON.stringify({ ...record, title: 'A & B <c> ]]> 🐟' }));
    await writeFile(showPath, JSON.stringify({ ...show, title: 'A & B <c> ]]> 🐟' }));

    const snapshot = await createContentStore(folder).readSnapshot();
    const { xml } = generateFeed(snapshot, CONFIG, BUILT_AT, NO_SIDECARS);

    expect(xml).toContain('<title>A &amp; B &lt;c&gt; ]]&gt; 🐟</title>');
    expect(xml).toContain('🐟');
    expect(() => SyntaxValidator.validate(xml)).not.toThrow();
  });
});

describe('the basic fixture', () => {
  it('excludes a draft episode (AE3)', async () => {
    const { xml } = await generateFromFixture('basic');

    expect(xml.match(/<item>/g)).toHaveLength(1);
    expect(xml).toContain('Pilot');
    expect(xml).not.toContain('Unfinished');
  });

  it('excludes a draft live item', async () => {
    await cp(join(FIXTURES, 'basic'), folder, { recursive: true });

    const path = join(folder, 'live/first-show/live.json');
    const record = JSON.parse(await readFile(path, 'utf8'));

    await writeFile(path, JSON.stringify({ ...record, draft: true }));

    const snapshot = await createContentStore(folder).readSnapshot();
    const { xml } = generateFeed(snapshot, CONFIG, BUILT_AT, NO_SIDECARS);

    expect(xml).not.toContain('podcast:liveItem');
  });
});

describe('determinism', () => {
  it('produces the same bytes and the same sha256 from the same folder and clock', async () => {
    const first = await generateFromFixture('full');
    const second = await generateFromFixture('full');

    expect(second.xml).toBe(first.xml);
    expect(second.sha256).toBe(first.sha256);
    expect(first.sha256).toBe(sha256Of(first.bytes));
  });

  it('changes the sha256 when the clock changes', async () => {
    const first = await generateFromFixture('full');
    const second = await generateFromFixture('full', new Date('2026-11-05T16:00:00.000Z'));

    expect(second.sha256).not.toBe(first.sha256);
  });
});

describe('a missing channel', () => {
  it('fails with a message, because publish validates first', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);

    await writeFile(join(folder, 'show.json'), '{ not json');

    const snapshot = await createContentStore(folder).readSnapshot();

    expect(() => generateFeed(snapshot, CONFIG, BUILT_AT, NO_SIDECARS)).toThrow(/show\.json/);
  });

  it('fails when a sidecar has no hash', async () => {
    const snapshot = await createContentStore(join(FIXTURES, 'full')).readSnapshot();

    expect(() => generateFeed(snapshot, CONFIG, BUILT_AT, NO_SIDECARS)).toThrow(/has no hash/);
  });
});
