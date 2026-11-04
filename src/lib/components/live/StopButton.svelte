<script lang="ts">
  type Props = { disabled: boolean; onStop: () => void };

  let { disabled, onStop }: Props = $props();
</script>

<button
  type="button"
  {disabled}
  onclick={onStop}
  class="rounded-md border border-fish-edge px-4 py-2 font-semibold disabled:opacity-50"
>
  Stop
</button>
