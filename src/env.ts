import { defineEnvVars } from '@sveltejs/kit/env';
import * as v from 'valibot';

/*
	Every value that differs between two installs. A private entry omits `public`
	and `static`: a public entry that is not static reaches every rendered page,
	and a static entry lands in the build output as a literal. The server
	validates these values when it starts.
*/

const requiredString = (name: string) =>
  v.pipe(v.string(`${name} is required.`), v.nonEmpty(`${name} must not be empty.`));

const holdsNoCredentials = (value: string): boolean => {
  if (!URL.canParse(value)) {
    return true;
  }

  const url = new URL(value);

  return url.username === '' && url.password === '';
};

const requiredUrl = (name: string) =>
  v.pipe(
    requiredString(name),
    v.url(`${name} must be a URL.`),
    v.check(holdsNoCredentials, `${name} must not hold a username or a password.`)
  );

const isLoopbackOrigin = (value: string): boolean => {
  if (!URL.canParse(value)) {
    return false;
  }

  const url = new URL(value);

  return url.protocol === 'http:' && url.hostname === '127.0.0.1' && url.pathname === '/';
};

export const variables = defineEnvVars({
  CONTENT_FOLDER: {
    schema: v.pipe(
      requiredString('CONTENT_FOLDER'),
      v.startsWith('/', 'CONTENT_FOLDER must be an absolute path.')
    ),
    description: 'The folder of the show, inside the content repo. Never the repo root.'
  },
  FEED_URL: {
    schema: requiredUrl('FEED_URL'),
    description: 'The public URL of the feed. Its path must start with OBJECT_KEY_PREFIX.'
  },
  OBJECT_KEY_PREFIX: {
    schema: v.pipe(
      requiredString('OBJECT_KEY_PREFIX'),
      v.regex(
        /^[a-z0-9][a-z0-9-]*$/,
        'OBJECT_KEY_PREFIX must hold only lowercase letters, digits, and dashes.'
      )
    ),
    description: 'The prefix of every object key of this show in the bucket.'
  },
  MEDIA_BASE_URL: {
    schema: requiredUrl('MEDIA_BASE_URL'),
    description: 'The public base URL of the bucket. A media URL is this value plus the object key.'
  },
  SHOW_PAGE_URL: {
    schema: requiredUrl('SHOW_PAGE_URL'),
    description: 'The public page of the show. A new live item links to it.'
  },
  R2_ACCOUNT_ID: {
    schema: requiredString('R2_ACCOUNT_ID'),
    description: 'The Cloudflare account that holds the R2 bucket.'
  },
  R2_BUCKET: {
    schema: requiredString('R2_BUCKET'),
    description: 'The R2 bucket name.'
  },
  R2_ACCESS_KEY_ID: {
    schema: requiredString('R2_ACCESS_KEY_ID'),
    description: 'The access key ID of the R2 token, scoped to the one bucket.'
  },
  R2_SECRET_ACCESS_KEY: {
    schema: requiredString('R2_SECRET_ACCESS_KEY'),
    description: 'The secret access key of the R2 token.'
  },
  STREAM_MOUNT_URL: {
    schema: requiredUrl('STREAM_MOUNT_URL'),
    description: 'The public URL of the stream mount.'
  },
  STREAM_STATUS_URL: {
    schema: requiredUrl('STREAM_STATUS_URL'),
    description: 'The public status page of the stream server.'
  },
  PODPING_CLOUD_TOKEN: {
    schema: v.optional(v.string()),
    description: 'The podping.cloud token. It stays empty until the token arrives.'
  },
  APP_ORIGIN: {
    schema: v.pipe(
      requiredString('APP_ORIGIN'),
      v.check(isLoopbackOrigin, 'APP_ORIGIN must be an http URL on 127.0.0.1 with no path.')
    ),
    description: 'The URL of this app on the Mac. Keep it equal to ORIGIN in the start script.'
  },
  APP_USER_AGENT: {
    schema: requiredString('APP_USER_AGENT'),
    description: 'The User-Agent of every request from this app. It names the app and its repo.'
  }
});
