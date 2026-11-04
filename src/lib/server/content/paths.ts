import { resolve, sep } from 'node:path';

const SLUG_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;

export const isSafeSlug = (slug: string): boolean =>
  SLUG_PATTERN.test(slug) && !slug.includes('..');

/* A sidecar reference is a path relative to the folder of its item. */
export const isSafeRelativePath = (path: string): boolean =>
  !path.startsWith('/') &&
  path.split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..');

export const isInsideFolder = (folder: string, candidate: string): boolean =>
  resolve(candidate).startsWith(`${resolve(folder)}${sep}`);

export const SHOW_FILE = 'show.json';
export const EPISODES_FOLDER = 'episodes';
export const LIVE_FOLDER = 'live';
export const PUBLISH_FOLDER = 'publish';
export const EPISODE_FILE = 'episode.json';
export const LIVE_FILE = 'live.json';
