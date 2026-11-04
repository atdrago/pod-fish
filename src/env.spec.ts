import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { variables } from './env';

type VariableName = keyof typeof variables;

const SECRET_NAMES = ['R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'PODPING_CLOUD_TOKEN'] as const;

const declaredNames = Object.keys(variables);

const readClassification = (name: string): { isPublic: unknown; isStatic: unknown } => {
  const registry: Record<string, Record<string, unknown>> = variables;
  const entry = registry[name];

  return { isPublic: entry.public, isStatic: entry.static };
};

const issuesFor = async (name: VariableName, value: string | undefined): Promise<string[]> => {
  const result = await variables[name].schema['~standard'].validate(value);

  return result.issues?.map((issue) => issue.message) ?? [];
};

const namesInEnvFile = (fileName: string): string[] =>
  readFileSync(fileURLToPath(new URL(`../${fileName}`, import.meta.url)), 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '' && !line.startsWith('#'))
    .map((line) => line.slice(0, line.indexOf('=')));

describe('the env registry', () => {
  it('keeps every secret private and not static', () => {
    expect(SECRET_NAMES.map((name) => readClassification(name))).toStrictEqual(
      SECRET_NAMES.map(() => ({ isPublic: undefined, isStatic: undefined }))
    );
  });

  it('declares no public variable and no static variable', () => {
    expect(declaredNames.filter((name) => readClassification(name).isPublic === true)).toEqual([]);
    expect(declaredNames.filter((name) => readClassification(name).isStatic === true)).toEqual([]);
  });

  it.each(['.env.example', '.env.test'])('%s lists exactly the declared variables', (fileName) => {
    expect(namesInEnvFile(fileName).toSorted()).toStrictEqual(declaredNames.toSorted());
  });

  it('names the variable when a required value is absent or empty', async () => {
    expect(await issuesFor('R2_BUCKET', undefined)).toEqual(['R2_BUCKET is required.']);
    expect(await issuesFor('R2_BUCKET', '')).toEqual(['R2_BUCKET must not be empty.']);
    expect(await issuesFor('FEED_URL', '')).toContain('FEED_URL must not be empty.');
  });

  it('allows an absent podping.cloud token', async () => {
    expect(await issuesFor('PODPING_CLOUD_TOKEN', undefined)).toEqual([]);
  });

  it.each(['STREAM_MOUNT_URL', 'STREAM_STATUS_URL', 'FEED_URL', 'MEDIA_BASE_URL'] as const)(
    '%s refuses a URL that holds credentials',
    async (name) => {
      expect(await issuesFor(name, 'https://user:pw@example.com/a')).toEqual([
        `${name} must not hold a username or a password.`
      ]);
      expect(await issuesFor(name, 'https://example.com/a')).toEqual([]);
    }
  );

  it('accepts only an http origin on the loopback address', async () => {
    expect(await issuesFor('APP_ORIGIN', 'http://127.0.0.1:5174')).toEqual([]);
    expect(await issuesFor('APP_ORIGIN', 'http://192.0.2.1:5174')).toHaveLength(1);
    expect(await issuesFor('APP_ORIGIN', 'https://127.0.0.1:5174')).toHaveLength(1);
  });

  it('accepts only an absolute content folder', async () => {
    expect(await issuesFor('CONTENT_FOLDER', '/tmp/show')).toEqual([]);
    expect(await issuesFor('CONTENT_FOLDER', 'show')).toEqual([
      'CONTENT_FOLDER must be an absolute path.'
    ]);
  });
});
