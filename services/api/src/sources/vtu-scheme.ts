/**
 * Discovering VTU's UG scheme and syllabus documents.
 *
 * Authority: Phase 7C.2 §14–§19, §26, §34 · docs/22
 *
 * ---------------------------------------------------------------------------
 * A DOCUMENT GRAPH, NOT A SITE CRAWL
 * ---------------------------------------------------------------------------
 *
 * The scheme page lists every UG programme's scheme and syllabus as PDF links,
 * grouped by scheme year and by first-year versus third-to-eighth semester.
 * That listing IS the graph: one page enumerates the documents, and nothing
 * needs to be reached by following links out into the rest of the site.
 *
 * So this adapter reads that one page and classifies what it finds. It does not
 * crawl. Bounding the traversal to the academic listing is what §15 asks for,
 * and it is also the only responsible thing to do to somebody's web server.
 *
 * ---------------------------------------------------------------------------
 * PARSING IS PURE, AND FETCHING IS SOMEBODY ELSE'S JOB
 * ---------------------------------------------------------------------------
 *
 * `parse` takes bytes and never touches the network, exactly as `SourceAdapter`
 * requires. Whether GradTools is ALLOWED to fetch this source at all is decided
 * by `checkSourcePermission` against the source registry, where an unknown
 * robots status is not permission (§34). This module never bypasses that.
 *
 * ---------------------------------------------------------------------------
 * WHAT IS CLASSIFIED, AND WHAT IS LEFT ALONE
 * ---------------------------------------------------------------------------
 *
 * Programme, scheme year, document kind and semester span are read from the
 * link's own text and href. Where the page does not say, the field is null —
 * never a guess. A document nobody can classify is still DISCOVERED and still
 * reported; it is the extractor's problem, not the discoverer's, and dropping
 * it here would hide it from the report that is supposed to account for
 * everything (§36).
 */

import { hashItem, type NormalizedItem, type RawItem, type SourceAdapter } from './adapter.js';

export const VTU_SCHEME_SOURCE_ID = 'vtu-scheme-syllabus';

/**
 * Bumped whenever classification changes.
 *
 * §22: the same PDF under a new parser version must be re-readable without
 * being downloaded again, and that is only possible if the version is recorded
 * beside the extraction.
 */
export const VTU_SCHEME_PARSER_VERSION = '1.0.0';

/** What kind of document a link points at. */
export type SchemeDocumentKind =
  /** A table of courses, credits and marks for a programme's semesters. */
  | 'scheme'
  /** Course-by-course content: objectives, modules, outcomes. */
  | 'syllabus'
  /** The stream-wise list of programmes; how a programme finds its first year. */
  | 'programme_index'
  /** Recognised as academic, kind not established from the page. */
  | 'unclassified';

export interface SchemeDocument {
  readonly url: string;
  readonly linkText: string;
  readonly kind: SchemeDocumentKind;
  /** "2022", "2025" — null when the page does not say. */
  readonly schemeYear: string | null;
  /** The programme name as the page writes it. Null for common documents. */
  readonly programme: string | null;
  /** `[1, 2]` or `[3, 8]`. Null when the page does not say. */
  readonly semesters: readonly [number, number] | null;
  /** True when the document serves a whole stream rather than one programme. */
  readonly common: boolean;
  /**
   * The stream this document belongs to, where its own label names one.
   *
   * "CSE Stream Scheme (CSE/ISC/BT)" is not a programme-less document — it is
   * the CSE stream's, and its courses are namespaced by that. Without it the
   * Civil and CSE first-year schemes shared an identity and overwrote each
   * other (§5, §7).
   */
  readonly streamLabel: string | null;
}

/* -------------------------------------------------------------------------- */
/* Reading the page                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Anchors with a PDF href.
 *
 * A regex over HTML is normally a poor idea. It is the right size here: the
 * target is one attribute and the enclosed text, and adding a DOM parser to
 * the API to read one listing page would be a dependency earning its keep on
 * one file.
 */
const PDF_LINK = /<a\b[^>]*\bhref\s*=\s*["']([^"']+\.pdf)["'][^>]*>([\s\S]*?)<\/a>/gi;

/**
 * One row of the listing table.
 *
 * THE PROGRAMME IS THE ROW, NOT THE LINK. The page is a table whose second
 * cell names the programme and whose later cells hold its documents, so a link
 * reads only "3-8 Sem Scheme" and says nothing about whose scheme it is.
 * Reading anchors alone produced 244 "programmes" that were mostly fragments
 * of link text, and found nothing at all when asked for CSBS.
 */
const TABLE_ROW = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
const TABLE_CELL = /<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi;

const TAGS = /<[^>]*>/g;
const ENTITIES: Readonly<Record<string, string>> = {
  '&amp;': '&',
  '&nbsp;': ' ',
  '&#8211;': '-',
  '&#8212;': '-',
  '&quot;': '"',
  '&#039;': "'",
  '&lt;': '<',
  '&gt;': '>',
};

function textOf(html: string): string {
  let text = html.replace(TAGS, ' ');
  for (const [entity, char] of Object.entries(ENTITIES)) text = text.split(entity).join(char);
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * The scheme year, from the link text or the URL path.
 *
 * VTU files its documents under paths that carry the year — `/pdf/2022syll/`,
 * `/pdf/2022_3to8/` — and labels its sections with it. Both are read, the text
 * first, because a path is a filing convention and the label is a statement.
 */
function schemeYearOf(linkText: string, url: string): string | null {
  return (
    /\b(20\d{2})\s*(?:scheme|syllabus)/i.exec(linkText)?.[1] ??
    /\/pdf\/(20\d{2})[a-z_]/i.exec(url)?.[1] ??
    /\b(20\d{2})\b/.exec(linkText)?.[1] ??
    null
  );
}

/** `[1, 2]`, `[3, 8]`, or null where the page states no span. */
function semestersOf(linkText: string): readonly [number, number] | null {
  const range = /\b([1-8])\s*(?:st|nd|rd|th)?\s*(?:-|to|–|—)\s*([1-8])\b/i.exec(linkText);
  if (range?.[1] !== undefined && range[2] !== undefined) {
    return [Number(range[1]), Number(range[2])];
  }
  if (/\bI\s*(?:&|and)\s*II\b|\bfirst\s*year\b/i.test(linkText)) return [1, 2];
  return null;
}

function kindOf(linkText: string, url: string): SchemeDocumentKind {
  const haystack = `${linkText} ${url}`;
  /* Order matters: "scheme and syllabus" headings name both. */
  if (/\bstream\b/i.test(haystack) && /\bprogram/i.test(haystack)) return 'programme_index';
  if (/\bsyll/i.test(haystack)) return 'syllabus';
  if (/\bsch(eme)?\b/i.test(haystack)) return 'scheme';
  return 'unclassified';
}

/**
 * The programme a table row names.
 *
 * DELIBERATELY NOT A LOOKUP AGAINST A PROGRAMME LIST (§16). The page's own
 * words are the answer; matching against a hardcoded roster would make the
 * crawler blind to any programme nobody had thought to add.
 *
 * The label is the first cell that reads as a name rather than a serial number
 * or a link — the table numbers its rows, so cell one is usually "12".
 */
function programmeFromRow(cells: readonly string[]): string | null {
  for (const cell of cells) {
    const name = textOf(cell);
    if (name === '' || /^\d+$/.test(name)) continue;
    if (/\.pdf/i.test(cell)) continue;
    if (/\b(scheme|syllabus)\b/i.test(name) && name.length < 20) continue;
    return name.length >= 3 ? name.slice(0, 160) : null;
  }
  return null;
}

const COMMON = /\bstream\b|\bcommon\b|\bcycle\b|\bI\s*(?:&|and)\s*II\b/i;

export const vtuSchemeAdapter: SourceAdapter & {
  readonly describe: (raw: readonly RawItem[]) => SchemeDocument[];
} = {
  sourceId: VTU_SCHEME_SOURCE_ID,
  parserVersion: VTU_SCHEME_PARSER_VERSION,

  parse(body: string): RawItem[] {
    const seen = new Set<string>();
    const items: RawItem[] = [];

    /*
     * Rows first, so each link carries the programme its row names. A link
     * outside any row still counts — the page has standalone links too — and
     * simply has no programme label.
     */
    const rows: { label: string | null; html: string }[] = [];
    for (const row of body.matchAll(TABLE_ROW)) {
      const html = row[1] ?? '';
      const cells = [...html.matchAll(TABLE_CELL)].map((cell) => cell[1] ?? '');
      rows.push({ label: programmeFromRow(cells), html });
    }
    rows.push({ label: null, html: body });

    for (const row of rows) {
      for (const match of row.html.matchAll(PDF_LINK)) {
        const href = match[1];
        if (href === undefined) continue;
        const url = href.startsWith('http')
          ? href
          : `https://vtu.ac.in${href.replace(/^\/?/, '/')}`;
        /*
         * The same PDF is often linked twice, under a heading and again in a
         * table. One document, one item — the duplicate is not news.
         */
        if (seen.has(url)) continue;
        seen.add(url);
        const linkText = textOf(match[2] ?? '') || url.split('/').pop() || url;
        items.push({
          externalId: url,
          /*
           * The row's programme and the link's own words, joined, because the
           * classifiers downstream need both and `RawItem` carries one title.
           */
          title: row.label === null ? linkText : `${row.label} — ${linkText}`,
          url,
          publishedAt: null,
        });
      }
    }
    return items;
  },

  normalize(raw: readonly RawItem[]): NormalizedItem[] {
    return raw
      .map((item) => ({
        externalId: item.externalId,
        title: item.title.slice(0, 500),
        url: item.url,
        publishedAt: item.publishedAt,
      }))
      .map((item) => ({ ...item, payloadHash: hashItem(item) }));
  },

  validate(items: readonly NormalizedItem[]) {
    const valid: NormalizedItem[] = [];
    const rejected: { item: NormalizedItem; reason: string }[] = [];
    for (const item of items) {
      if (item.url === null || !/^https:\/\/[^/]*vtu\.ac\.in\//i.test(item.url)) {
        /*
         * A link off VTU's own domain is not refused because it is dangerous —
         * `checkDestination` handles that — but because it is not the source
         * this adapter claims to speak for.
         */
        rejected.push({ item, reason: 'Not a vtu.ac.in document.' });
        continue;
      }
      if (item.title.trim() === '') {
        rejected.push({ item, reason: 'The link carries no text to identify it by.' });
        continue;
      }
      valid.push(item);
    }
    return { valid, rejected };
  },

  /**
   * The document graph: every discovered PDF with what the page said about it.
   *
   * Separate from `normalize` because `NormalizedItem` is the shared change-
   * detection shape and must stay that shape. This is the academic reading of
   * the same items.
   */
  describe(raw: readonly RawItem[]): SchemeDocument[] {
    return raw.map((item) => {
      const url = item.url ?? '';
      const [label, linkText] = item.title.includes(' — ')
        ? (item.title.split(' — ') as [string, string])
        : [null, item.title];
      return {
        url,
        linkText,
        kind: kindOf(item.title, url),
        schemeYear: schemeYearOf(item.title, url),
        programme: label !== null && COMMON.test(label) ? null : label,
        semesters: semestersOf(linkText),
        common: label === null ? COMMON.test(item.title) : COMMON.test(label),
        streamLabel: label !== null && /\bstream\b/i.test(label) ? label : null,
      };
    });
  },
};
