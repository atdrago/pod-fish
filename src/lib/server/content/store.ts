import { randomBytes } from 'node:crypto';
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import * as v from 'valibot';
import { errMessage, log } from '$lib/server/log';
import {
  EPISODE_FILE,
  EPISODES_FOLDER,
  isInsideFolder,
  isSafeSlug,
  LIVE_FILE,
  LIVE_FOLDER,
  PUBLISH_FOLDER,
  SHOW_FILE
} from './paths';
import {
  episodeSchema,
  liveItemSchema,
  publishRecordSchema,
  showSchema,
  type EpisodeRecord,
  type LiveItemRecord,
  type PublishRecord,
  type ShowRecord
} from './schemas';

/* A problem names the node and the field, so the UI can name them too (R7). */
export type ContentProblem = { node: string; field: string; message: string };

export type WriteResult =
  | { ok: true }
  | { ok: false; reason: 'stale' | 'invalid' | 'path_rejected' | 'io_error'; message: string };

type EpisodeEntry = { slug: string; record: EpisodeRecord };
type LiveItemEntry = { slug: string; record: LiveItemRecord };
export type PublishEntry = { name: string; record: PublishRecord };

export type ContentSnapshot = {
  show: ShowRecord | undefined;
  episodes: EpisodeEntry[];
  liveItems: LiveItemEntry[];
  problems: ContentProblem[];
};

/* The channel starts empty. `validate.ts` reports what publish still needs. */
const INITIAL_SHOW: ShowRecord = {
  revision: 1,
  title: '',
  link: '',
  description: '',
  language: 'en',
  ttl: 5,
  podcast: {}
};

/* An hour of MP3 is about 58 MB, and GitHub refuses a file over 100 MB without LFS. */
const CONTENT_GITIGNORE = 'episodes/*/media/\n.DS_Store\n';
const GITIGNORE_FILE = '.gitignore';

const isMissingFileError = (error: unknown): boolean =>
  error instanceof Error && 'code' in error && error.code === 'ENOENT';

const writeIfMissing = async (path: string, contents: string): Promise<void> => {
  try {
    await writeFile(path, contents, { encoding: 'utf8', flag: 'wx' });
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) {
      throw error;
    }
  }
};

const toProblems = (
  node: string,
  issues: readonly v.BaseIssue<unknown>[]
): readonly ContentProblem[] =>
  issues.map((issue) => ({
    node,
    field: v.getDotPath(issue) ?? '',
    message: issue.message
  }));

export const createContentStore = (contentFolder: string) => {
  const showPath = join(contentFolder, SHOW_FILE);

  const writeJsonAtomically = async (path: string, value: unknown): Promise<void> => {
    const temporaryPath = `${path}.tmp-${randomBytes(6).toString('hex')}`;

    try {
      await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
      await rename(temporaryPath, path);
    } catch (error) {
      await rm(temporaryPath, { force: true });
      throw error;
    }
  };

  const readRevision = async (path: string): Promise<number | undefined> => {
    try {
      const parsed: unknown = JSON.parse(await readFile(path, 'utf8'));
      const result = v.safeParse(v.looseObject({ revision: v.number() }), parsed);

      return result.success ? result.output.revision : undefined;
    } catch (error) {
      if (isMissingFileError(error)) {
        return undefined;
      }

      throw error;
    }
  };

  const writeRevisioned = async (
    path: string,
    relativeKey: string,
    schema: v.GenericSchema,
    record: { revision: number }
  ): Promise<WriteResult> => {
    if (!isInsideFolder(contentFolder, path)) {
      log.warn('content_write_path_rejected', { key: relativeKey });

      return { ok: false, reason: 'path_rejected', message: `${relativeKey} is not a valid path.` };
    }

    const parsed = v.safeParse(schema, record);

    if (!parsed.success) {
      log.warn('content_write_invalid', { key: relativeKey, error: parsed.issues[0].message });

      return { ok: false, reason: 'invalid', message: parsed.issues[0].message };
    }

    try {
      const currentRevision = await readRevision(path);

      if (currentRevision !== undefined && record.revision <= currentRevision) {
        log.warn('content_write_stale', { key: relativeKey });

        return {
          ok: false,
          reason: 'stale',
          message: `${relativeKey} changed since this copy was read. Reload it, then save again.`
        };
      }

      await mkdir(join(path, '..'), { recursive: true });
      await writeJsonAtomically(path, record);

      return { ok: true };
    } catch (error) {
      log.error('content_write_failed', { key: relativeKey, error: errMessage(error) });

      return { ok: false, reason: 'io_error', message: `Could not write ${relativeKey}.` };
    }
  };

  const readRecord = async <TSchema extends v.GenericSchema>(
    path: string,
    relativeKey: string,
    node: string,
    schema: TSchema
  ): Promise<
    | { status: 'ok'; record: v.InferOutput<TSchema> }
    | { status: 'missing' }
    | { status: 'invalid'; problems: readonly ContentProblem[] }
  > => {
    let contents: string;

    try {
      contents = await readFile(path, 'utf8');
    } catch (error) {
      if (isMissingFileError(error)) {
        return { status: 'missing' };
      }

      log.error('content_file_unreadable', { key: relativeKey, error: errMessage(error) });

      return {
        status: 'invalid',
        problems: [{ node, field: '', message: `Could not read ${relativeKey}.` }]
      };
    }

    let parsedJson: unknown;

    try {
      parsedJson = JSON.parse(contents);
    } catch (error) {
      log.warn('content_file_invalid', { key: relativeKey, error: errMessage(error) });

      return {
        status: 'invalid',
        problems: [{ node, field: '', message: `${relativeKey} is not valid JSON.` }]
      };
    }

    const result = v.safeParse(schema, parsedJson);

    if (!result.success) {
      log.warn('content_file_invalid', { key: relativeKey, error: result.issues[0].message });

      return { status: 'invalid', problems: toProblems(node, result.issues) };
    }

    return { status: 'ok', record: result.output };
  };

  const listSlugs = async (folder: string): Promise<string[]> => {
    try {
      const entries = await readdir(join(contentFolder, folder), { withFileTypes: true });

      return entries
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .toSorted();
    } catch (error) {
      if (isMissingFileError(error)) {
        return [];
      }

      throw error;
    }
  };

  const readItems = async <TSchema extends v.GenericSchema>(
    folder: string,
    fileName: string,
    nodePrefix: string,
    schema: TSchema,
    problems: ContentProblem[]
  ): Promise<{ slug: string; record: v.InferOutput<TSchema> }[]> => {
    const entries: { slug: string; record: v.InferOutput<TSchema> }[] = [];

    for (const slug of await listSlugs(folder)) {
      const relativeKey = `${folder}/${slug}/${fileName}`;
      const result = await readRecord(
        join(contentFolder, folder, slug, fileName),
        relativeKey,
        `${nodePrefix}:${slug}`,
        schema
      );

      if (result.status === 'ok') {
        entries.push({ slug, record: result.record });
      } else if (result.status === 'invalid') {
        problems.push(...result.problems);
      } else {
        log.warn('content_item_without_record', { key: relativeKey });
      }
    }

    return entries;
  };

  return {
    /* First run (F1). Each step keeps what exists, so a second run changes nothing. */
    ensureShape: async (): Promise<void> => {
      for (const folder of [EPISODES_FOLDER, LIVE_FOLDER, PUBLISH_FOLDER]) {
        await mkdir(join(contentFolder, folder), { recursive: true });
      }

      await writeIfMissing(showPath, `${JSON.stringify(INITIAL_SHOW, null, 2)}\n`);
      await writeIfMissing(join(contentFolder, GITIGNORE_FILE), CONTENT_GITIGNORE);
    },

    readSnapshot: async (): Promise<ContentSnapshot> => {
      const problems: ContentProblem[] = [];
      const showResult = await readRecord(showPath, SHOW_FILE, 'show', showSchema);
      let show: ShowRecord | undefined;

      if (showResult.status === 'ok') {
        show = showResult.record;
      } else if (showResult.status === 'invalid') {
        problems.push(...showResult.problems);
      } else {
        problems.push({ node: 'show', field: '', message: `${SHOW_FILE} is missing.` });
      }

      const episodes = await readItems(
        EPISODES_FOLDER,
        EPISODE_FILE,
        'episode',
        episodeSchema,
        problems
      );
      const liveItems = await readItems(LIVE_FOLDER, LIVE_FILE, 'live', liveItemSchema, problems);

      return { show, episodes, liveItems, problems };
    },

    writeShow: (record: ShowRecord): Promise<WriteResult> =>
      writeRevisioned(showPath, SHOW_FILE, showSchema, record),

    writeEpisode: (slug: string, record: EpisodeRecord): Promise<WriteResult> => {
      const relativeKey = `${EPISODES_FOLDER}/${slug}/${EPISODE_FILE}`;

      return isSafeSlug(slug)
        ? writeRevisioned(join(contentFolder, relativeKey), relativeKey, episodeSchema, record)
        : rejectSlug(relativeKey);
    },

    writeLiveItem: (slug: string, record: LiveItemRecord): Promise<WriteResult> => {
      const relativeKey = `${LIVE_FOLDER}/${slug}/${LIVE_FILE}`;

      return isSafeSlug(slug)
        ? writeRevisioned(join(contentFolder, relativeKey), relativeKey, liveItemSchema, record)
        : rejectSlug(relativeKey);
    },

    deleteLiveItem: async (slug: string): Promise<WriteResult> => {
      const relativeKey = `${LIVE_FOLDER}/${slug}`;

      if (!isSafeSlug(slug)) {
        return rejectSlug(relativeKey);
      }

      try {
        await rm(join(contentFolder, relativeKey), { recursive: true });

        return { ok: true };
      } catch (error) {
        log.error('content_delete_failed', { key: relativeKey, error: errMessage(error) });

        return { ok: false, reason: 'io_error', message: `Could not delete ${relativeKey}.` };
      }
    },

    /* A publish record has no revision: each run writes its own file and then updates it. */
    writePublishRecord: async (name: string, record: PublishRecord): Promise<WriteResult> => {
      const relativeKey = `${PUBLISH_FOLDER}/${name}.json`;

      if (!isSafeSlug(name)) {
        return rejectSlug(relativeKey);
      }

      const parsed = v.safeParse(publishRecordSchema, record);

      if (!parsed.success) {
        log.error('content_write_invalid', { key: relativeKey, error: parsed.issues[0].message });

        return { ok: false, reason: 'invalid', message: parsed.issues[0].message };
      }

      try {
        await mkdir(join(contentFolder, PUBLISH_FOLDER), { recursive: true });
        await writeJsonAtomically(join(contentFolder, relativeKey), record);

        return { ok: true };
      } catch (error) {
        log.error('content_write_failed', { key: relativeKey, error: errMessage(error) });

        return { ok: false, reason: 'io_error', message: `Could not write ${relativeKey}.` };
      }
    },

    readPublishRecords: async (): Promise<PublishEntry[]> => {
      const entries = await readdir(join(contentFolder, PUBLISH_FOLDER)).catch(
        (error: unknown): string[] => {
          if (isMissingFileError(error)) {
            return [];
          }

          throw error;
        }
      );
      const records: PublishEntry[] = [];

      for (const fileName of entries.filter((entry) => entry.endsWith('.json')).toSorted()) {
        const name = fileName.slice(0, -'.json'.length);
        const result = await readRecord(
          join(contentFolder, PUBLISH_FOLDER, fileName),
          `${PUBLISH_FOLDER}/${fileName}`,
          `publish:${name}`,
          publishRecordSchema
        );

        if (result.status === 'ok') {
          records.push({ name, record: result.record });
        }
      }

      return records;
    }
  };
};

const rejectSlug = (relativeKey: string): Promise<WriteResult> => {
  log.warn('content_write_path_rejected', { key: relativeKey });

  return Promise.resolve({
    ok: false,
    reason: 'path_rejected',
    message: `${relativeKey} is not a valid path.`
  });
};
