import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const readEnvFile = (name: string): string =>
  readFileSync(fileURLToPath(new URL(`../${name}`, import.meta.url)), 'utf8');

const valuesOf = (contents: string): string[] =>
  contents
    .split('\n')
    .filter((line) => line.trim() !== '' && !line.startsWith('#'))
    .map((line) => line.slice(line.indexOf('=') + 1));

// A URL variable must parse as a URL, so its placeholder goes on the host.
const PLACEHOLDER_SHAPE = /^(?:placeholder-|https?:\/\/placeholder-)/;

describe('the committed env files', () => {
  it.each(['.env.example', '.env.test'])('%s holds only placeholder values', (name) => {
    const values = valuesOf(readEnvFile(name));

    expect(values.length).toBeGreaterThan(0);
    expect(values.filter((value) => value !== '' && !PLACEHOLDER_SHAPE.test(value))).toStrictEqual(
      []
    );
  });

  it('says in the first line of .env.test that its values are fake', () => {
    expect(readEnvFile('.env.test').split('\n')[0]).toMatch(/fake values/i);
  });
});
