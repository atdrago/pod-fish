import { createLiveItem } from '$lib/server/live/createLiveItem';
import { respondUnderLock } from '$lib/server/live/respondUnderLock';
import { liveDeps } from '$lib/server/runtime';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
  const body: unknown = await request.json().catch(() => undefined);

  return respondUnderLock(() => createLiveItem(liveDeps, body));
};
