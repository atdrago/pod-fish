import { randomUUID } from 'node:crypto';
import {
  CONTENT_FOLDER,
  FEED_URL,
  MEDIA_BASE_URL,
  OBJECT_KEY_PREFIX,
  R2_ACCESS_KEY_ID,
  R2_ACCOUNT_ID,
  R2_BUCKET,
  R2_SECRET_ACCESS_KEY,
  SHOW_PAGE_URL,
  STREAM_MOUNT_URL,
  STREAM_STATUS_URL,
  APP_USER_AGENT
} from '$app/env/private';
import { createContentStore } from '$lib/server/content/store';
import type { LiveDeps } from '$lib/server/live/state';
import { createHubNotifier } from '$lib/server/podping/hub';
import { createPublishLock } from '$lib/server/publish/lock';
import type { PublishDeps } from '$lib/server/publish/publish';
import { createR2Client } from '$lib/server/publish/r2Client';
import { createStreamStatusReader } from '$lib/server/stream/status';
import { createTimedFetch } from '$lib/server/timedFetch';

const OUTSIDE_REQUEST_TIMEOUT_MS = 15_000;

const timedFetch = createTimedFetch(fetch, OUTSIDE_REQUEST_TIMEOUT_MS);

/* One lock for the whole process, so every route that publishes shares it (KTD9). */
export const publishLock = createPublishLock();

const publishDeps: PublishDeps = {
  store: createContentStore(CONTENT_FOLDER),
  contentFolder: CONTENT_FOLDER,
  objectStore: createR2Client({
    accountId: R2_ACCOUNT_ID,
    bucket: R2_BUCKET,
    accessKeyId: R2_ACCESS_KEY_ID,
    secretAccessKey: R2_SECRET_ACCESS_KEY,
    fetch
  }),
  fetch: timedFetch,
  notifier: createHubNotifier({ fetch: timedFetch, userAgent: APP_USER_AGENT }),
  clock: () => new Date(),
  sleep: (delayMs) =>
    new Promise((resolve) => {
      setTimeout(resolve, delayMs);
    }),
  config: {
    feedUrl: FEED_URL,
    mediaBaseUrl: MEDIA_BASE_URL,
    objectKeyPrefix: OBJECT_KEY_PREFIX
  },
  userAgent: APP_USER_AGENT
};

export const liveDeps: LiveDeps = {
  ...publishDeps,
  mountUrl: STREAM_MOUNT_URL,
  showPageUrl: SHOW_PAGE_URL,
  readStreamStatus: createStreamStatusReader(
    { fetch: timedFetch, userAgent: APP_USER_AGENT, clock: publishDeps.clock },
    { statusUrl: STREAM_STATUS_URL, mountUrl: STREAM_MOUNT_URL }
  ),
  createGuid: () => randomUUID(),
  isPublishInFlight: () => publishLock.isBusy()
};
