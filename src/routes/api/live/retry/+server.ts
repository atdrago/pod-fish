import { json } from '@sveltejs/kit';
import * as v from 'valibot';
import { RETRY_CHOICES } from '$lib/liveView';
import type { PublishOutcome } from '$lib/publishOutcome';
import { respondUnderLock } from '$lib/server/live/respondUnderLock';
import { retryLiveAction } from '$lib/server/live/retry';
import { liveDeps } from '$lib/server/runtime';
import type { RequestHandler } from './$types';

const bodySchema = v.object({ choice: v.picklist(RETRY_CHOICES) });

export const POST: RequestHandler = async ({ request }) => {
  const parsed = v.safeParse(bodySchema, await request.json().catch(() => undefined));

  if (!parsed.success) {
    const outcome: PublishOutcome = {
      ok: false,
      failedStep: 'refused',
      reason: 'A retry needs a choice of publish, verify, or ping.'
    };

    return json(outcome, { status: 400 });
  }

  return respondUnderLock(() => retryLiveAction(liveDeps, parsed.output.choice));
};
