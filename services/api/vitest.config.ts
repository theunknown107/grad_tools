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
    // Integration tests share one database; parallel files would race on the
    // schema drop in beforeAll.
    fileParallelism: false,
  },
});
