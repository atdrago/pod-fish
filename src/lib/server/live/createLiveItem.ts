import * as v from 'valibot';
import { createLiveItemInputSchema, type LiveChangeResult } from '$lib/liveView';
import { contentTypeFor } from '$lib/server/feed/contentTypes';
import { draftSlugsOf, openItems, type LiveDeps } from './state';

const MS_PER_MINUTE = 60_000;

const slugify = (title: string): string =>
  title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

/* R19. The mount URL, its type, and the content link come from the configured settings. */
export const createLiveItem = async (
  deps: LiveDeps,
  input: unknown
): Promise<LiveChangeResult & { slug?: string }> => {
  const parsed = v.safeParse(createLiveItemInputSchema, input);

  if (!parsed.success) {
    const [issue] = parsed.issues;

    return { ok: false, reason: `${v.getDotPath(issue) ?? 'input'}: ${issue.message}` };
  }

  const snapshot = await deps.store.readSnapshot();
  const draftSlug = draftSlugsOf(snapshot).at(0);

  if (draftSlug !== undefined) {
    return { ok: false, reason: `The live item ${draftSlug} is a draft. Finish it or delete it.` };
  }

  const openItem = openItems(snapshot).at(0);

  if (openItem !== undefined) {
    return { ok: false, reason: `The live item ${openItem.slug} is still open.` };
  }

  const contentType = contentTypeFor(new URL(deps.mountUrl).pathname);

  if (!contentType.ok) {
    return { ok: false, reason: contentType.message };
  }

  const { title, description, start, durationMinutes } = parsed.output;
  const baseSlug = `${start.slice(0, 10)}-${slugify(title) || 'show'}`;
  const existingSlugs = new Set(snapshot.liveItems.map(({ slug }) => slug));
  let slug = baseSlug;

  for (let suffix = 2; existingSlugs.has(slug); suffix += 1) {
    slug = `${baseSlug}-${String(suffix)}`;
  }

  const written = await deps.store.writeLiveItem(slug, {
    revision: 1,
    draft: false,
    title,
    guid: deps.createGuid(),
    description,
    status: 'pending',
    start,
    end: new Date(Date.parse(start) + durationMinutes * MS_PER_MINUTE).toISOString(),
    durationMinutes,
    contentLink: { href: deps.showPageUrl, display: 'Listen live' },
    enclosure: { url: deps.mountUrl, type: contentType.contentType }
  });

  return written.ok ? { ok: true, slug } : { ok: false, reason: written.message };
};
