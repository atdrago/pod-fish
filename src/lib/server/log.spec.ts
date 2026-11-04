import { afterEach, describe, expect, it, vi } from 'vitest';
import { errMessage, log } from './log';

afterEach(() => {
  vi.restoreAllMocks();
});

const lastLine = (spy: { mock: { calls: unknown[][] } }): Record<string, unknown> =>
  JSON.parse(String(spy.mock.calls.at(-1)?.[0]));

describe('the logger', () => {
  it('writes one JSON line with the event, the level, and the safe fields', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    log.warn('publish_verify_mismatch', { step: 'verify', status: 200, durationMs: 12 });

    expect(lastLine(spy)).toMatchObject({
      event: 'publish_verify_mismatch',
      level: 'warn',
      step: 'verify',
      status: 200,
      durationMs: 12
    });
  });

  it('sends an error event to stderr', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    log.error('publish_upload_failed', { key: 'show/feed.xml' });

    expect(lastLine(spy)).toMatchObject({ event: 'publish_upload_failed', key: 'show/feed.xml' });
  });

  it('rejects a field outside the allowlist and never writes its value', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    log.info('anything', {
      headers: { authorization: 'placeholder-token' },
      url: 'https://example.com/?signature=placeholder-token',
      step: 'upload'
    } as never);

    const written = String(spy.mock.calls.at(-1)?.[0]);

    expect(written).not.toContain('placeholder-token');
    expect(JSON.parse(written)).toMatchObject({
      step: 'upload',
      rejectedFields: ['headers', 'url']
    });
  });
});

describe('errMessage', () => {
  it('reads the message of an Error and stringifies anything else', () => {
    expect(errMessage(new Error('boom'))).toBe('boom');
    expect(errMessage('plain')).toBe('plain');
  });
});
