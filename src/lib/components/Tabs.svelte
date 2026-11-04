<script lang="ts">
  import { resolve } from '$app/paths';

  type Props = { pathname: string };

  let { pathname }: Props = $props();

  const tabs = [
    { href: resolve('/'), label: 'Feed' },
    { href: resolve('/live'), label: 'Live' }
  ];
</script>

<nav aria-label="Tabs" class="flex gap-1">
  {#each tabs as tab (tab.href)}
    <a
      href={tab.href}
      aria-current={pathname === tab.href ? 'page' : undefined}
      class="rounded-md px-3 py-1.5 font-medium aria-[current=page]:bg-fish-accent aria-[current=page]:text-fish-accent-ink"
    >
      {tab.label}
    </a>
  {/each}
</nav>
