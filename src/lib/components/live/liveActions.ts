import * as v from 'valibot';
import {
  liveChangeResultSchema,
  liveViewSchema,
  type CreateLiveItemInput,
  type LiveChangeResult,
  type LiveView,
  type RetryChoice
} from '$lib/liveView';
import { publishOutcomeSchema, type PublishOutcome } from '$lib/publishOutcome';

export type LiveActions = {
  refresh: () => Promise<LiveView>;
  goLive: () => Promise<PublishOutcome>;
  stop: () => Promise<PublishOutcome>;
  retry: (choice: RetryChoice) => Promise<PublishOutcome>;
  create: (input: CreateLiveItemInput) => Promise<LiveChangeResult>;
  remove: (slug: string) => Promise<LiveChangeResult>;
};

const JSON_HEADERS = { 'content-type': 'application/json' };

const postJson = async (path: string, body?: unknown): Promise<unknown> => {
  const response = await fetch(path, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: body === undefined ? undefined : JSON.stringify(body)
  });

  return response.json();
};

export const liveActions: LiveActions = {
  refresh: async () => {
    const response = await fetch('/api/live/status');

    return v.parse(liveViewSchema, await response.json());
  },
  goLive: async () => v.parse(publishOutcomeSchema, await postJson('/api/live/go')),
  stop: async () => v.parse(publishOutcomeSchema, await postJson('/api/live/stop')),
  retry: async (choice) =>
    v.parse(publishOutcomeSchema, await postJson('/api/live/retry', { choice })),
  create: async (input) =>
    v.parse(liveChangeResultSchema, await postJson('/api/live/create', input)),
  remove: async (slug) =>
    v.parse(liveChangeResultSchema, await postJson('/api/live/delete', { slug }))
};
