import type { LiveItemRecord } from '$lib/server/content/schemas';

const escapeText = (value: string): string =>
  value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

const escapeAttribute = (value: string): string => escapeText(value).replaceAll('"', '&quot;');

const CHILD_INDENT = '      ';
const ELEMENT_INDENT = '    ';

/*
	A stream has no size. The RSS Advisory Board profile says a publisher uses a
	length of 0 when the size cannot be determined.
*/
const renderChildren = (record: LiveItemRecord): string =>
  [
    `<title>${escapeText(record.title)}</title>`,
    `<guid isPermaLink="false">${escapeText(record.guid)}</guid>`,
    `<enclosure url="${escapeAttribute(record.enclosure.url)}" type="${escapeAttribute(record.enclosure.type)}" length="0"/>`,
    `<description>${escapeText(record.description)}</description>`,
    `<pubDate>${new Date(record.start).toUTCString()}</pubDate>`
  ]
    .map((child) => `\n${CHILD_INDENT}${child}`)
    .join('');

/*
	KTD5. feedsmith emits a live item's namespace children and attributes, but not
	its RSS children, and it has no hook to add them. So this inserts them into each
	element in array order. An element with no namespace child arrives self-closing.

	The pattern matches a CDATA section first and returns it unchanged, because a
	channel description can hold the literal text of a live item tag.
*/
const LIVE_ITEM_OR_CDATA = /<!\[CDATA\[[\s\S]*?\]\]>|<podcast:liveItem\b[^>]*?(\/)?>/g;

export const insertLiveItemChildren = (
  xml: string,
  liveItems: readonly LiveItemRecord[]
): string => {
  let index = 0;

  const inserted = xml.replace(LIVE_ITEM_OR_CDATA, (match, selfClosingSlash?: string) => {
    if (match.startsWith('<![CDATA[')) {
      return match;
    }

    const record = liveItems.at(index);

    index += 1;

    if (record === undefined) {
      throw new Error(
        `The feed holds more live item elements than the ${String(liveItems.length)} records.`
      );
    }

    return selfClosingSlash === undefined
      ? `${match}${renderChildren(record)}`
      : `${match.slice(0, -2)}>${renderChildren(record)}\n${ELEMENT_INDENT}</podcast:liveItem>`;
  });

  if (index !== liveItems.length) {
    throw new Error(
      `The feed holds ${String(index)} live item elements for ${String(liveItems.length)} records.`
    );
  }

  return inserted;
};
