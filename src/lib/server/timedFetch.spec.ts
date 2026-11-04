import { describe, expect, it, vi } from 'vitest';
import { createTimedFetch } from './timedFetch';

describe('createTimedFetch', () => {
  it('adds a deadline and keeps the rest of the request', async () => {
    const fetchFake = vi.fn<(input: unknown, init: RequestInit) => Promise<Response>>(() =>
      Promise.resolve(new Response('ok'))
    );

    await createTimedFetch(fetchFake as unknown as typeof fetch, 1000)('https://example.com/', {
      method: 'HEAD'
    });

    const init = fetchFake.mock.calls[0][1];

    expect(init.method).toBe('HEAD');
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('keeps a signal that the caller already set', async () => {
    const fetchFake = vi.fn<(input: unknown, init: RequestInit) => Promise<Response>>(() =>
      Promise.resolve(new Response('ok'))
    );
    const { signal } = new AbortController();

    await createTimedFetch(fetchFake as unknown as typeof fetch, 1000)('https://example.com/', {
      signal
    });

    expect(fetchFake.mock.calls[0][1].signal).toBe(signal);
  });

  it('aborts a request that passes its deadline', async () => {
    const hangs: typeof fetch = (_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new Error('aborted'));
        });
      });

    await expect(createTimedFetch(hangs, 5)('https://example.com/')).rejects.toThrow('aborted');
  });
});
