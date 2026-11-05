import type { LiveChangeResult } from '$lib/liveView';
import { loadRetryPlan, type LiveDeps } from './state';

/*
	R32. An ended item stays listed until the podcaster deletes it. Only an ended item can go.
	A Retry plan blocks the delete, because this item can be the only sign of a public feed
	that is still live.
*/
export const deleteEnded = async (deps: LiveDeps, slug: string): Promise<LiveChangeResult> => {
  const snapshot = await deps.store.readSnapshot();
  const item = snapshot.liveItems.find((entry) => entry.slug === slug);

  if (item === undefined) {
    return { ok: false, reason: `No live item is named ${slug}.` };
  }

  if (item.record.status !== 'ended') {
    return { ok: false, reason: `The live item ${slug} has not ended, so it stays.` };
  }

  if ((await loadRetryPlan(deps)) !== null) {
    return { ok: false, reason: `A publish did not finish, so ${slug} stays. Finish Retry first.` };
  }

  const removed = await deps.store.deleteLiveItem(slug);

  return removed.ok ? { ok: true } : { ok: false, reason: removed.message };
};
