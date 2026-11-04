import { createHash } from 'node:crypto';
import { generateRssFeed } from 'feedsmith';
import type { ContentSnapshot } from '$lib/server/content/store';
import { insertLiveItemChildren } from './liveItem';
import { publishedLiveItems, toFeedInput, type FeedConfig, type SidecarHashes } from './model';

export type GeneratedFeed = { xml: string; bytes: Buffer<ArrayBuffer>; sha256: string };

export const sha256Of = (bytes: Uint8Array): string =>
  createHash('sha256').update(bytes).digest('hex');

export const generateFeed = (
  snapshot: ContentSnapshot,
  config: FeedConfig,
  builtAt: Date,
  sidecarHashes: SidecarHashes
): GeneratedFeed => {
  const { show } = snapshot;

  if (show === undefined) {
    throw new Error('The feed needs a valid show.json. Run the validation first.');
  }

  const xml = insertLiveItemChildren(
    generateRssFeed(toFeedInput(show, snapshot, config, builtAt, sidecarHashes)),
    publishedLiveItems(snapshot).map(({ record }) => record)
  );
  const bytes = Buffer.from(xml, 'utf8');

  return { xml, bytes, sha256: sha256Of(bytes) };
};
