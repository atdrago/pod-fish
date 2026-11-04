import { describe, expect, it } from 'vitest';
import { contentTypeFor } from './contentTypes';

describe('contentTypeFor', () => {
  it.each([
    ['episode.mp3', 'audio/mpeg'],
    ['EPISODE.MP3', 'audio/mpeg'],
    ['episode.chapters.json', 'application/json+chapters'],
    ['transcript.json', 'application/json'],
    ['transcript.vtt', 'text/vtt'],
    ['transcript.srt', 'application/x-subrip'],
    ['cover.jpg', 'image/jpeg'],
    ['cover.jpeg', 'image/jpeg'],
    ['cover.png', 'image/png']
  ])('maps %s to %s', (fileName, contentType) => {
    expect(contentTypeFor(fileName)).toStrictEqual({ ok: true, contentType });
  });

  it('rejects an unknown extension with a message that names the file', () => {
    expect(contentTypeFor('notes.exe')).toStrictEqual({
      ok: false,
      message: 'notes.exe has a file type that this app cannot publish.'
    });
  });
});
