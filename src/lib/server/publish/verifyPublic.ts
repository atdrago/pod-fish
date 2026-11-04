import { sha256Of } from '$lib/server/feed/generate';
import { errMessage, log } from '$lib/server/log';

/* The cache rule bypasses the feed path, so the first try normally matches. */
const RETRY_DELAYS_MS = [500, 1000, 2000, 4000, 8000];

type VerifyResult = { ok: true } | { ok: false; reason: string };

/*
	R11. Proof by content: the bytes that the public URL serves must hash to the bytes
	that this run generated. A network error fails at once, because waiting out the
	window while offline during a show only delays the Retry button.
*/
export const verifyPublicFeed = async (
  {
    fetch: fetchFunction,
    sleep
  }: { fetch: typeof fetch; sleep: (delayMs: number) => Promise<void> },
  {
    feedUrl,
    expectedSha256,
    userAgent
  }: { feedUrl: string; expectedSha256: string; userAgent: string }
): Promise<VerifyResult> => {
  let lastStatus: number | undefined;

  for (const [attempt, delayMs] of [0, ...RETRY_DELAYS_MS].entries()) {
    if (attempt > 0) {
      await sleep(delayMs);
    }

    try {
      const response = await fetchFunction(feedUrl, { headers: { 'user-agent': userAgent } });
      const body = Buffer.from(await response.arrayBuffer());

      if (response.status === 200 && sha256Of(body) === expectedSha256) {
        return { ok: true };
      }

      lastStatus = response.status;
    } catch (error) {
      log.warn('publish_verify_failed', { step: 'verify', error: errMessage(error) });

      return { ok: false, reason: 'The app could not reach the public feed.' };
    }
  }

  log.warn('publish_verify_mismatch', { step: 'verify', status: lastStatus });

  return {
    ok: false,
    reason: `The public feed did not serve the new version. It last answered ${String(lastStatus)}.`
  };
};
