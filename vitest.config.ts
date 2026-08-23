import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/**/test/**/*.test.ts', 'tests/**/*.test.ts'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['packages/*/src/**/*.ts'],
      // index.ts is re-exports only; types.ts is type declarations only.
      // Neither emits testable runtime code.
      exclude: ['**/index.ts', '**/types.ts'],
      // 22_TESTING_AND_QA.md §22.1 — packages/academic-rules carries the
      // highest test standard in the repository: 100% branch coverage.
      // Overall line coverage is deliberately NOT a target (§22.1).
      thresholds: {
        'packages/academic-rules/src/**': {
          branches: 100,
          functions: 100,
          lines: 100,
          statements: 100,
        },
      },
    },
  },
});
