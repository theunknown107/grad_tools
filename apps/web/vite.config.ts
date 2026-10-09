import { readFileSync } from 'node:fs';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

// One source of truth for the web app version: this package's version. Baked in
// at build time so diagnostic events can say which build a bug came from,
// without the number being retyped anywhere (OBSERVABILITY-AND-SUPPORT-V1 §18).
const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
  version: string;
};

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { port: 5173 },
  build: { outDir: 'dist', sourcemap: true },
  define: { __APP_VERSION__: JSON.stringify(version) },
});
