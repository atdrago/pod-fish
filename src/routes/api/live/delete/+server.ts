import { json } from '@sveltejs/kit';
import * as v from 'valibot';
import { deleteEnded } from '$lib/server/live/deleteEnded';
import { respondUnderLock } from '$lib/server/live/respondUnderLock';
import { liveDeps } from '$lib/server/runtime';
import type { RequestHandler } from './$types';

const bodySchema = v.object({ slug: v.string() });

export const POST: RequestHandler = async ({ request }) => {
  const parsed = v.safeParse(bodySchema, await request.json().catch(() => undefined));

  return parsed.success
    ? respondUnderLock(() => deleteEnded(liveDeps, parsed.output.slug))
    : json({ ok: false, reason: 'A delete needs a slug.' }, { status: 400 });
};
