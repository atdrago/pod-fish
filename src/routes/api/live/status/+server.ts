import { json } from '@sveltejs/kit';
import { loadLiveView } from '$lib/server/live/state';
import { liveDeps } from '$lib/server/runtime';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async () => json(await loadLiveView(liveDeps));
