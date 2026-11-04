import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sha256Of } from '$lib/server/feed/generate';
import { verifyPublicFeed } from './verifyPublic';

const NEW_BODY = 'new feed';
const INPUT = {
  feedUrl: 'https://example.com/placeholder-show/feed.xml',
  expectedSha256: sha256Of(Buffer.from(NEW_BODY)),
  userAgent: 'placeholder-user-agent'
};

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('verifyPublicFeed', () => {
  it('fetches the plain public URL, sends the User-Agent, and passes on a match', async () => {
    const fetchFake = vi.fn(() => Promise.resolve(new Response(NEW_BODY)));
    const sleep = vi.fn(() => Promise.resolve());

    const result = await verifyPublicFeed({ fetch: fetchFake, sleep }, INPUT);

    expect(result).toStrictEqual({ ok: true });
    expect(fetchFake).toHaveBeenCalledOnce();
    expect(fetchFake).toHaveBeenCalledWith(INPUT.feedUrl, {
      headers: { 'user-agent': INPUT.userAgent }
    });
    expect(sleep).not.toHaveBeenCalled();
  });

  it('backs off between tries, and passes on a later try', async () => {
    const bodies = ['old', 'old', NEW_BODY];
    const fetchFake = vi.fn(() => Promise.resolve(new Response(bodies.shift())));
    const delays: number[] = [];

    const result = await verifyPublicFeed(
      {
        fetch: fetchFake,
        sleep: (delayMs) => {
          delays.push(delayMs);

          return Promise.resolve();
        }
      },
      INPUT
    );

    expect(result).toStrictEqual({ ok: true });
    expect(delays).toHaveLength(2);
    expect(delays[1]).toBeGreaterThan(delays[0]);
  });

  it('fails after the window when the body never matches', async () => {
    const fetchFake = vi.fn(() => Promise.resolve(new Response('old')));
    const result = await verifyPublicFeed(
      { fetch: fetchFake, sleep: () => Promise.resolve() },
      INPUT
    );

    expect(result).toMatchObject({ ok: false });
    expect(fetchFake.mock.calls.length).toBeGreaterThan(2);
  });

  it('retries a non-200 answer as a mismatch', async () => {
    const answers = [new Response('nope', { status: 404 }), new Response(NEW_BODY)];
    const result = await verifyPublicFeed(
      {
        fetch: vi.fn(() => Promise.resolve(answers.shift())) as unknown as typeof fetch,
        sleep: () => Promise.resolve()
      },
      INPUT
    );

    expect(result).toStrictEqual({ ok: true });
  });

  it('fails at once on a network error, with no wait', async () => {
    const sleep = vi.fn(() => Promise.resolve());
    const fetchFake = vi.fn(() => Promise.reject(new Error('offline')));

    const result = await verifyPublicFeed({ fetch: fetchFake, sleep }, INPUT);

    expect(result).toMatchObject({ ok: false });
    expect(fetchFake).toHaveBeenCalledOnce();
    expect(sleep).not.toHaveBeenCalled();
  });
});
