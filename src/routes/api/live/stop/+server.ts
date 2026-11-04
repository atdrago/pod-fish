import { respondUnderLock } from '$lib/server/live/respondUnderLock';
import { stopLive } from '$lib/server/live/stop';
import { liveDeps } from '$lib/server/runtime';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = () => respondUnderLock(() => stopLive(liveDeps));
