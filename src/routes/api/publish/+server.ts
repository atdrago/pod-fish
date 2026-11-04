import { respondUnderLock } from '$lib/server/live/respondUnderLock';
import { publish } from '$lib/server/publish/publish';
import { liveDeps } from '$lib/server/runtime';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = () =>
  respondUnderLock(() => publish(liveDeps, { reason: 'update' }));
