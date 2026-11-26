import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig, loadEnv, type Plugin } from 'vite';
import { contentSecurityPolicy, insertPolicyMeta } from './scripts/csp-policy.mjs';

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
/**
 * Content-Security-Policy as a <meta> tag on built pages (web and Android; the
 * dev server is left alone). The policy is scripts/csp-policy.mjs; this hashes
 * the inline scripts of the final page and places the tag before any script.
 */
function contentSecurityPolicyTag(env: Record<string, string>): Plugin {
  return {
    name: 'gradtools-csp',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler(html) {
        const inline = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)];
        const policy = contentSecurityPolicy({
          apiUrl: env.VITE_API_URL,
          supabaseUrl: env.VITE_SUPABASE_URL,
          clerkPublishableKey: env.VITE_CLERK_PUBLISHABLE_KEY,
          inlineScriptHashes: inline.map(([, body]) =>
            createHash('sha256')
              .update(body ?? '')
              .digest('base64'),
          ),
        });
        return insertPolicyMeta(html, policy);
      },
    },
  };
}

export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    tailwindcss(),
    contentSecurityPolicyTag(loadEnv(mode, process.cwd(), 'VITE_')),
  ],
  server: { port: 5173 },
  build: { outDir: 'dist', sourcemap: mode !== 'android' },
  define: { __APP_VERSION__: JSON.stringify(version) },
}));
