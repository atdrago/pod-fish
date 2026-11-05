import { tick } from 'svelte';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import type { LiveView } from '$lib/liveView';
import type { PublishOutcome } from '$lib/publishOutcome';
import LivePanel from './LivePanel.svelte';
import { ENDED_ITEM, LIVE_ITEM, makeActions, makeView, PENDING_ITEM } from './liveSpecQueries';

const goLiveButton = (screen: Awaited<ReturnType<typeof render>>) =>
  screen.getByRole('button', { name: 'Go live', exact: true });
const stopButton = (screen: Awaited<ReturnType<typeof render>>) =>
  screen.getByRole('button', { name: 'Stop', exact: true });

describe('with no live item (AE5)', () => {
  it('disables Go live, and creates an item with a two-hour default', async () => {
    const view = makeView({ subject: null });
    const actions = makeActions(makeView());
    const screen = await render(LivePanel, { view, actions });

    await expect.element(goLiveButton(screen)).toBeDisabled();

    await screen.getByLabelText('Title').fill('Friday show');
    await screen.getByLabelText('Description').fill('The Friday show.');
    await screen.getByLabelText('Start').fill('2026-11-06T20:00');

    await expect.element(screen.getByLabelText('Duration in minutes')).toHaveValue(120);

    await screen.getByRole('button', { name: 'Create' }).click();

    await expect.poll(() => vi.mocked(actions.create).mock.calls.length).toBe(1);
    expect(actions.create).toHaveBeenCalledWith({
      title: 'Friday show',
      description: 'The Friday show.',
      start: new Date('2026-11-06T20:00').toISOString(),
      durationMinutes: 120
    });

    await expect.element(goLiveButton(screen)).toBeEnabled();
  });
});

describe('Go live', () => {
  it('asks for a confirmation that reminds about the recording and names the source', async () => {
    const actions = makeActions();
    const screen = await render(LivePanel, { view: makeView(), actions });

    await goLiveButton(screen).click();

    await expect
      .element(screen.getByRole('dialog'))
      .toHaveTextContent('Start your local recording now.');
    await expect.element(screen.getByRole('dialog')).toHaveTextContent('Your source is connected.');
    expect(actions.goLive).not.toHaveBeenCalled();

    await screen.getByRole('button', { name: 'Confirm Go live' }).click();

    await expect.poll(() => vi.mocked(actions.goLive).mock.calls.length).toBe(1);
    await expect
      .element(screen.getByRole('status'))
      .toHaveTextContent('Done: index re-fetch accepted.');
  });

  it('runs nothing on Cancel', async () => {
    const actions = makeActions();
    const screen = await render(LivePanel, { view: makeView(), actions });

    await goLiveButton(screen).click();
    await screen.getByRole('button', { name: 'Cancel' }).click();

    expect(actions.goLive).not.toHaveBeenCalled();
  });

  it('warns in the confirmation when no source is connected', async () => {
    const screen = await render(LivePanel, {
      view: makeView({ source: { state: 'none' } }),
      actions: makeActions()
    });

    await goLiveButton(screen).click();

    await expect.element(screen.getByRole('dialog')).toHaveTextContent('No source is connected.');
  });

  it('is disabled on a validation failure, and names the node and the field', async () => {
    const screen = await render(LivePanel, {
      view: makeView({
        failures: [{ node: 'live:friday', field: 'contentLink', message: 'Needs a link.' }]
      }),
      actions: makeActions()
    });

    await expect.element(goLiveButton(screen)).toBeDisabled();
    await expect
      .element(screen.getByRole('list', { name: 'Validation failures' }))
      .toHaveTextContent('live:friday contentLink: Needs a link.');
  });

  it('shows the answer of a dead mount (AE13)', async () => {
    const actions = makeActions();

    vi.mocked(actions.goLive).mockResolvedValue({
      ok: false,
      failedStep: 'mount',
      reason: 'The mount https://example.com/live.mp3 answered 404.'
    });

    const screen = await render(LivePanel, { view: makeView(), actions });

    await goLiveButton(screen).click();
    await screen.getByRole('button', { name: 'Confirm Go live' }).click();

    await expect
      .element(screen.getByRole('status'))
      .toHaveTextContent('Failed at mount: The mount https://example.com/live.mp3 answered 404.');
  });
});

describe('Stop (AE7)', () => {
  it('runs on one press, with no confirmation', async () => {
    const actions = makeActions(makeView({ subject: LIVE_ITEM }));
    const screen = await render(LivePanel, { view: makeView({ subject: LIVE_ITEM }), actions });

    await stopButton(screen).click();

    await expect.poll(() => vi.mocked(actions.stop).mock.calls.length).toBe(1);
    await expect.element(screen.getByRole('dialog')).not.toBeInTheDocument();
  });

  it('is disabled when nothing is live', async () => {
    const screen = await render(LivePanel, { view: makeView(), actions: makeActions() });

    await expect.element(stopButton(screen)).toBeDisabled();
  });
});

describe('a request in flight (AE8)', () => {
  it('disables both buttons, and a second click runs nothing', async () => {
    let release: (value: PublishOutcome) => void = () => undefined;
    const actions = makeActions(makeView({ subject: LIVE_ITEM }));

    vi.mocked(actions.stop).mockReturnValue(new Promise((resolve) => (release = resolve)));

    const screen = await render(LivePanel, { view: makeView({ subject: LIVE_ITEM }), actions });

    await stopButton(screen).click();

    await expect.element(stopButton(screen)).toBeDisabled();
    await expect.element(goLiveButton(screen)).toBeDisabled();

    await stopButton(screen).click({ force: true });

    expect(actions.stop).toHaveBeenCalledOnce();

    release({ ok: false, failedStep: 'lock', reason: 'publish in flight' });

    await expect.element(stopButton(screen)).toBeEnabled();
  });

  it('keeps the newer view when an older refresh resolves late', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });

    try {
      let releaseSlowRefresh: (view: LiveView) => void = () => undefined;
      const liveView = makeView({ subject: LIVE_ITEM });
      const actions = makeActions(makeView());

      vi.mocked(actions.refresh)
        .mockReturnValueOnce(new Promise((resolve) => (releaseSlowRefresh = resolve)))
        .mockResolvedValue(makeView());

      const screen = await render(LivePanel, { view: liveView, actions });

      await vi.advanceTimersByTimeAsync(10_000);
      await stopButton(screen).click();

      await vi.waitFor(() => {
        expect(actions.refresh).toHaveBeenCalledTimes(2);
      });
      await expect.element(goLiveButton(screen)).toBeEnabled();

      releaseSlowRefresh(liveView);
      await new Promise((resolve) => setTimeout(resolve, 0));
      await tick();

      /* A polled assertion advances the fake interval, and the next refresh hides the fault. */
      expect(stopButton(screen).element()).toBeDisabled();
      expect(goLiveButton(screen).element()).toBeEnabled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('disables both buttons when another tab holds the lock', async () => {
    const screen = await render(LivePanel, {
      view: makeView({ publishInFlight: true }),
      actions: makeActions()
    });

    await expect.element(goLiveButton(screen)).toBeDisabled();
    await expect.element(stopButton(screen)).toBeDisabled();
  });
});

describe('Retry (AE14)', () => {
  it('offers only the choices of the failed step, names the reason, and preselects', async () => {
    const screen = await render(LivePanel, {
      view: makeView({
        retry: {
          failedStep: 'verify',
          reason: 'The public feed did not serve the new version.',
          choices: ['verify', 'publish'],
          preselected: 'verify'
        }
      }),
      actions: makeActions()
    });

    const form = screen.getByRole('form', { name: 'Retry' });

    await expect
      .element(form)
      .toHaveTextContent('Failed at verify: The public feed did not serve the new version.');
    await expect.element(screen.getByRole('radio', { name: 'Verify again' })).toBeChecked();
    await expect.element(screen.getByRole('radio', { name: 'Publish again' })).not.toBeChecked();
    await expect.element(screen.getByRole('radio', { name: 'Ping again' })).not.toBeInTheDocument();
  });

  it('sends the chosen step', async () => {
    const actions = makeActions();
    const screen = await render(LivePanel, {
      view: makeView({
        retry: {
          failedStep: 'verify',
          reason: 'No match.',
          choices: ['verify', 'publish'],
          preselected: 'verify'
        }
      }),
      actions
    });

    await screen.getByRole('radio', { name: 'Publish again' }).click();
    await screen.getByRole('button', { name: 'Retry' }).click();

    await expect.poll(() => vi.mocked(actions.retry).mock.calls.length).toBe(1);
    expect(actions.retry).toHaveBeenCalledWith('publish');
  });

  it('shows no retry when nothing failed', async () => {
    const screen = await render(LivePanel, { view: makeView(), actions: makeActions() });

    await expect.element(screen.getByRole('form', { name: 'Retry' })).not.toBeInTheDocument();
  });
});

describe('ended items (AE16)', () => {
  it('lists an ended item with only a delete control, and deletes after a confirmation', async () => {
    const view = makeView({ subject: PENDING_ITEM, ended: [ENDED_ITEM] });
    const actions = makeActions(view);
    const screen = await render(LivePanel, { view, actions });
    const section = screen.getByRole('region', { name: 'Ended live items' });

    await expect.element(section.getByRole('listitem')).toHaveTextContent('Last week');
    expect(section.getByRole('button').elements()).toHaveLength(1);

    await section.getByRole('button', { name: 'Delete' }).click();

    expect(actions.remove).not.toHaveBeenCalled();

    await section.getByRole('button', { name: 'Confirm delete' }).click();

    await expect.poll(() => vi.mocked(actions.remove).mock.calls.length).toBe(1);
    expect(actions.remove).toHaveBeenCalledWith('last-week');
  });

  it('shows when a failed Stop leaves the item published as live', async () => {
    const screen = await render(LivePanel, {
      view: makeView({
        subject: null,
        ended: [
          {
            ...ENDED_ITEM,
            published: { status: 'live', start: ENDED_ITEM.start, end: ENDED_ITEM.end }
          }
        ]
      }),
      actions: makeActions()
    });

    await expect
      .element(screen.getByRole('region', { name: 'Ended live items' }))
      .toHaveTextContent('still published as live');
  });
});

describe('the status', () => {
  it('names a draft, and offers neither Go live nor the create form', async () => {
    const screen = await render(LivePanel, {
      view: makeView({ subject: null, draftSlugs: ['friday'] }),
      actions: makeActions()
    });

    await expect.element(screen.getByText('A draft cannot go live: friday.')).toBeVisible();
    await expect.element(goLiveButton(screen)).toBeDisabled();
    await expect
      .element(screen.getByRole('form', { name: 'Create a live item' }))
      .not.toBeInTheDocument();
  });

  it('shows the local state beside the published state, with the change count', async () => {
    const screen = await render(LivePanel, {
      view: makeView({
        subject: { ...LIVE_ITEM, published: PENDING_ITEM.published },
        unpublishedChanges: 2
      }),
      actions: makeActions()
    });

    await expect.element(screen.getByTestId('local-state')).toHaveTextContent('Local: live');
    await expect
      .element(screen.getByTestId('published-state'))
      .toHaveTextContent('Published: pending');
    await expect
      .element(screen.getByTestId('unpublished-changes'))
      .toHaveTextContent('Unpublished changes: 2');
  });

  it.each([
    ['none', 'Nothing is published yet.'],
    ['unmatched', 'A publish did not finish'],
    ['offline', 'Offline: this is the last publish record']
  ] as const)('explains the public feed state %s', async (state, text) => {
    const screen = await render(LivePanel, {
      view: makeView({ publicFeed: { state } }),
      actions: makeActions()
    });

    await expect.element(screen.getByTestId('public-feed-note')).toHaveTextContent(text);
  });

  it('shows the source, the listeners, and the stream title as text, never as HTML', async () => {
    const screen = await render(LivePanel, {
      view: makeView({
        source: { state: 'connected', listeners: 3, title: 'A <img src=x onerror=alert(1)>' }
      }),
      actions: makeActions()
    });

    const source = screen.getByTestId('source');

    await expect
      .element(source)
      .toHaveTextContent('Source connected, 3 listener(s): A <img src=x onerror=alert(1)>');
    expect(source.element().querySelector('img')).toBeNull();
  });

  it('reports a failed refresh', async () => {
    const actions = makeActions();

    vi.mocked(actions.stop).mockResolvedValue({ ok: true } as never);
    vi.mocked(actions.refresh).mockRejectedValue(new Error('offline'));

    const screen = await render(LivePanel, { view: makeView({ subject: LIVE_ITEM }), actions });

    await stopButton(screen).click();

    await expect
      .element(screen.getByText('The page could not refresh this status from the app server.'))
      .toBeVisible();
  });
});
