import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHubNotifier } from './hub';

const FEED_URL = 'https://example.com/placeholder-show/feed.xml';
const USER_AGENT = 'pod-fish/0.1 (+https://example.com/repo)';

let logSpy: ReturnType<typeof vi.spyOn>;

const notifierFor = (answer: () => Promise<Response>) => {
  const fetchFake = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(answer);

  return {
    fetchFake,
    notifier: createHubNotifier({
      fetch: fetchFake as unknown as typeof fetch,
      userAgent: USER_AGENT
    })
  };
};

beforeEach(() => {
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the Podcast Index hub sender', () => {
  it('sends the feed URL and a User-Agent that names the app', async () => {
    const { fetchFake, notifier } = notifierFor(() => Promise.resolve(new Response('{}')));

    await notifier.notify({ feedUrl: FEED_URL, reason: 'update' });

    const [url, init] = fetchFake.mock.calls[0];

    expect(url).toBe(`https://hub.podcastindex.org/pubnotify?url=${encodeURIComponent(FEED_URL)}`);
    expect(init.headers).toStrictEqual({ 'user-agent': USER_AGENT });
  });

  it('labels a 200 as an accepted index re-fetch, never as a sent podping', async () => {
    const { notifier } = notifierFor(() => Promise.resolve(new Response('{}')));
    const result = await notifier.notify({ feedUrl: FEED_URL, reason: 'update' });

    expect(result).toStrictEqual({ ok: true, label: 'index re-fetch accepted' });
  });

  it.each(['update', 'live', 'liveEnd'] as const)('ignores the reason %s', async (reason) => {
    const { fetchFake, notifier } = notifierFor(() => Promise.resolve(new Response('{}')));

    await notifier.notify({ feedUrl: FEED_URL, reason });

    expect(fetchFake.mock.calls[0][0]).not.toContain('reason');
  });

  it('reports a 403 with the status, and logs the event', async () => {
    const { notifier } = notifierFor(() => Promise.resolve(new Response('no', { status: 403 })));
    const result = await notifier.notify({ feedUrl: FEED_URL, reason: 'update' });

    expect(result).toMatchObject({ ok: false, reason: expect.stringContaining('403') });
    expect(logSpy.mock.calls.map((call: unknown[]) => JSON.parse(String(call[0])))).toContainEqual(
      expect.objectContaining({ event: 'podping_send_failed', status: 403 })
    );
  });

  it('reports a network error as a value, with no thrown error', async () => {
    const { notifier } = notifierFor(() => Promise.reject(new Error('offline')));

    await expect(notifier.notify({ feedUrl: FEED_URL, reason: 'update' })).resolves.toMatchObject({
      ok: false
    });
  });

  it('writes no header value and no URL into a log line', async () => {
    const { notifier } = notifierFor(() => Promise.resolve(new Response('no', { status: 403 })));

    await notifier.notify({ feedUrl: FEED_URL, reason: 'update' });

    const written = logSpy.mock.calls.map((call: unknown[]) => String(call[0])).join('\n');

    expect(written).not.toContain(USER_AGENT);
    expect(written).not.toContain(FEED_URL);
  });
});
