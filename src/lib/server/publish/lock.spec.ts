import { describe, expect, it, vi } from 'vitest';
import { createPublishLock, PUBLISH_IN_FLIGHT } from './lock';

describe('the publish lock', () => {
  it('runs the task and returns its result', async () => {
    const lock = createPublishLock();

    expect(await lock.run(() => Promise.resolve('done'))).toStrictEqual({
      refused: false,
      value: 'done'
    });
  });

  it('refuses a second task while one runs, and runs nothing', async () => {
    const lock = createPublishLock();
    const second = vi.fn(() => Promise.resolve('second'));
    let release: (value: string) => void = () => undefined;
    const first = lock.run(() => new Promise<string>((resolve) => (release = resolve)));

    expect(lock.isBusy()).toBe(true);
    expect(await lock.run(second)).toStrictEqual({ refused: true, message: PUBLISH_IN_FLIGHT });
    expect(second).not.toHaveBeenCalled();

    release('first');

    expect(await first).toStrictEqual({ refused: false, value: 'first' });
    expect(lock.isBusy()).toBe(false);
  });

  it('releases after a task that throws', async () => {
    const lock = createPublishLock();

    await expect(lock.run(() => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
    expect(lock.isBusy()).toBe(false);
    expect(await lock.run(() => Promise.resolve('next'))).toMatchObject({ value: 'next' });
  });
});
