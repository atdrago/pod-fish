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
