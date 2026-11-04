import { goLive } from '$lib/server/live/goLive';
import { respondUnderLock } from '$lib/server/live/respondUnderLock';
import { liveDeps } from '$lib/server/runtime';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = () => respondUnderLock(() => goLive(liveDeps));
