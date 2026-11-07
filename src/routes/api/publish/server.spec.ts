import type { RequestEvent } from '@sveltejs/kit';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPublishLock } from '$lib/server/publish/lock';

const { publishFake } = vi.hoisted(() => ({ publishFake: vi.fn() }));

vi.mock('$lib/server/publish/publish', () => ({ publish: publishFake }));
vi.mock('$lib/server/runtime', () => ({
  liveDeps: {},
  publishLock: createPublishLock()
}));

const { POST } = await import('./+server');

const eventWithBody = (body?: string): RequestEvent =>
  ({
    request: new Request('http://127.0.0.1:5174/api/publish', { method: 'POST', body })
  }) as RequestEvent;

beforeEach(() => {
  publishFake.mockReset();
});

describe('POST /api/publish', () => {
  it('runs one publish with the reason update and a ping, and returns its outcome', async () => {
    publishFake.mockResolvedValue({ ok: true, recordName: 'name' });

    const response = await POST(eventWithBody() as never);

    expect(publishFake).toHaveBeenCalledWith({}, { reason: 'update', notify: true });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, recordName: 'name' });
  });

  it('holds the ping back when the body says notify false', async () => {
    publishFake.mockResolvedValue({ ok: true, recordName: 'name' });

    const response = await POST(eventWithBody('{"notify":false}') as never);

    expect(publishFake).toHaveBeenCalledWith({}, { reason: 'update', notify: false });
    expect(response.status).toBe(200);
  });

  it('refuses a body that is not a JSON object with a boolean notify, and runs nothing', async () => {
    for (const body of ['notify', '{"notify":"no"}', '[]']) {
      const response = await POST(eventWithBody(body) as never);

      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ ok: false, failedStep: 'refused' });
    }

    expect(publishFake).not.toHaveBeenCalled();
  });

  it('refuses a second request while one runs, and runs nothing', async () => {
    let release: (value: unknown) => void = () => undefined;

    publishFake.mockReturnValue(new Promise((resolve) => (release = resolve)));

    const first = POST(eventWithBody() as never);
    const second = await POST(eventWithBody() as never);

    expect(second.status).toBe(409);
    expect(await second.json()).toStrictEqual({
      ok: false,
      failedStep: 'lock',
      reason: 'publish in flight'
    });
    expect(publishFake).toHaveBeenCalledOnce();

    release({ ok: true, recordName: 'name' });

    expect((await first).status).toBe(200);
  });
});
