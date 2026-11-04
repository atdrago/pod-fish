import type { PublishRecord } from '$lib/server/content/schemas';
import type { ContentStore, ContentSnapshot, WriteResult } from '$lib/server/content/store';

/* A record name must be a safe slug, and it sorts by time. */
const recordNameFor = (startedAt: Date): string =>
  startedAt.toISOString().toLowerCase().replaceAll(':', '-').replaceAll('.', '-');

export const snapshotLiveItems = (
  liveItems: ContentSnapshot['liveItems']
): PublishRecord['liveItems'] =>
  liveItems.map(({ slug, record: { guid, status, start, end } }) => ({
    slug,
    guid,
    status,
    start,
    end
  }));

/*
	KTD4. The bucket restores the media from these keys, and the Live tab reads what
	the public feed holds from this record, so an attempt that stopped early still
	leaves its record.
*/
export const createPublishLog = (store: ContentStore, startedAt: Date, initial: PublishRecord) => {
  const name = recordNameFor(startedAt);
  let current = initial;

  return {
    name,
    write: (changes: Partial<PublishRecord>): Promise<WriteResult> => {
      current = { ...current, ...changes };

      return store.writePublishRecord(name, current);
    }
  };
};
