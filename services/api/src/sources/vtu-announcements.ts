/**
 * VTU announcements adapter — FRAMEWORK ONLY, SOURCE DISABLED.
 *
 * Authority: docs/14 §14.7, §14.8 · docs/15 · M5 §12 · docs/32 OQ-006
 *
 * THIS ADAPTER HAS NEVER BEEN RUN AGAINST VTU AND CANNOT BE.
 *
 * The `vtu-announcements` source row is seeded with `enabled = false`, and the
 * database constraint `source_enable_requires_all_gates` refuses to let it
 * become true until its terms of use have been reviewed. That review is
 * OQ-006 and is unresolved.
 *
 * Robots was re-verified on 2026-08-24: vtu.ac.in/robots.txt disallows only
 * `/wp-admin/`, so robots does NOT block reading announcements. The source is
 * still disabled — and that is the point of having two independent gates. A
 * machine-readable crawl policy is not a licence to reuse content, and passing
 * one gate says nothing about the other.
 *
 * The separate host results.vtu.ac.in returns `Disallow: /` and is seeded as a
 * permanently blocked source. No result-retrieval adapter exists here or
 * anywhere in this repository (docs/15, DEC-004/DEC-011).
 *
 * WHAT THIS FILE IS FOR
 *
 * `parse`, `normalize` and `validate` are pure and are exercised against a
 * stored fixture, so the adapter framework is proven end to end without a
 * single request leaving the machine. There is deliberately no `fetch` method:
 * see fetch.ts, where fetching is a gated capability that consults the source
 * row rather than a method an adapter simply owns.
 *
 * The fixture is SYNTHETIC — handwritten HTML in the shape of a WordPress
 * notices list. It is not a capture of vtu.ac.in and does not reproduce any of
 * its content.
 */

import type { NormalizedItem, RawItem, SourceAdapter, ValidationVerdict } from './adapter.js';
import { hashItem } from './adapter.js';

export const VTU_ANNOUNCEMENTS_SOURCE_ID = 'vtu-announcements';
export const VTU_ANNOUNCEMENTS_PARSER_VERSION = 'vtu-ann-v1';

/**
 * Rows in the notices list.
 *
 * A deliberately narrow pattern over a `<li>` containing an anchor. A real
 * implementation would use a parser rather than a regex; this is the shape the
 * fixture asserts against, and the narrowness is intentional — an adapter that
 * matches loosely turns an unrelated page change into plausible-looking
 * garbage rather than an obvious failure.
 */
const ITEM_PATTERN =
  /<li[^>]*class="[^"]*notice[^"]*"[^>]*>\s*<a\s+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>\s*(?:<span[^>]*class="date"[^>]*>([^<]*)<\/span>)?/gi;

function stripTags(html: string): string {
  return html
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * A stable identifier for an item.
 *
 * Derived from the announcement's own URL path, because VTU's list markup
 * carries no id. The path is what persists across page re-renders; the
 * position in the list is not, so using an index would report every item as
 * modified whenever a new one is posted.
 */
function externalIdFor(url: string): string {
  try {
    const path = new URL(url, 'https://vtu.ac.in').pathname;
    return path.replace(/^\/+|\/+$/g, '') || url;
  } catch {
    return url;
  }
}

/** ISO date if the source's date is understood; null if it is not. Never a guess. */
function parseDate(raw: string | undefined): string | null {
  if (raw === undefined) return null;
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  const parsed = Date.parse(trimmed);
  if (Number.isNaN(parsed)) return null;
  return new Date(parsed).toISOString().slice(0, 10);
}

export const vtuAnnouncementsAdapter: SourceAdapter = {
  sourceId: VTU_ANNOUNCEMENTS_SOURCE_ID,
  parserVersion: VTU_ANNOUNCEMENTS_PARSER_VERSION,

  parse(body: string): RawItem[] {
    const items: RawItem[] = [];
    ITEM_PATTERN.lastIndex = 0;

    let match = ITEM_PATTERN.exec(body);
    while (match !== null) {
      const href = match[1] ?? '';
      items.push({
        externalId: externalIdFor(href),
        title: stripTags(match[2] ?? ''),
        url: href === '' ? null : href,
        publishedAt: parseDate(match[3]),
      });
      match = ITEM_PATTERN.exec(body);
    }
    return items;
  },

  normalize(raw: readonly RawItem[]): NormalizedItem[] {
    return (
      raw
        .map((item) => {
          const url = item.url === null ? null : new URL(item.url, 'https://vtu.ac.in').toString();
          const base = {
            externalId: item.externalId,
            title: item.title,
            url,
            publishedAt: item.publishedAt,
          };
          return { ...base, payloadHash: hashItem(base) };
        })
        // Sorted by identifier, not by document order: a stable order means a
        // reordered page is not mistaken for changed content.
        .sort((a, b) => a.externalId.localeCompare(b.externalId))
    );
  },

  validate(items: readonly NormalizedItem[]): ValidationVerdict {
    const valid: NormalizedItem[] = [];
    const rejected: ValidationVerdict['rejected'] = [];
    const seen = new Set<string>();

    for (const item of items) {
      if (item.title === '') {
        rejected.push({ item, reason: 'Announcement has no title.' });
        continue;
      }
      if (item.title.length > 500) {
        rejected.push({ item, reason: 'Announcement title is implausibly long.' });
        continue;
      }
      if (item.url !== null && !/^https?:\/\//.test(item.url)) {
        // Catches javascript: and data: URLs before they can reach a template.
        rejected.push({ item, reason: 'Announcement link is not an http(s) URL.' });
        continue;
      }
      if (seen.has(item.externalId)) {
        rejected.push({ item, reason: 'Duplicate announcement identifier in one response.' });
        continue;
      }
      seen.add(item.externalId);
      valid.push(item);
    }

    return { valid, rejected };
  },
};
