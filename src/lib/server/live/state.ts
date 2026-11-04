import type { LiveItemView, LiveView, RetryChoice, StreamStatus } from '$lib/liveView';
import type { LiveItemRecord, PublishRecord } from '$lib/server/content/schemas';
import type { ContentSnapshot, PublishEntry } from '$lib/server/content/store';
import { generateFeed, sha256Of } from '$lib/server/feed/generate';
import { validateContent } from '$lib/server/feed/validate';
import { errMessage, log } from '$lib/server/log';
import { readSidecarHashes, type PublishDeps } from '$lib/server/publish/publish';

export type LiveDeps = PublishDeps & {
  mountUrl: string;
  showPageUrl: string;
  readStreamStatus: () => Promise<StreamStatus>;
  createGuid: () => string;
  isPublishInFlight: () => boolean;
};

type LiveEntry = ContentSnapshot['liveItems'][number];

type PublicFeed =
  | { state: 'none' }
  | { state: 'matched'; feedSha256: string; entry: PublishEntry }
  | { state: 'unmatched'; feedSha256: string }
  | { state: 'offline' };

export type RetryPlan = {
  failedStep: string;
  reason: string;
  choices: RetryChoice[];
  preselected: RetryChoice;
  pingReason: PublishRecord['reason'];
  entry: PublishEntry | undefined;
};

const newestFirst = (first: LiveEntry, second: LiveEntry): number =>
  Date.parse(second.record.start) - Date.parse(first.record.start);

export const openItems = (snapshot: ContentSnapshot): LiveEntry[] =>
  snapshot.liveItems
    .filter(({ record }) => !record.draft && record.status !== 'ended')
    .toSorted(newestFirst);

/* KTD9. The newest live item that is neither ended nor a draft. A live one always wins. */
export const pickSubject = (snapshot: ContentSnapshot): LiveEntry | undefined => {
  const items = openItems(snapshot);

  return items.find(({ record }) => record.status === 'live') ?? items.at(0);
};

export const draftSlugsOf = (snapshot: ContentSnapshot): string[] =>
  snapshot.liveItems.filter(({ record }) => record.draft).map(({ slug }) => slug);

const readPublicFeed = async (
  { fetch: fetchFunction, config, userAgent }: LiveDeps,
  records: readonly PublishEntry[]
): Promise<PublicFeed> => {
  try {
    const response = await fetchFunction(config.feedUrl, {
      headers: { 'user-agent': userAgent }
    });

    if (response.status === 404) {
      await response.body?.cancel();

      return { state: 'none' };
    }

    if (response.status !== 200) {
      await response.body?.cancel();
      log.warn('live_public_feed_failed', { step: 'status', status: response.status });

      return { state: 'offline' };
    }

    const feedSha256 = sha256Of(Buffer.from(await response.arrayBuffer()));
    const entry = records.findLast(
      ({ record }) => record.feedUploaded && record.feedSha256 === feedSha256
    );

    return entry === undefined
      ? { state: 'unmatched', feedSha256 }
      : { state: 'matched', feedSha256, entry };
  } catch (error) {
    log.warn('live_public_feed_failed', { step: 'status', error: errMessage(error) });

    return { state: 'offline' };
  }
};

/* The record that says what the public feed holds, or the newest one when offline. */
const publishedRecord = (
  publicFeed: PublicFeed,
  records: readonly PublishEntry[]
): PublishEntry | undefined => {
  if (publicFeed.state === 'matched') {
    return publicFeed.entry;
  }

  return publicFeed.state === 'offline'
    ? records.findLast(({ record }) => record.feedUploaded)
    : undefined;
};

const choicesFor = (
  failedStep: NonNullable<PublishRecord['failedStep']>
): { choices: RetryChoice[]; preselected: RetryChoice } => {
  if (failedStep === 'verify') {
    return { choices: ['verify', 'publish'], preselected: 'verify' };
  }

  if (failedStep === 'ping') {
    return { choices: ['ping'], preselected: 'ping' };
  }

  return { choices: ['publish'], preselected: 'publish' };
};

/*
	R28. Only the choices that fit the failed step, so no path offers a ping before
	verify has passed. A flip that reached no record is the case of a crash between the
	write and the publish.
*/
const planRetry = (
  snapshot: ContentSnapshot,
  records: readonly PublishEntry[],
  publicFeed: PublicFeed
): RetryPlan | null => {
  const latest = records.at(-1);

  if (latest?.record.failedStep !== undefined) {
    return {
      failedStep: latest.record.failedStep,
      reason: latest.record.failedReason ?? 'The last publish did not finish.',
      ...choicesFor(latest.record.failedStep),
      pingReason: latest.record.reason,
      entry: latest
    };
  }

  if (publicFeed.state === 'unmatched' && latest?.record.feedUploaded === true) {
    return {
      failedStep: 'verify',
      reason: 'A publish did not finish: the public feed matches no publish record.',
      ...choicesFor('verify'),
      pingReason: latest.record.reason,
      entry: latest
    };
  }

  const snapshotRecord = publishedRecord(publicFeed, records);
  const unpublishedFlip = snapshot.liveItems.find(({ slug, record }) => {
    if (record.draft || record.status === 'pending') {
      return false;
    }

    const published = snapshotRecord?.record.liveItems.find((item) => item.slug === slug);

    return published?.status !== record.status;
  });

  if (publicFeed.state !== 'offline' && unpublishedFlip !== undefined) {
    return {
      failedStep: 'publish',
      reason: `${unpublishedFlip.slug} changed to ${unpublishedFlip.record.status}, and that change is not public yet.`,
      ...choicesFor('feed'),
      pingReason: unpublishedFlip.record.status === 'live' ? 'live' : 'liveEnd',
      entry: undefined
    };
  }

  return null;
};

export const loadRetryPlan = async (deps: LiveDeps): Promise<RetryPlan | null> => {
  const snapshot = await deps.store.readSnapshot();
  const records = await deps.store.readPublishRecords();

  /* A failed run decides the plan by itself, so this reads the public feed only when needed. */
  return records.at(-1)?.record.failedStep === undefined
    ? planRetry(snapshot, records, await readPublicFeed(deps, records))
    : planRetry(snapshot, records, { state: 'none' });
};

const toItemView = (
  { slug, record }: LiveEntry,
  published: PublishEntry | undefined
): LiveItemView => {
  const publishedItem = published?.record.liveItems.find((item) => item.slug === slug);

  return {
    slug,
    title: record.title,
    status: record.status,
    start: record.start,
    end: record.end,
    durationMinutes: record.durationMinutes,
    published:
      publishedItem === undefined
        ? null
        : { status: publishedItem.status, start: publishedItem.start, end: publishedItem.end }
  };
};

const countItemChanges = (record: LiveItemRecord, published: LiveItemView['published']): number =>
  (['status', 'start', 'end'] as const).filter((field) =>
    published === null ? record[field] !== undefined : record[field] !== published[field]
  ).length;

const generatedFeedDiffers = async (
  deps: LiveDeps,
  snapshot: ContentSnapshot,
  published: PublishEntry | undefined
): Promise<boolean> => {
  if (published === undefined || snapshot.problems.length > 0) {
    return true;
  }

  const sidecarHashes = await readSidecarHashes(snapshot, deps.contentFolder);

  if (sidecarHashes === undefined) {
    return true;
  }

  /* The record's own build time, so the clock alone never counts as a change. */
  const { sha256 } = generateFeed(
    snapshot,
    deps.config,
    new Date(published.record.builtAt),
    sidecarHashes
  );

  return sha256 !== published.record.feedSha256;
};

export const loadLiveView = async (deps: LiveDeps): Promise<LiveView> => {
  const snapshot = await deps.store.readSnapshot();
  const records = await deps.store.readPublishRecords();
  const [publicFeed, source] = await Promise.all([
    readPublicFeed(deps, records),
    deps.readStreamStatus()
  ]);
  const published = publishedRecord(publicFeed, records);
  const subject = pickSubject(snapshot);
  const ended = snapshot.liveItems
    .filter(({ record }) => !record.draft && record.status === 'ended')
    .toSorted(newestFirst);
  const focus = subject ?? ended.at(0);
  const focusView = focus === undefined ? undefined : toItemView(focus, published);
  const retry = planRetry(snapshot, records, publicFeed);

  return {
    publishInFlight: deps.isPublishInFlight(),
    subject: subject === undefined ? null : toItemView(subject, published),
    ended: ended.map((entry) => toItemView(entry, published)),
    draftSlugs: draftSlugsOf(snapshot),
    publicFeed: {
      state: publicFeed.state,
      feedSha256: 'feedSha256' in publicFeed ? publicFeed.feedSha256 : undefined,
      recordName: published?.name
    },
    unpublishedChanges:
      (focus === undefined || focusView === undefined
        ? 0
        : countItemChanges(focus.record, focusView.published)) +
      ((await generatedFeedDiffers(deps, snapshot, published)) ? 1 : 0),
    failures: validateContent(snapshot),
    source,
    retry:
      retry === null
        ? null
        : {
            failedStep: retry.failedStep,
            reason: retry.reason,
            choices: retry.choices,
            preselected: retry.preselected
          }
  };
};
