#!/usr/bin/env node
// Gate: no literal NUL (0x00) byte may appear in a tracked TEXT file.
//
// A NUL in a source file is not a cosmetic problem -- it makes the file
// effectively invisible to search. `grep`/`ripgrep` classify any file containing
// one as binary and, without `-a`, report ZERO matches for every pattern; `file(1)`
// reports it as `data` rather than source. So the file silently drops out of every
// audit, refactor sweep, and codemod that greps the tree, and nothing announces the
// gap -- the search just comes back clean. That is the whole reason this gate
// exists: the failure mode is silence, which no other check in the repo can catch.
//
// This has already happened twice here. `EpisodeDownloadHeader.tsx` and
// `episodeNotificationDispatcher.ts` each built a composite key by joining fields
// with a raw NUL written directly into a template literal. The DELIMITER choice is
// good -- a NUL cannot occur in a URL, guid, or user id, so the key can never
// collide -- and this gate does not object to it. It objects only to spelling the
// byte literally in source. Write it as the `\u0000` escape instead: identical
// value at runtime, and the file stays greppable.
//
// Binary files legitimately contain NULs, so they are skipped by extension. The
// denylist and its rationale live in scripts/binary-extensions.mjs.
//
// Usage:
//   node scripts/check-source-nul.mjs            # every tracked file
//   node scripts/check-source-nul.mjs <file>...  # only the given files (tests)

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import process from 'node:process';

import { isBinaryPath } from './binary-extensions.mjs';

function trackedFiles() {
  // `-z` so a path containing a newline cannot split into two bogus entries.
  const stdout = execFileSync('git', ['ls-files', '-z'], {
    maxBuffer: 1 << 28
  }).toString('utf8');
  return stdout.split('\0').filter(Boolean);
}

const argvFiles = process.argv.slice(2);
const files = argvFiles.length > 0 ? argvFiles : trackedFiles();

const offenders = [];
for (const file of files) {
  if (isBinaryPath(file)) {
    continue;
  }

  let buffer;
  try {
    buffer = readFileSync(file);
  } catch {
    // A tracked-but-absent path (mid-rebase, sparse checkout) is not this gate's
    // business; the checks that actually read the file will report it.
    continue;
  }

  if (buffer.indexOf(0) === -1) {
    continue;
  }

  let count = 0;
  for (const byte of buffer) {
    if (byte === 0) {
      count++;
    }
  }
  offenders.push({ count, file });
}

if (offenders.length === 0) {
  process.exit(0);
}

console.error('Literal NUL (0x00) byte in tracked text file(s):');
for (const { count, file } of offenders) {
  console.error(`  ${file} (${String(count)} NUL byte${count === 1 ? '' : 's'})`);
}
console.error(
  '\nA NUL makes the file invisible to grep/ripgrep, so it silently drops out of\n' +
    'every search-based audit. If the byte is a deliberate delimiter, keep the value\n' +
    'and write it as the \\u0000 escape instead. If the file is genuinely binary, add\n' +
    'its extension to BINARY_EXTENSIONS in scripts/binary-extensions.mjs.'
);
process.exit(1);
