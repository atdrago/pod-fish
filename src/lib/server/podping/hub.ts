import { errMessage, log } from '$lib/server/log';
import type { Notifier } from './notifier';

const HUB_HOST = 'hub.podcastindex.org';

/*
	A 200 means the index accepted a request to re-fetch the feed. It does not prove
	that a podping reached Hive, so this label never says "podping sent" (KTD7).
*/
const HUB_ACCEPTED_LABEL = 'index re-fetch accepted';

export const createHubNotifier = ({
  fetch: fetchFunction,
  userAgent
}: {
  fetch: typeof fetch;
  userAgent: string;
}): Notifier => ({
  notify: async ({ feedUrl }) => {
    try {
      const response = await fetchFunction(
        `https://${HUB_HOST}/pubnotify?url=${encodeURIComponent(feedUrl)}`,
        { headers: { 'user-agent': userAgent } }
      );

      if (response.status === 200) {
        return { ok: true, label: HUB_ACCEPTED_LABEL };
      }

      log.warn('podping_send_failed', { step: 'ping', status: response.status, host: HUB_HOST });

      return {
        ok: false,
        reason: `The Podcast Index hub answered ${String(response.status)}.`
      };
    } catch (error) {
      log.warn('podping_send_failed', { step: 'ping', host: HUB_HOST, error: errMessage(error) });

      return { ok: false, reason: 'The app could not reach the Podcast Index hub.' };
    }
  }
});
