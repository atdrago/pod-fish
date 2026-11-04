import type { LiveChangeResult } from '$lib/liveView';
import type { LiveDeps } from './state';

/* R32. An ended item stays listed until the podcaster deletes it. Only an ended item can go. */
export const deleteEnded = async (deps: LiveDeps, slug: string): Promise<LiveChangeResult> => {
  const snapshot = await deps.store.readSnapshot();
  const item = snapshot.liveItems.find((entry) => entry.slug === slug);

  if (item === undefined) {
    return { ok: false, reason: `No live item is named ${slug}.` };
  }

  if (item.record.status !== 'ended') {
    return { ok: false, reason: `The live item ${slug} has not ended, so it stays.` };
  }

  const removed = await deps.store.deleteLiveItem(slug);

  return removed.ok ? { ok: true } : { ok: false, reason: removed.message };
};
