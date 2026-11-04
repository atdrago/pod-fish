import { json } from '@sveltejs/kit';
import type { PublishOutcome } from '$lib/publishOutcome';
import { publish } from '$lib/server/publish/publish';
import { publishDeps, publishLock } from '$lib/server/runtime';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async () => {
  const result = await publishLock.run(() => publish(publishDeps, { reason: 'update' }));

  if (result.refused) {
    const outcome: PublishOutcome = { ok: false, failedStep: 'lock', reason: result.message };

    return json(outcome, { status: 409 });
  }

  return json(result.value);
};
