import type { Handle, ServerInit } from '@sveltejs/kit';
import { APP_ORIGIN, CONTENT_FOLDER, FEED_URL, OBJECT_KEY_PREFIX } from '$app/env/private';
import { createContentStore } from '$lib/server/content/store';
import { log } from '$lib/server/log';
import { feedObjectKey } from '$lib/server/publish/objectKeys';

const MAX_NON_MEDIA_BODY_BYTES = 1024 * 1024;

/* U10 adds this route. It streams to disk and enforces its own cap (KTD10). */
const MEDIA_ROUTE_PREFIX = '/api/media/';

const SAFE_METHODS = new Set(['GET', 'HEAD']);

const refuse = (status: number, event: string, host: string | undefined): Response => {
  log.warn(event, { status, host });

  return new Response('Refused.', { status, headers: { 'content-type': 'text/plain' } });
};

const bodyRefusal = (request: Request, pathname: string): Response | undefined => {
  if (SAFE_METHODS.has(request.method) || pathname.startsWith(MEDIA_ROUTE_PREFIX)) {
    return undefined;
  }

  const host = request.headers.get('host') ?? undefined;
  const declaredLength = request.headers.get('content-length');

  if (declaredLength === null) {
    /* Node checks a declared length against the bytes it reads. A chunked body declares none. */
    return request.headers.has('transfer-encoding')
      ? refuse(411, 'request_body_length_missing', host)
      : undefined;
  }

  return Number(declaredLength) > MAX_NON_MEDIA_BODY_BYTES
    ? refuse(413, 'request_body_too_large', host)
    : undefined;
};

export const init: ServerInit = async () => {
  feedObjectKey(FEED_URL, OBJECT_KEY_PREFIX);
  await createContentStore(CONTENT_FOLDER).ensureShape();
};

/*
	KTD14. adapter-node listens on every interface by default, and the SvelteKit
	origin check covers form content types only. So a page on another site, a
	DNS-rebinding page, or a device on the same Wi-Fi could otherwise call Stop
	during the show. The start script binds the loopback address, and this hook
	refuses anything that did not come from the app's own page.
*/
export const handle: Handle = async ({ event, resolve }) => {
  const { request } = event;
  const app = new URL(APP_ORIGIN);
  const host = request.headers.get('host') ?? undefined;

  if (host !== app.host) {
    return refuse(403, 'request_host_refused', host);
  }

  if (!SAFE_METHODS.has(request.method) && request.headers.get('origin') !== app.origin) {
    return refuse(403, 'request_origin_refused', host);
  }

  const refusal = bodyRefusal(request, event.url.pathname);

  if (refusal !== undefined) {
    return refusal;
  }

  const response = await resolve(event);

  /* A framed Live tab would let another site trick the owner into a press of Stop. */
  response.headers.set('content-security-policy', "frame-ancestors 'none'");
  response.headers.set('x-frame-options', 'DENY');

  return response;
};
