/*
	The feed object key is the path of the public feed URL, so the bucket and the
	URL can never disagree. A path outside the show prefix is a configuration
	error, and the server refuses to start with it.
*/
export const feedObjectKey = (feedUrl: string, objectKeyPrefix: string): string => {
  const key = new URL(feedUrl).pathname.replace(/^\/+/, '');

  if (!key.startsWith(`${objectKeyPrefix}/`)) {
    throw new Error(
      `The path of FEED_URL (${feedUrl}) must start with OBJECT_KEY_PREFIX (${objectKeyPrefix}).`
    );
  }

  return key;
};

const SHA256_PREFIX_LENGTH = 16;

/*
	The hash in the key makes a media object immutable: new bytes get a new key, so
	the long cache lifetime of a media object can never serve an old file (KTD6).
*/
export const mediaObjectKey = (
  objectKeyPrefix: string,
  slug: string,
  sha256: string,
  file: string
): string => {
  const fileName = file.slice(file.lastIndexOf('/') + 1);

  return `${objectKeyPrefix}/media/${slug}/${sha256.slice(0, SHA256_PREFIX_LENGTH)}-${fileName}`;
};

export const publicObjectUrl = (mediaBaseUrl: string, key: string): string =>
  `${mediaBaseUrl.replace(/\/+$/, '')}/${key.split('/').map(encodeURIComponent).join('/')}`;
