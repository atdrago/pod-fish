import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, realpath } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { PublishOutcome } from '$lib/publishOutcome';
import { EPISODES_FOLDER, MEDIA_FOLDER } from '$lib/server/content/paths';
import type { PublishRecord } from '$lib/server/content/schemas';
import type { ContentSnapshot, ContentStore, PublishEntry } from '$lib/server/content/store';
import { contentTypeFor } from '$lib/server/feed/contentTypes';
import { generateFeed } from '$lib/server/feed/generate';
import {
  listSidecarReferences,
  publishedEpisodes,
  publishedLiveItems,
  type FeedConfig
} from '$lib/server/feed/model';
import { validateContent } from '$lib/server/feed/validate';
import { errMessage, log } from '$lib/server/log';
import type { Notifier } from '$lib/server/podping/notifier';
import { feedObjectKey, mediaObjectKey } from './objectKeys';
import { createPublishLog, recordNameFor, snapshotLiveItems } from './publishLog';
import type { ObjectStore } from './r2Client';
import { verifyPublicFeed } from './verifyPublic';

export type PublishDeps = {
  store: ContentStore;
  contentFolder: string;
  objectStore: ObjectStore;
  fetch: typeof fetch;
  notifier: Notifier;
  clock: () => Date;
  sleep: (delayMs: number) => Promise<void>;
  config: FeedConfig;
  userAgent: string;
};

type FailedOutcome = Extract<PublishOutcome, { ok: false }>;

type UploadFile = {
  source: string;
  absolutePath: string;
  key: string;
  sha256: string;
  length: number;
  contentType: string;
};

type ReadFile = { absolutePath: string; sha256: string; length: number };

const FEED_CONTENT_TYPE = 'application/rss+xml; charset=utf-8';
const FEED_CACHE_CONTROL = 'no-cache';
const MEDIA_CACHE_CONTROL = 'public, max-age=31536000, immutable';

/*
	A stream, not a buffer, so a long episode does not sit in memory. A file reference
	stays open only for the PUT.
*/
const openFileStream = (absolutePath: string): ReadableStream<Uint8Array<ArrayBuffer>> =>
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- The Node and DOM declarations of ReadableStream do not compose, and fetch accepts this stream at run time.
  Readable.toWeb(createReadStream(absolutePath)) as unknown as ReadableStream<
    Uint8Array<ArrayBuffer>
  >;

const hashFile = async (absolutePath: string): Promise<string> => {
  const hash = createHash('sha256');

  await pipeline(createReadStream(absolutePath), hash);

  return hash.digest('hex');
};

const failValidation = (reason: string, failedFile: string): FailedOutcome => ({
  ok: false,
  failedStep: 'validate',
  reason,
  failedFile
});

/*
	KTD11. The schema already refuses an absolute path and a dot segment. This catches
	what a string cannot show: a symlink, or a symlinked folder on the way to the file.
*/
const readItemFile = async (
  contentFolder: string,
  itemFolder: string,
  relativePath: string,
  source: string
): Promise<ReadFile | FailedOutcome> => {
  const absolutePath = join(contentFolder, itemFolder, relativePath);

  try {
    const stats = await lstat(absolutePath);
    const resolvedFolder = await realpath(join(contentFolder, itemFolder));

    if (
      stats.isSymbolicLink() ||
      !stats.isFile() ||
      (await realpath(absolutePath)) !== join(resolvedFolder, relativePath)
    ) {
      log.warn('publish_sidecar_path_rejected', { step: 'validate', key: source });

      return failValidation(`${source} is a link or not a plain file, so it stays out.`, source);
    }

    return { absolutePath, sha256: await hashFile(absolutePath), length: stats.size };
  } catch (error) {
    log.warn('publish_file_unreadable', {
      step: 'validate',
      key: source,
      error: errMessage(error)
    });

    return failValidation(`The app could not read ${source}.`, source);
  }
};

const isFailure = (value: object): value is FailedOutcome => 'ok' in value;

export const collectUploads = async (
  snapshot: ContentSnapshot,
  { contentFolder, config }: Pick<PublishDeps, 'contentFolder' | 'config'>
): Promise<{ files: UploadFile[]; sidecarHashes: Map<string, string> } | FailedOutcome> => {
  const files: UploadFile[] = [];
  const sidecarHashes = new Map<string, string>();

  const addFile = (source: string, file: ReadFile, slug: string, contentType: string): void => {
    files.push({
      source,
      absolutePath: file.absolutePath,
      key: mediaObjectKey(config.objectKeyPrefix, slug, file.sha256, basename(source)),
      sha256: file.sha256,
      length: file.length,
      contentType
    });
  };

  const typeOf = (source: string): { contentType: string } | FailedOutcome => {
    const result = contentTypeFor(basename(source));

    if (!result.ok) {
      log.warn('publish_file_type_rejected', { step: 'validate', key: source });

      return failValidation(result.message, source);
    }

    return { contentType: result.contentType };
  };

  for (const { slug, record } of publishedEpisodes(snapshot)) {
    if (record.media === undefined) {
      continue;
    }

    const itemFolder = `${EPISODES_FOLDER}/${slug}`;
    const relativePath = `${MEDIA_FOLDER}/${record.media.file}`;
    const source = `${itemFolder}/${relativePath}`;
    const type = typeOf(source);

    if (isFailure(type)) {
      return type;
    }

    const file = await readItemFile(contentFolder, itemFolder, relativePath, source);

    if (isFailure(file)) {
      return file;
    }

    if (file.sha256 !== record.media.sha256 || file.length !== record.media.length) {
      log.warn('publish_media_mismatch', { step: 'validate', key: source });

      return failValidation(`${source} does not match the media record in episode.json.`, source);
    }

    addFile(source, file, slug, type.contentType);
  }

  for (const { itemFolder, keySlug, file: relativePath, source } of listSidecarReferences(
    snapshot
  )) {
    if (sidecarHashes.has(source)) {
      continue;
    }

    const type = typeOf(source);

    if (isFailure(type)) {
      return type;
    }

    const file = await readItemFile(contentFolder, itemFolder, relativePath, source);

    if (isFailure(file)) {
      return file;
    }

    sidecarHashes.set(source, file.sha256);
    addFile(source, file, keySlug, type.contentType);
  }

  return { files, sidecarHashes };
};

const logRejectedSidecarPaths = (failures: readonly { node: string; field: string }[]): void => {
  for (const { node, field } of failures) {
    if (/(?:^|\.)file$/.test(field)) {
      log.warn('publish_sidecar_path_rejected', { step: 'validate', key: `${node} ${field}` });
    }
  }
};

/* The hashes alone, for a generated feed that the Live tab compares with a publish record. */
export const readSidecarHashes = async (
  snapshot: ContentSnapshot,
  contentFolder: string
): Promise<Map<string, string> | undefined> => {
  const hashes = new Map<string, string>();

  for (const { itemFolder, file, source } of listSidecarReferences(snapshot)) {
    const read = await readItemFile(contentFolder, itemFolder, file, source);

    if (isFailure(read)) {
      return undefined;
    }

    hashes.set(source, read.sha256);
  }

  return hashes;
};

const describeResponse = (result: { status?: number; error?: string }): string =>
  result.status === undefined
    ? 'The app could not reach the bucket.'
    : `The bucket answered ${String(result.status)}.`;

const runPipeline = async (
  deps: PublishDeps,
  { reason, notify = true }: PublishOptions
): Promise<PublishOutcome> => {
  const { store, objectStore, config } = deps;
  const startedAt = deps.clock();
  const snapshot = await store.readSnapshot();
  const failures = validateContent(snapshot);

  if (failures.length > 0) {
    logRejectedSidecarPaths(failures);

    return {
      ok: false,
      failedStep: 'validate',
      reason: `The feed has ${String(failures.length)} problem(s) to fix before publish.`,
      failures
    };
  }

  const collected = await collectUploads(snapshot, deps);

  if (isFailure(collected)) {
    return collected;
  }

  const feed = generateFeed(snapshot, config, startedAt, collected.sidecarHashes);
  const feedKey = feedObjectKey(config.feedUrl, config.objectKeyPrefix);
  const files: PublishRecord['files'] = [];
  const runLog = createPublishLog(store, recordNameFor(startedAt), {
    startedAt: startedAt.toISOString(),
    builtAt: startedAt.toISOString(),
    reason,
    feedKey,
    feedSha256: feed.sha256,
    files,
    liveItems: snapshotLiveItems(publishedLiveItems(snapshot)),
    feedUploaded: false,
    verified: false,
    pinged: false
  });

  const failUpload = async (
    failedStep: 'upload' | 'feed',
    file: string,
    key: string,
    result: { status?: number; error?: string }
  ): Promise<FailedOutcome> => {
    log.error('publish_upload_failed', {
      step: failedStep,
      key,
      status: result.status,
      error: result.error
    });

    const failedReason = `Could not upload ${file}. ${describeResponse(result)}`;

    await runLog.write({ failedStep, failedFile: file, failedReason });

    return {
      ok: false,
      failedStep,
      reason: failedReason,
      failedFile: file,
      recordName: runLog.name
    };
  };

  /* R13: media goes first, so a failure here leaves the public feed on its old version. */
  for (const file of collected.files) {
    const existing = await objectStore.head(file.key);

    if (!existing.ok) {
      return failUpload('upload', file.source, file.key, existing);
    }

    if (existing.sha256 === file.sha256) {
      files.push({
        key: file.key,
        source: file.source,
        sha256: file.sha256,
        length: file.length,
        uploaded: false
      });
      continue;
    }

    const uploaded = await objectStore.put({
      key: file.key,
      body: openFileStream(file.absolutePath),
      length: file.length,
      contentType: file.contentType,
      cacheControl: MEDIA_CACHE_CONTROL,
      sha256: file.sha256
    });

    if (!uploaded.ok) {
      return failUpload('upload', file.source, file.key, uploaded);
    }

    files.push({
      key: file.key,
      source: file.source,
      sha256: file.sha256,
      length: file.length,
      uploaded: true
    });
  }

  const feedUpload = await objectStore.put({
    key: feedKey,
    body: feed.bytes,
    length: feed.bytes.length,
    contentType: FEED_CONTENT_TYPE,
    cacheControl: FEED_CACHE_CONTROL,
    sha256: feed.sha256
  });

  if (!feedUpload.ok) {
    return failUpload('feed', 'feed.xml', feedKey, feedUpload);
  }

  /* The record lands before verify, so a verify timeout cannot hide a feed that went public. */
  const recordWrite = await runLog.write({ feedUploaded: true });

  if (!recordWrite.ok) {
    return {
      ok: false,
      failedStep: 'record',
      reason: `The feed uploaded, but the app could not write the publish record. ${recordWrite.message}`,
      recordName: runLog.name
    };
  }

  return verifyThenPing(deps, runLog, { feedSha256: feed.sha256, reason, files, notify });
};

type RunLog = ReturnType<typeof createPublishLog>;

type Finish = {
  feedSha256: string;
  reason: PublishRecord['reason'];
  files: PublishRecord['files'];
  /* False holds the hub ping back, so a feed can go public before the index learns of it. */
  notify: boolean;
};

export type PublishOptions = { reason: PublishRecord['reason']; notify?: boolean };

const NO_NOTIFICATION_LABEL = 'no notification sent';

const okOutcome = (
  runLog: RunLog,
  { feedSha256, files }: Finish,
  pingLabel: string
): Extract<PublishOutcome, { ok: true }> => ({
  ok: true,
  recordName: runLog.name,
  uploaded: files.filter((file) => file.uploaded).map((file) => file.key),
  skipped: files.filter((file) => !file.uploaded).length,
  feedSha256,
  pingLabel
});

const finishWithoutPing = async (
  deps: PublishDeps,
  runLog: RunLog,
  finish: Finish
): Promise<PublishOutcome> => {
  await runLog.write({
    verified: true,
    pinged: false,
    failedStep: undefined,
    failedReason: undefined,
    finishedAt: deps.clock().toISOString()
  });

  return okOutcome(runLog, finish, NO_NOTIFICATION_LABEL);
};

const pingAndFinish = async (
  deps: PublishDeps,
  runLog: RunLog,
  finish: Finish
): Promise<PublishOutcome> => {
  const notified = await deps.notifier.notify({
    feedUrl: deps.config.feedUrl,
    reason: finish.reason
  });

  if (!notified.ok) {
    await runLog.write({ verified: true, failedStep: 'ping', failedReason: notified.reason });

    return {
      ok: false,
      failedStep: 'ping',
      reason: notified.reason,
      recordName: runLog.name
    };
  }

  await runLog.write({
    verified: true,
    pinged: true,
    pingResult: notified.label,
    failedStep: undefined,
    failedReason: undefined,
    finishedAt: deps.clock().toISOString()
  });

  return okOutcome(runLog, finish, notified.label);
};

const verifyThenPing = async (
  deps: PublishDeps,
  runLog: RunLog,
  finish: Finish
): Promise<PublishOutcome> => {
  const verified = await verifyPublicFeed(deps, {
    feedUrl: deps.config.feedUrl,
    expectedSha256: finish.feedSha256,
    userAgent: deps.userAgent
  });

  if (!verified.ok) {
    await runLog.write({ failedStep: 'verify', failedReason: verified.reason });

    return {
      ok: false,
      failedStep: 'verify',
      reason: verified.reason,
      recordName: runLog.name
    };
  }

  return finish.notify
    ? pingAndFinish(deps, runLog, finish)
    : finishWithoutPing(deps, runLog, finish);
};

const runGuarded = async (run: () => Promise<PublishOutcome>): Promise<PublishOutcome> => {
  try {
    return await run();
  } catch (error) {
    log.error('publish_unexpected_failure', { step: 'publish', error: errMessage(error) });

    return { ok: false, failedStep: 'unexpected', reason: 'The publish stopped on an app error.' };
  }
};

/* A retry always pings: the record of a run that held the ping back never fails at verify or ping. */
const finishOf = ({ record }: PublishEntry): Finish => ({
  feedSha256: record.feedSha256,
  reason: record.reason,
  files: record.files,
  notify: true
});

/* R28. Retry resumes the record of the failed run, so its times and its reason stay. */
export const resumeFromVerify = (deps: PublishDeps, entry: PublishEntry): Promise<PublishOutcome> =>
  runGuarded(() =>
    verifyThenPing(deps, createPublishLog(deps.store, entry.name, entry.record), finishOf(entry))
  );

export const resumeFromPing = (deps: PublishDeps, entry: PublishEntry): Promise<PublishOutcome> =>
  runGuarded(() =>
    pingAndFinish(deps, createPublishLog(deps.store, entry.name, entry.record), finishOf(entry))
  );

export const publish = (deps: PublishDeps, options: PublishOptions): Promise<PublishOutcome> =>
  runGuarded(() => runPipeline(deps, options));
