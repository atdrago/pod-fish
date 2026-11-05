<script lang="ts">
  import type { CreateLiveItemInput, LiveChangeResult, LiveView, RetryChoice } from '$lib/liveView';
  import type { PublishOutcome } from '$lib/publishOutcome';
  import CreateLiveItem from './CreateLiveItem.svelte';
  import GoLiveButton from './GoLiveButton.svelte';
  import { liveActions, type LiveActions } from './liveActions';
  import LiveStatus from './LiveStatus.svelte';
  import StopButton from './StopButton.svelte';

  type Props = { view: LiveView; actions?: LiveActions };

  let { view, actions = liveActions }: Props = $props();

  const REFRESH_INTERVAL_MS = 10_000;

  const RETRY_LABELS: Record<RetryChoice, string> = {
    publish: 'Publish again',
    verify: 'Verify again',
    ping: 'Ping again'
  };

  let refreshedView = $state<LiveView>();
  let isRefreshFailing = $state(false);
  let isRequestInFlight = $state(false);
  let outcome = $state<PublishOutcome | LiveChangeResult>();
  let chosenRetry = $state<RetryChoice>();
  let confirmingDeleteSlug = $state<string>();

  const currentView = $derived(refreshedView ?? view);
  const isBusy = $derived(isRequestInFlight || currentView.publishInFlight);
  const subject = $derived(currentView.subject);
  const retry = $derived(currentView.retry);
  const selectedRetry = $derived(
    chosenRetry !== undefined && retry?.choices.includes(chosenRetry) === true
      ? chosenRetry
      : retry?.preselected
  );

  let refreshSequence = 0;

  const refresh = async (): Promise<void> => {
    refreshSequence += 1;
    const ticket = refreshSequence;

    try {
      const nextView = await actions.refresh();

      if (ticket === refreshSequence) {
        refreshedView = nextView;
        isRefreshFailing = false;
      }
    } catch {
      if (ticket === refreshSequence) {
        isRefreshFailing = true;
      }
    }
  };

  $effect(() => {
    const timer = setInterval(() => {
      if (!isRequestInFlight) {
        refresh().catch(() => undefined);
      }
    }, REFRESH_INTERVAL_MS);

    return () => {
      clearInterval(timer);
    };
  });

  const runAction = async (
    action: () => Promise<PublishOutcome | LiveChangeResult>
  ): Promise<void> => {
    if (isBusy) {
      return;
    }

    isRequestInFlight = true;
    outcome = undefined;

    try {
      outcome = await action();
    } catch {
      outcome = { ok: false, reason: 'The page could not read an answer from the app server.' };
    } finally {
      await refresh();
      isRequestInFlight = false;
    }
  };

  const start = (action: () => Promise<PublishOutcome | LiveChangeResult>): void => {
    runAction(action).catch(() => undefined);
  };

  const removeItem = (slug: string): void => {
    confirmingDeleteSlug = undefined;
    start(() => actions.remove(slug));
  };
</script>

<div class="mt-4 flex flex-col gap-4">
  <LiveStatus view={currentView} />

  {#if isRefreshFailing}
    <p class="text-fish-live">The page could not refresh this status from the app server.</p>
  {/if}

  <div class="flex gap-3">
    <GoLiveButton
      disabled={isBusy || subject?.status !== 'pending' || currentView.failures.length > 0}
      sourceState={currentView.source.state}
      onConfirm={() => {
        start(actions.goLive);
      }}
    />
    <StopButton
      disabled={isBusy || subject?.status !== 'live'}
      onStop={() => {
        start(actions.stop);
      }}
    />
  </div>

  <div role="status">
    {#if outcome?.ok === true}
      <p>Done{'pingLabel' in outcome ? `: ${outcome.pingLabel}.` : '.'}</p>
    {:else if outcome !== undefined}
      <p class="text-fish-live">
        {'failedStep' in outcome ? `Failed at ${outcome.failedStep}: ` : ''}{outcome.reason}
      </p>
    {/if}
  </div>

  {#if retry !== null}
    <form
      aria-label="Retry"
      class="flex flex-col gap-2 rounded-md border border-fish-live p-4"
      onsubmit={(event) => {
        event.preventDefault();

        if (selectedRetry !== undefined) {
          const choice = selectedRetry;

          start(() => actions.retry(choice));
        }
      }}
    >
      <p><span class="font-medium">Failed at {retry.failedStep}:</span> {retry.reason}</p>
      {#each retry.choices as choice (choice)}
        <label class="flex items-center gap-2">
          <input
            type="radio"
            name="retry-choice"
            value={choice}
            checked={selectedRetry === choice}
            onchange={() => {
              chosenRetry = choice;
            }}
          />
          {RETRY_LABELS[choice]}
        </label>
      {/each}
      <button
        type="submit"
        disabled={isBusy}
        class="self-start rounded-md bg-fish-accent px-3 py-1.5 font-medium text-fish-accent-ink disabled:opacity-50"
      >
        Retry
      </button>
    </form>
  {/if}

  {#if currentView.draftSlugs.length > 0}
    <p class="text-fish-live">
      A draft cannot go live: {currentView.draftSlugs.join(', ')}. Clear its draft flag in its JSON
      file with the app stopped, or delete it.
    </p>
  {:else if subject === null}
    <CreateLiveItem
      disabled={isBusy}
      onCreate={(input: CreateLiveItemInput) => {
        start(() => actions.create(input));
      }}
    />
  {/if}

  {#if currentView.ended.length > 0}
    <section aria-label="Ended live items" class="flex flex-col gap-2">
      <h2 class="font-medium">Ended</h2>
      <ul class="flex flex-col gap-2">
        {#each currentView.ended as item (item.slug)}
          <li
            class="flex items-center justify-between gap-3 rounded-md border border-fish-edge p-3"
          >
            <span>
              {item.title}
              {#if item.published !== null && item.published.status !== item.status}
                <span class="text-fish-live">(still published as {item.published.status})</span>
              {/if}
            </span>
            {#if confirmingDeleteSlug === item.slug}
              <span class="flex gap-2">
                <button
                  type="button"
                  disabled={isBusy}
                  onclick={() => {
                    removeItem(item.slug);
                  }}
                  class="rounded-md bg-fish-live px-3 py-1 text-fish-live-ink disabled:opacity-50"
                >
                  Confirm delete
                </button>
                <button
                  type="button"
                  onclick={() => {
                    confirmingDeleteSlug = undefined;
                  }}
                  class="rounded-md border border-fish-edge px-3 py-1"
                >
                  Cancel
                </button>
              </span>
            {:else}
              <button
                type="button"
                disabled={isBusy}
                onclick={() => {
                  confirmingDeleteSlug = item.slug;
                }}
                class="rounded-md border border-fish-edge px-3 py-1 disabled:opacity-50"
              >
                Delete
              </button>
            {/if}
          </li>
        {/each}
      </ul>
    </section>
  {/if}
</div>
