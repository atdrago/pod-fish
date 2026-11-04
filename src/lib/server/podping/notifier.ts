import type { PublishRecord } from '$lib/server/content/schemas';

export type NotifyResult = { ok: true; label: string } | { ok: false; reason: string };

/*
	KTD7. Publish hands every sender a reason. The hub ignores it. The podping.cloud
	sender, which lands the day its token arrives, sends it.
*/
export type Notifier = {
  notify: (input: { feedUrl: string; reason: PublishRecord['reason'] }) => Promise<NotifyResult>;
};
