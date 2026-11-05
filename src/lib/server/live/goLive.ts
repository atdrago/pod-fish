import type { PublishOutcome } from '$lib/publishOutcome';
import { validateContent } from '$lib/server/feed/validate';
import { collectUploads, publish } from '$lib/server/publish/publish';
import { checkMount } from '$lib/server/stream/mountCheck';
import { draftSlugsOf, pickSubject, type LiveDeps } from './state';

const MS_PER_MINUTE = 60_000;

const refuse = (reason: string): PublishOutcome => ({ ok: false, failedStep: 'refused', reason });

/*
	KTD9. The order matters: validate, match the stream URL (R19), read the files, and check
	the mount before the flip, so a fault in any of them leaves the item unchanged (AE13).
	After the flip, a failure keeps the times, and Retry repeats the failed step without a
	new start (R28).
*/
export const goLive = async (deps: LiveDeps): Promise<PublishOutcome> => {
  const snapshot = await deps.store.readSnapshot();
  const subject = pickSubject(snapshot);

  if (subject === undefined) {
    const draftSlug = draftSlugsOf(snapshot).at(0);

    return refuse(
      draftSlug === undefined
        ? 'There is no pending live item. Create one first.'
        : `The live item ${draftSlug} is a draft, so it cannot go live.`
    );
  }

  if (subject.record.status !== 'pending') {
    return refuse(`The live item ${subject.slug} is already live.`);
  }

  const failures = validateContent(snapshot);

  if (failures.length > 0) {
    return {
      ok: false,
      failedStep: 'validate',
      reason: `The feed has ${String(failures.length)} problem(s) to fix before Go live.`,
      failures
    };
  }

  const itemUrl = subject.record.enclosure.url;

  if (itemUrl !== deps.mountUrl) {
    return refuse(
      `The live item ${subject.slug} streams from ${itemUrl}, but STREAM_MOUNT_URL is ${deps.mountUrl}. Change STREAM_MOUNT_URL or the enclosure in live/${subject.slug}/live.json so that they match.`
    );
  }

  const collected = await collectUploads(snapshot, deps);

  if ('ok' in collected) {
    return collected;
  }

  const mount = await checkMount(deps, deps.mountUrl);

  if (!mount.ok) {
    return { ok: false, failedStep: 'mount', reason: mount.message };
  }

  const startedAt = deps.clock();
  const written = await deps.store.writeLiveItem(subject.slug, {
    ...subject.record,
    status: 'live',
    start: startedAt.toISOString(),
    end: new Date(
      startedAt.getTime() + subject.record.durationMinutes * MS_PER_MINUTE
    ).toISOString(),
    revision: subject.record.revision + 1
  });

  return written.ok ? publish(deps, { reason: 'live' }) : refuse(written.message);
};
