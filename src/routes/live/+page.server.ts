import { loadLiveView } from '$lib/server/live/state';
import { liveDeps } from '$lib/server/runtime';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => ({ view: await loadLiveView(liveDeps) });
