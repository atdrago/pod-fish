import { json } from '@sveltejs/kit';
import type { PublishOutcome } from '$lib/publishOutcome';
import { publishLock } from '$lib/server/runtime';

/* KTD9. Every route that changes the show shares this one lock (R18, AE8). */
export const respondUnderLock = async (task: () => Promise<object>): Promise<Response> => {
  const result = await publishLock.run(task);

  if (result.refused) {
    const outcome: PublishOutcome = { ok: false, failedStep: 'lock', reason: result.message };

    return json(outcome, { status: 409 });
  }

  return json(result.value);
};
