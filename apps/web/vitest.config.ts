/**
 * Web test project.
 *
 * Lives here rather than in the root config because @vitejs/plugin-react and
 * jsdom are dependencies of this package. pnpm's strict node_modules would not
 * resolve them from the repository root.
 */
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  test: {
    name: 'web',
    include: ['test/**/*.test.{ts,tsx}'],
    environment: 'jsdom',
    globals: false,
    // userEvent drives real DOM events one at a time; a form with several
    // selects legitimately exceeds the 5s default in jsdom.
    testTimeout: 20_000,
  },
});
