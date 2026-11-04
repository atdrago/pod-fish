import type { RequestEvent } from '@sveltejs/kit';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPublishLock } from '$lib/server/publish/lock';

const { publishFake } = vi.hoisted(() => ({ publishFake: vi.fn() }));

vi.mock('$lib/server/publish/publish', () => ({ publish: publishFake }));
vi.mock('$lib/server/runtime', () => ({
  publishDeps: {},
  publishLock: createPublishLock()
}));

const { POST } = await import('./+server');

const EVENT = {} as RequestEvent;

beforeEach(() => {
  publishFake.mockReset();
});

describe('POST /api/publish', () => {
  it('runs one publish with the reason update and returns its outcome', async () => {
    publishFake.mockResolvedValue({ ok: true, recordName: 'name' });

    const response = await POST(EVENT as never);

    expect(publishFake).toHaveBeenCalledWith({}, { reason: 'update' });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, recordName: 'name' });
  });

  it('refuses a second request while one runs, and runs nothing', async () => {
    let release: (value: unknown) => void = () => undefined;

    publishFake.mockReturnValue(new Promise((resolve) => (release = resolve)));

    const first = POST(EVENT as never);
    const second = await POST(EVENT as never);

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
