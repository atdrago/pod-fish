import * as v from 'valibot';

/* The result of a publish, as a value (KTD12). The server sends it and the page reads it. */
export const publishOutcomeSchema = v.variant('ok', [
  v.object({
    ok: v.literal(true),
    recordName: v.string(),
    uploaded: v.array(v.string()),
    skipped: v.number(),
    feedSha256: v.string(),
    pingLabel: v.string()
  }),
  v.object({
    ok: v.literal(false),
    failedStep: v.picklist([
      'lock',
      'refused',
      'validate',
      'mount',
      'upload',
      'feed',
      'record',
      'verify',
      'ping',
      'unexpected'
    ]),
    reason: v.string(),
    recordName: v.optional(v.string()),
    failedFile: v.optional(v.string()),
    failures: v.optional(
      v.array(v.object({ node: v.string(), field: v.string(), message: v.string() }))
    )
  })
]);

export type PublishOutcome = v.InferOutput<typeof publishOutcomeSchema>;
