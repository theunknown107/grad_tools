/**
 * The Content-Security-Policy for built GradTools pages, web and Android alike.
 *
 * Built from the same variables the app uses, so an origin is allowed only when
 * that integration is configured in the build:
 *   - the GradTools API          (VITE_API_URL origin)
 *   - the legacy Supabase adapter (VITE_SUPABASE_URL origin, https + wss)
 *   - Clerk                       (its Frontend API host, which the PUBLISHABLE
 *                                  key encodes; Turnstile and Clerk images with it)
 * Everything else is the page's own origin (on Android: https://localhost).
 *
 * Known exceptions, each for a measured reason (CSP_REPORT.md):
 *   - script-src 'wasm-unsafe-eval': the OCR engine compiles WebAssembly.
 *   - style-src 'unsafe-inline': libraries in the bundle insert <style> tags.
 *     Styles cannot run script; scripts stay hash/origin-restricted.
 *   - worker-src blob: tesseract.js starts its worker from a blob URL that
 *     loads /ocr/worker.min.js from this origin.
 * frame-ancestors cannot be set from a <meta> tag; vercel.json sends it as a header.
 */

import { Buffer } from 'node:buffer';
import { URL } from 'node:url';

const origin = (url) => {
  try {
    return url ? new URL(url).origin : null;
  } catch {
    return null;
  }
};

/** `https://<host>` from a Clerk publishable key (`pk_test_…` / `pk_live_…`), or null. */
export function clerkFrontendApi(publishableKey) {
  const match = /^pk_(?:test|live)_([A-Za-z0-9+/=_-]+)$/.exec(publishableKey ?? '');
  if (match === null) return null;
  try {
    const host = Buffer.from(match[1], 'base64').toString('utf8').replace(/\$$/, '');
    return /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(host) ? `https://${host}` : null;
  } catch {
    return null;
  }
}

export function contentSecurityPolicy({
  apiUrl,
  supabaseUrl,
  clerkPublishableKey,
  inlineScriptHashes = [],
}) {
  const api = origin(apiUrl);
  const supabase = origin(supabaseUrl);
  const clerk = clerkFrontendApi(clerkPublishableKey);
  const turnstile = clerk && 'https://challenges.cloudflare.com';
  const list = (...items) => items.filter(Boolean).join(' ');
  const directives = {
    'default-src': "'self'",
    'script-src': list(
      "'self'",
      ...inlineScriptHashes.map((hash) => `'sha256-${hash}'`),
      "'wasm-unsafe-eval'",
      clerk,
      turnstile,
    ),
    'style-src': "'self' 'unsafe-inline'",
    'img-src': list("'self'", 'data:', 'blob:', clerk && 'https://img.clerk.com'),
    'font-src': "'self' data:",
    'connect-src': list(
      "'self'",
      'blob:',
      'data:',
      api,
      supabase,
      supabase?.replace(/^https:/, 'wss:'),
      clerk,
    ),
    'worker-src': "'self' blob:",
    'frame-src': turnstile ?? "'none'",
    'object-src': "'none'",
    'base-uri': "'self'",
    'form-action': "'self'",
  };
  return Object.entries(directives)
    .map(([name, value]) => `${name} ${value}`)
    .join('; ');
}
