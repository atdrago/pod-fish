import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createStreamStatusReader } from './status';

const STATUS_URL = 'https://stream.example.com/status-json.xsl';
const MOUNT_URL = 'https://stream.example.com/placeholder-show/live.mp3';

/* Icecast 2.5.0 reported a wrong host and port in listenurl, so only the path counts. */
const OUR_SOURCE = {
  listeners: 4,
  server_name: 'Placeholder <b>Show</b>',
  listenurl: 'http://stream.example.com:8000/placeholder-show/live.mp3'
};
const OTHER_SOURCE = { listeners: 9, listenurl: 'http://stream.example.com:8000/other.mp3' };

let logSpy: ReturnType<typeof vi.spyOn>;
let now: number;

const jsonAnswer = (icestats: object): Response =>
  new Response(JSON.stringify({ icestats }), { headers: { 'content-type': 'application/json' } });

const readerFor = (answer: (url: string) => Promise<Response>) => {
  const fetchFake = vi.fn(answer);

  return {
    fetchFake,
    read: createStreamStatusReader(
      {
        fetch: fetchFake as unknown as typeof fetch,
        userAgent: 'placeholder-user-agent',
        clock: () => new Date(now)
      },
      { statusUrl: STATUS_URL, mountUrl: MOUNT_URL }
    )
  };
};

const logged = (): Record<string, unknown>[] =>
  logSpy.mock.calls.map((call: unknown[]) => JSON.parse(String(call[0])));

beforeEach(() => {
  now = 1_000_000;
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the stream status', () => {
  it('reports no source when the status has no source key', async () => {
    const { read } = readerFor(() => Promise.resolve(jsonAnswer({ host: 'x' })));

    expect(await read()).toStrictEqual({ state: 'none' });
  });

  it('reports one source as an object, with its listener count and its title as text', async () => {
    const { read } = readerFor(() => Promise.resolve(jsonAnswer({ source: OUR_SOURCE })));

    expect(await read()).toStrictEqual({
      state: 'connected',
      listeners: 4,
      title: 'Placeholder <b>Show</b>'
    });
  });

  it('finds our mount by its path in an array of sources', async () => {
    const { read } = readerFor(() =>
      Promise.resolve(jsonAnswer({ source: [OTHER_SOURCE, OUR_SOURCE] }))
    );

    expect(await read()).toMatchObject({ state: 'connected', listeners: 4 });
  });

  it('reports no source when only another mount has one', async () => {
    const { read } = readerFor(() => Promise.resolve(jsonAnswer({ source: [OTHER_SOURCE] })));

    expect(await read()).toStrictEqual({ state: 'none' });
  });

  it('falls back to a mount GET when the status page answers 404', async () => {
    const { read, fetchFake } = readerFor((url) =>
      Promise.resolve(
        url === STATUS_URL
          ? new Response('no', { status: 404 })
          : new Response(new Uint8Array([1]), { headers: { 'content-type': 'audio/mpeg' } })
      )
    );

    expect(await read()).toStrictEqual({ state: 'connected' });
    expect(fetchFake).toHaveBeenCalledWith(MOUNT_URL, expect.anything());
  });

  it('reads a 404 on the fallback mount GET as no source', async () => {
    const { read } = readerFor(() => Promise.resolve(new Response('no', { status: 404 })));

    expect(await read()).toStrictEqual({ state: 'none' });
  });

  it('reports unknown with a logged event when the request fails', async () => {
    const { read } = readerFor(() => Promise.reject(new Error('timed out')));

    expect(await read()).toStrictEqual({ state: 'unknown' });
    expect(logged()).toContainEqual(expect.objectContaining({ event: 'stream_status_failed' }));
  });

  it('reports unknown when the status page is not valid status JSON', async () => {
    const { read } = readerFor(() => Promise.resolve(new Response('<html>')));

    expect(await read()).toStrictEqual({ state: 'unknown' });
    expect(logged()).toContainEqual(expect.objectContaining({ event: 'stream_status_invalid' }));
  });

  it('caches an answer for a few seconds, and then asks again', async () => {
    const { read, fetchFake } = readerFor(() =>
      Promise.resolve(jsonAnswer({ source: OUR_SOURCE }))
    );

    await read();
    now += 2000;
    await read();

    expect(fetchFake).toHaveBeenCalledOnce();

    now += 10_000;
    await read();

    expect(fetchFake).toHaveBeenCalledTimes(2);
  });
});
