import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPublishLock } from '$lib/server/publish/lock';

const fakes = vi.hoisted(() => ({
  goLive: vi.fn(),
  stopLive: vi.fn(),
  retryLiveAction: vi.fn(),
  deleteEnded: vi.fn(),
  createLiveItem: vi.fn(),
  loadLiveView: vi.fn()
}));

vi.mock('$lib/server/live/goLive', () => ({ goLive: fakes.goLive }));
vi.mock('$lib/server/live/stop', () => ({ stopLive: fakes.stopLive }));
vi.mock('$lib/server/live/retry', () => ({ retryLiveAction: fakes.retryLiveAction }));
vi.mock('$lib/server/live/deleteEnded', () => ({ deleteEnded: fakes.deleteEnded }));
vi.mock('$lib/server/live/createLiveItem', () => ({ createLiveItem: fakes.createLiveItem }));
vi.mock('$lib/server/live/state', () => ({ loadLiveView: fakes.loadLiveView }));
vi.mock('$lib/server/runtime', () => ({ liveDeps: {}, publishLock: createPublishLock() }));

const go = await import('./go/+server');
const stop = await import('./stop/+server');
const retry = await import('./retry/+server');
const remove = await import('./delete/+server');
const create = await import('./create/+server');
const status = await import('./status/+server');

const event = (body?: unknown) =>
  ({
    request: new Request('http://127.0.0.1:5174/api', {
      method: 'POST',
      body: body === undefined ? undefined : JSON.stringify(body)
    })
  }) as never;

beforeEach(() => {
  for (const fake of Object.values(fakes)) {
    fake.mockReset();
  }
});

describe('the Live routes', () => {
  it('runs Go live and returns its outcome', async () => {
    fakes.goLive.mockResolvedValue({ ok: true, pingLabel: 'x' });

    const response = await go.POST(event());

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true });
  });

  it('refuses a second tab while a request runs (AE8), across routes', async () => {
    let release: (value: unknown) => void = () => undefined;

    fakes.goLive.mockReturnValue(new Promise((resolve) => (release = resolve)));

    const first = go.POST(event());
    const secondGo = await go.POST(event());
    const secondStop = await stop.POST(event());

    expect(secondGo.status).toBe(409);
    expect(await secondGo.json()).toStrictEqual({
      ok: false,
      failedStep: 'lock',
      reason: 'publish in flight'
    });
    expect(secondStop.status).toBe(409);
    expect(fakes.goLive).toHaveBeenCalledOnce();
    expect(fakes.stopLive).not.toHaveBeenCalled();

    release({ ok: true });

    expect((await first).status).toBe(200);
  });

  it('passes the choice of a retry', async () => {
    fakes.retryLiveAction.mockResolvedValue({ ok: true });

    await retry.POST(event({ choice: 'verify' }));

    expect(fakes.retryLiveAction).toHaveBeenCalledWith({}, 'verify');
  });

  it.each([[{ choice: 'nonsense' }], [{}], ['not an object']])(
    'refuses the retry body %j, and runs nothing',
    async (body) => {
      const response = await retry.POST(event(body));

      expect(response.status).toBe(400);
      expect(fakes.retryLiveAction).not.toHaveBeenCalled();
    }
  );

  it('refuses a retry body that is not JSON', async () => {
    const response = await retry.POST({
      request: new Request('http://127.0.0.1:5174/api', { method: 'POST', body: '{ nope' })
    } as never);

    expect(response.status).toBe(400);
  });

  it('passes the slug of a delete, and refuses a missing slug', async () => {
    fakes.deleteEnded.mockResolvedValue({ ok: true });

    await remove.POST(event({ slug: 'first-show' }));

    expect(fakes.deleteEnded).toHaveBeenCalledWith({}, 'first-show');
    expect((await remove.POST(event({}))).status).toBe(400);
    expect(fakes.deleteEnded).toHaveBeenCalledOnce();
  });

  it('hands the create body to the server validation', async () => {
    fakes.createLiveItem.mockResolvedValue({ ok: false, reason: 'title: required' });

    const response = await create.POST(event({ title: '' }));

    expect(fakes.createLiveItem).toHaveBeenCalledWith({}, { title: '' });
    expect(await response.json()).toStrictEqual({ ok: false, reason: 'title: required' });
  });

  it('returns the view with no lock, so a second tab can still read it', async () => {
    fakes.loadLiveView.mockResolvedValue({ publishInFlight: true });

    const response = await status.GET({} as never);

    expect(await response.json()).toStrictEqual({ publishInFlight: true });
  });
});
