import { vi } from 'vitest';
import type { LiveItemView, LiveView } from '$lib/liveView';
import type { LiveActions } from './liveActions';

export const PENDING_ITEM: LiveItemView = {
  slug: 'friday',
  title: 'Friday show',
  status: 'pending',
  start: '2026-11-07T01:00:00.000Z',
  end: '2026-11-07T03:00:00.000Z',
  durationMinutes: 120,
  published: {
    status: 'pending',
    start: '2026-11-07T01:00:00.000Z',
    end: '2026-11-07T03:00:00.000Z'
  }
};

export const LIVE_ITEM: LiveItemView = {
  ...PENDING_ITEM,
  status: 'live',
  published: { status: 'live', start: PENDING_ITEM.start, end: PENDING_ITEM.end }
};

export const ENDED_ITEM: LiveItemView = {
  ...PENDING_ITEM,
  slug: 'last-week',
  title: 'Last week',
  status: 'ended',
  published: { status: 'ended', start: PENDING_ITEM.start, end: PENDING_ITEM.end }
};

export const makeView = (overrides: Partial<LiveView> = {}): LiveView => ({
  publishInFlight: false,
  subject: PENDING_ITEM,
  ended: [],
  draftSlugs: [],
  publicFeed: { state: 'matched', feedSha256: 'abc', recordName: 'name' },
  unpublishedChanges: 0,
  failures: [],
  source: { state: 'connected', listeners: 3 },
  retry: null,
  ...overrides
});

export const makeActions = (view: LiveView = makeView()): LiveActions => ({
  refresh: vi.fn(() => Promise.resolve(view)),
  goLive: vi.fn(() =>
    Promise.resolve({
      ok: true as const,
      recordName: 'name',
      uploaded: [],
      skipped: 0,
      feedSha256: 'abc',
      pingLabel: 'index re-fetch accepted'
    })
  ),
  stop: vi.fn(() =>
    Promise.resolve({
      ok: true as const,
      recordName: 'name',
      uploaded: [],
      skipped: 0,
      feedSha256: 'abc',
      pingLabel: 'index re-fetch accepted'
    })
  ),
  retry: vi.fn(() =>
    Promise.resolve({
      ok: true as const,
      recordName: 'name',
      uploaded: [],
      skipped: 0,
      feedSha256: 'abc',
      pingLabel: 'index re-fetch accepted'
    })
  ),
  create: vi.fn(() => Promise.resolve({ ok: true as const })),
  remove: vi.fn(() => Promise.resolve({ ok: true as const }))
});
