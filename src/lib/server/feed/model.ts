import type { generateRssFeed } from 'feedsmith';
import type { ContentSnapshot } from '$lib/server/content/store';
import type { EpisodeRecord, LiveItemRecord, ShowRecord } from '$lib/server/content/schemas';
import { mediaObjectKey, publicObjectUrl } from '$lib/server/publish/objectKeys';

type FeedInput = Parameters<typeof generateRssFeed>[0];
type ItemInput = NonNullable<FeedInput['items']>[number];
type ChannelTags = NonNullable<FeedInput['podcast']>;
type LiveItemInput = NonNullable<ChannelTags['liveItems']>[number];
type ItemTags = NonNullable<EpisodeRecord['podcast']>;

export type FeedConfig = {
  feedUrl: string;
  mediaBaseUrl: string;
  objectKeyPrefix: string;
};

type ItemFolder = 'episodes' | 'live';

export type SidecarReference = { folder: ItemFolder; slug: string; file: string; source: string };

/* The sha256 of each sidecar file, by its path in the content folder. */
export type SidecarHashes = ReadonlyMap<string, string>;

const APP_NAME = 'pod-fish';

const sidecarSource = (folder: ItemFolder, slug: string, file: string): string =>
  `${folder}/${slug}/${file}`;

const sidecarFilesOf = (tags: ItemTags | undefined): string[] =>
  [
    ...(tags?.transcripts ?? []).map((transcript) => transcript.file),
    tags?.chapters?.file,
    ...(tags?.images ?? []).map((image) => image.file)
  ].filter((file) => file !== undefined);

const publishedEpisodes = (snapshot: ContentSnapshot): ContentSnapshot['episodes'] =>
  snapshot.episodes
    .filter(({ record }) => !record.draft)
    .toSorted(
      (first, second) =>
        Date.parse(second.record.pubDate) - Date.parse(first.record.pubDate) ||
        first.slug.localeCompare(second.slug)
    );

export const publishedLiveItems = (snapshot: ContentSnapshot): ContentSnapshot['liveItems'] =>
  snapshot.liveItems
    .filter(({ record }) => !record.draft)
    .toSorted(
      (first, second) =>
        Date.parse(second.record.start) - Date.parse(first.record.start) ||
        first.slug.localeCompare(second.slug)
    );

export const listSidecarReferences = (snapshot: ContentSnapshot): SidecarReference[] => {
  const references = (
    folder: ItemFolder,
    entries: readonly { slug: string; record: { podcast?: ItemTags | undefined } }[]
  ): SidecarReference[] =>
    entries.flatMap(({ slug, record }) =>
      sidecarFilesOf(record.podcast).map((file) => ({
        folder,
        slug,
        file,
        source: sidecarSource(folder, slug, file)
      }))
    );

  return [
    ...references('episodes', publishedEpisodes(snapshot)),
    ...references('live', publishedLiveItems(snapshot))
  ];
};

const toItemTags = (
  tags: ItemTags,
  folder: ItemFolder,
  slug: string,
  config: FeedConfig,
  sidecarHashes: SidecarHashes
) => {
  const sidecarUrl = (file: string): string => {
    const source = sidecarSource(folder, slug, file);
    const sha256 = sidecarHashes.get(source);

    if (sha256 === undefined) {
      throw new Error(`${source} has no hash, so the feed cannot name its URL.`);
    }

    return publicObjectUrl(
      config.mediaBaseUrl,
      mediaObjectKey(config.objectKeyPrefix, slug, sha256, file)
    );
  };

  const urlOf = (url: string | undefined, file: string | undefined): string => {
    if (url !== undefined) {
      return url;
    }

    if (file !== undefined) {
      return sidecarUrl(file);
    }

    throw new Error(`A tag of ${folder}/${slug} has neither a URL nor a file.`);
  };

  const { transcripts, chapters, images, ...rest } = tags;

  return {
    ...rest,
    transcripts: transcripts?.map(({ url, file, ...transcript }) => ({
      ...transcript,
      url: urlOf(url, file)
    })),
    chapters:
      chapters === undefined
        ? undefined
        : { type: chapters.type, url: urlOf(chapters.url, chapters.file) },
    images: images?.map(({ href, file, ...image }) => ({ ...image, href: urlOf(href, file) }))
  };
};

const toEpisodeItem = (
  slug: string,
  record: EpisodeRecord,
  config: FeedConfig,
  sidecarHashes: SidecarHashes
): ItemInput => {
  const { media } = record;

  return {
    title: record.title,
    description: record.description,
    link: record.link,
    guid: { value: record.guid, isPermaLink: false },
    pubDate: new Date(record.pubDate),
    enclosures:
      media === undefined
        ? undefined
        : [
            {
              url: publicObjectUrl(
                config.mediaBaseUrl,
                mediaObjectKey(config.objectKeyPrefix, slug, media.sha256, media.file)
              ),
              length: media.length,
              type: media.type
            }
          ],
    itunes: {
      ...record.itunes,
      duration: media?.durationSeconds
    },
    podcast:
      record.podcast === undefined
        ? undefined
        : toItemTags(record.podcast, 'episodes', slug, config, sidecarHashes)
  };
};

const toLiveItem = (
  slug: string,
  record: LiveItemRecord,
  config: FeedConfig,
  sidecarHashes: SidecarHashes
): LiveItemInput => ({
  ...(record.podcast === undefined
    ? {}
    : toItemTags(record.podcast, 'live', slug, config, sidecarHashes)),
  status: record.status,
  start: new Date(record.start),
  end: record.end === undefined ? undefined : new Date(record.end),
  contentLinks: record.contentLink === undefined ? undefined : [record.contentLink]
});

/*
	The one adapter from the content records to the input of the generator (KTD4).
	It excludes drafts (R9). The order of `podcast.liveItems` is the order that
	`insertLiveItemChildren` relies on.
*/
export const toFeedInput = (
  show: ShowRecord,
  snapshot: ContentSnapshot,
  config: FeedConfig,
  builtAt: Date,
  sidecarHashes: SidecarHashes
): FeedInput => {
  const { revision, podcast, ...channel } = show;
  const liveItems = publishedLiveItems(snapshot).map(({ slug, record }) =>
    toLiveItem(slug, record, config, sidecarHashes)
  );

  return {
    ...channel,
    lastBuildDate: builtAt,
    generator: APP_NAME,
    atom: { links: [{ href: config.feedUrl, rel: 'self', type: 'application/rss+xml' }] },
    podcast: {
      ...podcast,
      liveItems: liveItems.length > 0 ? liveItems : undefined
    },
    items: publishedEpisodes(snapshot).map(({ slug, record }) =>
      toEpisodeItem(slug, record, config, sidecarHashes)
    )
  };
};
