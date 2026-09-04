/**
 * Reading a college class timetable, which is a GRID rather than a list.
 *
 * Authority: docs/08 §8.22 · M10A.8 §5, §12–§28
 *
 * ---------------------------------------------------------------------------
 * WHY THIS CANNOT BE READ AS LINES
 * ---------------------------------------------------------------------------
 *
 * A result card and an academic calendar are lists: one printed row is one
 * record, so joining words into lines is enough. A timetable is two-
 * dimensional. "MAT" means nothing until you know which COLUMN it sits in, and
 * the column is a time of day printed once, in a header, far above it.
 *
 * So this reads positions. Columns come from the header's own time slots and
 * rows from the day names, and every cell is placed by where its box actually
 * is. Nothing about the layout is assumed: the slots are whatever the document
 * printed, in whatever order and however many (§18).
 *
 * ---------------------------------------------------------------------------
 * THE DOCUMENT DEFINES ITS OWN VOCABULARY
 * ---------------------------------------------------------------------------
 *
 * The grid says `MAT`. Only the subject table at the foot of the same page says
 * that `MAT` is `BQATS101`. There is no global truth about what `MAT` means —
 * a different college's timetable may use it for something else — so initials
 * are resolved through THAT DOCUMENT'S dictionary and through nothing else
 * (§20). A cell whose initials the document never defines is reported, not
 * guessed at.
 *
 * Identity is then the code, exactly as M10A.1 requires: the timetable's own
 * wording of a title is kept as source, and never used to match anything (§21,
 * §22).
 *
 * ---------------------------------------------------------------------------
 * A CELL IS NOT ALWAYS ONE CLASS
 * ---------------------------------------------------------------------------
 *
 * `PHYE1/POPE2` is two classes that happen at the same time for different
 * halves of the class. Storing it as a subject called "PHYE1/POPE2" would
 * invent a course nobody teaches, and picking one half would put a student in
 * the wrong room (§23).
 *
 * A lab may run across several columns, and it is ONE class from the start of
 * the first to the end of the last — not three disconnected forty-minute
 * classes (§25).
 */

import type { PositionedText } from './pdf-layout.js';
import { subjectKey } from './subjects.js';
import { WEEKDAYS, type Weekday } from './types.js';

/** Positioned text with the page it came from. */
export interface PlacedLike extends PositionedText {
  readonly page: number;
}

/** One column of the grid: a time of day the document printed. */
export interface TimeSlot {
  /** 24-hour `HH:MM`. */
  readonly start: string;
  readonly end: string;
  /** Where the column sits, so cells can be placed in it. */
  readonly left: number;
  readonly right: number;
  /** True for a break or lunch column, which is not a class (§19). */
  readonly isBreak: boolean;
}

/** One row of the subject table at the foot of the page. */
export interface DictionaryEntry {
  readonly subjectCode: string;
  /** The timetable's own wording. Source, never used to match (§22). */
  readonly title: string;
  /** `MAT`. What the grid actually contains. */
  readonly initials: string;
  readonly faculty: string | null;
  /** As the college teaches it, e.g. `3+0+2`. */
  readonly collegeHours: string | null;
  /** As the scheme prescribes it. A DIFFERENT number, kept apart (§27). */
  readonly schemeHours: string | null;
}

/** One class the grid describes, before a batch has been chosen. */
export interface GridClass {
  readonly day: Weekday;
  readonly start: string;
  readonly end: string;
  /** Resolved through the document's dictionary. Null when it could not be. */
  readonly subjectCode: string | null;
  /** What the cell actually said, always. */
  readonly initials: string;
  /**
   * Which half of the class this is for, e.g. `E1`. Null when it is for all.
   *
   * A cell reading `PHYE1/POPE2` produces TWO of these, one per batch — never
   * one class with a made-up name (§23).
   */
  readonly batch: string | null;
  readonly room: string | null;
  /** True when the cell ran across more than one column (§25). */
  readonly spansSlots: number;
  readonly sourceText: string;
}

export interface TimetableContext {
  readonly className: string | null;
  readonly semester: number | null;
  readonly academicYear: string | null;
  /** `R1`, `R2`. Null when the document did not label one. */
  readonly revision: string | null;
  /** ISO, from the printed W.E.F. and from nothing else (§14). */
  readonly effectiveFrom: string | null;
  readonly room: string | null;
}

export interface TimetableConflict {
  readonly day: Weekday;
  readonly start: string;
  readonly batch: string | null;
  readonly initials: readonly string[];
}

export interface ParsedTimetable {
  readonly context: TimetableContext;
  readonly slots: readonly TimeSlot[];
  readonly dictionary: readonly DictionaryEntry[];
  readonly classes: readonly GridClass[];
  /** Batches the grid mentions, e.g. `['E1', 'E2']`. Empty when it has none. */
  readonly batches: readonly string[];
  readonly conflicts: readonly TimetableConflict[];
  readonly warnings: readonly string[];
}

/* -------------------------------------------------------------------------- */
/* Times                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * `10:00-10:55am`, `11:50-12.10pm`, `03:10- 04:05pm`.
 *
 * The separator may be a colon or a full stop — the reference document uses
 * both, sometimes in the same header — and the meridiem may appear once at the
 * end, on each half, or not at all.
 */
const SLOT = /(\d{1,2})[:.](\d{2})\s*(am|pm)?\s*[-–—]\s*(\d{1,2})[:.](\d{2})\s*(am|pm)?/i;

/**
 * A college timetable's hours, as a 24-hour clock.
 *
 * WITHOUT A MERIDIEM, THE COLLEGE DAY DECIDES. A timetable printing `1:05` and
 * `04:05` means the afternoon: teaching runs from the morning into the evening,
 * and no college starts a class at one in the morning. Hours below 8 are read
 * as afternoon, which is the rule the document's own day implies rather than a
 * guess about a particular college.
 */
function toClock(hour: number, minute: number, meridiem: string | undefined): string | null {
  if (minute > 59 || hour > 23) return null;
  let h = hour;
  const marker = meridiem?.toLowerCase();
  if (marker === 'pm' && h < 12) h += 12;
  else if (marker === 'am' && h === 12) h = 0;
  else if (marker === undefined && h < 8) h += 12;
  if (h > 23) return null;
  return `${String(h).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

/**
 * The time range a header cell describes, or null when it is not one.
 *
 * THE END TELLS THE START WHICH HALF OF THE DAY IT IS IN, but it does not lend
 * it its own marker. `11:50-12.10pm` runs from ten to twelve in the MORNING to
 * ten past twelve; copying the `pm` onto the start makes it ten to midnight and
 * the range collapses. `1:05-02:00pm` genuinely does start in the afternoon.
 *
 * What distinguishes them is not the marker but the ORDER: a printed range runs
 * forwards. So an unmarked start takes whichever reading lands before the end
 * and nearest to it, and a range with no such reading is not a range.
 */
export function readSlot(text: string): { start: string; end: string } | null {
  const match = SLOT.exec(text.replace(/\s+/g, ' '));
  if (match === null) return null;

  const end = toClock(Number(match[4]), Number(match[5]), match[6]);
  if (end === null) return null;

  const startHour = Number(match[1]);
  const startMinute = Number(match[2]);
  const marked = match[3];

  if (marked !== undefined) {
    const start = toClock(startHour, startMinute, marked);
    return start !== null && start < end ? { start, end } : null;
  }

  const candidates = [toClock(startHour, startMinute, 'am'), toClock(startHour, startMinute, 'pm')]
    .filter((value): value is string => value !== null && value < end)
    /* Nearest to the end: the same morning or the same afternoon, not yesterday. */
    .sort((a, b) => b.localeCompare(a));

  const start = candidates[0];
  return start === undefined ? null : { start, end };
}

/* -------------------------------------------------------------------------- */
/* Reading the page                                                           */
/* -------------------------------------------------------------------------- */

/** Groups placed text into rows by vertical position. */
function rowsOf(items: readonly PlacedLike[], tolerance: number): PlacedLike[][] {
  const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x);
  const rows: PlacedLike[][] = [];
  for (const item of sorted) {
    const current = rows[rows.length - 1];
    const anchor = current?.[0];
    if (current !== undefined && anchor !== undefined && Math.abs(anchor.y - item.y) <= tolerance) {
      current.push(item);
    } else {
      rows.push([item]);
    }
  }
  return rows.map((row) => [...row].sort((a, b) => a.x - b.x));
}

function medianHeight(items: readonly PlacedLike[]): number {
  const heights = items.map((item) => item.height).filter((h) => h > 0).sort((a, b) => a - b);
  return heights.length === 0 ? 10 : (heights[Math.floor(heights.length / 2)] as number);
}

/**
 * The day names a timetable prints, mapped to the product's own weekday.
 *
 * Sunday is deliberately absent: `Weekday` does not have one, because the
 * college week these documents describe does not either.
 */
const DAY_NAMES: Record<string, Weekday> = {
  monday: 'Mon',
  mon: 'Mon',
  tuesday: 'Tue',
  tue: 'Tue',
  tues: 'Tue',
  wednesday: 'Wed',
  wed: 'Wed',
  thursday: 'Thu',
  thu: 'Thu',
  thur: 'Thu',
  thurs: 'Thu',
  friday: 'Fri',
  fri: 'Fri',
  saturday: 'Sat',
  sat: 'Sat',
};

/** A cell that marks time passing rather than a class (§19). */
const BREAK_CELL = /^(lunch|break|recess|lunch\s*break|interval)$/i;

/** `PHYE1/POPE2` — two classes, one per half of the class group (§23). */
const SPLIT_CELL = /^([A-Z]{2,6})\s*(E\d|B\d)\s*\/\s*([A-Z]{2,6})\s*(E\d|B\d)$/i;

/** `MAT LAB(E1+E2)` — one lab, for the batches named. */
const LAB_CELL = /^([A-Z]{2,6})\s*LAB\s*\(([^)]*)\)$/i;

/* -------------------------------------------------------------------------- */
/* The document's own vocabulary                                              */
/* -------------------------------------------------------------------------- */

/** A VTU course code, the same shape the result importer accepts. */
const COURSE_CODE = /\b(1?B[A-Z]{2,6}\d{3}[A-Z]?)\b/;
/** `2+2+2`, `3 +0+ 2`. */
const HOURS = /\b(\d)\s*\+\s*(\d)\s*\+\s*(\d)\b/g;

/**
 * The subject table at the foot of the page.
 *
 * Read row by row from the joined text, because each row is a list and lines
 * are enough for a list. The GRID needs positions; this does not.
 */
export function readDictionary(rows: readonly string[]): DictionaryEntry[] {
  const entries: DictionaryEntry[] = [];

  for (const row of rows) {
    const code = COURSE_CODE.exec(row)?.[1];
    if (code === undefined) continue;

    const after = row.slice(row.indexOf(code) + code.length);

    /*
     * The initials are the only ALL-CAPS short token on the row that is not the
     * code and not a number. Anchoring on shape rather than on column position
     * survives a row whose columns the reader merged.
     */
    const initials = (after.match(/\b[A-Z]{2,6}\b/g) ?? []).find(
      (token) => !COURSE_CODE.test(token) && !/^(LAB|VTU|CSE|ECE|ISE|AIML|CSBS)$/i.test(token),
    );
    if (initials === undefined) continue;

    const title = after.slice(0, after.indexOf(initials)).replace(/\s+/g, ' ').trim();

    /*
     * TWO WORKLOADS, KEPT APART (§27). A row prints what the college teaches
     * and what the scheme prescribes, and they differ — 3+0+2 against 2+0+2.
     * Collapsing them would lose the fact that they disagree.
     */
    const hours = [...after.matchAll(HOURS)].map((match) => match[0].replace(/\s+/g, ''));

    const faculty = /\b(?:prof|dr|adv|mr|ms|mrs)\.?\s+[A-Za-z][A-Za-z. ]{1,40}/i.exec(after)?.[0];

    entries.push({
      subjectCode: subjectKey(code),
      title,
      initials: initials.toUpperCase(),
      faculty: faculty?.replace(/\s+/g, ' ').trim() ?? null,
      collegeHours: hours[0] ?? null,
      schemeHours: hours[1] ?? null,
    });
  }

  return entries;
}

/* -------------------------------------------------------------------------- */
/* Context                                                                    */
/* -------------------------------------------------------------------------- */

/** `W.E.F: 07/11/2024`, `W.E.F 7-11-2024`. Never the upload date (§14). */
function readEffectiveFrom(text: string): string | null {
  const match = /w\.?\s*e\.?\s*f\.?\s*[:\s]\s*(\d{1,2})\s*[-/.]\s*(\d{1,2})\s*[-/.]\s*(\d{4})/i.exec(
    text,
  );
  if (match === null) return null;
  const [, day, month, year] = match as unknown as [string, string, string, string];
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  if (date.getUTCMonth() !== Number(month) - 1 || date.getUTCDate() !== Number(day)) return null;
  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
}

function readContext(text: string): TimetableContext {
  const semesterMatch =
    /\bsemester\s*[:\-–]?\s*([1-8])\b/i.exec(text) ??
    /\bsemester\s*[:\-–]?\s*([IVX]{1,4})\b/i.exec(text);
  const roman: Record<string, number> = { i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8 };
  const rawSemester = semesterMatch?.[1] ?? '';
  const semester = /^\d$/.test(rawSemester)
    ? Number(rawSemester)
    : (roman[rawSemester.toLowerCase()] ?? null);

  const year = /\b(20\d{2})\s*[-–—/]\s*((?:20)?\d{2})\b/.exec(text);
  const academicYear =
    year === null
      ? null
      : (() => {
          const start = year[1] as string;
          const tail = year[2] as string;
          const end = tail.length === 2 ? `20${tail}` : tail;
          return Number(end) === Number(start) + 1 ? `${start}-${end.slice(2)}` : null;
        })();

  return {
    className: /\bclass\s*[:\-–]\s*([^\n]{1,40})/i.exec(text)?.[1]?.trim() ?? null,
    semester,
    academicYear,
    /* `TIME-TABLE (R2)`. The label the document gave its own revision (§13). */
    revision: /time\s*-?\s*table\s*\(\s*(R\d)\s*\)/i.exec(text)?.[1]?.toUpperCase() ?? null,
    effectiveFrom: readEffectiveFrom(text),
    room: /\broom\s*(?:no\.?)?\s*[:\-–]?\s*([A-Z]?\d{2,4}[A-Z]?)\b/i.exec(text)?.[1] ?? null,
  };
}

/* -------------------------------------------------------------------------- */
/* The grid                                                                   */
/* -------------------------------------------------------------------------- */

/** Which column a cell sits in: the slot its centre falls inside, or nearest. */
function slotAt(slots: readonly TimeSlot[], left: number, right: number): number {
  const centre = (left + right) / 2;
  const inside = slots.findIndex((slot) => centre >= slot.left && centre <= slot.right);
  if (inside !== -1) return inside;

  let best = -1;
  let distance = Infinity;
  slots.forEach((slot, index) => {
    const gap = Math.min(Math.abs(centre - slot.left), Math.abs(centre - slot.right));
    if (gap < distance) {
      distance = gap;
      best = index;
    }
  });
  return best;
}

/**
 * The whole document.
 *
 * `placed` is the shared extraction's output — a PDF's own text runs or OCR's
 * words, already normalised to the same coordinate convention. This does not
 * know or care which it was given (§8).
 */
export function parseTimetable(placed: readonly PlacedLike[]): ParsedTimetable {
  const warnings: string[] = [];
  if (placed.length === 0) {
    return {
      context: {
        className: null,
        semester: null,
        academicYear: null,
        revision: null,
        effectiveFrom: null,
        room: null,
      },
      slots: [],
      dictionary: [],
      classes: [],
      batches: [],
      conflicts: [],
      warnings: ['Nothing could be read from this document.'],
    };
  }

  const tolerance = medianHeight(placed) * 0.6;
  const rows = rowsOf(placed, tolerance);
  const rowText = rows.map((row) => row.map((item) => item.text).join(' ').replace(/\s+/g, ' ').trim());
  const joined = rowText.join('\n');

  const context = readContext(joined);
  const dictionary = readDictionary(rowText);

  /*
   * THE COLUMNS COME FROM THE HEADER, and the header is whichever row holds the
   * most time ranges. Finding it by content rather than by position means a
   * document with a logo, a title block or a stamp above the grid still works
   * (§18).
   */
  let headerIndex = -1;
  let headerSlots: TimeSlot[] = [];
  rows.forEach((row, index) => {
    const found: TimeSlot[] = [];
    /*
     * A header cell may be split across several runs — `10:00 -` then
     * `10:55am` — so neighbouring runs are joined before being read, and the
     * column's extent is the extent of everything that made it up.
     */
    for (let i = 0; i < row.length; i += 1) {
      for (let span = 1; span <= 3 && i + span <= row.length; span += 1) {
        const group = row.slice(i, i + span);
        const text = group.map((item) => item.text).join(' ');
        const slot = readSlot(text);
        if (slot === null) continue;
        const left = Math.min(...group.map((item) => item.x));
        const right = Math.max(...group.map((item) => item.x + item.width));
        found.push({ ...slot, left, right, isBreak: false });
        i += span - 1;
        break;
      }
    }
    if (found.length > headerSlots.length) {
      headerSlots = found;
      headerIndex = index;
    }
  });

  if (headerSlots.length < 2) {
    return {
      context,
      slots: [],
      dictionary,
      classes: [],
      batches: [],
      conflicts: [],
      warnings: ['The times along the top of this timetable could not be read.'],
    };
  }

  const slots = [...headerSlots].sort((a, b) => a.left - b.left);

  /*
   * COLUMNS ARE WIDENED TO MEET EACH OTHER. A header's printed text is narrower
   * than the column it labels, so a cell sitting under the middle of a column
   * can fall outside the header's own box. Splitting the gap between
   * neighbours puts every cell in exactly one column.
   */
  const bounded: TimeSlot[] = slots.map((slot, index) => {
    const previous = slots[index - 1];
    const next = slots[index + 1];
    return {
      ...slot,
      left: previous === undefined ? slot.left - 40 : (previous.right + slot.left) / 2,
      right: next === undefined ? slot.right + 40 : (slot.right + next.left) / 2,
    };
  });

  /* Which columns are breaks: a day row puts "BREAK" or "LUNCH" in them. */
  const breakColumns = new Set<number>();
  const classes: GridClass[] = [];
  const batches = new Set<string>();

  for (let index = headerIndex + 1; index < rows.length; index += 1) {
    const row = rows[index] as PlacedLike[];
    const firstText = (row[0]?.text ?? '').replace(/[^A-Za-z]/g, '').toLowerCase();
    const day = DAY_NAMES[firstText];
    if (day === undefined) continue;

    /*
     * Cells are neighbouring runs inside one column. A cell like `MAT LAB(E1+E2)`
     * arrives as several runs and must be read as one, so runs are grouped by
     * the column their centre falls in.
     */
    const byColumn = new Map<number, PlacedLike[]>();
    for (const item of row.slice(1)) {
      const column = slotAt(bounded, item.x, item.x + item.width);
      if (column < 0) continue;
      const bucket = byColumn.get(column) ?? [];
      bucket.push(item);
      byColumn.set(column, bucket);
    }

    for (const [column, items] of byColumn) {
      const text = items
        .map((item) => item.text)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
      if (text === '' || /^[-–—.]+$/.test(text)) continue;

      if (BREAK_CELL.test(text)) {
        breakColumns.add(column);
        continue;
      }

      const slot = bounded[column];
      if (slot === undefined) continue;

      /*
       * HOW FAR THE CELL REACHES. A lab written once across three columns is
       * one class from the first column's start to the last column's end, not
       * three unrelated ones (§25).
       */
      const right = Math.max(...items.map((item) => item.x + item.width));
      const lastColumn = slotAt(bounded, right - 1, right);
      const span = Math.max(1, lastColumn - column + 1);
      const end = (bounded[Math.min(lastColumn, bounded.length - 1)] ?? slot).end;

      const push = (initials: string, batch: string | null, room: string | null) => {
        const entry = dictionary.find(
          (candidate) => candidate.initials === initials.toUpperCase(),
        );
        if (batch !== null) batches.add(batch.toUpperCase());
        classes.push({
          day,
          start: slot.start,
          end,
          subjectCode: entry?.subjectCode ?? null,
          initials: initials.toUpperCase(),
          batch: batch?.toUpperCase() ?? null,
          room,
          spansSlots: span,
          sourceText: text,
        });
      };

      const split = SPLIT_CELL.exec(text);
      if (split !== null) {
        /* Two classes at one time, one per half of the group (§23). */
        push(split[1] as string, split[2] as string, null);
        push(split[3] as string, split[4] as string, null);
        continue;
      }

      const lab = LAB_CELL.exec(text);
      if (lab !== null) {
        const named = (lab[2] ?? '').split(/[+,/]/).map((part) => part.trim()).filter(Boolean);
        if (named.length === 0) push(lab[1] as string, null, null);
        else for (const batch of named) push(lab[1] as string, batch, null);
        continue;
      }

      const plain = /^([A-Z]{2,6})$/i.exec(text);
      if (plain !== null) {
        push(plain[1] as string, null, null);
        continue;
      }

      /*
       * A cell that is neither empty, a break, a split, a lab nor plain
       * initials. Kept with a null code so the review can show it rather than
       * dropping a class in silence.
       */
      classes.push({
        day,
        start: slot.start,
        end,
        subjectCode: null,
        initials: text.slice(0, 20),
        batch: null,
        room: null,
        spansSlots: span,
        sourceText: text,
      });
    }
  }

  const withBreaks = bounded.map((slot, index) => ({ ...slot, isBreak: breakColumns.has(index) }));
  const teaching = classes.filter((entry) => {
    const column = withBreaks.findIndex((slot) => slot.start === entry.start);
    return column === -1 || !withBreaks[column]?.isBreak;
  });

  /*
   * TWO CLASSES IN ONE PLACE ARE SHOWN, NEVER RESOLVED (§17). Different batches
   * at the same hour are not a conflict — that is the whole point of a split
   * cell — so a clash counts only within one batch.
   */
  const conflicts: TimetableConflict[] = [];
  const seen = new Map<string, GridClass[]>();
  for (const entry of teaching) {
    const key = `${entry.day}|${entry.start}|${entry.batch ?? '*'}`;
    const bucket = seen.get(key) ?? [];
    bucket.push(entry);
    seen.set(key, bucket);
  }
  for (const [key, bucket] of seen) {
    if (bucket.length < 2) continue;
    const [day, start, batch] = key.split('|') as [Weekday, string, string];
    conflicts.push({
      day,
      start,
      batch: batch === '*' ? null : batch,
      initials: bucket.map((entry) => entry.initials),
    });
  }

  if (dictionary.length === 0) {
    warnings.push('The subject table on this timetable could not be read, so the initials in the grid cannot be matched to subject codes.');
  }
  const unresolved = teaching.filter((entry) => entry.subjectCode === null);
  if (unresolved.length > 0 && dictionary.length > 0) {
    warnings.push(
      `${String(unresolved.length)} ${unresolved.length === 1 ? 'class uses initials this' : 'classes use initials this'} timetable never defines. Check them before saving.`,
    );
  }
  if (context.effectiveFrom === null) {
    warnings.push('This timetable does not print an effective date (W.E.F.).');
  }
  if (conflicts.length > 0) {
    warnings.push(
      `${String(conflicts.length)} ${conflicts.length === 1 ? 'time has' : 'times have'} more than one class. Check them against the printed timetable.`,
    );
  }

  return {
    context,
    slots: withBreaks,
    dictionary,
    classes: teaching,
    batches: [...batches].sort(),
    conflicts,
    warnings,
  };
}

/* -------------------------------------------------------------------------- */
/* Becoming the student's week                                                */
/* -------------------------------------------------------------------------- */

/**
 * The classes that apply to one student, as ordinary timetable slots.
 *
 * The batch is resolved HERE, once, and what gets stored is the existing
 * `TimetableSlot` — so the day view, the week view and attendance all keep
 * working with no knowledge that a document was involved (§32, §33).
 *
 * A class with no batch is everybody's. A class with one belongs to that batch
 * alone, and passing no batch keeps only the shared classes — which is the
 * honest answer while the student has not said which half they are in (§23).
 */
export function slotsForBatch(
  parsed: ParsedTimetable,
  batch: string | null,
  profileId: string,
  makeId: () => string,
): Array<{
  id: string;
  profileId: string;
  day: Weekday;
  startTime: string;
  endTime: string;
  subjectCode: string;
  room: string | null;
  faculty: string | null;
}> {
  return parsed.classes
    .filter((entry) => entry.subjectCode !== null)
    .filter((entry) => entry.batch === null || entry.batch === batch?.toUpperCase())
    .map((entry) => {
      const definition = parsed.dictionary.find(
        (candidate) => candidate.subjectCode === entry.subjectCode,
      );
      return {
        id: makeId(),
        profileId,
        day: entry.day,
        startTime: entry.start,
        endTime: entry.end,
        subjectCode: entry.subjectCode as string,
        room: entry.room ?? parsed.context.room,
        /* Present only where the document named one. Never inferred (§26). */
        faculty: definition?.faculty ?? null,
      };
    });
}

/** Whether the student must say which batch they are in before saving (§23). */
export function needsBatch(parsed: ParsedTimetable): boolean {
  return parsed.batches.length > 0;
}

/* -------------------------------------------------------------------------- */
/* One active timetable                                                       */
/* -------------------------------------------------------------------------- */

/** What was imported, kept so a revision can be recognised as one (§13). */
export interface SavedTimetable {
  readonly id: string;
  readonly className: string | null;
  readonly semester: number | null;
  readonly academicYear: string | null;
  readonly revision: string | null;
  readonly effectiveFrom: string | null;
  readonly batch: string | null;
  readonly fingerprint: string;
  readonly importedAt: string;
  readonly slotCount: number;
}

export type TimetableRelation =
  | { readonly kind: 'new' }
  | { readonly kind: 'duplicate'; readonly existing: SavedTimetable }
  | {
      readonly kind: 'revision';
      readonly existing: SavedTimetable;
      /** False when the incoming one takes effect BEFORE what is already active. */
      readonly supersedes: boolean;
    };

/**
 * How an incoming timetable relates to the one already active.
 *
 * A REVISION supersedes by its printed effective date, not by upload order: a
 * student who uploads last term's R1 after this term's R2 has not gone back in
 * time, and treating the latest upload as the truth would put stale classes on
 * their Monday (§14, §16).
 */
export function relateTimetable(
  incoming: { fingerprint: string; className: string | null; effectiveFrom: string | null },
  saved: readonly SavedTimetable[],
): TimetableRelation {
  const same = saved.find((candidate) => candidate.fingerprint === incoming.fingerprint);
  if (same !== undefined) return { kind: 'duplicate', existing: same };

  const sameClass = saved.filter((candidate) => candidate.className === incoming.className);
  if (sameClass.length === 0) return { kind: 'new' };

  /* The one currently in force: the latest effective date already saved. */
  const active = [...sameClass].sort((a, b) =>
    (b.effectiveFrom ?? '').localeCompare(a.effectiveFrom ?? ''),
  )[0] as SavedTimetable;

  return {
    kind: 'revision',
    existing: active,
    supersedes:
      incoming.effectiveFrom === null || active.effectiveFrom === null
        ? true
        : incoming.effectiveFrom >= active.effectiveFrom,
  };
}

/** Whether a day is one this document could describe. */
export function isWeekday(value: string): value is Weekday {
  return (WEEKDAYS as readonly string[]).includes(value);
}
