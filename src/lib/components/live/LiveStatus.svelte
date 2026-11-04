<script lang="ts">
  import type { LiveItemView, LiveView } from '$lib/liveView';

  type Props = { view: LiveView };

  let { view }: Props = $props();

  const SOURCE_LABELS = {
    connected: 'Source connected',
    none: 'No source connected',
    unknown: 'Source status unknown'
  };

  const PUBLIC_FEED_NOTES = {
    none: 'Nothing is published yet.',
    matched: undefined,
    unmatched: 'A publish did not finish: the public feed matches no publish record.',
    offline: 'Offline: this is the last publish record, not a fresh read of the public feed.'
  };

  const describeTimes = (item: { start: string; end?: string }): string => {
    const start = new Date(item.start).toLocaleString();

    return item.end === undefined
      ? `from ${start}`
      : `from ${start} to ${new Date(item.end).toLocaleString()}`;
  };

  const describePublished = (item: LiveItemView): string =>
    item.published === null
      ? 'not published'
      : `${item.published.status}, ${describeTimes(item.published)}`;

  const publicFeedNote = $derived(PUBLIC_FEED_NOTES[view.publicFeed.state]);
  const listenerNote = $derived(
    view.source.listeners === undefined ? '' : `, ${String(view.source.listeners)} listener(s)`
  );
  const titleNote = $derived(view.source.title === undefined ? '' : `: ${view.source.title}`);
</script>

<section aria-label="Status" class="flex flex-col gap-2 rounded-md border border-fish-edge p-4">
  <p data-testid="source">
    <span class="font-medium">{SOURCE_LABELS[view.source.state]}</span>{listenerNote}{titleNote}
  </p>

  {#if view.subject !== null}
    <p class="font-medium">{view.subject.title}</p>
    <p data-testid="local-state">
      Local: {view.subject.status}, {describeTimes(view.subject)}
    </p>
    <p data-testid="published-state">Published: {describePublished(view.subject)}</p>
  {/if}

  <p data-testid="unpublished-changes">Unpublished changes: {view.unpublishedChanges}</p>

  {#if publicFeedNote !== undefined}
    <p data-testid="public-feed-note" class="text-fish-dim">{publicFeedNote}</p>
  {/if}

  {#if view.failures.length > 0}
    <ul aria-label="Validation failures" class="text-fish-live">
      {#each view.failures as failure, index (index)}
        <li>{failure.node} {failure.field}: {failure.message}</li>
      {/each}
    </ul>
  {/if}
</section>
