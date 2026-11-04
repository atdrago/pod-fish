// The file extensions the text gates skip.
//
// Binary files legitimately contain NULs, and their bytes can spell any string by chance, so
// the gates skip them by extension. The list is a DENYLIST rather than a source-extension
// allowlist on purpose: an unrecognized binary type trips a gate loudly (add its extension
// below), while an unrecognized SOURCE type under an allowlist would be skipped silently --
// and silent gaps are exactly what these gates exist to prevent.
//
// Used by scripts/check-source-nul.mjs.

const BINARY_EXTENSIONS = new Set([
  'a',
  'car',
  'dylib',
  'gif',
  'gz',
  'icns',
  'ico',
  'jar',
  'jks',
  'jpeg',
  'jpg',
  'keystore',
  'm4a',
  'mov',
  'mp3',
  'mp4',
  'otf',
  'p12',
  'pdf',
  'png',
  'so',
  'tgz',
  'ttf',
  'wasm',
  'webp',
  'woff',
  'woff2',
  'xcuserstate',
  'zip'
]);

/**
 * @param {string} file
 * @returns {boolean}
 */
export function isBinaryPath(file) {
  const base = file.slice(file.lastIndexOf('/') + 1);
  const dot = base.lastIndexOf('.');
  if (dot <= 0) {
    return base === '.DS_Store';
  }
  return BINARY_EXTENSIONS.has(base.slice(dot + 1).toLowerCase());
}
