<script lang="ts">
  import type { CreateLiveItemInput } from '$lib/liveView';

  type Props = { disabled: boolean; onCreate: (input: CreateLiveItemInput) => void };

  let { disabled, onCreate }: Props = $props();

  const DEFAULT_DURATION_MINUTES = 120;

  let title = $state('');
  let description = $state('');
  let startLocal = $state('');
  let durationMinutes = $state(DEFAULT_DURATION_MINUTES);

  const handleSubmit = (event: SubmitEvent): void => {
    event.preventDefault();

    if (disabled) {
      return;
    }

    onCreate({
      title,
      description,
      start: new Date(startLocal).toISOString(),
      durationMinutes
    });
  };
</script>

<form
  aria-label="Create a live item"
  onsubmit={handleSubmit}
  class="flex flex-col gap-3 rounded-md border border-fish-edge p-4"
>
  <p class="font-medium">Create a live item</p>
  <label class="flex flex-col gap-1">
    Title
    <input
      bind:value={title}
      required
      class="rounded-md border-fish-edge bg-fish-surface text-fish-text"
    />
  </label>
  <label class="flex flex-col gap-1">
    Description
    <textarea
      bind:value={description}
      rows="2"
      class="rounded-md border-fish-edge bg-fish-surface text-fish-text"></textarea>
  </label>
  <label class="flex flex-col gap-1">
    Start
    <input
      type="datetime-local"
      bind:value={startLocal}
      required
      class="rounded-md border-fish-edge bg-fish-surface text-fish-text"
    />
  </label>
  <label class="flex flex-col gap-1">
    Duration in minutes
    <input
      type="number"
      min="1"
      bind:value={durationMinutes}
      required
      class="rounded-md border-fish-edge bg-fish-surface text-fish-text"
    />
  </label>
  <button
    type="submit"
    {disabled}
    class="self-start rounded-md bg-fish-accent px-3 py-1.5 font-medium text-fish-accent-ink disabled:opacity-50"
  >
    Create
  </button>
</form>
