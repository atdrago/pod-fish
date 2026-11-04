import type { PublishOutcome } from '$lib/publishOutcome';
import { publish } from '$lib/server/publish/publish';
import type { LiveDeps } from './state';

/* R17. One press, with no confirmation. A failure keeps the end time, and Retry repeats. */
export const stopLive = async (deps: LiveDeps): Promise<PublishOutcome> => {
  const snapshot = await deps.store.readSnapshot();
  const liveItem = snapshot.liveItems.find(
    ({ record }) => !record.draft && record.status === 'live'
  );

  if (liveItem === undefined) {
    return { ok: false, failedStep: 'refused', reason: 'No live item is live now.' };
  }

  const written = await deps.store.writeLiveItem(liveItem.slug, {
    ...liveItem.record,
    status: 'ended',
    end: deps.clock().toISOString(),
    revision: liveItem.record.revision + 1
  });

  return written.ok
    ? publish(deps, { reason: 'liveEnd' })
    : { ok: false, failedStep: 'refused', reason: written.message };
};
