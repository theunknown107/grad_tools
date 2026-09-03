import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/coverage/**',
      'docs/**',
      // Vendored, minified OCR engine. Not ours to lint or to fix.
      'apps/web/public/ocr/**',
      // QA output and private validation scratch. Gitignored, never shipped.
      '.qa-*/**',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    rules: {
      eqeqeq: ['error', 'always'],
      'no-console': 'error',
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
      'prefer-const': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },

  // ---------------------------------------------------------------------------
  // packages/academic-rules is a critical architectural boundary.
  //   16_ACADEMIC_RULES_ENGINE.md §16.2 — pure, zero-dependency, zero I/O
  //   19_RECOMMENDATION_AND_AI_POLICY.md §19.2 — AI can never reach a calculation
  //   33_M2_IMPLEMENTATION_BACKLOG.md §33.4 — invariants 1 and 2
  //
  // This lint rule is the first of two guards. The second is the runtime purity
  // test (packages/academic-rules/test/purity.test.ts), which also catches
  // forbidden globals that lint cannot see.
  // ---------------------------------------------------------------------------
  {
    files: ['packages/academic-rules/src/**/*.ts'],
    rules: {
      // Blocklist of the categories the M3 authorization §14 names explicitly.
      //
      // This is defence in depth, not the complete guard: ESLint's pattern
      // matcher cannot express "relative imports only" (its globs normalise
      // away the leading "./"). The COMPLETE and authoritative check is
      // packages/academic-rules/test/purity.test.ts, which parses every import
      // in the package and asserts it is relative. That test also covers the
      // forbidden globals and the empty dependency list.
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['node:*'],
              message:
                'academic-rules must be environment-agnostic — no Node built-ins. ' +
                'See 16_ACADEMIC_RULES_ENGINE.md §16.2.',
            },
            {
              group: [
                'react*',
                'express*',
                'pg',
                'drizzle*',
                'zod',
                'undici',
                'axios',
                '@anthropic-ai/*',
                'openai',
                '@aws-sdk/*',
                'fs',
                'path',
                'crypto',
                'http',
                'https',
              ],
              message:
                'academic-rules must be pure: no UI, no server, no database, no HTTP, no AI SDK. ' +
                'Pass any required data into the calculation instead. ' +
                'See 16_ACADEMIC_RULES_ENGINE.md §16.2 and 19_RECOMMENDATION_AND_AI_POLICY.md §19.2.',
            },
          ],
        },
      ],
      'no-restricted-globals': [
        'error',
        { name: 'process', message: 'academic-rules must not read the environment.' },
        { name: 'window', message: 'academic-rules must be environment-agnostic.' },
        { name: 'document', message: 'academic-rules must contain no UI logic.' },
        { name: 'fetch', message: 'academic-rules must perform no I/O.' },
      ],
      'no-restricted-properties': [
        'error',
        { object: 'Math', property: 'random', message: 'academic-rules must be deterministic.' },
        { object: 'Date', property: 'now', message: 'academic-rules must not read the clock.' },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: "NewExpression[callee.name='Date']",
          message: 'academic-rules must not read the clock (16 §16.2).',
        },
      ],
    },
  },

  // ---------------------------------------------------------------------------
  // React components and hooks.
  //
  // rules-of-hooks and exhaustive-deps catch the two React bugs that survive
  // TypeScript: a conditional hook call, and a stale closure over props. Neither
  // is visible to the type system, so lint is the only guard.
  // ---------------------------------------------------------------------------
  {
    files: ['apps/web/src/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error',
    },
  },

  {
    // tests/visual-qa.mjs is a Node QA harness. Its page.evaluate callbacks are
    // serialised and executed inside Chromium, so it legitimately references
    // both Node globals (console, process) and browser globals (document).
    files: ['tests/**/*.mjs'],
    languageOptions: {
      globals: {
        console: 'readonly',
        process: 'readonly',
        document: 'readonly',
        getComputedStyle: 'readonly',
        window: 'readonly',
      },
    },
    rules: {
      'no-console': 'off',
    },
  },

  {
    // Build scripts run under Node and report to a terminal, so Node globals
    // and printing are the point rather than an oversight.
    files: ['apps/*/scripts/**/*.mjs'],
    languageOptions: {
      globals: { console: 'readonly', process: 'readonly' },
    },
    rules: {
      'no-console': 'off',
    },
  },

  {
    // Measurement scripts are run by hand against a local corpus and report to
    // a terminal. Printing IS their output (M10B §27, §45).
    files: ['services/*/scripts/**/*.ts'],
    rules: {
      'no-console': 'off',
    },
  },

  {
    files: ['**/*.test.ts', '**/*.test.tsx', 'vitest.config.ts', 'eslint.config.mjs'],
    rules: {
      'no-restricted-imports': 'off',
      'no-restricted-globals': 'off',
    },
  },
);
