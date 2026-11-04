import {
  CONTENT_FOLDER,
  FEED_URL,
  MEDIA_BASE_URL,
  OBJECT_KEY_PREFIX,
  R2_ACCESS_KEY_ID,
  R2_ACCOUNT_ID,
  R2_BUCKET,
  R2_SECRET_ACCESS_KEY,
  APP_USER_AGENT
} from '$app/env/private';
import { createContentStore } from '$lib/server/content/store';
import { createHubNotifier } from '$lib/server/podping/hub';
import { createPublishLock } from '$lib/server/publish/lock';
import type { PublishDeps } from '$lib/server/publish/publish';
import { createR2Client } from '$lib/server/publish/r2Client';
import { createTimedFetch } from '$lib/server/timedFetch';

const OUTSIDE_REQUEST_TIMEOUT_MS = 15_000;

const timedFetch = createTimedFetch(fetch, OUTSIDE_REQUEST_TIMEOUT_MS);

/* One lock for the whole process, so every route that publishes shares it (KTD9). */
export const publishLock = createPublishLock();

export const publishDeps: PublishDeps = {
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
