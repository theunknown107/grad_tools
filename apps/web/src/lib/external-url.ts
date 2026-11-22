/**
 * A URL is safe to navigate to from a rendered link only if it is http(s).
 *
 * React does not sanitize `href`: `<a href="javascript:…">` runs script on
 * click, and `data:`/`vbscript:` are the same class of hazard. The API schema
 * already constrains URL fields to http(s) (`httpUrlSchema`), but a value can
 * reach a link from outside that gate — cloud sync from another device, the
 * bundled academic-rules catalogue, or data written before the schema was
 * tightened — so every dynamic `href` is guarded here too.
 *
 * Returns the URL when it is a valid http(s) URL, otherwise `undefined`, which
 * makes React omit the attribute and render an inert, non-navigable element.
 */
import { isHttpUrl } from '@gradtools/shared-types';

export function externalHref(url: string | null | undefined): string | undefined {
  return typeof url === 'string' && isHttpUrl(url) ? url : undefined;
}
