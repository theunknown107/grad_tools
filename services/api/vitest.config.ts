/**
 * API test project.
 *
 * Integration tests need a real PostgreSQL instance, supplied through
 * TEST_DATABASE_URL. Without it the suite skips with a clear message rather
 * than failing (see test/api.test.ts).
 */
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'api',
    include: ['test/**/*.test.ts'],
    environment: 'node',
    // A migration + seed against a real database is slower than a unit test.
    testTimeout: 30_000,
    hookTimeout: 60_000,
    // Integration tests share one database, so files run one at a time.
    fileParallelism: false,
    // The schema is dropped and recreated ONCE, before any file runs. Doing it
    // per-file let two files' hooks interleave and one find its tables gone.
    globalSetup: ['./test/global-setup.ts'],
    // One worker, so files genuinely serialise against the shared database.
    // fileParallelism alone did not prevent two files migrating at once.
    poolOptions: { forks: { singleFork: true }, threads: { singleThread: true } },
  },
});
