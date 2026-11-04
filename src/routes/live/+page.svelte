<script lang="ts">
  import LivePanel from '$lib/components/live/LivePanel.svelte';
  import type { PageProps } from './$types';

  let { data }: PageProps = $props();
</script>

<svelte:head>
  <title>Live: pod-fish</title>
</svelte:head>

<h1 class="text-xl font-semibold">Live</h1>
<LivePanel view={data.view} />
