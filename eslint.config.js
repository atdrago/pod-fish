import prettier from 'eslint-config-prettier';
import path from 'node:path';
import js from '@eslint/js';
import svelte from 'eslint-plugin-svelte';
import { defineConfig, includeIgnoreFile } from 'eslint/config';
import globals from 'globals';
import ts from 'typescript-eslint';

const gitignorePath = path.resolve(import.meta.dirname, '.gitignore');

export default defineConfig(
  includeIgnoreFile(gitignorePath),
  js.configs.recommended,
  ts.configs.strictTypeChecked,
  svelte.configs.recommended,
  prettier,
  svelte.configs.prettier,
  {
    linterOptions: {
      reportUnusedDisableDirectives: 'error'
    },
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname
      }
    },
    rules: {
      // typescript-eslint strongly recommend that you do not use the no-undef lint rule on TypeScript projects.
      // see: https://typescript-eslint.io/troubleshooting/faqs/eslint/#i-get-errors-from-the-no-undef-rule-about-global-variables-not-being-defined-even-though-there-are-no-typescript-errors
      'no-undef': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { ignoreRestSiblings: true }],

      // KTD3. The rules of pod-monster-native, in ESLint, because oxlint reads no `.svelte` file
      // and has no type-aware rules.
      '@typescript-eslint/consistent-type-assertions': ['error', { assertionStyle: 'never' }],
      '@typescript-eslint/no-non-null-assertion': 'error',
      eqeqeq: ['error', 'always'],
      'id-length': [
        'error',
        { min: 2, properties: 'never', exceptions: ['_', 'i', 'j', 'k', 'v'] }
      ],
      'object-shorthand': ['error', 'always'],
      'no-void': 'error',
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['../*', '../../*', '../../../*', '../../../../*'],
              message: 'Import through $lib, not through a parent path.'
            }
          ]
        }
      ]
    }
  },
  {
    // Application source runs in the browser. Server-only modules are excluded
    // so each file resolves exactly one globals set -- flat config merges
    // `globals` across matching blocks rather than replacing it.
    files: ['src/**'],
    ignores: ['src/**/*.server.{js,ts}', 'src/lib/server/**', 'src/routes/**/+server.ts'],
    languageOptions: { globals: { ...globals.browser } }
  },
  {
    // Root config files and server-only modules run in Node.
    files: [
      '*.js',
      '*.ts',
      'scripts/**/*.{js,ts,mjs}',
      'src/**/*.server.{js,ts}',
      'src/lib/server/**',
      'src/routes/**/+server.ts'
    ],
    languageOptions: { globals: { ...globals.node } }
  },
  {
    // Scoping globals only documents intent unless something enforces it, and
    // no-undef is off globally. Turn it back on for server-only modules so a
    // browser API there is an error rather than a runtime surprise.
    files: ['scripts/**/*.{js,mjs}', 'src/**/*.server.js', 'src/lib/server/**/*.js'],
    rules: { 'no-undef': 'error' }
  },
  {
    // Root .js config files resolve outside the SvelteKit tsconfig project, so
    // type-aware rules would read every import as `error` typed. With those
    // off, no-undef is the only thing left that catches an undefined
    // reference here.
    files: ['*.js'],
    extends: [ts.configs.disableTypeChecked],
    rules: { 'no-undef': 'error' }
  },
  {
    files: ['**/*.svelte', '**/*.svelte.ts', '**/*.svelte.js'],
    languageOptions: {
      parserOptions: {
        projectService: true,
        extraFileExtensions: ['.svelte'],
        parser: ts.parser
      }
    }
  },
  {
    // Specs drive third-party test fixtures that aren't worth fully typing, and
    // mocks need assertions.
    files: ['**/*.{test,spec}.{js,ts}', 'src/vitest-setup-client.ts', '**/*SpecQueries.ts'],
    rules: {
      '@typescript-eslint/consistent-type-assertions': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      'id-length': 'off'
    }
  }
);
