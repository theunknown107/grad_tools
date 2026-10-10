/**
 * Reading an official VTU examination time table the student supplied.
 *
 * Authority: Phase 7B.2 §1–§17 · docs/40 (source audit) · docs/37 (never invent)
 *
 * ---------------------------------------------------------------------------
 * THIS IS NOT THE WEEKLY TIMETABLE, AND THE TWO MUST NOT MEET
 * ---------------------------------------------------------------------------
 *
 * `TimetableSlot` is a recurring hour of the student's week: a weekday, a
 * start, an end, repeating until the timetable is replaced. An exam is a dated
 * event that happens once. They share the words "timetable", "subject" and
 * "time" and nothing else, and merging them because both carry a clock would
 * make every query about one answer partly about the other.
 *
 * ---------------------------------------------------------------------------
 * NOTHING HERE FETCHES
 * ---------------------------------------------------------------------------
 *
 * vtu.ac.in's terms of use have never been reviewed (OQ-006), and the registry
 * records `terms_status = 'unknown'`, which the project reads as "do not
 * fetch". So an exam timetable reaches GradTools exactly one way: a student
 * uploads a document they already hold. This module reads what it is handed
 * and knows nothing about the network.
 *
 * ---------------------------------------------------------------------------
 * WHAT THE REAL DOCUMENT LOOKS LIKE
 * ---------------------------------------------------------------------------
 *
 * Measured from the one real document available (docs/40), and every rule
 * below exists because of something it does:
 *
 *   Draft Time Table for Eligible Students of B.E. III & IV (2022 Scheme),
 *   V & VI semester (2021 Scheme) [CBCS] Examinations, Dec.2025/Jan.2026
 *
 *   ┌───────────────┬─────────────────────────┬────────────────────────┐
 *   │               │    2022 Scheme [CBCS]   │   2021 Scheme [CBCS]   │
 *   │   Date, Day   ├────────────┬────────────┼───────────┬────────────┤
 *   │               │ III-Sem    │ IV-Sem     │ V-Sem     │ VI-Sem     │
 *   │               │ 2.00–5.00pm│ 2.00–5.00pm│ 9.30–12.30│ 9.30–12.30 │
 *   ├───────────────┼────────────┼────────────┼───────────┼────────────┤
 *   │ 23-01-2026,Fri│ B**301 /   │     --     │    --     │     --     │
 *   │               │ BMAT301/…  │            │           │            │
 *   └───────────────┴────────────┴────────────┴───────────┴────────────┘
 *
 *   - ONE DOCUMENT, SEVERAL SCHEMES AND SEVERAL SEMESTERS. The scheme is a
 *     merged header spanning the semester columns beneath it, so what applies
 *     to a student is decided by the COLUMN, never by the document.
 *   - THE SESSION IS A PROPERTY OF THE COLUMN, printed once in its header, not
 *     repeated on each exam.
 *   - THE CELL IS OFTEN A PATTERN. `B**301`, `B**456*`, `21**51` name no single
 *     course, and this module does not pretend otherwise (§12).
 *   - A SECOND CODE GRAMMAR EXISTS. `21RMI56` is a 2021-scheme code and does
 *     not match the catalogue's `B…` shape at all (§13).
 *   - `--` MEANS "no exam in this column that day" and is not missing data.
 *
 * ---------------------------------------------------------------------------
 * WHAT IT REFUSES TO DO
 * ---------------------------------------------------------------------------
 *
 * It never invents a course code, never expands a wildcard by guessing the
 * letters it hides, and never matches a cell to a course because the two read
 * alike. A cell that cannot be resolved is kept as printed and marked
 * unresolved, which is a fact about the document rather than a failure to hide.
 */

import type { PositionedText } from './pdf-layout.js';

/** One page of a supplied document, positioned exactly as `pdf-layout` gives it. */
export interface ExamPage {
  readonly page: number;
  readonly items: readonly PositionedText[];
}

/** What a cell turned out to be. */
export type ExamCellKind =
  /** An ordinary course code the catalogue could hold: `BBOK407`. */
  | 'code'
  /** Several codes for one sitting: `BBOK407 / BBOC407`. */
  | 'alternatives'
  /** A pattern standing for many courses: `B**301`, `21**51`. */
  | 'pattern'
  /** Recognisably an exam, in a grammar this product does not model. */
  | 'other';

export interface ExamEventReading {
  /** ISO `YYYY-MM-DD`. */
  readonly examDate: string;
  /** The weekday as printed, or null where the document printed none. */
  readonly weekday: string | null;
  /** The column's own session text: "2.00pm to 5.00pm". */
  readonly session: string | null;
  /** 24-hour `HH:MM`, where the session text states one. */
  readonly startTime: string | null;
  readonly endTime: string | null;
  /** The scheme this column belongs to, as printed: "2022". */
  readonly scheme: string | null;
  /** The semester this column belongs to. */
  readonly semester: number | null;
  /** The cell, verbatim. The source's own words, never rewritten. */
  readonly printed: string;
  readonly kind: ExamCellKind;
  /**
   * The codes the cell names, where it names any.
   *
   * Empty for a pattern: `B**301` names a shape, not a course, and listing a
   * guess here would be the fabrication this module exists to avoid.
   */
  readonly codes: readonly string[];
}

export interface ExamTimetableContext {
  /** The cycle in the document's own words: "Dec.2025/Jan.2026". */
  readonly examCycle: string | null;
  /** How the document titles itself: "Draft", "Revised". Null when it does not. */
  readonly publicationState: string | null;
  /** The notification number the document cites, verbatim. */
  readonly notification: string | null;
  /** Every scheme the header names. */
  readonly schemes: readonly string[];
}

export interface ParsedExamTimetable {
  readonly context: ExamTimetableContext;
  readonly events: readonly ExamEventReading[];
  readonly warnings: readonly string[];
}

/* -------------------------------------------------------------------------- */
/* The shapes the document prints                                             */
/* -------------------------------------------------------------------------- */

/**
 * An ordinary course code, in the grammar the rest of the product uses.
 *
 * Anchored, because a cell is a whole cell. `BBOK407` matches; `B**301` does
 * not, and must not — that is the entire point of telling them apart.
 */
const EXAM_CODE = /^1?B[A-Z]{2,7}\d{3}[A-Za-z]?$/;

/**
 * A code in a scheme this product does not model: `21RMI56`, `21CIV57`.
 *
 * Read and kept, not forced through the catalogue's grammar (§13). A student
 * sitting a 2021-scheme arrear paper should see it on their timetable even
 * though nothing in the catalogue can say what it is.
 */
const LEGACY_CODE = /^\d{2}[A-Z]{2,6}\d{2,3}[A-Za-z]?$/;

/**
 * A pattern: `B**301`, `B**456*`, `21**51`.
 *
 * The asterisks are the document's own wildcard, standing for the branch
 * letters it does not need to spell out. It is recognised so it can be KEPT as
 * a pattern — never expanded (§12).
 */
const PATTERN_CODE = /^[0-9A-Z]*\*+[0-9A-Z*]*$/;

/** The cell a document prints where a column has no exam that day. */
const NO_EXAM = /^[-–—]{1,3}$/;

/** `23-01-2026`, `23.01.2026`, `23/01/2026`. */
const PRINTED_DATE = /\b(\d{1,2})[-./](\d{1,2})[-./](\d{4})\b/;

/** `2.00pm to 5.00pm`, `9.30am to 12.30pm`. */
const SESSION = /(\d{1,2})[.:](\d{2})\s*(am|pm)?\s*(?:to|–|-|—)\s*(\d{1,2})[.:](\d{2})\s*(am|pm)/i;

/** `Dec.2025/Jan.2026`, `June/July 2026`. */
const CYCLE =
  /((?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s*\d{4}\s*\/\s*(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s*\d{4}|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s*\/\s*(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s*\d{4})/i;

/** How a document says what it is. */
const PUBLICATION = /\b(draft|revised|provisional|final)\b/i;

/** `No.VTU/BGM/BOS/598/2024-25/4718` */
const NOTIFICATION = /\bNo\.\s*([A-Z]{2,}(?:\/[A-Za-z0-9-]+)+)/;

/** Roman numerals a semester header uses. */
const ROMAN: Readonly<Record<string, number>> = {
  I: 1,
  II: 2,
  III: 3,
  IV: 4,
  V: 5,
  VI: 6,
  VII: 7,
  VIII: 8,
};

/* -------------------------------------------------------------------------- */
/* Reading                                                                    */
/* -------------------------------------------------------------------------- */

function medianHeight(items: readonly PositionedText[]): number {
  const heights = items
    .map((item) => item.height)
    .filter((height) => height > 0)
    .sort((a, b) => a - b);
  return heights.length === 0 ? 10 : (heights[Math.floor(heights.length / 2)] as number);
}

/** Printed lines, top to bottom, each ordered left to right. */
function rowsOf(items: readonly PositionedText[], tolerance: number): PositionedText[][] {
  const rows: PositionedText[][] = [];
  for (const item of [...items].sort((a, b) => b.y - a.y || a.x - b.x)) {
    const row = rows.find(
      (candidate) => Math.abs((candidate[0] as PositionedText).y - item.y) <= tolerance,
    );
    if (row === undefined) rows.push([item]);
    else row.push(item);
  }
  return rows.map((row) => [...row].sort((a, b) => a.x - b.x));
}

const textOf = (row: readonly PositionedText[]) =>
  row
    .map((item) => item.text)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();

/** `2.00pm to 5.00pm` as two 24-hour times, where it states them. */
function sessionTimes(text: string): { start: string | null; end: string | null } {
  const match = SESSION.exec(text);
  if (match === null) return { start: null, end: null };

  const endMeridiem = (match[6] ?? '').toLowerCase();
  const startMeridiem = (match[3] ?? endMeridiem).toLowerCase();
  const to24 = (hour: string, minute: string, meridiem: string) => {
    let value = Number(hour) % 12;
    if (meridiem === 'pm') value += 12;
    return `${String(value).padStart(2, '0')}:${minute}`;
  };
  return {
    start: to24(match[1] as string, match[2] as string, startMeridiem),
    end: to24(match[4] as string, match[5] as string, endMeridiem),
  };
}

/** `23-01-2026` as `2026-01-23`. Never reinterpreted as month-first. */
function isoDate(text: string): string | null {
  const match = PRINTED_DATE.exec(text);
  if (match === null) return null;
  const day = (match[1] as string).padStart(2, '0');
  const month = (match[2] as string).padStart(2, '0');
  if (Number(month) > 12 || Number(day) > 31) return null;
  return `${match[3] as string}-${month}-${day}`;
}

/**
 * What one cell is.
 *
 * Order matters: a pattern is tested BEFORE a code, because `B**301` would
 * otherwise be offered to a grammar that cannot hold it and read as nothing.
 */
export function classifyExamCell(printed: string): {
  kind: ExamCellKind;
  codes: string[];
} {
  const cleaned = printed.replace(/\s+/g, ' ').trim();
  const parts = cleaned
    .split('/')
    .map((part) => part.trim())
    .filter((part) => part !== '');

  if (parts.length === 0) return { kind: 'other', codes: [] };

  /* A pattern anywhere in the cell makes the whole cell a pattern: the
     document is naming a shape, and the codes beside it are examples of it. */
  if (parts.some((part) => PATTERN_CODE.test(part))) return { kind: 'pattern', codes: [] };

  const codes = parts.filter((part) => EXAM_CODE.test(part) || LEGACY_CODE.test(part));
  if (codes.length === 0) return { kind: 'other', codes: [] };
  if (codes.length !== parts.length) return { kind: 'other', codes: [] };
  return { kind: codes.length > 1 ? 'alternatives' : 'code', codes };
}

interface Column {
  /** Where the column begins and ends, from its own header text. */
  readonly left: number;
  readonly right: number;
  readonly scheme: string | null;
  readonly semester: number | null;
  readonly session: string | null;
  readonly startTime: string | null;
  readonly endTime: string | null;
}

/**
 * The columns, from the header the document prints above them.
 *
 * The semester row is what defines a column — one column per semester — and
 * the scheme is a MERGED cell above it, claimed by horizontal overlap rather
 * than by counting: a scheme label sits over the columns it spans, and that is
 * the only thing that says which they are.
 */
function columnsOf(rows: readonly PositionedText[][]): Column[] {
  let semesterRow: PositionedText[] | null = null;
  let semesterIndex = -1;
  for (const [index, row] of rows.entries()) {
    const found = row.filter((item) => semesterOf(item.text) !== null);
    if (found.length >= 2 && found.length > (semesterRow?.length ?? 0)) {
      semesterRow = found;
      semesterIndex = index;
    }
  }
  if (semesterRow === null) return [];

  /* The scheme labels: the nearest row ABOVE that names scheme years. */
  const schemeCells: PositionedText[] = [];
  for (let index = semesterIndex - 1; index >= 0 && schemeCells.length === 0; index -= 1) {
    for (const item of rows[index] as PositionedText[]) {
      if (/\b(19|20)\d{2}\b/.test(item.text) && /scheme/i.test(item.text)) schemeCells.push(item);
    }
  }

  /* The session lines: the nearest row BELOW that states times. */
  const sessionCells: PositionedText[] = [];
  for (
    let index = semesterIndex + 1;
    index < rows.length && sessionCells.length === 0;
    index += 1
  ) {
    for (const item of rows[index] as PositionedText[]) {
      if (SESSION.test(item.text)) sessionCells.push(item);
    }
  }

  return semesterRow.map((cell) => {
    const centre = cell.x + cell.width / 2;
    const scheme = schemeCells.find(
      (label) => centre >= label.x && centre <= label.x + label.width,
    );
    const session = sessionCells.find(
      (line) => centre >= line.x - line.width && centre <= line.x + line.width * 2,
    );
    const times = session === undefined ? { start: null, end: null } : sessionTimes(session.text);
    return {
      left: cell.x - cell.width * 0.6,
      right: cell.x + cell.width * 1.6,
      scheme: scheme === undefined ? null : (/\b((?:19|20)\d{2})\b/.exec(scheme.text)?.[1] ?? null),
      semester: semesterOf(cell.text),
      session: session?.text.replace(/\s+/g, ' ').trim() ?? null,
      startTime: times.start,
      endTime: times.end,
    };
  });
}

/** `III - Semester`, `V-Semester`, `Semester V`. */
function semesterOf(text: string): number | null {
  const match =
    /\b(I{1,3}|IV|VI{0,3}|VIII)\b\s*[-–—]?\s*semester|semester\s*[-–—]?\s*\b(I{1,3}|IV|VI{0,3}|VIII)\b/i.exec(
      text,
    );
  if (match === null) return null;
  const roman = (match[1] ?? match[2] ?? '').toUpperCase();
  return ROMAN[roman] ?? null;
}

/**
 * One supplied exam timetable, read.
 *
 * Every value comes from the document. Where it says nothing, the field is
 * null and stays null.
 */
export function parseExamTimetable(pages: readonly ExamPage[]): ParsedExamTimetable {
  const items = pages.flatMap((page) => page.items).filter((item) => item.text.trim() !== '');
  if (items.length === 0) {
    return {
      context: { examCycle: null, publicationState: null, notification: null, schemes: [] },
      events: [],
      warnings: ['Nothing could be read from this document.'],
    };
  }

  const tolerance = medianHeight(items) * 0.6;
  const rows = rowsOf(items, tolerance);
  const joined = rows.map(textOf).join('\n');

  const columns = columnsOf(rows);
  const warnings: string[] = [];

  const context: ExamTimetableContext = {
    examCycle: CYCLE.exec(joined)?.[1]?.replace(/\s+/g, ' ').trim() ?? null,
    publicationState: PUBLICATION.exec(joined)?.[1]?.toLowerCase() ?? null,
    notification: NOTIFICATION.exec(joined)?.[1] ?? null,
    schemes: [
      ...new Set(columns.map((column) => column.scheme).filter((s): s is string => s !== null)),
    ],
  };

  if (columns.length === 0) {
    return {
      context,
      events: [],
      warnings: [
        'The columns of this exam timetable could not be read, so no exam was taken from it.',
      ],
    };
  }

  const events: ExamEventReading[] = [];
  let noExamCells = 0;

  /*
   * A DATE IS ONLY A DATE IN THE DATE COLUMN.
   *
   * The notes at the foot of the document cite the notification's own date —
   * "dt.01/01/2099" — and reading any line that carries a date as a row of the
   * table turned that sentence into an exam, filed under whichever column its
   * text happened to sit over. The table's date column is to the LEFT of every
   * semester column, so that is where a row's date has to come from.
   */
  const dateColumnRight = Math.min(...columns.map((column) => column.left));

  for (const row of rows) {
    const dateCells = row.filter((item) => item.x + item.width / 2 < dateColumnRight);
    if (dateCells.length === 0) continue;
    const line = textOf(dateCells);
    const examDate = isoDate(line);
    if (examDate === null) continue;

    /* The weekday the row prints beside its date, kept as printed. */
    const weekday =
      /\b(mon|tues|tue|wednes|wed|thurs|thur|thu|fri|satur|sat|sun)[a-z]*\b/i.exec(line)?.[0] ??
      null;

    for (const column of columns) {
      const cells = row.filter(
        (item) => item.x + item.width / 2 >= column.left && item.x + item.width / 2 <= column.right,
      );
      if (cells.length === 0) continue;
      const printed = textOf(cells);
      if (printed === '') continue;

      /*
       * `--` IS AN ANSWER (§14). It says this column has no exam that day,
       * which is not the same as the document being silent, and turning it
       * into an event would put an exam on a free afternoon.
       */
      if (NO_EXAM.test(printed)) {
        noExamCells += 1;
        continue;
      }

      const { kind, codes } = classifyExamCell(printed);
      events.push({
        examDate,
        weekday,
        session: column.session,
        startTime: column.startTime,
        endTime: column.endTime,
        scheme: column.scheme,
        semester: column.semester,
        printed,
        kind,
        codes,
      });
    }
  }

  const patterns = events.filter((event) => event.kind === 'pattern').length;
  if (patterns > 0) {
    warnings.push(
      `${String(patterns)} ${patterns === 1 ? 'exam names a code pattern' : 'exams name code patterns'} ` +
        'such as B**301 rather than one course. They are shown as printed — which course they mean ' +
        'is not stated by this document.',
    );
  }
  if (events.length === 0 && noExamCells === 0) {
    warnings.push('No exam rows could be read from this document.');
  }

  return { context, events, warnings };
}

/* -------------------------------------------------------------------------- */
/* What the student keeps                                                     */
/* -------------------------------------------------------------------------- */

/**
 * One exam timetable document the student supplied, as it is stored.
 *
 * `fingerprint` is the identity: the same document uploaded twice is one
 * document, whatever the file was called the second time (§23).
 */
export interface SavedExamTimetable {
  readonly id: string;
  readonly profileId: string;
  readonly examCycle: string | null;
  readonly publicationState: string | null;
  readonly notification: string | null;
  /** SHA-256 of the supplied bytes. */
  readonly fingerprint: string;
  /** What the student called the file. Shown so they can recognise it again. */
  readonly fileName: string | null;
  readonly importedAt: string;
  readonly eventCount: number;
}

/** One exam, as it is stored. */
export interface StoredExamEvent extends ExamEventReading {
  readonly id: string;
  readonly profileId: string;
  readonly timetableId: string;
}

export type ExamTimetableRelation =
  | { readonly kind: 'new' }
  | { readonly kind: 'duplicate'; readonly existing: SavedExamTimetable }
  | {
      readonly kind: 'revision';
      readonly existing: SavedExamTimetable;
      /** False where the incoming document is not the later publication. */
      readonly supersedes: boolean;
    };

/**
 * How an incoming exam timetable relates to one already held.
 *
 * ---------------------------------------------------------------------------
 * A REVISION IS NOT A DUPLICATE, AND A DUPLICATE IS NOT A REVISION
 * ---------------------------------------------------------------------------
 *
 * The same bytes are the same document: uploading a file twice must not
 * produce two timetables, and the fingerprint settles that without reading a
 * word of it (§23).
 *
 * A DIFFERENT document for the same cycle is a revision, and the order matters:
 * a draft and the revision that replaces it are both real, and the product has
 * to know which one is current. `supersedes` is decided by what the documents
 * SAY — a published document supersedes a draft — and never by which was
 * uploaded second, because a student who uploads the draft later has not
 * un-published anything (§24).
 *
 * Where neither document states its publication, nothing is claimed: the
 * relation is a revision that does not supersede, and the student is the one
 * who decides.
 */
export function relateExamTimetable(
  incoming: {
    readonly fingerprint: string;
    readonly examCycle: string | null;
    readonly publicationState: string | null;
  },
  saved: readonly SavedExamTimetable[],
): ExamTimetableRelation {
  const duplicate = saved.find((entry) => entry.fingerprint === incoming.fingerprint);
  if (duplicate !== undefined) return { kind: 'duplicate', existing: duplicate };

  /* Same cycle, different bytes: the documents are two readings of one exam
     season, which is the only case where supersession means anything. */
  const sameCycle = saved.filter(
    (entry) =>
      incoming.examCycle !== null &&
      entry.examCycle !== null &&
      entry.examCycle.toLowerCase() === incoming.examCycle.toLowerCase(),
  );
  const existing = sameCycle[sameCycle.length - 1];
  if (existing === undefined) return { kind: 'new' };

  const rank = (state: string | null) =>
    state === null ? 0 : state === 'draft' || state === 'provisional' ? 1 : 2;
  return {
    kind: 'revision',
    existing,
    supersedes: rank(incoming.publicationState) > rank(existing.publicationState),
  };
}

/* -------------------------------------------------------------------------- */
/* Whose exam is it                                                           */
/* -------------------------------------------------------------------------- */

/** What the student is, as far as an exam timetable is concerned. */
export interface ExamAudience {
  /** The scheme the student is enrolled under: "2022". */
  readonly scheme: string | null;
  readonly semester: number | null;
  /** Codes the student is taking now. */
  readonly enrolled: readonly string[];
  /** Codes they still owe from an earlier semester. */
  readonly backlog: readonly string[];
}

export type ExamRelevance =
  /** The column is this student's, and the course is one of theirs. */
  | 'enrolled'
  /** The column is this student's, and the course is one they still owe. */
  | 'backlog'
  /** The column is this student's; which course the cell means is not stated. */
  | 'unresolved'
  /** The column belongs to another scheme or another semester. */
  | 'not_applicable';

/**
 * Whether one exam is this student's, and on what evidence.
 *
 * ---------------------------------------------------------------------------
 * THE COLUMN DECIDES, THEN THE CODE
 * ---------------------------------------------------------------------------
 *
 * Scheme and semester come from the column the exam was printed in, and they
 * are checked FIRST: a Semester III paper is not this student's business
 * however familiar its code looks. Only then does the course matter.
 *
 * Matching is exact and nothing else (§16). A pattern like `B**301` names no
 * course, so an exam in the student's own column whose cell is a pattern comes
 * back `unresolved` — visible, honestly unidentified, and never quietly
 * dropped or quietly resolved. That is the state §18 asks to be distinguished
 * from "no exam", and the two are not allowed to look the same.
 */
export function examRelevance(event: ExamEventReading, audience: ExamAudience): ExamRelevance {
  /* A column that names a scheme the student is not under is not theirs. */
  if (event.scheme !== null && audience.scheme !== null && event.scheme !== audience.scheme) {
    return 'not_applicable';
  }
  if (
    event.semester !== null &&
    audience.semester !== null &&
    event.semester !== audience.semester
  ) {
    /*
     * An earlier semester can still be theirs — a backlog paper is sat with
     * the juniors — but only when they actually owe one of its courses.
     */
    const owed = event.codes.some((code) => audience.backlog.includes(code));
    return owed ? 'backlog' : 'not_applicable';
  }

  if (event.codes.some((code) => audience.enrolled.includes(code))) return 'enrolled';
  if (event.codes.some((code) => audience.backlog.includes(code))) return 'backlog';

  /*
   * Their column, and the cell names no course this student holds. That is
   * either a course they are not taking or a cell nobody can resolve, and the
   * two are told apart by whether it named anything at all.
   */
  return event.codes.length === 0 ? 'unresolved' : 'not_applicable';
}
