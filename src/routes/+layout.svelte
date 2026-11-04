<script lang="ts">
  import { page } from '$app/state';
  import PublishButton from '$lib/components/PublishButton.svelte';
  import Tabs from '$lib/components/Tabs.svelte';
  import type { LayoutProps } from './$types';
  import './layout.css';

  let { children }: LayoutProps = $props();
</script>

<div class="flex min-h-screen flex-col">
  <header class="flex items-start gap-4 border-b border-fish-edge bg-fish-surface px-4 py-2">
    <span class="py-1.5 font-semibold">pod-fish</span>
    <Tabs pathname={page.url.pathname} />
    <div class="ml-auto"><PublishButton /></div>
  </header>
  <main class="mx-auto w-full max-w-5xl flex-1 px-4 py-6">{@render children()}</main>
</div>
