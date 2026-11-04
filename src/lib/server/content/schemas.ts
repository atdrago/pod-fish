import * as v from 'valibot';
import { isSafeRelativePath } from './paths';

/*
	The shape of the content folder (KTD4). These types are this app's own, so the
	files never depend on a third-party type: `feed/model.ts` is the one adapter
	to the generator. A strict object rejects an unknown key, because a hand edit
	with a misspelled key must fail, not vanish. U9 adds the per-tag refinements.
*/

const holdsNoCredentials = (value: string): boolean => {
  if (!URL.canParse(value)) {
    return true;
  }

  const url = new URL(value);

  return url.username === '' && url.password === '';
};

const urlSchema = v.pipe(
  v.string(),
  v.url('This value must be a URL.'),
  v.check(holdsNoCredentials, 'A URL must not hold a username or a password.')
);

const sidecarPathSchema = v.pipe(
  v.string(),
  v.nonEmpty(),
  v.check(
    isSafeRelativePath,
    'A file reference must be a relative path with no empty or dot segment.'
  )
);

const timestampSchema = v.pipe(
  v.string(),
  v.isoTimestamp('This value must be an ISO 8601 timestamp with an offset.')
);

const revisionSchema = v.pipe(v.number(), v.integer(), v.minValue(0));
const positiveIntegerSchema = v.pipe(v.number(), v.integer(), v.minValue(0));

const transcriptSchema = v.pipe(
  v.strictObject({
    url: v.optional(urlSchema),
    file: v.optional(sidecarPathSchema),
    type: v.string(),
    language: v.optional(v.string()),
    rel: v.optional(v.string())
  }),
  v.check(
    (transcript) => (transcript.url === undefined) !== (transcript.file === undefined),
    'A transcript needs exactly one of url and file.'
  )
);

const chaptersSchema = v.pipe(
  v.strictObject({
    url: v.optional(urlSchema),
    file: v.optional(sidecarPathSchema),
    type: v.string()
  }),
  v.check(
    (chapters) => (chapters.url === undefined) !== (chapters.file === undefined),
    'Chapters need exactly one of url and file.'
  )
);

const soundbiteSchema = v.strictObject({
  startTime: v.number(),
  duration: v.number(),
  display: v.optional(v.string())
});

const personSchema = v.strictObject({
  display: v.string(),
  role: v.optional(v.string()),
  group: v.optional(v.string()),
  img: v.optional(urlSchema),
  href: v.optional(urlSchema)
});

const locationSchema = v.strictObject({
  display: v.string(),
  rel: v.optional(v.string()),
  geo: v.optional(v.string()),
  osm: v.optional(v.string()),
  country: v.optional(v.string())
});

const seasonSchema = v.strictObject({ number: v.number(), name: v.optional(v.string()) });
const episodeNumberSchema = v.strictObject({ number: v.number(), display: v.optional(v.string()) });
const licenseSchema = v.strictObject({ display: v.string(), url: v.optional(urlSchema) });

const alternateEnclosureSchema = v.strictObject({
  type: v.string(),
  length: v.optional(positiveIntegerSchema),
  bitrate: v.optional(v.number()),
  height: v.optional(v.number()),
  lang: v.optional(v.string()),
  title: v.optional(v.string()),
  rel: v.optional(v.string()),
  codecs: v.optional(v.string()),
  default: v.optional(v.boolean()),
  sources: v.optional(
    v.array(v.strictObject({ uri: v.string(), contentType: v.optional(v.string()) }))
  ),
  integrity: v.optional(v.strictObject({ type: v.string(), value: v.string() }))
});

const remoteItemSchema = v.strictObject({
  feedGuid: v.string(),
  feedUrl: v.optional(urlSchema),
  itemGuid: v.optional(v.string()),
  medium: v.optional(v.string()),
  title: v.optional(v.string())
});

const valueRecipientSchema = v.strictObject({
  name: v.optional(v.string()),
  customKey: v.optional(v.string()),
  customValue: v.optional(v.string()),
  type: v.string(),
  address: v.string(),
  split: v.number(),
  fee: v.optional(v.boolean())
});

const valueTimeSplitSchema = v.strictObject({
  startTime: v.number(),
  duration: v.number(),
  remoteStartTime: v.optional(v.number()),
  remotePercentage: v.optional(v.number()),
  remoteItem: v.optional(remoteItemSchema),
  valueRecipients: v.optional(v.array(valueRecipientSchema))
});

const valueSchema = v.strictObject({
  type: v.string(),
  method: v.string(),
  suggested: v.optional(v.number()),
  valueRecipients: v.optional(v.array(valueRecipientSchema)),
  valueTimeSplits: v.optional(v.array(valueTimeSplitSchema))
});

const imageFields = {
  alt: v.optional(v.string()),
  aspectRatio: v.optional(v.string()),
  width: v.optional(v.number()),
  height: v.optional(v.number()),
  type: v.optional(v.string()),
  purpose: v.optional(v.string())
};

const itemImageSchema = v.pipe(
  v.strictObject({
    href: v.optional(urlSchema),
    file: v.optional(sidecarPathSchema),
    ...imageFields
  }),
  v.check(
    (image) => (image.href === undefined) !== (image.file === undefined),
    'An image needs exactly one of href and file.'
  )
);

const socialInteractSchema = v.strictObject({
  uri: v.optional(v.string()),
  protocol: v.string(),
  accountId: v.optional(v.string()),
  accountUrl: v.optional(urlSchema),
  priority: v.optional(v.number())
});

const txtSchema = v.strictObject({ display: v.string(), purpose: v.optional(v.string()) });

const chatSchema = v.strictObject({
  server: v.string(),
  protocol: v.string(),
  accountId: v.optional(v.string()),
  space: v.optional(v.string())
});

const itemTagsSchema = v.strictObject({
  transcripts: v.optional(v.array(transcriptSchema)),
  chapters: v.optional(chaptersSchema),
  soundbites: v.optional(v.array(soundbiteSchema)),
  persons: v.optional(v.array(personSchema)),
  locations: v.optional(v.array(locationSchema)),
  season: v.optional(seasonSchema),
  episode: v.optional(episodeNumberSchema),
  license: v.optional(licenseSchema),
  alternateEnclosures: v.optional(v.array(alternateEnclosureSchema)),
  values: v.optional(v.array(valueSchema)),
  images: v.optional(v.array(itemImageSchema)),
  socialInteracts: v.optional(v.array(socialInteractSchema)),
  txts: v.optional(v.array(txtSchema)),
  chat: v.optional(chatSchema)
});

const channelTagsSchema = v.strictObject({
  locked: v.optional(v.strictObject({ value: v.boolean(), owner: v.optional(v.string()) })),
  fundings: v.optional(
    v.array(v.strictObject({ url: urlSchema, display: v.optional(v.string()) }))
  ),
  persons: v.optional(v.array(personSchema)),
  locations: v.optional(v.array(locationSchema)),
  trailers: v.optional(
    v.array(
      v.strictObject({
        display: v.string(),
        url: urlSchema,
        pubDate: timestampSchema,
        length: v.optional(positiveIntegerSchema),
        type: v.optional(v.string()),
        season: v.optional(v.number())
      })
    )
  ),
  license: v.optional(licenseSchema),
  guid: v.optional(v.string()),
  values: v.optional(v.array(valueSchema)),
  medium: v.optional(v.string()),
  images: v.optional(v.array(v.strictObject({ href: urlSchema, ...imageFields }))),
  blocks: v.optional(v.array(v.strictObject({ value: v.boolean(), id: v.optional(v.string()) }))),
  txts: v.optional(v.array(txtSchema)),
  remoteItems: v.optional(v.array(remoteItemSchema)),
  podroll: v.optional(v.strictObject({ remoteItems: v.optional(v.array(remoteItemSchema)) })),
  updateFrequency: v.optional(
    v.strictObject({
      display: v.string(),
      complete: v.optional(v.boolean()),
      dtstart: v.optional(timestampSchema),
      rrule: v.optional(v.string())
    })
  ),
  podping: v.optional(v.strictObject({ usesPodping: v.optional(v.boolean()) })),
  chat: v.optional(chatSchema),
  publisher: v.optional(v.strictObject({ remoteItem: v.optional(remoteItemSchema) }))
});

const itunesCategorySchema = v.strictObject({
  text: v.string(),
  categories: v.optional(v.array(v.strictObject({ text: v.string() })))
});

export const showSchema = v.strictObject({
  revision: revisionSchema,
  title: v.string(),
  link: v.union([v.literal(''), urlSchema]),
  description: v.string(),
  language: v.optional(v.string()),
  copyright: v.optional(v.string()),
  ttl: v.pipe(v.number(), v.integer(), v.minValue(1)),
  image: v.optional(v.strictObject({ url: urlSchema, title: v.string(), link: urlSchema })),
  itunes: v.optional(
    v.strictObject({
      author: v.optional(v.string()),
      explicit: v.optional(v.boolean()),
      type: v.optional(v.picklist(['episodic', 'serial'])),
      image: v.optional(urlSchema),
      categories: v.optional(v.array(itunesCategorySchema)),
      owner: v.optional(v.strictObject({ name: v.string(), email: v.string() }))
    })
  ),
  podcast: v.optional(channelTagsSchema)
});

export const episodeSchema = v.strictObject({
  revision: revisionSchema,
  draft: v.optional(v.boolean(), false),
  title: v.string(),
  guid: v.string(),
  description: v.string(),
  pubDate: timestampSchema,
  link: v.optional(urlSchema),
  media: v.optional(
    v.strictObject({
      file: sidecarPathSchema,
      sha256: v.pipe(
        v.string(),
        v.regex(/^[0-9a-f]{64}$/, 'A sha256 must be 64 lowercase hex digits.')
      ),
      length: positiveIntegerSchema,
      type: v.string(),
      durationSeconds: v.optional(v.number())
    })
  ),
  itunes: v.optional(
    v.strictObject({
      title: v.optional(v.string()),
      episodeType: v.optional(v.picklist(['full', 'trailer', 'bonus'])),
      explicit: v.optional(v.boolean()),
      image: v.optional(urlSchema)
    })
  ),
  podcast: v.optional(itemTagsSchema)
});

const LIVE_STATUSES = ['pending', 'live', 'ended'] as const;

const liveStatusSchema = v.picklist(LIVE_STATUSES, 'A live status is pending, live, or ended.');

export const liveItemSchema = v.strictObject({
  revision: revisionSchema,
  draft: v.optional(v.boolean(), false),
  title: v.string(),
  guid: v.string(),
  description: v.string(),
  status: liveStatusSchema,
  start: timestampSchema,
  end: v.optional(timestampSchema),
  durationMinutes: v.pipe(v.number(), v.integer(), v.minValue(1)),
  contentLink: v.optional(v.strictObject({ href: urlSchema, display: v.optional(v.string()) })),
  enclosure: v.strictObject({ url: urlSchema, type: v.string() }),
  podcast: v.optional(itemTagsSchema)
});

const PUBLISH_REASONS = ['update', 'live', 'liveEnd'] as const;

export const publishRecordSchema = v.strictObject({
  startedAt: timestampSchema,
  builtAt: timestampSchema,
  finishedAt: v.optional(timestampSchema),
  reason: v.picklist(PUBLISH_REASONS),
  feedKey: v.string(),
  feedSha256: v.string(),
  files: v.array(
    v.strictObject({
      key: v.string(),
      source: v.string(),
      sha256: v.string(),
      length: positiveIntegerSchema,
      uploaded: v.boolean()
    })
  ),
  liveItems: v.array(
    v.strictObject({
      slug: v.string(),
      guid: v.string(),
      status: liveStatusSchema,
      start: timestampSchema,
      end: v.optional(timestampSchema)
    })
  ),
  feedUploaded: v.boolean(),
  verified: v.boolean(),
  pinged: v.boolean(),
  pingResult: v.optional(v.string()),
  failedStep: v.optional(v.picklist(['upload', 'feed', 'verify', 'ping'])),
  failedReason: v.optional(v.string()),
  failedFile: v.optional(v.string())
});

export type ShowRecord = v.InferOutput<typeof showSchema>;
export type EpisodeRecord = v.InferOutput<typeof episodeSchema>;
export type LiveItemRecord = v.InferOutput<typeof liveItemSchema>;
export type PublishRecord = v.InferOutput<typeof publishRecordSchema>;
