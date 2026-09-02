/**
 * Reading a VTU result card, and refusing to guess at the parts it cannot read.
 *
 * Authority: docs/08 §8.19 · docs/32 OQ-049 · M10A.6 §10–§21, §31–§33, §48
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS IS, AND WHAT IT REFUSES TO BE
 * ---------------------------------------------------------------------------
 *
 * Input is LINES OF TEXT with their page number — whether they came from a
 * PDF's text layer or, one day, from OCR. Output is a structured reading of the
 * card plus a list of everything that looked wrong. Nothing here saves, and
 * nothing here decides: the student confirms a reading before it becomes their
 * academic record (§28).
 *
 * The two failure modes worth naming, because both look like success:
 *
 *   SILENT REPAIR. A card whose columns do not add up is the single most
 *   valuable thing a parser can notice, and the easiest to "fix" by recomputing
 *   the total. That turns a transcription error into a confident wrong number
 *   (§17).
 *
 *   SILENT MATCHING. `BCS403` misread as `BCS408` is a real subject code that
 *   belongs to a different course. A parser that repairs codes against a
 *   catalogue by similarity produces rows that pass every check and describe
 *   someone else's degree (§32).
 *
 * So this reports, and the review screen shows. It does not correct.
 *
 * ---------------------------------------------------------------------------
 * WHY LINES RATHER THAN WORD GEOMETRY
 * ---------------------------------------------------------------------------
 *
 * A VTU result row is one printed row: code, title, three numbers, a status
 * letter and a date, left to right. A layout-preserving text extraction keeps
 * that on one line, so a line IS the row and the columns can be taken from its
 * ends inward. Word-level geometry would be needed for a document whose rows
 * wrap unpredictably; this one does not, and building a column-clustering pass
 * for it would be machinery serving no case that exists (§46).
 *
 * The parser reads from BOTH ENDS: the code anchors the left, the trailing
 * numeric-and-status group anchors the right, and whatever lies between them is
 * the title. A title with spaces, an ampersand or a hyphen therefore needs no
 * special handling, because it is never matched — it is what is left over.
 */

import type { ResultSubject } from './types.js';
import { normalizeResultSubject } from './results.js';
import { subjectKey } from './subjects.js';

/* -------------------------------------------------------------------------- */
/* What a reading can go wrong in                                             */
/* -------------------------------------------------------------------------- */

export type RowWarningKind =
  /** The printed total does not equal internal + external. Never repaired. */
  | 'total_mismatch'
  /** The code does not look like any VTU course code. */
  | 'unreadable_code'
  /** The code belongs to a scheme family other than the student's (OQ-053). */
  | 'scheme_mismatch'
  /** No title was printed between the code and the marks. */
  | 'missing_title'
  /** A status letter the card's own legend does not list. */
  | 'unknown_status'
  /** A mark is present but not a whole number. */
  | 'non_numeric_mark';

export interface RowWarning {
  readonly kind: RowWarningKind;
  /** Shown to the student verbatim, next to the row it concerns. */
  readonly message: string;
}

export interface ParsedRow {
  readonly subjectCode: string;
  readonly subjectTitle: string;
  readonly internal: number | null;
  readonly external: number | null;
  readonly total: number | null;
  readonly resultStatus: string | null;
  readonly announcedOn: string | null;
  /** The page this row was read from, for "where did this come from" (§11). */
  readonly page: number;
  /**
   * The line exactly as it was read.
   *
   * Kept so the review screen can show the student what the parser saw, rather
   * than only what it made of it. When a reading is wrong this is the only
   * thing that explains why.
   */
  readonly sourceLine: string;
  readonly warnings: readonly RowWarning[];
}

export interface ParsedCard {
  /** Null when the document did not state one. NEVER taken from a filename (§11). */
  readonly semester: number | null;
  readonly rows: readonly ParsedRow[];
  /**
   * Whether this document looks like a result card at all.
   *
   * False means the file is not refused outright — it means the import screen
   * says so and offers manual entry instead of presenting a confident reading
   * of something that is not a result (§48, §85).
   */
  readonly looksLikeResultCard: boolean;
  /**
   * The seat number, if printed. Extracted for CONFIRMATION CONTEXT ONLY.
   *
   * Never an identity, never an ownership check, never required to import
   * (§26, §41). It exists so a student can see they are importing their own
   * card, and for no other purpose.
   */
  readonly seatNumber: string | null;
  readonly warnings: readonly RowWarning[];
}

/* -------------------------------------------------------------------------- */
/* Recognisers                                                                */
/* -------------------------------------------------------------------------- */

/**
 * A VTU course code, in either family.
 *
 * The optional leading digit is deliberate and is the M10A.3 lesson: a 2022
 * pattern run over a later-scheme code matches its tail, so `1BMATC101`
 * silently becomes `BMATC101` — a real code for a different course. Matching
 * the whole thing and reporting the mismatch is the only safe reading (§87).
 */
const COURSE_CODE = /^(1?B[A-Z]{2,6}\d{3}[A-Z]?)\b/;

/** The trailing block: three marks, a status letter, and an optional date. */
const TRAILING = /\s(\d{1,3})\s+(\d{1,3})\s+(\d{1,3})\s+([A-Z]{1,2})(?:\s+(\S+))?\s*$/;

/** `Semester : 4`, however it is spaced or punctuated. */
const SEMESTER_LINE = /semester\s*[:-]?\s*(\d)\b/i;

/** `2BU24CB076`-shaped. Recognised only to show it back, never to trust it. */
const SEAT_NUMBER = /\b(\d[A-Z]{2}\d{2}[A-Z]{2}\d{3})\b/;

/**
 * The statuses a real card legends at the foot of the page.
 *
 * An unfamiliar letter is REPORTED, not rejected: the legend is what this
 * university printed, not a closed universe, and a card carrying a seventh
 * status is a fact about the card (docs/08, DEC-040).
 */
const KNOWN_STATUSES = new Set(['P', 'F', 'A', 'W', 'X', 'NE']);

/** ISO, or the `YYYY-MM-DD` a VTU card prints. Anything else is kept as text. */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Cues that this is a result card rather than any other PDF.
 *
 * Two or more, so a single stray word cannot promote an arbitrary document —
 * and so a card missing one heading is not refused (§48's "do not reject
 * legitimate formatting variation").
 */
const CARD_CUES = [
  /university\s+seat\s+number/i,
  /provisional\s+result/i,
  /internal\s+marks/i,
  /external\s+marks/i,
  /announced\s*\/?\s*updated/i,
  /visvesvaraya\s+technological/i,
];

export interface ImportLine {
  readonly text: string;
  readonly page: number;
}

/* -------------------------------------------------------------------------- */
/* Parsing                                                                    */
/* -------------------------------------------------------------------------- */

function wholeNumber(raw: string): number | null {
  if (!/^\d{1,3}$/.test(raw)) return null;
  return Number(raw);
}

/**
 * One printed row, read from both ends.
 *
 * Returns null when the line is not a subject row at all — a heading, a legend,
 * a page number. That is the common case and is not a warning: most lines of a
 * result card are not rows.
 */
export function parseRow(line: ImportLine, schemeFamily2022: boolean): ParsedRow | null {
  const text = line.text.replace(/\s+$/, '');
  const code = COURSE_CODE.exec(text.trimStart())?.[1];
  if (code === undefined) return null;

  const trailing = TRAILING.exec(text);
  if (trailing === null) return null;

  const [, rawInternal, rawExternal, rawTotal, status, rawDate] = trailing;

  /*
   * The title is what is LEFT OVER between the code and the marks, never
   * matched. A title containing an ampersand, a hyphen, digits or a bracket
   * therefore needs no special case — the two anchors define it.
   */
  const start = text.indexOf(code) + code.length;
  const title = text.slice(start, text.length - trailing[0].length).trim();

  const internal = wholeNumber(rawInternal ?? '');
  const external = wholeNumber(rawExternal ?? '');
  const total = wholeNumber(rawTotal ?? '');

  const warnings: RowWarning[] = [];

  if (internal === null || external === null || total === null) {
    warnings.push({
      kind: 'non_numeric_mark',
      message: 'A mark on this row could not be read as a whole number.',
    });
  } else if (total !== internal + external) {
    /*
     * REPORTED, NEVER REPAIRED (§17). Recomputing the total here would turn a
     * transcription or OCR error into a confident wrong number, and the student
     * would have no way to see that it had happened.
     */
    warnings.push({
      kind: 'total_mismatch',
      message: `Total does not match the component marks: ${String(internal)} + ${String(external)} = ${String(internal + external)}, but ${String(total)} was read.`,
    });
  }

  if (title === '') {
    warnings.push({ kind: 'missing_title', message: 'No subject name was read on this row.' });
  }

  if (status !== undefined && !KNOWN_STATUSES.has(status)) {
    warnings.push({
      kind: 'unknown_status',
      message: `"${status}" is not one of the statuses this card legends. It has been kept as printed.`,
    });
  }

  /*
   * A LATER-SCHEME CODE IS NOT REINTERPRETED (§87, OQ-053). `1BMATC101` is a
   * real course in a scheme this student is not on; stripping the digit to make
   * it match would attribute someone else's course to their degree.
   */
  if (schemeFamily2022 && code.startsWith('1B')) {
    warnings.push({
      kind: 'scheme_mismatch',
      message: `${code} belongs to a different VTU scheme from your profile. It has not been reinterpreted — check before importing.`,
    });
  }

  return {
    subjectCode: subjectKey(code),
    subjectTitle: title,
    internal,
    external,
    total,
    resultStatus: status ?? null,
    announcedOn: rawDate !== undefined && ISO_DATE.test(rawDate) ? rawDate : null,
    page: line.page,
    sourceLine: text.trim(),
    warnings,
  };
}

/**
 * A whole document.
 *
 * The semester comes from the PAGE, never from the filename: `result_s3.pdf` is
 * a name somebody typed, and a name is not evidence about what is inside the
 * file (§11). Where the page does not say, `semester` is null and the import
 * screen asks.
 */
export function parseResultCard(
  lines: readonly ImportLine[],
  options: { readonly schemeFamily2022?: boolean } = {},
): ParsedCard {
  const schemeFamily2022 = options.schemeFamily2022 ?? true;
  const joined = lines.map((line) => line.text).join('\n');

  const rows: ParsedRow[] = [];
  for (const line of lines) {
    const row = parseRow(line, schemeFamily2022);
    if (row !== null) rows.push(row);
  }

  const cues = CARD_CUES.filter((cue) => cue.test(joined)).length;
  /*
   * A document is a result card when it says so AND has rows in it. Rows alone
   * would admit any table; cues alone would admit a covering letter about
   * results that contains no marks.
   */
  const looksLikeResultCard = cues >= 2 && rows.length > 0;

  const semesterMatch = SEMESTER_LINE.exec(joined);
  const semester =
    semesterMatch?.[1] === undefined
      ? null
      : Number(semesterMatch[1]) >= 1 && Number(semesterMatch[1]) <= 8
        ? Number(semesterMatch[1])
        : null;

  const warnings: RowWarning[] = [];
  if (looksLikeResultCard && semester === null) {
    warnings.push({
      kind: 'unknown_status',
      message: 'The semester was not printed on this document. Choose it before importing.',
    });
  }

  return {
    semester,
    rows,
    looksLikeResultCard,
    seatNumber: SEAT_NUMBER.exec(joined)?.[1] ?? null,
    warnings,
  };
}

/* -------------------------------------------------------------------------- */
/* Becoming a result                                                          */
/* -------------------------------------------------------------------------- */

/**
 * A parsed row as a stored subject.
 *
 * SOURCE FIELDS ONLY (§16). Grade, grade point, credits and SEE applicability
 * are absent from a provisional card, so they are absent here — the grade a
 * student would otherwise be made to invent is exactly what OQ-049 removed.
 * `evaluateResultSubject` computes what it can on read, and says so.
 *
 * `credits` and `hasSee` are filled in by the caller from the verified
 * catalogue where it covers the subject, and stay null where it does not.
 */
export function rowToSubject(
  row: ParsedRow,
  id: string,
  reference: { readonly credits: number | null; readonly hasSee: boolean | null } | null,
): ResultSubject {
  return normalizeResultSubject({
    id,
    subjectCode: row.subjectCode,
    subjectTitle: row.subjectTitle === '' ? row.subjectCode : row.subjectTitle,
    internal: row.internal,
    external: row.external,
    total: row.total,
    resultStatus: row.resultStatus,
    announcedOn: row.announcedOn,
    gradeLetter: null,
    gradePoint: null,
    credits: reference?.credits ?? null,
    hasSee: reference?.hasSee ?? null,
    provenance: reference === null ? 'manual' : 'catalogue',
  });
}
