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
  | 'non_numeric_mark'
  /** No pass/fail letter was read on a row that otherwise parsed. */
  | 'missing_status'
  /** A line looked like a subject row but could not be read as one. */
  | 'unreadable_row'
  /** The row carried more numbers than a result row has columns. */
  | 'ambiguous_marks';

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
   * Lines that begin with a course code but could not be read as a row.
   *
   * Shown to the student rather than discarded, because a row dropped in
   * silence is a subject missing from a semester with nothing to indicate it
   * (M10A.6C §6). The line is offered as text, for a person to compare against
   * their card — never repaired, never guessed at.
   */
  readonly unreadableRows: readonly ImportLine[];
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

/**
 * The trailing block: three marks, then an optional status and date.
 *
 * BOTH TAILS ARE OPTIONAL, and that is a lesson from real cards rather than a
 * relaxation for its own sake. Recognition on a genuine result card dropped the
 * single status letter on three rows out of nine while reading all three marks
 * perfectly — and requiring the letter threw away the marks with it. Losing a
 * whole row because one smudged glyph was unreadable is the wrong trade: the
 * marks are the part that matters, and a missing status is reported and filled
 * in during review.
 *
 * The status also tolerates a trailing full stop or comma, because a table rule
 * next to the letter is routinely read as one. That is stripping punctuation,
 * never correcting a letter: `F` is never turned into `P` (M10A.6C §6).
 */
const TRAILING =
  /\s(\d{1,3})\s+(\d{1,3})\s+(\d{1,3})(?:\s+([A-Za-z]{1,2})[.,]?)?(?:\s+(\S+))?\s*$/;

/** `Semester : 4`, however it is spaced or punctuated. */
const SEMESTER_LINE = /semester\s*[:-]?\s*(\d)\b/i;

/**
 * A seat-number shape: digit, two letters, two digits, two letters, three
 * digits. Recognised only to show it back, never to trust it.
 *
 * The pattern is described rather than exemplified on purpose — a specimen here
 * would be somebody's real seat number, and this file is public.
 */
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

/**
 * A row with the table's own vertical rules taken out.
 *
 * A ruled table read from a picture brings its borders along as pipes, landing
 * INSIDE the row: `38 | 18 56 P`. The marks pattern wants three numbers
 * separated by whitespace, so a single border character between two columns
 * cost the whole row — on a real card this was the difference between seven
 * readable rows and two.
 *
 * A pipe is never data on a result card: it is not a digit, a letter of a
 * course code, or part of a status. Removing it is reading the table, not
 * correcting the marks (M10A.6C §6).
 */
function stripRules(text: string): string {
  return text.replace(/[|¦]+/g, ' ').replace(/\s+$/, '');
}

/**
 * Whether a line begins with something shaped like a course code.
 *
 * The weaker half of `parseRow`'s test: enough to say "this was meant to be a
 * subject row", not enough to read one. It exists so a line that fails the full
 * parse can be COUNTED rather than dropped.
 */
function looksLikeSubjectRow(text: string): boolean {
  return COURSE_CODE.test(stripRules(text).trimStart().replace(/^[^A-Za-z0-9]+/, ''));
}

/**
 * Trailing whole numbers on the stretch between the code and the marks.
 *
 * These are the EXTRA numbers: a row's three marks are matched separately, so
 * anything numeric still sitting at the end of the title is a token the reader
 * produced that a result row has no column for.
 */
function trailingNumbers(between: string): string[] {
  const tokens = between.split(/\s+/).filter((token) => token !== '');
  const extras: string[] = [];
  while (tokens.length > 0 && /^\d{1,3}$/.test(tokens[tokens.length - 1] as string)) {
    extras.unshift(tokens.pop() as string);
  }
  return extras;
}

/**
 * The rightmost three consecutive numbers where the first two make the third.
 *
 * The card prints internal, external and total, and the total is their sum. On
 * a row carrying more numbers than columns that invariant says which three are
 * the columns — without changing any of them.
 */
function rightmostConsistentTriple(values: readonly string[]): [string, string, string] | null {
  for (let i = values.length - 3; i >= 0; i -= 1) {
    const triple = values.slice(i, i + 3) as [string, string, string];
    const numbers = triple.map((value) => wholeNumber(value));
    const [a, b, c] = numbers;
    if (a !== null && a !== undefined && b !== null && b !== undefined && c !== null && c !== undefined && a + b === c) {
      return triple;
    }
  }
  return null;
}

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
  const text = stripRules(line.text);
  /*
   * Leading punctuation is stripped before the code is matched. A table's
   * vertical rule at the left edge of a scanned row comes back as a stray
   * quote or pipe attached to the code — `'BQEK459` — and an anchored pattern
   * then fails to see a code that is plainly there. Removing non-alphanumeric
   * noise cannot invent a code where there is none.
   */
  const code = COURSE_CODE.exec(text.trimStart().replace(/^[^A-Za-z0-9]+/, ''))?.[1];
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
  const between = text.slice(start, text.length - trailing[0].length).trim();

  const warnings: RowWarning[] = [];

  /*
   * MORE NUMBERS THAN COLUMNS.
   *
   * On a real card, recognition inserted a stray digit after the total:
   * `... 27 39 66 3 2025-03-13`. Reading three marks from the right then
   * shifted every column left by one and produced marks that were wrong rather
   * than missing — the failure this whole workflow exists to prevent.
   *
   * Where the row carries extra trailing numbers, the columns are chosen by the
   * card's OWN ARITHMETIC: the rightmost run of three where internal + external
   * equals the total. That picks an ALIGNMENT; it never alters a value, and it
   * never invents one. When no run adds up, the rightmost three stand exactly
   * as before and the existing mismatch warning says so.
   *
   * Either way the row is flagged, because a row whose columns had to be
   * inferred is a row a person should look at.
   */
  const extras = trailingNumbers(between);
  const candidates = [...extras, rawInternal ?? '', rawExternal ?? '', rawTotal ?? ''];
  let [rawA, rawB, rawC] = candidates.slice(-3) as [string, string, string];

  if (extras.length > 0) {
    const consistent = rightmostConsistentTriple(candidates);
    if (consistent !== null) [rawA, rawB, rawC] = consistent;
    warnings.push({
      kind: 'ambiguous_marks',
      message:
        consistent === null
          ? 'This row had more numbers on it than a result row has columns, and none of them add up. The three nearest the end were used — check them against your card.'
          : 'This row had more numbers on it than a result row has columns. The three that add up were used — check them against your card.',
    });
  }

  const internal = wholeNumber(rawA);
  const external = wholeNumber(rawB);
  const total = wholeNumber(rawC);

  /* Whatever was taken as a mark is not part of the printed subject name. */
  const title = between
    .split(/\s+/)
    .slice(0, between.split(/\s+/).length - extras.length)
    .join(' ')
    .trim();

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

  if (status === undefined) {
    warnings.push({
      kind: 'missing_status',
      message: 'No pass or fail letter was read on this row. Choose one before importing.',
    });
  } else if (!KNOWN_STATUSES.has(status)) {
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
  /*
   * A LINE THAT LOOKS LIKE A SUBJECT ROW AND DID NOT PARSE IS KEPT.
   *
   * Silently dropping it is the worst available outcome: a nine-subject card
   * arrives as eight rows, every one of them correct, and nothing on screen
   * says a subject is missing. The student has no way to notice — the card does
   * not print how many subjects it has. On a real card this happened where
   * recognition lost one mark out of a row, and the row vanished with it.
   */
  const unreadable: ImportLine[] = [];
  for (const line of lines) {
    const row = parseRow(line, schemeFamily2022);
    if (row !== null) {
      rows.push(row);
    } else if (looksLikeSubjectRow(line.text)) {
      unreadable.push(line);
    }
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
  if (unreadable.length > 0) {
    warnings.push({
      kind: 'unreadable_row',
      message:
        unreadable.length === 1
          ? 'One line looks like a subject row but could not be read. Check it against your card and add it by hand if it is missing.'
          : `${String(unreadable.length)} lines look like subject rows but could not be read. Check them against your card and add any that are missing by hand.`,
    });
  }
  if (looksLikeResultCard && semester === null) {
    warnings.push({
      kind: 'unknown_status',
      message: 'The semester was not printed on this document. Choose it before importing.',
    });
  }

  return {
    semester,
    rows,
    unreadableRows: unreadable,
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
