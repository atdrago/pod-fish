import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { checkMount } from './mountCheck';

const MOUNT_URL = 'https://stream.example.com/placeholder-show/live.mp3';

let logSpy: ReturnType<typeof vi.spyOn>;

const streamResponse = (contentType: string, status = 200) => {
  const cancel = vi.fn();
  const body = new ReadableStream<Uint8Array>({
    pull: (controller) => {
      controller.enqueue(new Uint8Array([255, 251, 144, 100]));
    },
    cancel
  });

  return {
    cancel,
    response: new Response(body, { status, headers: { 'content-type': contentType } })
  };
};

const check = (answer: () => Promise<Response>) =>
  checkMount({ fetch: vi.fn(answer), userAgent: 'placeholder-user-agent' }, MOUNT_URL);

beforeEach(() => {
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('checkMount (R30)', () => {
  it('passes on a 200 audio answer with bytes, and stops reading the endless stream', async () => {
    const { response, cancel } = streamResponse('audio/mpeg');

    expect(await check(() => Promise.resolve(response))).toStrictEqual({ ok: true });
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('refuses a 404, names the mount URL and the answer, and logs', async () => {
    const result = await check(() => Promise.resolve(new Response('no', { status: 404 })));

    expect(result).toMatchObject({ ok: false });
    expect(result).toMatchObject({ message: expect.stringContaining(MOUNT_URL) });
    expect(result).toMatchObject({ message: expect.stringContaining('404') });
    expect(logSpy.mock.calls.map((call: unknown[]) => JSON.parse(String(call[0])))).toContainEqual(
      expect.objectContaining({ event: 'live_mount_check_failed', status: 404 })
    );
  });

  it('refuses a 200 with text/html, and names the content type', async () => {
    const { response, cancel } = streamResponse('text/html');
    const result = await check(() => Promise.resolve(response));

    expect(result).toMatchObject({ message: expect.stringContaining('text/html') });
    expect(result).toMatchObject({ message: expect.stringContaining(MOUNT_URL) });
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('refuses an audio answer with no bytes', async () => {
    const result = await check(() =>
      Promise.resolve(new Response(null, { headers: { 'content-type': 'audio/mpeg' } }))
    );

    expect(result).toMatchObject({ ok: false });
  });

  it('refuses a network error as a value, and names the mount URL', async () => {
    const result = await check(() => Promise.reject(new Error('offline')));

    expect(result).toMatchObject({ ok: false, message: expect.stringContaining(MOUNT_URL) });
  });

  it('sends the User-Agent of the app', async () => {
    const fetchFake = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(() =>
      Promise.resolve(streamResponse('audio/mpeg').response)
    );

    await checkMount(
      { fetch: fetchFake as unknown as typeof fetch, userAgent: 'placeholder-user-agent' },
      MOUNT_URL
    );

    expect(fetchFake.mock.calls[0][1].headers).toStrictEqual({
      'user-agent': 'placeholder-user-agent'
    });
  });
});
