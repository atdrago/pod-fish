import * as v from 'valibot';
import type { StreamStatus } from '$lib/liveView';
import { errMessage, log } from '$lib/server/log';

const CACHE_LIFETIME_MS = 5000;

const sourceSchema = v.looseObject({
  listenurl: v.optional(v.string()),
  listeners: v.optional(v.number()),
  server_name: v.optional(v.string())
});

/*
	Icecast omits `source` with no source, and sends an array for more than one. The array
	comes first in the union, because an array also passes as a loose object.
*/
const statusPageSchema = v.object({
  icestats: v.looseObject({
    source: v.optional(v.union([v.array(sourceSchema), sourceSchema]))
  })
});

type StatusSource = v.InferOutput<typeof sourceSchema>;

const pathOf = (url: string | undefined): string | undefined =>
  url !== undefined && URL.canParse(url) ? new URL(url).pathname : undefined;

const toConnected = ({ listeners, server_name: title }: StatusSource): StreamStatus => ({
  state: 'connected',
  ...(listeners === undefined ? {} : { listeners }),
  ...(title === undefined ? {} : { title })
});

/*
	KTD8. The public status page, read on the server, so no admin password reaches the
	browser. `/status-json.xsl` is deprecated in Icecast 2.5, so a mount GET is the
	fallback signal. Icecast reports an unreliable host and port in `listenurl`, so only
	its path identifies our mount.
*/
export const createStreamStatusReader = (
  {
    fetch: fetchFunction,
    userAgent,
    clock
  }: { fetch: typeof fetch; userAgent: string; clock: () => Date },
  { statusUrl, mountUrl }: { statusUrl: string; mountUrl: string }
): (() => Promise<StreamStatus>) => {
  const headers = { 'user-agent': userAgent };
  const mountPath = pathOf(mountUrl);
  let cached: { status: StreamStatus; readAt: number } | undefined;

  const readFromMount = async (): Promise<StreamStatus> => {
    const response = await fetchFunction(mountUrl, { headers });

    await response.body?.cancel();

    if (response.status === 200) {
      return { state: 'connected' };
    }

    return response.status === 404 ? { state: 'none' } : { state: 'unknown' };
  };

  const readFromStatusPage = async (): Promise<StreamStatus> => {
    const response = await fetchFunction(statusUrl, { headers });

    if (response.status === 404) {
      await response.body?.cancel();

      return readFromMount();
    }

    let body: unknown;

    try {
      body = await response.json();
    } catch (error) {
      log.warn('stream_status_invalid', { step: 'status', error: errMessage(error) });

      return { state: 'unknown' };
    }

    const parsed = v.safeParse(statusPageSchema, body);

    if (!parsed.success) {
      log.warn('stream_status_invalid', { step: 'status', error: parsed.issues[0].message });

      return { state: 'unknown' };
    }

    const { source } = parsed.output.icestats;
    const sources = source === undefined ? [] : [source].flat();
    const ourSource = sources.find(({ listenurl }) => pathOf(listenurl) === mountPath);

    return ourSource === undefined ? { state: 'none' } : toConnected(ourSource);
  };

  return async () => {
    const now = clock().getTime();

    if (cached !== undefined && now - cached.readAt < CACHE_LIFETIME_MS) {
      return cached.status;
    }

    let status: StreamStatus;

    try {
      status = await readFromStatusPage();
    } catch (error) {
      log.warn('stream_status_failed', { step: 'status', error: errMessage(error) });
      status = { state: 'unknown' };
    }

    cached = { status, readAt: now };

    return status;
  };
};
