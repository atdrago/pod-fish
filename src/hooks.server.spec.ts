import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { RequestEvent } from '@sveltejs/kit';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const ORIGIN = 'http://127.0.0.1:5174';
const HOST = '127.0.0.1:5174';

let contentFolder: string;

const loadHooks = async (overrides: Record<string, string> = {}) => {
  vi.resetModules();
  vi.doMock('$app/env/private', () => ({
    APP_ORIGIN: ORIGIN,
    CONTENT_FOLDER: contentFolder,
    FEED_URL: 'https://example.com/placeholder-show/feed.xml',
    OBJECT_KEY_PREFIX: 'placeholder-show',
    ...overrides
  }));

  return import('./hooks.server');
};

const run = async (init: {
  method?: string;
  path?: string;
  host?: string;
  origin?: string;
  body?: string;
  extraHeaders?: Record<string, string>;
}) => {
  const { handle } = await loadHooks();
  const headers = new Headers({ host: init.host ?? HOST, ...init.extraHeaders });

  if (init.origin !== undefined) {
    headers.set('origin', init.origin);
  }

  if (init.body !== undefined) {
    headers.set('content-length', String(Buffer.byteLength(init.body)));
  }

  const url = `${ORIGIN}${init.path ?? '/api/publish'}`;
  const request = new Request(url, {
    method: init.method ?? 'POST',
    headers,
    body: init.body
  });
  const resolve = vi.fn(() => Promise.resolve(new Response('handled')));
  const response = await handle({
    event: { request, url: new URL(url) } as unknown as RequestEvent,
    resolve
  });

  return { response, resolve };
};

beforeEach(async () => {
  contentFolder = await mkdtemp(join(tmpdir(), 'pod-fish-hooks-'));
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
});

afterEach(async () => {
  vi.restoreAllMocks();
  vi.doUnmock('$app/env/private');
  await rm(contentFolder, { recursive: true, force: true });
});

describe('the request guard (AE15)', () => {
  it('refuses a POST from another origin, and no handler runs', async () => {
    const { response, resolve } = await run({ origin: 'https://evil.example' });

    expect(response.status).toBe(403);
    expect(resolve).not.toHaveBeenCalled();
  });

  it('refuses a POST with no origin, and no handler runs', async () => {
    const { response, resolve } = await run({});

    expect(response.status).toBe(403);
    expect(resolve).not.toHaveBeenCalled();
  });

  it('refuses a POST with another host, even from the right origin', async () => {
    const { response, resolve } = await run({ host: 'evil.example:3000', origin: ORIGIN });

    expect(response.status).toBe(403);
    expect(resolve).not.toHaveBeenCalled();
  });

  it('refuses a GET with another host, so a rebinding page reads no draft', async () => {
    const { response, resolve } = await run({ method: 'GET', host: 'evil.example:3000' });

    expect(response.status).toBe(403);
    expect(resolve).not.toHaveBeenCalled();
  });

  it('passes a same-origin POST', async () => {
    const { response, resolve } = await run({ origin: ORIGIN, body: '{}' });

    expect(response.status).toBe(200);
    expect(resolve).toHaveBeenCalledOnce();
  });

  it('passes a GET with the loopback host regardless of its origin', async () => {
    const { response } = await run({ method: 'GET', origin: 'https://evil.example' });

    expect(response.status).toBe(200);
  });

  it('forbids a frame on a response, so no other site can frame the Live tab', async () => {
    const { response } = await run({ method: 'GET', path: '/live' });

    expect(response.headers.get('content-security-policy')).toBe("frame-ancestors 'none'");
    expect(response.headers.get('x-frame-options')).toBe('DENY');
  });

  it('refuses a non-media POST with a 2 MB body before the handler runs', async () => {
    const { response, resolve } = await run({
      origin: ORIGIN,
      body: 'x'.repeat(2 * 1024 * 1024)
    });

    expect(response.status).toBe(413);
    expect(resolve).not.toHaveBeenCalled();
  });

  it('refuses a chunked non-media POST, which declares no length', async () => {
    const { response, resolve } = await run({
      origin: ORIGIN,
      extraHeaders: { 'transfer-encoding': 'chunked' }
    });

    expect(response.status).toBe(411);
    expect(resolve).not.toHaveBeenCalled();
  });

  it('leaves the body cap of a media PUT to its own route', async () => {
    const { response, resolve } = await run({
      method: 'PUT',
      path: '/api/media/pilot',
      origin: ORIGIN,
      body: 'x'.repeat(2 * 1024 * 1024)
    });

    expect(response.status).toBe(200);
    expect(resolve).toHaveBeenCalledOnce();
  });
});

describe('the server start', () => {
  it('creates the content shape in an empty folder', async () => {
    const { init } = await loadHooks();

    await init();

    expect((await stat(join(contentFolder, 'publish'))).isDirectory()).toBe(true);
    expect(await readFile(join(contentFolder, '.gitignore'), 'utf8')).toContain(
      'episodes/*/media/'
    );
  });

  it('fails when the feed path leaves the object key prefix, and names both values', async () => {
    const { init } = await loadHooks({ OBJECT_KEY_PREFIX: 'another-show' });

    await expect(init()).rejects.toThrow(/placeholder-show\/feed\.xml.*another-show/);
  });
});
