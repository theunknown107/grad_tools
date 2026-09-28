/**
 * URLs that will be rendered as links.
 *
 * A dedicated module so both `index.ts` and `sources.ts` can import it without
 * a circular dependency.
 */

import { z } from 'zod';

/**
 * Whether a string is a URL safe to place in an `href` — an explicit http(s)
 * URL with no whitespace or control characters.
 *
 * `z.string().url()` (WHATWG parsing) accepts `javascript:`, `data:` and
 * `vbscript:` URIs: valid URLs that execute or render script when a rendered
 * `<a href>` is clicked. A browser also strips ASCII whitespace and control
 * characters out of an href before parsing its scheme, so `java\tscript:` and
 * `\njavascript:` become `javascript:` at click time. Requiring a literal
 * `http://`/`https://` prefix and rejecting any control character or space
 * closes both: an obfuscated script URI never starts with http(s), and a
 * padded one is rejected rather than quietly trimmed. Every URL field in this
 * contract is shown to a student as a link, so the scheme is constrained where
 * the value ENTERS the system, and again where it is rendered (`externalHref`).
 */
export function isHttpUrl(value: string): boolean {
  // Any C0 control character, space, or DEL — anywhere — disqualifies it.
  // eslint-disable-next-line no-control-regex
  if (/[\u0000- \u007f]/.test(value)) return false;
  return /^https?:\/\/[^/]/i.test(value);
}

/** A URL that is safe to render as a link: an http(s) URL, no whitespace or control chars. */
export const httpUrlSchema = z.string().refine(isHttpUrl, { message: 'Must be an http(s) URL' });
