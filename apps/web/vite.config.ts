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

/*
 * Source maps: on for development and the web build (Vercel refuses public
 * `.map` requests), OFF for the Android app (`vite build --mode android`, used
 * by `build:android` / `android:sync`): an APK is a downloadable archive, and
 * maps there would ship the original source. The release Gradle build refuses
 * web assets that still contain a map or a `sourceMappingURL`.
 */
export default defineConfig(({ mode }) => ({
  plugins: [react(), tailwindcss()],
  server: { port: 5173 },
  build: { outDir: 'dist', sourcemap: mode !== 'android' },
  define: { __APP_VERSION__: JSON.stringify(version) },
}));
