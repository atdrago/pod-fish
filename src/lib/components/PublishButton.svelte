<script lang="ts">
  import * as v from 'valibot';
  import { publishOutcomeSchema, type PublishOutcome } from '$lib/publishOutcome';

  const postPublish = async (): Promise<PublishOutcome> => {
    const response = await fetch('/api/publish', { method: 'POST' });
    const body: unknown = await response.json();

    return v.parse(publishOutcomeSchema, body);
  };

  type Props = { requestPublish?: () => Promise<PublishOutcome> };

  let { requestPublish = postPublish }: Props = $props();

  let isPublishing = $state(false);
  let outcome = $state<PublishOutcome>();

  const handlePublish = async (): Promise<void> => {
    if (isPublishing) {
      return;
    }

    isPublishing = true;

    try {
      outcome = await requestPublish();
    } catch {
      outcome = {
        ok: false,
        failedStep: 'unexpected',
        reason: 'The page could not read an answer from the app server.'
      };
    } finally {
      isPublishing = false;
    }
  };
</script>

<div class="flex flex-col items-end gap-1">
  <button
    type="button"
    disabled={isPublishing}
    onclick={handlePublish}
    class="rounded-md bg-fish-accent px-3 py-1.5 font-medium text-fish-accent-ink disabled:opacity-60"
  >
    {isPublishing ? 'Publishing…' : 'Publish'}
  </button>

  <div role="status" class="max-w-md text-right text-sm">
    {#if outcome?.ok}
      <p>Published and verified: {outcome.pingLabel}.</p>
    {:else if outcome !== undefined}
      <p class="text-fish-live">Failed at {outcome.failedStep}: {outcome.reason}</p>
      {#each outcome.failures ?? [] as failure, index (index)}
        <p>{failure.node} {failure.field}: {failure.message}</p>
      {/each}
    {/if}
  </div>
</div>
