import { json } from '@sveltejs/kit';
import * as v from 'valibot';
import type { PublishOutcome } from '$lib/publishOutcome';
import { respondUnderLock } from '$lib/server/live/respondUnderLock';
import { publish } from '$lib/server/publish/publish';
import { liveDeps } from '$lib/server/runtime';
import type { RequestHandler } from './$types';

/* An empty body is the page's button. `{ "notify": false }` publishes without the hub ping. */
const bodySchema = v.object({ notify: v.optional(v.boolean(), true) });

export const POST: RequestHandler = async ({ request }) => {
  const text = await request.text();
  const body = v.safeParse(bodySchema, text === '' ? {} : parseJson(text));

  if (!body.success) {
    const outcome: PublishOutcome = {
      ok: false,
      failedStep: 'refused',
      reason: 'The body must be empty or a JSON object with a boolean notify.'
    };

    return json(outcome, { status: 400 });
  }

  const { notify } = body.output;

  return respondUnderLock(() => publish(liveDeps, { reason: 'update', notify }));
};

/* An array is an object to a parser, so it is refused here. */
function parseJson(text: string): unknown {
  try {
    const value: unknown = JSON.parse(text);

    return Array.isArray(value) ? undefined : value;
  } catch {
    return undefined;
  }
}
