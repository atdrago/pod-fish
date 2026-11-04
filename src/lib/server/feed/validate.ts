import type { ContentProblem, ContentSnapshot } from '$lib/server/content/store';

/*
	R7. A failure names the node and the field. The store reports what fails a
	schema, and this adds what publish needs beyond the shape of a file. A draft
	stays out of the feed, so only its shape counts. U9 adds the per-tag refinements.
*/
export const validateContent = (snapshot: ContentSnapshot): ContentProblem[] => {
  const failures: ContentProblem[] = [...snapshot.problems];

  const requireText = (node: string, field: string, value: string | undefined): void => {
    if (value === undefined || value.trim() === '') {
      failures.push({ node, field, message: `${field} is required.` });
    }
  };

  const { show } = snapshot;

  if (show !== undefined) {
    requireText('show', 'title', show.title);
    requireText('show', 'link', show.link);
    requireText('show', 'description', show.description);
  }

  const guidOwners = new Map<string, string>();

  const requireUniqueGuid = (node: string, guid: string): void => {
    const owner = guidOwners.get(guid);

    if (owner === undefined) {
      guidOwners.set(guid, node);
    } else {
      failures.push({ node, field: 'guid', message: `This guid is already used by ${owner}.` });
    }
  };

  for (const { slug, record } of snapshot.episodes.filter((entry) => !entry.record.draft)) {
    const node = `episode:${slug}`;

    requireText(node, 'title', record.title);
    requireText(node, 'guid', record.guid);
    requireText(node, 'description', record.description);
    requireUniqueGuid(node, record.guid);

    if (record.media === undefined) {
      failures.push({ node, field: 'media', message: 'A published episode needs its audio.' });
    }
  }

  for (const { slug, record } of snapshot.liveItems.filter((entry) => !entry.record.draft)) {
    const node = `live:${slug}`;

    requireText(node, 'title', record.title);
    requireText(node, 'guid', record.guid);
    requireUniqueGuid(node, record.guid);

    if (record.contentLink === undefined) {
      failures.push({ node, field: 'contentLink', message: 'A live item needs a content link.' });
    }
  }

  return failures;
};
