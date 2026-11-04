<script lang="ts">
  import type { StreamStatus } from '$lib/liveView';

  type Props = {
    disabled: boolean;
    sourceState: StreamStatus['state'];
    onConfirm: () => void;
  };

  let { disabled, sourceState, onConfirm }: Props = $props();

  let dialog = $state<HTMLDialogElement>();

  const SOURCE_NOTES = {
    connected: 'Your source is connected.',
    none: 'No source is connected. Go live will stop until the mount answers with audio.',
    unknown: 'The source status is unknown. Go live still checks the mount first.'
  };

  const confirm = (): void => {
    dialog?.close();

    if (!disabled) {
      onConfirm();
    }
  };
</script>

<button
  type="button"
  {disabled}
  onclick={() => dialog?.showModal()}
  class="rounded-md bg-fish-live px-4 py-2 font-semibold text-fish-live-ink disabled:opacity-50"
>
  Go live
</button>

<dialog
  bind:this={dialog}
  aria-label="Confirm Go live"
  class="m-auto rounded-md bg-fish-surface p-6 text-fish-text backdrop:bg-black/50"
>
  <p class="font-semibold">Start your local recording now.</p>
  <p class="mt-2">{SOURCE_NOTES[sourceState]}</p>
  <div class="mt-4 flex justify-end gap-2">
    <button
      type="button"
      onclick={() => dialog?.close()}
      class="rounded-md border border-fish-edge px-3 py-1.5"
    >
      Cancel
    </button>
    <button
      type="button"
      onclick={confirm}
      class="rounded-md bg-fish-live px-3 py-1.5 font-semibold text-fish-live-ink"
    >
      Confirm Go live
    </button>
  </div>
</dialog>
