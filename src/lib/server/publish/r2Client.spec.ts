import { describe, expect, it, vi } from 'vitest';
import { createR2Client } from './r2Client';

const CONFIG = {
  accountId: 'placeholder-account-id',
  bucket: 'placeholder-bucket',
  accessKeyId: 'placeholder-access-key-id',
  secretAccessKey: 'placeholder-secret-access-key'
};

const clientFor = (answer: () => Response) => {
  const fetchFake = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(() =>
    Promise.resolve(answer())
  );

  return {
    fetchFake,
    client: createR2Client({ ...CONFIG, fetch: fetchFake as unknown as typeof fetch })
  };
};

const PUT_INPUT = {
  key: 'placeholder-show/feed.xml',
  body: new Uint8Array([1, 2, 3]),
  length: 3,
  contentType: 'application/rss+xml; charset=utf-8',
  cacheControl: 'no-cache',
  sha256: 'abc'
};

describe('the R2 client', () => {
  it('sends a signed PUT to the bucket path with the headers and the hash metadata', async () => {
    const { fetchFake, client } = clientFor(() => new Response(null, { status: 200 }));

    expect(await client.put(PUT_INPUT)).toStrictEqual({ ok: true });

    const [url, init] = fetchFake.mock.calls[0];
    const headers = new Headers(init.headers);

    expect(url).toBe(
      'https://placeholder-account-id.r2.cloudflarestorage.com/placeholder-bucket/placeholder-show/feed.xml'
    );
    expect(init.method).toBe('PUT');
    expect(init.body).toBe(PUT_INPUT.body);
    expect(headers.get('content-type')).toBe(PUT_INPUT.contentType);
    expect(headers.get('cache-control')).toBe('no-cache');
    expect(headers.get('content-length')).toBe('3');
    expect(headers.get('x-amz-meta-sha256')).toBe('abc');
    expect(headers.get('authorization')).toMatch(/^AWS4-HMAC-SHA256 /);
    expect(headers.get('authorization')).not.toContain(CONFIG.secretAccessKey);
  });

  it('reports a refused PUT as a value with the status', async () => {
    const { client } = clientFor(() => new Response('denied', { status: 403 }));

    expect(await client.put(PUT_INPUT)).toStrictEqual({ ok: false, status: 403 });
  });

  it('reports a network error on a PUT as a value', async () => {
    const client = createR2Client({
      ...CONFIG,
      fetch: vi.fn(() => Promise.reject(new Error('offline')))
    });

    expect(await client.put(PUT_INPUT)).toMatchObject({ ok: false });
  });

  it('reads the stored hash from a HEAD', async () => {
    const { fetchFake, client } = clientFor(
      () => new Response(null, { status: 200, headers: { 'x-amz-meta-sha256': 'abc' } })
    );

    expect(await client.head('placeholder-show/a.mp3')).toStrictEqual({ ok: true, sha256: 'abc' });
    expect(fetchFake.mock.calls[0][1].method).toBe('HEAD');
  });

  it('reads a 404 as an absent object', async () => {
    const { client } = clientFor(() => new Response(null, { status: 404 }));

    expect(await client.head('placeholder-show/a.mp3')).toStrictEqual({
      ok: true,
      sha256: undefined
    });
  });

  it('reports a failed HEAD as a value', async () => {
    const { client } = clientFor(() => new Response(null, { status: 503 }));

    expect(await client.head('placeholder-show/a.mp3')).toStrictEqual({ ok: false, status: 503 });
  });
});
