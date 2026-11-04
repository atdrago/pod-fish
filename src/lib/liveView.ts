import * as v from 'valibot';

/* What the server sends to the Live tab (KTD9). The page parses it, so it needs no assertion. */

const statusSchema = v.picklist(['pending', 'live', 'ended']);

const liveItemViewSchema = v.object({
  slug: v.string(),
  title: v.string(),
  status: statusSchema,
  start: v.string(),
  end: v.optional(v.string()),
  durationMinutes: v.number(),
  published: v.nullable(
    v.object({ status: statusSchema, start: v.string(), end: v.optional(v.string()) })
  )
});

const streamStatusSchema = v.object({
  state: v.picklist(['connected', 'none', 'unknown']),
  listeners: v.optional(v.number()),
  title: v.optional(v.string())
});

export const RETRY_CHOICES = ['publish', 'verify', 'ping'] as const;

const retryChoiceSchema = v.picklist(RETRY_CHOICES);

export const liveViewSchema = v.object({
  publishInFlight: v.boolean(),
  subject: v.nullable(liveItemViewSchema),
  ended: v.array(liveItemViewSchema),
  draftSlugs: v.array(v.string()),
  publicFeed: v.object({
    state: v.picklist(['none', 'matched', 'unmatched', 'offline']),
    feedSha256: v.optional(v.string()),
    recordName: v.optional(v.string())
  }),
  unpublishedChanges: v.number(),
  failures: v.array(v.object({ node: v.string(), field: v.string(), message: v.string() })),
  source: streamStatusSchema,
  retry: v.nullable(
    v.object({
      failedStep: v.string(),
      reason: v.string(),
      choices: v.array(retryChoiceSchema),
      preselected: retryChoiceSchema
    })
  )
});

export const liveChangeResultSchema = v.variant('ok', [
  v.object({ ok: v.literal(true) }),
  v.object({ ok: v.literal(false), reason: v.string() })
]);

export const createLiveItemInputSchema = v.object({
  title: v.pipe(v.string(), v.trim(), v.nonEmpty('A title is required.')),
  description: v.string(),
  start: v.pipe(v.string(), v.isoTimestamp('The start must be a date and a time.')),
  durationMinutes: v.pipe(
    v.number(),
    v.integer(),
    v.minValue(1, 'The duration must be at least one minute.')
  )
});

export type LiveView = v.InferOutput<typeof liveViewSchema>;
export type LiveItemView = v.InferOutput<typeof liveItemViewSchema>;
export type StreamStatus = v.InferOutput<typeof streamStatusSchema>;
export type RetryChoice = v.InferOutput<typeof retryChoiceSchema>;
export type LiveChangeResult = v.InferOutput<typeof liveChangeResultSchema>;
export type CreateLiveItemInput = v.InferOutput<typeof createLiveItemInputSchema>;
