/* Longest suffix first, because a chapters file also ends in `.json`. */
const CONTENT_TYPE_BY_SUFFIX: readonly (readonly [suffix: string, contentType: string])[] = [
  ['.chapters.json', 'application/json+chapters'],
  ['.mp3', 'audio/mpeg'],
  ['.vtt', 'text/vtt'],
  ['.srt', 'application/x-subrip'],
  ['.json', 'application/json'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.png', 'image/png']
];

export type ContentTypeResult = { ok: true; contentType: string } | { ok: false; message: string };

export const contentTypeFor = (fileName: string): ContentTypeResult => {
  const lowerCaseName = fileName.toLowerCase();
  const match = CONTENT_TYPE_BY_SUFFIX.find(([suffix]) => lowerCaseName.endsWith(suffix));

  return match === undefined
    ? { ok: false, message: `${fileName} has a file type that this app cannot publish.` }
    : { ok: true, contentType: match[1] };
};
