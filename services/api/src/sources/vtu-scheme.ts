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
 * That last sentence was true of this module and false of the product. The
 * gate had no callers outside its own tests, and every script that fetched
 * vtu.ac.in — discover, sync, smoke — went straight to `fetch`. They go
 * through `sources/acquire` now, which is the door this comment always
 * implied existed.
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
export const VTU_SCHEME_PARSER_VERSION = '1.1.0';

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
  /**
   * The listing SECTION this link sits under, where the page has one.
   *
   * Null when nothing on the page governs it, and null for every caller that
   * does not hand `describe` the body it parsed.
   */
  readonly section: SchemeSection | null;
}

/**
 * A heading on the listing, and everything printed beneath it until the next.
 *
 * THE YEAR IS SOMETIMES ONLY IN THE HEADING. Measured on the real page: the
 * 2025 first-year section is headed "UG Engineering Scheme and Syllabus 2025
 * (1st & 2nd semesters)" and its seventy-eight documents are filed under
 * `/pdf/UG2024/` — a path naming the year BEFORE the scheme. Seventy-seven of
 * them state no year in their own link text either, so reading links alone
 * gives `schemeYear: null` and `--scheme 2025` selects none of them. Silently:
 * a section with no matching documents looks exactly like a section that is
 * empty.
 *
 * The heading governs the links below it until the next heading — the same
 * rule the table-header reader above already follows, one level out. It is the
 * HEADING rather than the `#menuNN` wrapper because a wrapper can hold several:
 * `#menu07` carries the 2022 first-year listing, the 2022 3-to-8 listing and
 * the 2022 common-course listing, which are three different semester scopes.
 */
export interface SchemeSection {
  /** The anchor the page's own contents list links it by: `menu11`. */
  readonly anchor: string | null;
  /** The heading as printed. */
  readonly title: string;
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
/** A row of `<th>` cells: the table saying what its columns are. */
const HEADER_ROW = /<th\b/i;

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
  /*
   * THE ORDINAL IS OPTIONAL ON BOTH ENDS. Link text writes the span as
   * "3 - 8 Scheme", and the section HEADINGS write it as "3rd to 8th
   * Semester" — where the trailing `th` sits between the digit and the
   * word boundary this used to require, so the heading's own span was
   * unreadable. `714 to 755` still matches nothing: 7 is followed by 5,
   * which is neither an ordinal nor a boundary.
   */
  const range = /\b([1-8])\s*(?:st|nd|rd|th)?\s*(?:-|to|–|—)\s*([1-8])(?:st|nd|rd|th)?\b/i.exec(
    linkText,
  );
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
 * A whole `<a>` element, text and all.
 *
 * A programme cell frequently carries an ANNOTATION link after the name —
 * `Computer Science &amp; Engineering<br><a …>Code correction 21SM72
 * circular</a>` — and the annotation is not part of the programme. Links are
 * what mark it: the name is the cell's plain text and every note VTU hangs
 * off it is a link to the circular that explains it.
 *
 * `<br>` is NOT the divider, which is the obvious guess and a wrong one: the
 * same page sets "Bachelor of<br />Business<br />Administration" as one name
 * across three lines.
 */
const ANCHOR = /<a\b[^>]*>[\s\S]*?<\/a>/gi;

/** A header cell that numbers the rows: `Sl. No`, `S.No`, `Slno.`, `SL.No.` */
const SERIAL_HEADER = /^(slno|sno)$/;
/** A header cell whose column holds the row's documents rather than its name. */
const DOCUMENT_HEADER = /\bscheme\b|\bsyllab/i;

/**
 * WHICH COLUMN NAMES THE ROW — ASKED OF THE TABLE'S OWN HEADER.
 *
 * This used to walk the cells of each BODY row looking for one that "reads
 * like a name": not blank, not all digits, no `.pdf` in it. Both halves of
 * that guess were wrong on the real listing, and each cost a whole class of
 * documents.
 *
 *   - VTU numbers some rows `21a` and `29a`, which is not all digits, so the
 *     SERIAL was returned as the programme. `21a` then carried a duplicate of
 *     the entire Computer Science scheme under a programme that does not
 *     exist.
 *   - A programme cell that contains an annotation link contains `.pdf`, so
 *     the whole cell was skipped and the row fell through to no programme at
 *     all. That is why 60 documents had unknown applicability, among them
 *     `38csesch.pdf` — Computer Science & Engineering, 91 courses — which was
 *     then stored as though it applied to every student in the university.
 *
 * The page answers the question itself. Every table on it opens with a header
 * row, and that row says which column is `Program Title` / `Programme Name` /
 * `Programs` / `Course Title ( I & II Semester )` and which are `Scheme` and
 * `1st yr Syllabus`. So the label column is the first header cell that neither
 * numbers the rows nor holds their documents, and it is read ONCE per table
 * rather than guessed once per row.
 *
 * Still not a lookup against a roster of programmes (§16): the page's own
 * words remain the answer, and a programme nobody has heard of reads exactly
 * like one everybody has. What changed is which cell is read.
 */
function labelColumnOf(cells: readonly string[]): number {
  return cells.findIndex((cell) => {
    const text = textOf(cell);
    if (text === '') return false;
    if (SERIAL_HEADER.test(text.replace(/[^a-z]/gi, '').toLowerCase())) return false;
    return !DOCUMENT_HEADER.test(text);
  });
}

/**
 * A VTU course code at the very start of a label.
 *
 * `BMATS101 Mathematics for CSE Stream-I` is a COURSE, and the row it heads
 * lists that one course's syllabus. The listing mixes such tables in among the
 * programme tables and heads them "Course Code" or "Course Title", and reading
 * their rows as programmes invented a hundred programmes that are really
 * courses — and, worse, read "Mathematics for CSE Stream-I" as a STREAM,
 * because the word is in the course's name.
 *
 * The code is the evidence. A row that opens with one is about a course, so
 * its label is never a PROGRAMME — there is no degree called "Principles of
 * Programming Using C". It can still name the STREAM the course serves, which
 * is what "Mathematics for CSE Stream-I" does and what the first-year
 * namespacing depends on; that reading is unchanged.
 *
 * The suffix is matched in either case because VTU prints both: `BETCK105I`
 * and `BETCK105l` are the same code on the same page. Reading the shape as
 * printed is not the same as correcting it.
 */
const LABEL_IS_A_COURSE = /^1?B[A-Z]{2,7}\d{3}[A-Za-z]?\b/;

/**
 * What the row calls itself, from the column the header pointed at.
 *
 * Null where the table named no such column — the 2014 archive heads its one
 * column "UG Scheme and Syllabus" — because a table that does not say what its
 * rows are is not made to say it here (§7).
 */
function labelFromRow(cells: readonly string[], column: number): string | null {
  if (column < 0) return null;
  const cell = cells[column];
  if (cell === undefined) return null;
  const name = textOf(cell.replace(ANCHOR, ' '));
  return name === '' ? null : name.slice(0, 160);
}

const COMMON = /\bstream\b|\bcommon\b|\bcycle\b|\bI\s*(?:&|and)\s*II\b/i;

/* -------------------------------------------------------------------------- */
/* Sections                                                                   */
/* -------------------------------------------------------------------------- */

/** The heading of a listing section. */
const SECTION_HEADING = /<div class="col-md-12 mqtitle"[^>]*>([\s\S]*?)<\/div>/gi;
/** The wrapper the page's contents list anchors at, where a section has one. */
const SECTION_ANCHOR = /<div id="(menu\d+)" class="[^"]*vc_row/gi;
/** A year stated in a heading, with no `scheme`/`syllabus` word required. */
const BARE_YEAR = /\b(20\d{2})\b/g;

/**
 * The year a heading states, or null where it states none — or several.
 *
 * SEVERAL IS NOT ONE. The listing carries "2002 2006 2010 2014 2015 2017 and
 * 2018 scheme Common Syllabus for MATDip courses", and taking the first year
 * out of that would file every document under it as 2002. A heading that names
 * more than one year does not establish a year for anything (§7).
 */
function sectionYearOf(title: string): string | null {
  const years = [...new Set([...title.matchAll(BARE_YEAR)].map((match) => match[1]))];
  return years.length === 1 ? (years[0] ?? null) : null;
}

/**
 * Which section each PDF link sits under, by position on the page.
 *
 * One linear pass: headings, anchors and links are collected with their offsets
 * and read in document order, so a link takes the heading most recently opened
 * above it. Nothing here needs the DOM to nest correctly, which matters because
 * this page repeats an id — `#menu08` appears twice.
 */
export function sectionsByUrl(body: string): ReadonlyMap<string, SchemeSection> {
  const marks: { at: number; kind: 'heading' | 'anchor' | 'link'; value: string }[] = [];
  for (const match of body.matchAll(SECTION_HEADING)) {
    marks.push({ at: match.index, kind: 'heading', value: textOf(match[1] ?? '') });
  }
  for (const match of body.matchAll(SECTION_ANCHOR)) {
    marks.push({ at: match.index, kind: 'anchor', value: match[1] ?? '' });
  }
  for (const match of body.matchAll(PDF_LINK)) {
    marks.push({ at: match.index, kind: 'link', value: match[1] ?? '' });
  }
  marks.sort((a, b) => a.at - b.at);

  const found = new Map<string, SchemeSection>();
  let anchor: string | null = null;
  let title: string | null = null;
  for (const mark of marks) {
    if (mark.kind === 'anchor') {
      anchor = mark.value;
      continue;
    }
    if (mark.kind === 'heading') {
      /* A blank heading governs nothing; the previous one keeps its scope. */
      if (mark.value !== '') title = mark.value;
      continue;
    }
    if (title === null) continue;
    const url = mark.value.startsWith('http')
      ? mark.value
      : `https://vtu.ac.in${mark.value.replace(/^\/?/, '/')}`;
    /* First heading above the FIRST appearance of a URL, as the page reads. */
    if (!found.has(url)) found.set(url, { anchor, title });
  }
  return found;
}

export const vtuSchemeAdapter: SourceAdapter & {
  readonly describe: (raw: readonly RawItem[], body?: string) => SchemeDocument[];
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
    /*
     * The header governs the rows that follow it, until the next header. One
     * page carries seventeen tables and they do not agree on their columns.
     */
    let labelColumn = -1;
    for (const row of body.matchAll(TABLE_ROW)) {
      const html = row[1] ?? '';
      const cells = [...html.matchAll(TABLE_CELL)].map((cell) => cell[1] ?? '');
      if (HEADER_ROW.test(html)) {
        labelColumn = labelColumnOf(cells);
        continue;
      }
      rows.push({ label: labelFromRow(cells, labelColumn), html });
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
  describe(raw: readonly RawItem[], body?: string): SchemeDocument[] {
    /*
     * The section map needs the page, not the items, so a caller that only has
     * items still gets everything it got before and no section.
     */
    const sections = body === undefined ? new Map<string, SchemeSection>() : sectionsByUrl(body);
    return raw.map((item) => {
      const url = item.url ?? '';
      const section = sections.get(url) ?? null;
      const [label, linkText] = item.title.includes(' — ')
        ? (item.title.split(' — ') as [string, string])
        : [null, item.title];
      return {
        url,
        linkText,
        kind: kindOf(item.title, url),
        /*
         * THE SECTION IS A FALLBACK, NEVER AN OVERRIDE. A link that states its
         * own year keeps it; only a link that states none inherits the
         * heading's. So this can fill a null and can never change a value the
         * document itself carries.
         */
        schemeYear:
          schemeYearOf(item.title, url) ??
          (section === null ? null : sectionYearOf(section.title)),
        /*
         * A label that opens with a course code names a course, never a
         * degree. It can still be read as a stream below, which is where a
         * first-year document says whose first year it is.
         */
        programme:
          label !== null && !COMMON.test(label) && !LABEL_IS_A_COURSE.test(label) ? label : null,
        semesters:
          semestersOf(linkText) ?? (section === null ? null : semestersOf(section.title)),
        section,
        common: label === null ? COMMON.test(item.title) : COMMON.test(label),
        streamLabel: label !== null && /\bstream\b/i.test(label) ? label : null,
      };
    });
  },
};
