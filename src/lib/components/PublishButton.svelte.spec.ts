import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import type { PublishOutcome } from '$lib/publishOutcome';
import PublishButton from './PublishButton.svelte';

const SUCCESS: PublishOutcome = {
  ok: true,
  recordName: 'name',
  uploaded: [],
  skipped: 1,
  feedSha256: 'abc',
  pingLabel: 'index re-fetch accepted'
};

describe('the Publish control', () => {
  it('disables the button while the request is in flight, and a second press runs nothing', async () => {
    let release: (value: PublishOutcome) => void = () => undefined;
    const requestPublish = vi.fn(
      () => new Promise<PublishOutcome>((resolve) => (release = resolve))
    );
    const screen = await render(PublishButton, { requestPublish });

    await screen.getByRole('button', { name: 'Publish' }).click();

    const inFlight = screen.getByRole('button', { name: 'Publishing…' });

    await expect.element(inFlight).toBeDisabled();
    await inFlight.click({ force: true });

    expect(requestPublish).toHaveBeenCalledOnce();

    release(SUCCESS);

    await expect.element(screen.getByRole('button', { name: 'Publish' })).toBeEnabled();
    await expect
      .element(screen.getByRole('status'))
      .toHaveTextContent('Published and verified: index re-fetch accepted.');
  });

  it('shows the failed step and its reason as text', async () => {
    const screen = await render(PublishButton, {
      requestPublish: () =>
        Promise.resolve({
          ok: false,
          failedStep: 'upload',
          reason: 'Could not upload <b>x</b>.mp3. The bucket answered 403.'
        })
    });

    await screen.getByRole('button', { name: 'Publish' }).click();

    await expect
      .element(screen.getByRole('status'))
      .toHaveTextContent(
        'Failed at upload: Could not upload <b>x</b>.mp3. The bucket answered 403.'
      );
  });

  it('names each validation failure by its node and its field', async () => {
    const screen = await render(PublishButton, {
      requestPublish: () =>
        Promise.resolve({
          ok: false,
          failedStep: 'validate',
          reason: 'The feed has 1 problem(s) to fix before publish.',
          failures: [{ node: 'episode:pilot', field: 'media', message: 'Needs audio.' }]
        })
    });

    await screen.getByRole('button', { name: 'Publish' }).click();

    await expect
      .element(screen.getByRole('status'))
      .toHaveTextContent('episode:pilot media: Needs audio.');
  });

  it('shows a failure when the request itself fails', async () => {
    const screen = await render(PublishButton, {
      requestPublish: () => Promise.reject(new Error('offline'))
    });

    await screen.getByRole('button', { name: 'Publish' }).click();

    await expect
      .element(screen.getByRole('status'))
      .toHaveTextContent('Failed at unexpected: The page could not read an answer');
    await expect.element(screen.getByRole('button', { name: 'Publish' })).toBeEnabled();
  });
});
