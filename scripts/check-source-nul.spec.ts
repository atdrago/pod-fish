import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const scriptPath = fileURLToPath(new URL('./check-source-nul.mjs', import.meta.url));

// Built rather than typed literally: a raw NUL in this test file would trip the
// very gate under test.
const NUL = String.fromCharCode(0);

const fixtureDir = mkdtempSync(join(tmpdir(), 'check-source-nul-'));

const fixture = (name: string, contents: string): string => {
  const path = join(fixtureDir, name);
  writeFileSync(path, contents, 'utf8');

  return path;
};

// The gate's whole contract is its exit code, so that is what these assert.
const runGate = (files: string[]): Promise<number> =>
  new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath, ...files], {
      stdio: ['ignore', 'ignore', 'ignore']
    });

    child.on('error', reject);
    child.on('close', (code) => {
      resolve(code ?? 1);
    });
  });

describe('the check-source-nul gate', () => {
  it('passes a clean source file', async () => {
    expect(await runGate([fixture('clean.ts', 'export const key = `a:b`;\n')])).toBe(0);
  });

  it('fails a source file that holds a literal NUL byte', async () => {
    expect(await runGate([fixture('dirty.ts', `export const key = \`a${NUL}b\`;\n`)])).toBe(1);
  });

  it('skips a binary file, which can legitimately hold a NUL', async () => {
    expect(await runGate([fixture('image.png', `PNG${NUL}${NUL}data`)])).toBe(0);
  });

  it('fails the whole run when one file of several is dirty', async () => {
    const clean = fixture('also-clean.ts', 'export const value = 1;\n');
    const dirty = fixture('also-dirty.ts', `const separator = "${NUL}";\n`);

    expect(await runGate([clean, dirty])).toBe(1);
  });
});
