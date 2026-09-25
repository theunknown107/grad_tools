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
  /**
   * `MAT`. What the grid actually contains — when the table PRINTS it.
   *
   * Null is the common case on a real document. The Semester 5 table's own
   * header reads "Subject code – Initials – Name" and then not one row fills
   * the initials column in, so the grid's abbreviations appear nowhere in the
   * table. Where that happens the abbreviation is derived from the TITLE
   * instead — see `initialismsFor` — and this stays null rather than being
   * filled with the first all-caps word of the title, which is what the
   * previous heuristic did: it read `IPR` out of "Research Methodology and IPR"
   * and declared it that subject's abbreviation.
   */
  readonly initials: string | null;
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
  /**
   * HOW it was resolved, or why it was not.
   *
   * Carried on every class so the review can distinguish "this is BCS502"
   * from "this could be either of two subjects" from "this timetable never
   * says what CN is". All three used to look identical — a null code.
   */
  readonly resolution: SubjectResolution;
  /** Null exactly when `subjectCode` is not. Shown to the student verbatim. */
  readonly unresolvedReason: string | null;
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
  /**
   * How much of the grid actually came back, so the screen can say so.
   *
   * A timetable read from a photograph can lose most of its columns and still
   * produce a handful of perfectly correct classes. Six right classes shown as
   * "your week" is worse than an honest refusal: it looks complete, and a
   * student would plan around the twenty-two that are missing (M10A.8.1 §26).
   */
  readonly coverage: TimetableCoverage;
  readonly warnings: readonly string[];
}

export interface TimetableCoverage {
  /** Cells the grid produced, whether or not their subject was identified. */
  readonly cellsFound: number;
  /** Of those, the ones with a subject code — the only ones that can be saved. */
  readonly cellsResolved: number;
  /** Time columns read from the header. */
  readonly slotsFound: number;
  readonly dictionaryEntries: number;
  /**
   * Whether this reading is complete enough to stand as a student's week.
   *
   * FALSE is not a failure to hide. It is the difference between "here is your
   * timetable" and "this is all that could be read from the picture", and only
   * one of those is true when half the columns are missing.
   */
  readonly looksComplete: boolean;
}

/* -------------------------------------------------------------------------- */
/* Times                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * `10:00-10:55am`, `11:50-12.10pm`, `03:10- 04:05pm`, `10:00 am to 10:55 am`.
 *
 * The separator may be a colon or a full stop — the reference document uses
 * both, sometimes in the same header — and the meridiem may appear once at the
 * end, on each half, or not at all.
 *
 * ---------------------------------------------------------------------------
 * TWO SHAPES ADDED AFTER A REAL TIMETABLE FAILED ON BOTH
 * ---------------------------------------------------------------------------
 *
 * `to` AS THE SEPARATOR. A timetable authored in Word routinely prints its
 * header as three stacked rows — the start times, a row of the word "to", and
 * the end times — so the column reads `10:00 am to 10:55 am` and never contains
 * a dash at all. Requiring `[-–—]` found no slot in any of the eight columns,
 * which failed the whole document with "the times could not be read". Both
 * forms are now accepted; neither is preferred.
 *
 * `p.m` AND `a.m.`. The same documents punctuate the meridiem, and sometimes
 * only on the last column of the row. An unmatched meridiem is not a small
 * loss: without it `4:05` falls to the `h < 8` afternoon rule, which happens to
 * be right, but `12:10 p.m` would be read with no marker at all.
 *
 * Neither is a concession to one file. A dash, the word "to", and a punctuated
 * meridiem are the three ways every college timetable writes a time range, and
 * the parser previously handled one of them.
 */
const SLOT =
  /(\d{1,2})[:.](\d{2})\s*(a\.?m\.?|p\.?m\.?)?\s*(?:[-–—]|to)\s*(\d{1,2})[:.](\d{2})\s*(a\.?m\.?|p\.?m\.?)?/i;

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
  /* `p.m.`, `p.m` and `pm` are one marker written three ways. */
  const marker = meridiem?.toLowerCase().replace(/\./g, '');
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
  const heights = items
    .map((item) => item.height)
    .filter((h) => h > 0)
    .sort((a, b) => a - b);
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

/**
 * `PHYE1/POPE2`, `CNL-B2/CSL-B1` — two classes, one per half of the group (§23).
 *
 * The batch may be joined to the initials or hyphenated to them. Both occur on
 * real timetables, and the hyphenated form is the one the Semester 5 document
 * uses for its lab rotation — with only `\s*` it matched neither of that
 * document's two lab cells, and the rotation that puts half the class in one
 * lab and half in the other was read as an unidentified blob.
 */
const SPLIT_CELL = /^([A-Z]{2,6})[\s-]*(E\d|B\d)[\s-]*\/[\s-]*([A-Z]{2,6})[\s-]*(E\d|B\d)$/i;

/**
 * `TOC-T` — an abbreviation with a component marker after it.
 *
 * A closed set: theory, practical, lab. Deliberately NOT "anything after a
 * hyphen", which would strip the batch off `CNL-B2` and put a whole class in
 * the wrong half of the group.
 */
const COMPONENT_SUFFIX = /^([A-Z]{2,6})-(T|P|L|TH|PR)$/i;

/** `MAT LAB(E1+E2)` — one lab, for the batches named. */
const LAB_CELL = /^([A-Z]{2,6})\s*LAB\s*\(([^)]*)\)$/i;

/* -------------------------------------------------------------------------- */
/* The document's own vocabulary                                              */
/* -------------------------------------------------------------------------- */

/** A VTU course code, the same shape the result importer accepts. */
const COURSE_CODE = /\b(1?B[A-Z]{2,6}\d{3}[A-Z]?)\b/;
/** The same, global: a name cell may list every code one subject is taken as. */
const COURSE_CODE_ALL = /\b1?B[A-Z]{2,6}\d{3}[A-Z]?\b/g;
/** `2+2+2`, `3 +0+ 2`. */
const HOURS = /\b(\d)\s*\+\s*(\d)\s*\+\s*(\d)\b/g;
/** `Prof. A B`, `Dr. C`. Where a subject table's title column stops. */
const FACULTY = /\b(?:prof|dr|adv|mr|ms|mrs)\s*\.?\s+[A-Za-z][A-Za-z. ]{1,40}/i;
/** The same, global, for stripping every occurrence from a row. */
const FACULTY_ALL = /\b(?:prof|dr|adv|mr|ms|mrs)\s*\.?\s+[A-Za-z][A-Za-z. ]{1,40}/gi;

/**
 * The subject table at the foot of the page.
 *
 * Read row by row from the joined text, because each row is a list and lines
 * are enough for a list. The GRID needs positions; this does not.
 */
export function readDictionary(
  rows: readonly string[],
  /**
   * What the caller knows about each row's LAYOUT, when it read one.
   *
   * `y` is where the row sits vertically, and is what tells a wrapped title
   * apart from the start of a DIFFERENT table further down the page — see the
   * block loop below. `runs` is the row's printed runs, left to right, which
   * is what says where one COLUMN of the table ends and the next begins — see
   * the name column below.
   *
   * Optional because the shape of the table is readable without either, and
   * a caller that has only lines gets exactly the behaviour it had before.
   */
  layout?: readonly { readonly y: number; readonly runs: readonly PlacedLike[] }[],
): DictionaryEntry[] {
  const entries: DictionaryEntry[] = [];

  /*
   * A ROW OF THE TABLE IS NOT A LINE OF THE PAGE.
   *
   * A subject whose title is too long for the column wraps, and the wrapped
   * halves come back as separate lines with the faculty and hours interleaved
   * between them:
   *
   *     BXX515A Marketing Research & Marketing
   *     Prof. A B 3+0+0 3 +0+0
   *     Management
   *
   * Reading line by line took the title as "Marketing Research & Marketing" and
   * lost the word that makes its abbreviation MRMM rather than MRM. So a row
   * begins at a course code and continues until the next one.
   */
  /*
   * AND A TABLE IS NOT THE REST OF THE PAGE.
   *
   * Continuing a block until the next course code is right inside the table and
   * catastrophic at the end of it: the last subject swallowed every remaining
   * line of the real document — the lab batch ranges, the coordinator table,
   * two rows of signatures — into its title.
   *
   * What separates the table from what follows it is SPACE. A wrapped title
   * sits on the next printed line; a new section starts after a gap. So a block
   * stops accepting continuations when the vertical step to the next line is
   * much larger than the steps within the table. With no positions supplied the
   * old behaviour stands, which is what the line-only callers still get.
   */
  const steps: number[] = [];
  if (layout !== undefined) {
    for (let index = 1; index < layout.length; index += 1) {
      const step = (layout[index - 1]?.y ?? 0) - (layout[index]?.y ?? 0);
      if (step > 0) steps.push(step);
    }
  }
  const sortedSteps = [...steps].sort((a, b) => a - b);
  const medianStep =
    sortedSteps.length === 0 ? 0 : (sortedSteps[Math.floor(sortedSteps.length / 2)] as number);
  const sectionBreak = (index: number) => {
    if (layout === undefined || medianStep === 0 || index === 0) return false;
    const step = (layout[index - 1]?.y ?? 0) - (layout[index]?.y ?? 0);
    return step > medianStep * 1.8;
  };

  const blocks: number[][] = [];
  let open = false;
  rows.forEach((row, index) => {
    if (COURSE_CODE.test(row)) {
      blocks.push([index]);
      open = true;
      return;
    }
    if (!open) return;
    if (sectionBreak(index)) {
      open = false;
      return;
    }
    blocks[blocks.length - 1]?.push(index);
  });

  /*
   * THE NAME COLUMN IS A COLUMN TOO.
   *
   * A row of this table is `code + name | faculty | hours | hours | staff`,
   * and reading it as one flattened line meant the title had to be told apart
   * from the faculty by what the faculty LOOKS like — a `Prof.` or a `Dr.`
   * ahead of it. The real Semester 5 table has two rows whose faculty is not
   * yet appointed and is printed as the words "New Faculty", which no such
   * rule can catch: BCB586's title came back "Mini project New Faculty" and
   * BNSK559's "... Value added Course New Faculty", and a grid cell reading
   * "Mini project" then matched neither.
   *
   * Where the caller read the page's columns, the title is taken from the
   * row's first one and the faculty cannot reach it at all. Where it did not,
   * the whole line is used and `stripAdmin` below does the old job.
   */
  const nameStarts = blocks
    .map((block) => layout?.[block[0] as number]?.runs?.[1]?.x)
    .filter((x): x is number => x !== undefined);
  const nameRight = nameStarts.length === 0 ? Infinity : Math.min(...nameStarts);

  const nameColumn = (index: number) => {
    const runs = layout?.[index]?.runs;
    if (runs === undefined) return rows[index] ?? '';
    return runs
      .filter((run) => run.x < nameRight)
      .map((run) => run.text)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
  };

  /*
   * THE INITIALS COLUMN IS A COLUMN, NOT A TOKEN.
   *
   * It was read per row as "the first short all-caps word after the code",
   * which reads the reference document's `code title INITIALS faculty hours`
   * correctly and cannot tell a declared abbreviation from an ordinary word
   * inside a title. On the real Semester 5 table exactly one row trips it —
   * `BRMK557 Research Methodology and IPR` — and the title was then cut at the
   * word it found: "Research Methodology and", with IPR taken for the
   * abbreviation and the last word of the title lost.
   *
   * A column a document fills in is filled in THROUGHOUT. So the candidate is
   * still read per row, and then kept only if the table as a whole fills that
   * column. A table that leaves it empty gets titles that run to the end; a
   * table that fills it reads exactly as it did before.
   */
  const candidateFor = (head: string, code: string): string | null => {
    const after = head.slice(head.indexOf(code) + code.length);
    return (
      (after.match(/\b[A-Z]{2,6}\b/g) ?? []).find(
        (token) => !COURSE_CODE.test(token) && !/^(LAB|VTU|CSE|ECE|ISE|AIML|CSBS)$/i.test(token),
      ) ?? null
    );
  };

  const coded = blocks
    .map((block) => {
      const head = rows[block[0] as number] ?? '';
      const code = COURSE_CODE.exec(head)?.[1];
      return code === undefined ? null : { block, head, code };
    })
    .filter((entry): entry is { block: number[]; head: string; code: string } => entry !== null);

  const filledRows = coded.filter((entry) => candidateFor(entry.head, entry.code) !== null).length;
  const columnIsFilled = coded.length > 0 && filledRows * 2 > coded.length;

  for (const { block, head, code } of coded) {
    const after = head.slice(head.indexOf(code) + code.length);
    const declared = columnIsFilled ? candidateFor(head, code) : null;

    /*
     * THE TITLE IS WHAT IS LEFT WHEN THE ADMINISTRATION IS TAKEN OUT.
     *
     * Where a declared column exists the title ends at it, exactly as before.
     * Where none does, the faculty and the workload have to be removed
     * instead — and NOT by cutting at the faculty, which is wrong whenever a
     * wrapped title resumes after it:
     *
     *     Marketing Research & Marketing  Prof. A B  3+0+0 3+0+0  Management
     *
     * Cutting there gives "Marketing Research & Marketing" and loses the word
     * that makes the abbreviation MRMM rather than MRM. So the span from the
     * faculty to the LAST workload group is removed and both sides kept, then
     * any remaining name — the technical staff, printed after the hours — is
     * stripped too.
     */
    const stripAdmin = (text: string) => {
      let out = text;
      const facultyAt = FACULTY.exec(out)?.index;
      if (facultyAt !== undefined) {
        const groups = [...out.matchAll(HOURS)];
        const last = groups[groups.length - 1];
        const lastEnd = last === undefined ? -1 : (last.index ?? 0) + last[0].length;
        out =
          lastEnd > facultyAt
            ? `${out.slice(0, facultyAt)} ${out.slice(lastEnd)}`
            : out.slice(0, facultyAt);
      }
      return (
        out
          .replace(FACULTY_ALL, ' ')
          .replace(HOURS, ' ')
          /* A contact number printed in the same cell is not part of a title. */
          .replace(/\b\d{5,}\b/g, ' ')
          .replace(/\s+/g, ' ')
          .trim()
      );
    };

    /*
     * Where the document names no initials the title comes from the NAME
     * COLUMN, so nothing printed to its right can join it; where it does, the
     * title ends at the initials exactly as before and the column rule is not
     * needed. Continuation lines follow whichever of the two the head used.
     */
    const named = nameColumn(block[0] as number);
    const namedAfter = named.slice(named.indexOf(code) + (named.includes(code) ? code.length : 0));

    const titleParts =
      declared === null ? [stripAdmin(namedAfter)] : [after.slice(0, after.indexOf(declared))];
    for (const index of block.slice(1)) {
      titleParts.push(stripAdmin(declared === null ? nameColumn(index) : (rows[index] ?? '')));
    }

    const title = titleParts
      .filter((part) => part !== '')
      .join(' ')
      /*
       * `BNSK559/BPEK559/BYOK559 NSS/PE/YOGA ...` — one subject a student may
       * be enrolled in under any of three codes, and the other two are no more
       * part of its name than the first one is.
       */
      .replace(COURSE_CODE_ALL, ' ')
      .replace(/^[\s\-–—:/]+/, '')
      .replace(/\s+/g, ' ')
      .trim();

    /* The faculty and the workload are read from the WHOLE row, as before. */
    const joined = block.map((index) => rows[index] ?? '').join(' ');

    /*
     * TWO WORKLOADS, KEPT APART (§27). A row prints what the college teaches
     * and what the scheme prescribes, and they differ — 3+0+2 against 2+0+2.
     * Collapsing them would lose the fact that they disagree.
     */
    const hours = [...joined.matchAll(HOURS)].map((match) => match[0].replace(/\s+/g, ''));
    const faculty = FACULTY.exec(joined)?.[0];

    entries.push({
      subjectCode: subjectKey(code),
      title,
      initials: declared?.toUpperCase() ?? null,
      faculty: faculty?.replace(/\s+/g, ' ').trim() ?? null,
      collegeHours: hours[0] ?? null,
      schemeHours: hours[1] ?? null,
    });
  }

  return entries;
}

/* -------------------------------------------------------------------------- */
/* Abbreviations the table does not print                                     */
/* -------------------------------------------------------------------------- */

/**
 * Words a title's initialism may skip.
 *
 * Both readings are produced, because colleges write both: "Theory of
 * Computation" is TOC on this timetable and TC on another.
 */
const SKIPPABLE = new Set(['of', 'and', 'the', 'for', 'in', 'to', 'with', 'a', 'an', '&']);

/**
 * Every abbreviation a title could reasonably have been shortened to.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS
 * ---------------------------------------------------------------------------
 *
 * The grid says `CN`, `TOC`, `FM`, `CNL`, `RMIPR`. The subject table on the
 * same page prints a code and a title and — on the real Semester 5 document —
 * leaves its own "Initials" column entirely empty, despite the table's header
 * naming it. So the only relationship between the grid and the table is that
 * the abbreviation was built from the title, and reading it is the difference
 * between one subject resolved and most of them.
 *
 * ---------------------------------------------------------------------------
 * THIS IS NOT FUZZY MATCHING
 * ---------------------------------------------------------------------------
 *
 * It generates a small, closed set of candidates by a stated rule and then
 * demands an EXACT hit against one of them. There is no edit distance, no
 * prefix matching, no scoring, no "closest". `CNL` matches "Computer Networks
 * Lab" and nothing else; it does not nearly-match "Computer Networks", which
 * produces `CN`.
 *
 * The rules, all of them:
 *
 *   - a word contributes its first letter,
 *   - a word ALREADY IN CAPS in the title is an acronym and contributes whole,
 *     so "Research Methodology and IPR" can reach RMIPR,
 *   - a hyphenated word contributes each part, so "E-waste" gives E and W,
 *   - the joining words above are included in one candidate and skipped in
 *     another, because both spellings occur.
 *
 * At most two candidates per title, and a caller that accepts a match only when
 * exactly one subject in the document produces it.
 */
export function initialismsFor(title: string): readonly string[] {
  /*
   * A PARENTHETICAL IS A QUALIFIER, NOT PART OF THE NAME.
   *
   * "Computer Networks(T/L)" is abbreviated CN on the grid, not CNTL — the
   * bracket says the course has a theory and a lab component, which is a fact
   * about the course rather than a word in its title. Both readings are
   * produced, because a college that writes the bracket may also abbreviate it.
   */
  const bare = title.replace(/\([^)]*\)/g, ' ');
  return [...new Set([...candidatesFrom(title), ...candidatesFrom(bare)])];
}

function candidatesFrom(title: string): readonly string[] {
  const words = title
    .split(/[^A-Za-z0-9&-]+/)
    .flatMap((word) => word.split('-'))
    .filter((word) => word !== '');
  if (words.length === 0) return [];

  const build = (skipJoiners: boolean) => {
    let out = '';
    for (const word of words) {
      if (skipJoiners && SKIPPABLE.has(word.toLowerCase())) continue;
      /* An acronym already in the title is carried whole, not initialised. */
      out += word.length > 1 && word === word.toUpperCase() ? word : (word[0] as string);
    }
    return out.toUpperCase();
  };

  return [...new Set([build(true), build(false)])].filter((value) => value.length >= 2);
}

/** How a grid cell's subject came to be pinned to a code, or why it was not. */
export type SubjectResolution = 'declared' | 'initialism' | 'ambiguous' | 'unknown';

export interface ResolvedSubject {
  readonly subjectCode: string | null;
  readonly resolution: SubjectResolution;
  /** Shown to the student verbatim when nothing was resolved. Null when it was. */
  readonly reason: string | null;
}

/**
 * The subject a grid abbreviation names, or an honest account of why not.
 *
 * Order, and it is not negotiable:
 *
 *   1. THE DOCUMENT'S OWN DECLARATION. If the subject table printed an initials
 *      column, that is the answer and nothing else is consulted.
 *   2. A UNIQUE TITLE INITIALISM. Derived by `initialismsFor`, accepted only
 *      when exactly ONE subject in this document produces it.
 *   3. NOTHING. Two subjects producing the same abbreviation is `ambiguous` and
 *      says which two; none producing it is `unknown`. Neither invents a code,
 *      and the class is kept either way so a person can identify it themselves.
 */
export function resolveGridSubject(
  dictionary: readonly DictionaryEntry[],
  initials: string,
): ResolvedSubject {
  const wanted = initials.trim().toUpperCase();
  if (wanted === '') {
    return { subjectCode: null, resolution: 'unknown', reason: 'The cell is empty.' };
  }

  /*
   * THE CELL MAY SIMPLY BE THE NAME.
   *
   * A block the grid has room for is written out — the real document's
   * "Mini project" cell is the subject table's "Mini project" entry, printed
   * in full rather than shortened. Matched whole and case-insensitively: this
   * is an EQUALITY, not a resemblance, and a cell that merely contains or
   * nearly reads like a title still resolves to nothing (§29).
   */
  const spelled = dictionary.filter(
    (entry) => entry.title.replace(/\s+/g, ' ').trim().toUpperCase() === wanted,
  );
  if (spelled.length === 1) {
    return {
      subjectCode: (spelled[0] as DictionaryEntry).subjectCode,
      /* The document named it outright, which is as declared as a cell gets. */
      resolution: 'declared',
      reason: null,
    };
  }

  const declared = dictionary.filter((entry) => entry.initials === wanted);
  if (declared.length === 1) {
    return {
      subjectCode: (declared[0] as DictionaryEntry).subjectCode,
      resolution: 'declared',
      reason: null,
    };
  }

  /*
   * The declared token is ALSO tried as part of the title.
   *
   * "Research Methodology and IPR" has no initials column; `IPR` is a word of
   * the title that the column-detector cannot tell apart from an abbreviation,
   * so it is read as one and the title becomes "Research Methodology and". The
   * grid says RMIPR. Putting the token back gives the true title and the
   * candidate that matches it — without which the detector's ambiguity would
   * silently cost a subject.
   */
  const candidates = (entry: DictionaryEntry) => [
    ...initialismsFor(entry.title),
    ...(entry.initials === null ? [] : initialismsFor(`${entry.title} ${entry.initials}`)),
  ];

  const derived = dictionary.filter((entry) => candidates(entry).includes(wanted));
  if (derived.length === 1) {
    return {
      subjectCode: (derived[0] as DictionaryEntry).subjectCode,
      resolution: 'initialism',
      reason: null,
    };
  }
  if (derived.length > 1) {
    return {
      subjectCode: null,
      resolution: 'ambiguous',
      reason:
        `"${wanted}" could be ` +
        `${derived.map((entry) => entry.subjectCode).join(' or ')} — ` +
        'this timetable does not say which.',
    };
  }

  return {
    subjectCode: null,
    resolution: 'unknown',
    reason: `"${wanted}" is not defined anywhere on this timetable.`,
  };
}

/* -------------------------------------------------------------------------- */
/* Context                                                                    */
/* -------------------------------------------------------------------------- */

/** `W.E.F: 07/11/2024`, `W.E.F 7-11-2024`. Never the upload date (§14). */
function readEffectiveFrom(text: string): string | null {
  /*
   * `W.E.F: 07/11/2026`, and `With effective from: 09.09.2026`.
   *
   * The abbreviation is what the reference document prints; the sentence is
   * what a timetable written in a word processor prints, and only matching the
   * abbreviation left a real document with no effective date at all — which
   * matters, because the effective date is how a revision is known to supersede
   * the timetable a student is already following.
   */
  const match =
    /w\.?\s*e\.?\s*f\.?\s*[:\s]\s*(\d{1,2})\s*[-/.]\s*(\d{1,2})\s*[-/.]\s*(\d{4})/i.exec(text) ??
    /\bwith\s+effect(?:ive)?\s+from\s*[:\s]\s*(\d{1,2})\s*[-/.]\s*(\d{1,2})\s*[-/.]\s*(\d{4})/i.exec(
      text,
    );
  if (match === null) return null;
  const [, day, month, year] = match as unknown as [string, string, string, string];
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  if (date.getUTCMonth() !== Number(month) - 1 || date.getUTCDate() !== Number(day)) return null;
  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
}
/**
 * The class this timetable is for, without whatever was printed beside it.
 *
 * `CLASS: I (E) CSBS SEMESTER I` and `TIME-TABLE (R2)` sit side by side on the
 * real document, so they land on one reconstructed row and the class name
 * swallows the revision label. That made two revisions of ONE class look like
 * two different classes — and the older one stopped being recognised as older,
 * which is exactly the check that stops a stale upload replacing a student's
 * week (§13, §16).
 */
function readClassName(text: string): string | null {
  const raw = /\bclass\s*[:\-–]\s*([^\n]{1,60})/i.exec(text)?.[1];
  if (raw === undefined) {
    /*
     * NO "CLASS:" LABEL AT ALL.
     *
     * A timetable headed `V (B) - Timetable for the Academic year 2026-27`
     * names its class and never uses the word. The shape - a roman numeral for
     * the semester, a parenthesised division letter - is the ordinary VTU
     * convention, and it is anchored to the word "timetable" so an unrelated
     * `V (B)` elsewhere on the page cannot be read as one.
     */
    const heading = /\b([IVX]{1,4}\s*\(\s*[A-Z]\s*\))\s*[-–—:]?\s*Time\s*-?\s*table\b/i.exec(
      text,
    )?.[1];
    return heading === undefined ? null : heading.replace(/\s+/g, ' ').trim();
  }
  const cut = raw.split(
    /\bTIME\s*-?\s*TABLE\b|\bROOM\b|\bW\.?\s*E\.?\s*F\b|\bACADEMIC\s+YEAR\b/i,
  )[0];
  const trimmed = cut?.trim() ?? '';
  return trimmed === '' ? null : trimmed;
}

function readContext(text: string): TimetableContext {
  const semesterMatch =
    /\bsemester\s*[:\-–]?\s*([1-8])\b/i.exec(text) ??
    /\bsemester\s*[:\-–]?\s*([IVX]{1,4})\b/i.exec(text);
  const roman: Record<string, number> = {
    i: 1,
    ii: 2,
    iii: 3,
    iv: 4,
    v: 5,
    vi: 6,
    vii: 7,
    viii: 8,
  };
  const rawSemester = semesterMatch?.[1] ?? '';
  const className = readClassName(text);
  /*
   * The class name carries the semester when nothing else states it.
   * `V (B)` is the fifth semester, division B — the roman numeral IS the
   * semester, and this document never writes the word "semester" at all. Read
   * from the class name rather than from anywhere on the page, so a roman
   * numeral in a subject title cannot be mistaken for one.
   */
  const fromClassName = /^([IVX]{1,4})\b/i.exec(className ?? '')?.[1];
  const semester = /^\d$/.test(rawSemester)
    ? Number(rawSemester)
    : (roman[rawSemester.toLowerCase()] ??
      (fromClassName === undefined ? null : (roman[fromClassName.toLowerCase()] ?? null)));

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
    className,
    semester,
    academicYear,
    /* `TIME-TABLE (R2)`. The label the document gave its own revision (§13). */
    revision:
      (
        /time\s*-?\s*table\s*\(\s*(R\d)\s*\)/i.exec(text)?.[1] ??
        /^.*\btime\s*-?\s*table\b.*?\(\s*(R\d)\s*\).*$/im.exec(text)?.[1]
      )?.toUpperCase() ?? null,
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
const EMPTY_COVERAGE: TimetableCoverage = {
  cellsFound: 0,
  cellsResolved: 0,
  slotsFound: 0,
  dictionaryEntries: 0,
  looksComplete: false,
};

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
      coverage: EMPTY_COVERAGE,
      warnings: ['Nothing could be read from this document.'],
    };
  }

  const tolerance = medianHeight(placed) * 0.6;
  const rows = rowsOf(placed, tolerance);
  const rowText = rows.map((row) =>
    row
      .map((item) => item.text)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim(),
  );
  const joined = rowText.join('\n');

  const context = readContext(joined);
  const dictionary = readDictionary(
    rowText,
    /*
     * Blank runs are dropped here for the same reason the column reader drops
     * them: a PDF emits them to cross a gap, and one reported with the width
     * of the gap it crossed sits to the LEFT of the column it precedes.
     */
    rows.map((row) => ({
      y: row[0]?.y ?? 0,
      runs: row.filter((item) => item.text.trim() !== ''),
    })),
  );

  /*
   * THE COLUMNS COME FROM THE HEADER, and the header is whichever row holds the
   * most time ranges. Finding it by content rather than by position means a
   * document with a logo, a title block or a stamp above the grid still works
   * (§18).
   */
  /*
   * THE HEADER WRAPS. On the real document a column is printed as
   *
   *     10:00 -
   *     10:55am
   *
   * so a range lives across two or three PRINTED LINES, not one. Scanning row
   * by row found the single column narrow enough to fit on one line and missed
   * the other seven — two slots out of eight, which left almost every cell with
   * no column to belong to.
   *
   * So the header is looked for in a WINDOW of consecutive rows, and within
   * that window text is grouped by the column it sits under before being read.
   * A column's extent is the extent of everything that made it up, which is
   * what later places the cells (M10A.8.1 §16).
   */
  /*
   * THE HEADER WRAPS. On the real document a column is printed as
   *
   *     10:00 -
   *     10:55am
   *
   * so a range lives across two or three PRINTED LINES, not one. Scanning row
   * by row found the single column narrow enough to fit on one line and missed
   * the other seven — two slots of eight, which left almost every cell with no
   * column to belong to.
   *
   * The header is therefore a BLOCK of consecutive rows, identified by what
   * they contain rather than by where they are: rows carrying a clock fragment
   * and no day name. A day row ends the block, which is what stops the window
   * swallowing Monday.
   */
  const CLOCK = /\d{1,2}[:.]\d{2}/;
  const isHeaderRow = (index: number) => {
    const row = rows[index];
    if (row === undefined) return false;
    const text = row.map((item) => item.text).join(' ');
    if (!CLOCK.test(text)) return false;
    return !row.some(
      (item) => DAY_NAMES[item.text.replace(/[^A-Za-z]/g, '').toLowerCase()] !== undefined,
    );
  };

  /**
   * A row that JOINS two clock rows without carrying a clock of its own.
   *
   * The header of a Word-authored timetable is three stacked rows: the start
   * times, a row of the word "to", and the end times. The middle row has no
   * digits in it, so `isHeaderRow` rejected it and the block stopped after the
   * start times — every column then held a single time, no column parsed as a
   * RANGE, and the whole document failed with "the times could not be read".
   *
   * Deliberately narrow, because this is the rule that could swallow the
   * timetable itself: the row must carry a separator word, must carry no clock
   * of its own, must carry no day name, and the row AFTER it must be a real
   * clock row. A row of subject codes satisfies none of those.
   */
  const SEPARATOR_WORD = /^(?:to|till|until|[-–—])$/i;
  const isBridgeRow = (index: number) => {
    const row = rows[index];
    if (row === undefined) return false;
    if (!isHeaderRow(index + 1)) return false;

    const words = row.map((item) => item.text.trim()).filter((text) => text !== '');
    if (words.length === 0) return false;
    if (words.some((word) => CLOCK.test(word))) return false;
    if (
      row.some((item) => DAY_NAMES[item.text.replace(/[^A-Za-z]/g, '').toLowerCase()] !== undefined)
    ) {
      return false;
    }
    return words.some((word) => SEPARATOR_WORD.test(word));
  };

  let headerIndex = -1;
  let headerSlots: TimeSlot[] = [];

  for (let index = 0; index < rows.length; index += 1) {
    if (!isHeaderRow(index)) continue;
    let last = index;
    while (last + 1 < rows.length && (isHeaderRow(last + 1) || isBridgeRow(last + 1))) last += 1;

    /*
     * BLANK RUNS ARE NOT COLUMNS. A PDF is full of zero-content positioning
     * runs, and pdf.js reports them with a width that spans the gap they were
     * emitted to cross. Letting them into the column grouping bridged every gap
     * in the header and merged seven time columns into one — eight slots became
     * two, and almost every cell lost the column it belonged to.
     *
     * The line reader already drops them for the same reason; the column reader
     * had not learned it yet.
     */
    const block = rows
      .slice(index, last + 1)
      .flat()
      .filter((item) => item.text.trim() !== '');

    /*
     * Grouped by horizontal overlap rather than exact position: the halves of
     * `10:00 -` and `10:55am` sit under one another but rarely at the same x,
     * and a column is where they overlap.
     */
    const byColumn: PlacedLike[][] = [];
    /*
     * STRICT OVERLAP, not a tolerance. Allowing a few pixels of slack was
     * measured on the real photograph and made things WORSE — six readable
     * classes fell to three — because neighbouring columns on a dense timetable
     * are close enough that any slack merges them, and a merged column reads as
     * no time range at all.
     */
    for (const item of [...block].sort((a, b) => a.x - b.x)) {
      const group = byColumn.find((candidate) => {
        const left = Math.min(...candidate.map((member) => member.x));
        const right = Math.max(...candidate.map((member) => member.x + member.width));
        return item.x <= right && item.x + item.width >= left;
      });
      if (group === undefined) byColumn.push([item]);
      else group.push(item);
    }

    const found: TimeSlot[] = [];
    for (const group of byColumn) {
      /* Reading order within the column: top line first, then left to right. */
      const text = [...group]
        .sort((a, b) => b.y - a.y || a.x - b.x)
        .map((item) => item.text)
        .join(' ');
      const slot = readSlot(text);
      if (slot === null) continue;
      found.push({
        ...slot,
        left: Math.min(...group.map((item) => item.x)),
        right: Math.max(...group.map((item) => item.x + item.width)),
        isBreak: false,
      });
    }

    if (found.length > headerSlots.length) {
      headerSlots = found;
      /* Day rows are searched below the header's LAST line, not its first. */
      headerIndex = last;
    }
    index = last;
  }

  if (headerSlots.length < 2) {
    return {
      context,
      slots: [],
      dictionary,
      classes: [],
      batches: [],
      conflicts: [],
      coverage: { ...EMPTY_COVERAGE, dictionaryEntries: dictionary.length },
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

  /*
   * A DAY IS A BAND OF ROWS, NOT A ROW.
   *
   * This used to require the day name to be the FIRST run of a row and read
   * that one row's cells. That holds for a timetable whose cells each fit on
   * one printed line, and it fails completely on a Word-authored one: there the
   * day label is vertically centred in a tall table row, so it lands on a
   * printed line of its OWN, with the subject codes on the line above it and
   * the rooms on the line below. Every day matched nothing, and the document
   * produced zero classes while reporting no error at all.
   *
   * A band therefore runs from one day label to the next, and its cells are
   * every run in between grouped by column. A timetable whose days DO fit on
   * one line each produces bands of one row, which is exactly the previous
   * behaviour — this generalises the old rule rather than replacing it.
   */
  const dayNameIn = (row: readonly PlacedLike[]): Weekday | undefined => {
    for (const item of row) {
      const day = DAY_NAMES[item.text.replace(/[^A-Za-z]/g, '').toLowerCase()];
      if (day !== undefined) return day;
    }
    return undefined;
  };

  interface Band {
    readonly day: Weekday;
    readonly items: PlacedLike[];
  }

  const labelRows: number[] = [];
  for (let index = headerIndex + 1; index < rows.length; index += 1) {
    if (dayNameIn(rows[index] as PlacedLike[]) !== undefined) labelRows.push(index);
  }

  /* How far apart the grid's own printed lines are, for the lone-day case. */
  const gridSteps: number[] = [];
  for (let index = headerIndex + 2; index < rows.length; index += 1) {
    const step = (rows[index - 1]?.[0]?.y ?? 0) - (rows[index]?.[0]?.y ?? 0);
    if (step > 0) gridSteps.push(step);
  }
  gridSteps.sort((a, b) => a - b);
  const gridStep =
    gridSteps.length === 0 ? tolerance : (gridSteps[Math.floor(gridSteps.length / 2)] as number);

  /*
   * A DAY OWNS THE ROWS BETWEEN THE MIDPOINTS TO ITS NEIGHBOURS.
   *
   * A Word-authored timetable centres the day label vertically in a tall table
   * row, so the subjects print on the line ABOVE the label and the rooms on the
   * line BELOW it. The band is therefore the region of the page that is nearer
   * to this label than to any other — which is exactly the table row the
   * document drew, and needs no rule about which side a document puts its
   * cells on.
   *
   * WHAT THIS REPLACED, AND WHY. The previous rule read the neighbouring lines
   * only for a label that had no cells of its own, deciding "own cells" by
   * whether any run on the label's row fell inside a time column. On the real
   * Semester 5 document that test is wrong three times out of six: Tuesday's,
   * Wednesday's and Saturday's label rows each catch a stray run — a single
   * letter of the vertically-set SHORT BREAK and LUNCH labels, or the second
   * line of a cell that wrapped ("Value added" above, "Course" below). Each
   * one declared the band complete, so the row holding that day's actual
   * subjects was never read: half the week silently produced nothing, and the
   * document reported no error at all.
   *
   * Midpoints have no such failure mode, and they degenerate correctly: on a
   * timetable whose days each fit on one printed line, the rows either side of
   * a label are past the midpoint, so the band is the label's row alone — byte
   * for byte the behaviour that layout had before.
   */
  const labelY = (index: number) => rows[index]?.[0]?.y ?? 0;
  const bands = new Map<number, Band>();

  for (let position = 0; position < labelRows.length; position += 1) {
    const labelRow = labelRows[position] as number;
    const day = dayNameIn(rows[labelRow] as PlacedLike[]);
    if (day === undefined) continue;

    const y = labelY(labelRow);
    const previous = position > 0 ? labelY(labelRows[position - 1] as number) : null;
    const next = position + 1 < labelRows.length ? labelY(labelRows[position + 1] as number) : null;

    /*
     * The outer edges use the gap this day actually has, mirrored. A first or
     * last day with no neighbour on one side would otherwise reach to the top
     * of the page or into the subject dictionary below the grid.
     */
    /*
     * A day with no neighbour on either side — a timetable of one day, or a
     * fixture of one — has no midpoint to take, so the band is a printed row
     * of the grid either side of the label. Without this the band collapsed
     * onto the label's own line and a document whose subjects are printed
     * above the label and rooms below it produced nothing at all.
     */
    const lone = gridStep * 3;
    const above = previous !== null ? previous - y : next !== null ? y - next : lone;
    const below = next !== null ? y - next : previous !== null ? previous - y : lone;
    const top = y + above / 2;
    const bottom = y - below / 2;

    const items: PlacedLike[] = [];
    for (let index = headerIndex + 1; index < rows.length; index += 1) {
      const rowY = labelY(index);
      if (rowY > top || rowY < bottom) continue;
      for (const item of rows[index] as PlacedLike[]) {
        /* The label itself names the band; it is not one of its cells. */
        if (DAY_NAMES[item.text.replace(/[^A-Za-z]/g, '').toLowerCase()] !== undefined) continue;
        items.push(item);
      }
    }
    bands.set(labelRow, { day, items });
  }

  for (const band of bands.values()) {
    const { day } = band;

    /*
     * Cells are neighbouring runs inside one column. A cell like `MAT LAB(E1+E2)`
     * arrives as several runs and must be read as one, so runs are grouped by
     * the column their centre falls in.
     */
    const byColumn = new Map<number, PlacedLike[]>();
    for (const item of band.items) {
      /*
       * A BLANK RUN AND A SINGLE LETTER ARE NOT PART OF A CELL.
       *
       * A PDF emits blank runs to cross gaps and reports each with the width
       * of the gap it crossed, so one left in a cell makes the cell look as
       * wide as the page — the reader that groups the header's columns had to
       * learn the same thing. And the letters:
       *
       * The vertically-set "SHORT BREAK" and "LUNCH" labels arrive one letter
       * per line, and a narrow break column is not always wide enough to hold
       * every one of them: a letter whose printed box crosses the boundary
       * lands in the NEIGHBOURING column and joined that cell's text, which is
       * how the real document produced a class called "Value added Course L".
       * Dropping them here costs nothing — the pass that reads those labels
       * stacks them straight off the page, below, and never looks at cells.
       */
      if (item.text.replace(/[^A-Za-z0-9]/g, '').length < 2) continue;
      const column = slotAt(bounded, item.x, item.x + item.width);
      if (column < 0) continue;
      const bucket = byColumn.get(column) ?? [];
      bucket.push(item);
      byColumn.set(column, bucket);
    }

    /*
     * A CELL THAT SPANS TWO COLUMNS HOLDS WHAT IS PRINTED UNDER BOTH.
     *
     * A lab written once across two hours is one class (§25), and the rooms
     * its two batches run in are printed one under each hour. Bucketing purely
     * by column left the second room stranded in a column of its own and it
     * became a class — the real document reported TEJOMAYI, a room, as a
     * subject nobody could identify.
     *
     * A run belongs to the column its CENTRE falls in, which is right for a
     * cell that fits its column and arbitrary for one that does not: the same
     * lab is centred over the earlier hour on Wednesday and over the later one
     * on Thursday, so its rooms are stranded on the right one day and on the
     * left the next. Two columns therefore join when the cell in either
     * physically crosses into the other — where the left one REACHES, and
     * where the right one BEGINS.
     */
    /*
     * Measured on the cell's TOP line — what the cell SAYS — and not on the
     * room printed under it. A room is a short word set under a narrow column
     * and routinely wider than the column's header text, so measuring the
     * whole cell made an ordinary subject-plus-room reach into its neighbour
     * and swallow the class standing there.
     */
    const edges = (items: readonly PlacedLike[]) => {
      const top = Math.max(...items.map((item) => item.y));
      const line = items.filter((item) => top - item.y <= tolerance);
      return {
        left: Math.min(...line.map((item) => item.x)),
        right: Math.max(...line.map((item) => item.x + item.width)),
      };
    };

    const ordered = [...byColumn.entries()].sort((a, b) => a[0] - b[0]);
    const cells: [number, PlacedLike[]][] = [];
    for (const [column, items] of ordered) {
      const previous = cells[cells.length - 1];
      if (previous !== undefined) {
        const reach = slotAt(bounded, edges(previous[1]).right - 1, edges(previous[1]).right);
        const begins = slotAt(bounded, edges(items).left, edges(items).left);
        if (reach >= column || begins <= previous[0]) {
          previous[1].push(...items);
          continue;
        }
      }
      cells.push([column, items]);
    }

    for (const [column, items] of cells) {
      const text = [...items]
        .sort((a, b) => b.y - a.y || a.x - b.x)
        .map((item) => item.text)
        .join(' ')
        .replace(/\s+/g, ' ')
        /*
         * A cell is printed with LEADERS around it — `----Mini project---` on
         * the real document — and a rule drawn out of dashes is typography,
         * not part of the name. Only leader characters are taken: a bracket is
         * data, and `MAT LAB(E1+E2)` loses its batches without the one that
         * closes it.
         */
        .replace(/^[-–—_.·•*=~\s]+|[-–—_.·•*=~\s]+$/g, '')
        .trim();
      if (text === '') continue;

      /*
       * A SINGLE LETTER IS NEVER A SUBJECT.
       *
       * A timetable sets "SHORT BREAK" and "LUNCH" vertically down its narrow
       * columns, and the extractor returns that as one letter per printed line
       * — S, H, O, R, T, B, R, E, A, K. Each landed in the break column as its
       * own cell and became its own "class", so a real document produced
       * seventeen distinct subject abbreviations of which eight were single
       * letters. Dropping them costs nothing: every abbreviation the grid
       * actually uses is at least two characters.
       */
      if (text.replace(/[^A-Za-z0-9]/g, '').length < 2) continue;

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
        /*
         * Through `resolveGridSubject`, which consults the document's declared
         * initials column first and falls back to a UNIQUE title initialism.
         * This used to be a direct lookup on the declared column alone, which
         * on a table that leaves that column empty resolved nothing at all.
         */
        const resolved = resolveGridSubject(dictionary, initials);
        if (batch !== null) batches.add(batch.toUpperCase());
        classes.push({
          day,
          start: slot.start,
          end,
          subjectCode: resolved.subjectCode,
          resolution: resolved.resolution,
          unresolvedReason: resolved.reason,
          initials: initials.toUpperCase(),
          batch: batch?.toUpperCase() ?? null,
          room,
          spansSlots: span,
          sourceText: text,
        });
      };

      /*
       * THE CELL, AND THE ROOM PRINTED UNDER IT.
       *
       * A band spans every printed line of one table row, so a column holds
       * the subject AND the room written beneath it: `TOC-T LH-302`, or a lab
       * rotation over the two rooms it runs in, `CNL-B1/CSL-B2 OJAS TEJOMAYI`.
       * Matched as one string, none of the cell shapes fit — the real document
       * lost every room, both lab rotations and both batch labels that way.
       *
       * So the shapes are matched against the longest PREFIX of the cell's
       * words that satisfies one, and whatever follows is the room. Two things
       * keep that safe: a prefix must be entirely upper case, which an
       * abbreviation on a timetable is and an English word in a wrapped cell
       * ("Value added Course") is not; and a cell matching no shape at all has
       * nothing peeled from it, so a second subject can never be turned into a
       * room.
       */
      const words = text.split(/\s+/).filter((word) => word !== '');
      const isCellShape = (candidate: string) =>
        candidate === candidate.toUpperCase() &&
        (SPLIT_CELL.test(candidate) ||
          LAB_CELL.test(candidate) ||
          /^[A-Z]{2,6}$/.test(candidate) ||
          COMPONENT_SUFFIX.test(candidate));

      /*
       * The WHOLE cell first, then its prefixes. `MAT LAB(E1+E2)` is a lab
       * with two batches and no room printed; trying prefixes first read it as
       * the subject MAT held in a room called "LAB(E1+E2)", and the second
       * batch disappeared.
       */
      let head = text;
      let printedRoom: string | null = null;
      for (let count = words.length; count >= 1; count -= 1) {
        const candidate = words.slice(0, count).join(' ');
        if (!isCellShape(candidate)) continue;
        head = candidate;
        printedRoom = count === words.length ? null : words.slice(count).join(' ');
        break;
      }

      const split = SPLIT_CELL.exec(head);
      if (split !== null) {
        /*
         * Two classes at one time, one per half of the group (§23). Where the
         * document printed the rooms under the rotation they follow in the
         * same order, so each half takes its own; where it printed one, both
         * take it.
         */
        const rooms = printedRoom === null ? [] : printedRoom.split(/\s+/).filter(Boolean);
        push(split[1] as string, split[2] as string, rooms[0] ?? null);
        push(split[3] as string, split[4] as string, rooms[1] ?? rooms[0] ?? null);
        continue;
      }

      const lab = LAB_CELL.exec(head);
      if (lab !== null) {
        const named = (lab[2] ?? '')
          .split(/[+,/]/)
          .map((part) => part.trim())
          .filter(Boolean);
        if (named.length === 0) push(lab[1] as string, null, printedRoom);
        else for (const batch of named) push(lab[1] as string, batch, printedRoom);
        continue;
      }

      const plain = /^([A-Z]{2,6})$/i.exec(head);
      if (plain !== null) {
        push(plain[1] as string, null, printedRoom);
        continue;
      }

      /* `TOC-T`: the same subject, marked as its theory hour. */
      const component = COMPONENT_SUFFIX.exec(head);
      if (component !== null) {
        push(component[1] as string, null, printedRoom);
        continue;
      }

      /*
       * `RMIPR LH-302` — the subject and the room in one cell.
       *
       * A timetable that prints the room under the subject puts both in the
       * same column, so the band reads them as one cell. Without this the cell
       * matches nothing, and the class is kept with a NULL code and no room —
       * on a real document that was 42 classes found and none identified.
       *
       * The room half is anchored and shaped: letters, an optional hyphen, and
       * digits. It is deliberately not "whatever follows the initials", which
       * would swallow a second subject and invent a room out of it.
       */
      const withRoom = /^([A-Z]{2,6})\s+([A-Z]{1,4}-?\d{1,4}[A-Z]?)$/i.exec(text);
      if (withRoom !== null) {
        push(withRoom[1] as string, null, (withRoom[2] as string).toUpperCase());
        continue;
      }

      /*
       * A cell that is neither empty, a break, a split, a lab nor plain
       * initials. Kept with a null code so the review can show it rather than
       * dropping a class in silence.
       */
      /*
       * The room is printed under this cell too, and it is a room whether or
       * not the thing above it is an abbreviation this document defines —
       * "Value added Course LH-302" is a block held in LH-302, not a class
       * whose name ends in a room.
       */
      const trailing = /^(.*?)\s+([A-Z]{1,4}-?\d{1,4}[A-Z]?)$/i.exec(text);
      const label = trailing?.[1] ?? text;

      /*
       * Still offered to the resolver, because a cell that is not an
       * abbreviation can still be a NAME the subject table prints — and the
       * real document's "Mini project" is exactly that.
       */
      const spelled = resolveGridSubject(dictionary, label);

      classes.push({
        day,
        start: slot.start,
        end,
        subjectCode: spelled.subjectCode,
        resolution: spelled.subjectCode === null ? 'unknown' : spelled.resolution,
        unresolvedReason:
          spelled.subjectCode !== null
            ? null
            : 'This cell is not a subject abbreviation this timetable defines. Check it against the printed timetable.',
        initials: label.slice(0, 20),
        batch: null,
        room: trailing?.[2]?.toUpperCase() ?? null,
        spansSlots: span,
        sourceText: text,
      });
    }
  }

  /*
   * BREAK AND LUNCH, SET VERTICALLY.
   *
   * A narrow column cannot fit "SHORT BREAK" across it, so a timetable sets it
   * down the column instead — and the extractor returns one letter per printed
   * line, spread through every day's rows. No single letter is a class and none
   * belongs to a day, so the grid reader drops them; but the COLUMN they spell
   * is a break, and without reading them a break column on such a document is
   * never identified at all and reads as an ordinary free period.
   *
   * A standalone pass, over every row under the header rather than over the
   * day bands, because these letters sit between the bands and belong to none
   * of them. Read top to bottom, which is how they were printed, and matched on
   * letters alone so spacing and case cannot matter.
   */
  const vertical = new Map<number, { y: number; text: string }[]>();
  for (let index = headerIndex + 1; index < rows.length; index += 1) {
    for (const item of rows[index] as PlacedLike[]) {
      const letters = item.text.replace(/[^A-Za-z0-9]/g, '');
      if (letters.length !== 1) continue;
      const column = slotAt(bounded, item.x, item.x + item.width);
      if (column < 0) continue;
      const stack = vertical.get(column) ?? [];
      stack.push({ y: item.y, text: letters });
      vertical.set(column, stack);
    }
  }
  for (const [column, stack] of vertical) {
    const spelled = [...stack]
      .sort((a, b) => b.y - a.y)
      .map((entry) => entry.text)
      .join('')
      .toUpperCase();
    if (/BREAK|LUNCH|RECESS|INTERVAL/.test(spelled)) breakColumns.add(column);
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
    warnings.push(
      'The subject table on this timetable could not be read, so the initials in the grid cannot be matched to subject codes.',
    );
  }
  /*
   * NAME THE ABBREVIATIONS, AND SAY WHICH KIND OF UNRESOLVED THEY ARE.
   *
   * "3 classes use initials this timetable never defines" is a count, and a
   * count is not something a person can act on. Which three, and whether the
   * document is silent about them or merely ambiguous, is — and both facts now
   * exist on the class itself.
   */
  const unresolved = teaching.filter((entry) => entry.subjectCode === null);
  if (unresolved.length > 0 && dictionary.length > 0) {
    const ambiguous = [
      ...new Set(
        unresolved
          .filter((entry) => entry.resolution === 'ambiguous')
          .map((entry) => entry.initials),
      ),
    ];
    const unknown = [
      ...new Set(
        unresolved
          .filter((entry) => entry.resolution !== 'ambiguous')
          .map((entry) => entry.initials),
      ),
    ];

    if (unknown.length > 0) {
      warnings.push(
        `This timetable never says what ${unknown.join(', ')} ${unknown.length === 1 ? 'is' : 'are'}. ` +
          'Those classes are kept, without a subject — check them before saving.',
      );
    }
    if (ambiguous.length > 0) {
      warnings.push(
        `${ambiguous.join(', ')} could each be more than one of this timetable's subjects, ` +
          'so no code was chosen. Check them before saving.',
      );
    }
  }
  if (context.effectiveFrom === null) {
    warnings.push('This timetable does not print an effective date (W.E.F.).');
  }
  if (conflicts.length > 0) {
    warnings.push(
      `${String(conflicts.length)} ${conflicts.length === 1 ? 'time has' : 'times have'} more than one class. Check them against the printed timetable.`,
    );
  }

  /*
   * WHETHER THIS IS A WEEK OR A FRAGMENT OF ONE.
   *
   * Measured against the real photograph: a reading can recover the dictionary,
   * every day name and a handful of correct classes while losing five of the
   * eight time columns — and the classes it did read are right. Presenting
   * those as "your timetable" would be a week missing three quarters of itself
   * that looks whole (§26).
   *
   * The thresholds are deliberately blunt: at least half the cells identified,
   * at least four teaching columns, and classes on at least three days. A
   * document that clears them is worth offering; one that does not is offered
   * with the truth attached rather than withheld.
   */
  const resolved = teaching.filter((entry) => entry.subjectCode !== null).length;
  const teachingSlots = withBreaks.filter((slot) => !slot.isBreak).length;
  const daysSeen = new Set(teaching.map((entry) => entry.day)).size;
  const coverage: TimetableCoverage = {
    cellsFound: teaching.length,
    cellsResolved: resolved,
    slotsFound: withBreaks.length,
    dictionaryEntries: dictionary.length,
    looksComplete:
      teaching.length > 0 &&
      resolved >= Math.ceil(teaching.length / 2) &&
      teachingSlots >= 4 &&
      daysSeen >= 3,
  };

  if (!coverage.looksComplete && teaching.length > 0) {
    warnings.push(
      `Only part of this timetable could be read — ${String(resolved)} of ${String(teaching.length)} classes, across ${String(teachingSlots)} of its time columns. Check it against the printed timetable, or add the rest by hand.`,
    );
  }

  return {
    context,
    slots: withBreaks,
    dictionary,
    classes: teaching,
    batches: [...batches].sort(),
    conflicts,
    coverage,
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
 *
 * ---------------------------------------------------------------------------
 * TWO KINDS OF HOUR, AND A THIRD THAT IS NOT AN HOUR AT ALL
 * ---------------------------------------------------------------------------
 *
 * **A course** keeps the code the subject table gave it.
 *
 * **An activity** — a cell the grid prints and the subject table never defines,
 * like "Value added Course" or "Placement & Training" — keeps the name the
 * document printed and no code. It used to be dropped here, because a slot
 * without a code could not be stored; it is stored now, as what it is. No code
 * is invented for it (§18, §29): an invented code would be indexed as a
 * subject and offered for attendance beside real VTU ones.
 *
 * **A break** is neither. SHORT BREAK and LUNCH are columns of the grid, kept
 * as `TimeSlot.isBreak` on the slots the header defines, and they never become
 * a record here.
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
  subjectCode: string | null;
  activity: string | null;
  room: string | null;
  faculty: string | null;
}> {
  return parsed.classes
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
        subjectCode: entry.subjectCode,
        /*
         * What the CELL said, for an hour that names no course. `initials` is
         * the cell's own text — "Placement & Training" where the grid wrote it
         * out, "ESEVM" where it abbreviated — so this is the document's
         * wording and not a description of it.
         */
        activity: entry.subjectCode === null ? entry.initials : null,
        room: entry.room ?? parsed.context.room,
        /* Present only where the document named one. Never inferred (§26). */
        faculty: definition?.faculty ?? null,
      };
    });
}

/**
 * WHAT A SLOT IS, ANSWERED ONCE.
 *
 * Every screen that shows a slot asks the same three questions — what do I
 * call it, what do I print beside it, and can this hour bear attendance — and
 * before this they each answered them inline from `subjectCode`. Six copies of
 * one rule is how the six come to disagree, and a nullable code would have put
 * an `if` in every one of them (§29).
 *
 * `title` is what the subject index resolved for the code, or null. Passing it
 * in keeps this pure and keeps the index where it already lives.
 */
export interface TimetableEntry {
  /** The heading: a resolved title, else the code, else the activity's name. */
  readonly name: string;
  /**
   * The shortest thing that identifies this hour: the code, or the activity's
   * name where there is no code.
   *
   * Distinct from `name`, which prefers a title. A control that speaks about
   * one hour — "Mark BCS502 attended" — wants the code a student recognises,
   * not the sentence it expands to, and it wanted that before an hour could
   * lack a code. This keeps that answer identical for every course.
   */
  readonly shortName: string;
  /** What belongs in the smaller line beside it, or null if that would repeat. */
  readonly detail: string | null;
  /** A course the timetable identified. False for an hour it merely named. */
  readonly isCourse: boolean;
  /**
   * The code attendance is counted against, or null.
   *
   * Null means this hour is not an attendance-bearing subject — not that its
   * code is missing. An activity can still be MARKED, because the mark belongs
   * to the slot; what it cannot do is open a subject's attendance record (§26).
   */
  readonly attendanceCode: string | null;
}

export function timetableEntry(
  slot: {
    readonly subjectCode: string | null;
    readonly activity?: string | null;
  },
  title: string | null,
): TimetableEntry {
  const code = slot.subjectCode;
  if (code === null) {
    /*
     * `?? ''` rather than a throw: a record written before slots could carry an
     * activity has neither field, and a student's saved week is not the place
     * to discover that. An empty name renders as nothing, which is what an
     * unnameable row honestly is.
     */
    const named = slot.activity ?? '';
    return { name: named, shortName: named, detail: null, isCourse: false, attendanceCode: null };
  }
  const named = title !== null && title !== '' && title !== code;
  return {
    name: named ? title : code,
    shortName: code,
    detail: named ? code : null,
    isCourse: true,
    attendanceCode: code,
  };
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
