/**
 * Reading a VTU syllabus into Course → Syllabus → Module → Topic.
 *
 * Authority: Phase 7D.2 §3–§10, §39 · docs/38_VTU_INGESTION.md
 *
 * ---------------------------------------------------------------------------
 * WHY STRUCTURE AND NOT A TEXT BLOB
 * ---------------------------------------------------------------------------
 *
 * A syllabus stored as one string can be displayed and nothing else. The
 * question-paper work that comes later needs to ask "which module does this
 * question belong to", and that is only answerable if the modules exist as
 * rows. §3 makes the structure mandatory for exactly that reason.
 *
 * ---------------------------------------------------------------------------
 * WHAT COUNTS AS A TOPIC (§8)
 * ---------------------------------------------------------------------------
 *
 * Only what the document itself sets out as one. VTU writes module content as
 * headed runs:
 *
 *     INTRODUCTION TO DATA STRUCTURES: Data Structures, Classifications…
 *     ARRAYS and STRUCTURES: Arrays, Dynamic Allocated Arrays…
 *     STACKS: Stacks, Stacks Using Dynamic Arrays…
 *
 * Those headings are the topics. Where a module is written as continuous prose
 * — much of the mathematics is — it has NO enumerated topics, and this returns
 * none rather than chopping sentences into a list that the source never
 * expressed. An invented subtopic is worse than an absent one: the future
 * system that consumes these will treat them as the syllabus's own words.
 *
 * ---------------------------------------------------------------------------
 * EVERY FIELD KNOWS WHETHER IT WAS FOUND (§5)
 * ---------------------------------------------------------------------------
 *
 * `resolved`, `unavailable`, `ambiguous`. A syllabus that does not print its
 * exam duration is not a syllabus with an exam duration of zero.
 */

import type { PositionedText } from './positioned-text.js';
import type { SchemePage } from './scheme-import.js';

export type FieldState = 'resolved' | 'unavailable' | 'ambiguous';

export interface Field<T> {
  readonly value: T | null;
  readonly state: FieldState;
  /** The page it was read from, where there is one. */
  readonly page: number | null;
}

export interface SyllabusTopic {
  /** Position within the module, 1-based. Explicit, not display order (§7). */
  readonly order: number;
  readonly title: string;
  readonly page: number;
}

export interface SyllabusModule {
  /** `Module-3` is 3. Explicit ordering, not array position (§6). */
  readonly number: number;
  readonly title: string | null;
  readonly hours: number | null;
  /** The module's text as printed, kept whole alongside its topics. */
  readonly content: string;
  readonly page: number;
  readonly topics: readonly SyllabusTopic[];
}

export interface ParsedSyllabus {
  readonly courseCode: Field<string>;
  readonly courseTitle: Field<string>;
  readonly semester: Field<number>;
  readonly credits: Field<number>;
  readonly cieMarks: Field<number>;
  readonly seeMarks: Field<number>;
  readonly totalMarks: Field<number>;
  readonly examHours: Field<number>;
  /** "2:2:2:0" as printed — L:T:P:S. Not split, because the source does not. */
  readonly teachingHours: Field<string>;
  readonly objectives: readonly string[];
  readonly outcomes: readonly string[];
  readonly modules: readonly SyllabusModule[];
  /** Pages this course's syllabus occupied, for provenance. */
  readonly pages: readonly number[];
}

/* -------------------------------------------------------------------------- */
/* Reading lines                                                              */
/* -------------------------------------------------------------------------- */

interface Line {
  readonly text: string;
  readonly page: number;
  readonly y: number;
}

/**
 * One printed line per row of text.
 *
 * Rows are clustered on the baseline because a syllabus sets its header as a
 * two-column table — "Course Code: BMATS101" and "CIE Marks 50" share a row —
 * and reading runs in document order would interleave them.
 */
function linesOf(pages: readonly SchemePage[]): Line[] {
  const lines: Line[] = [];
  for (const { page, items } of pages) {
    const rows = new Map<number, PositionedText[]>();
    for (const item of items) {
      if (item.text.trim() === '') continue;
      const key = Math.round(item.y);
      const bucket = rows.get(key);
      if (bucket === undefined) rows.set(key, [item]);
      else bucket.push(item);
    }
    for (const y of [...rows.keys()].sort((a, b) => b - a)) {
      const text = (rows.get(y) ?? [])
        .sort((a, b) => a.x - b.x)
        .map((item) => item.text)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
      if (text !== '') lines.push({ text, page, y });
    }
  }
  return lines;
}

/* -------------------------------------------------------------------------- */
/* Patterns                                                                   */
/* -------------------------------------------------------------------------- */

const COURSE_CODE = /\bCourse\s*Code\s*:?\s*([A-Z]{2,5}\d{3}[A-Za-z]?)\b/i;

/**
 * A code on its own line, which is how the header prints it when the label and
 * the value fall in different table cells.
 *
 * `BPHYS102/202` is one course the university offers in both semesters of the
 * first year under two codes. The printed primary is taken; the second is NOT
 * expanded from the "/202" fragment, because completing an abbreviation would
 * be this parser inventing a course code. Recording the pair is alias work, and
 * belongs against the document that states both.
 */
const BARE_CODE = /^([A-Z]{2,5}\d{3}[A-Za-z]?)(?:\s*\/\s*\d{3}[A-Za-z]?)?$/;
const COURSE_TITLE = /\bCourse\s*Title\s*:\s*(\S.*)$/i;
/** The label with its value typeset in another cell, above or below it. */
const TITLE_LABEL_ALONE = /^\s*Course\s*Title\s*:?\s*$/i;

/**
 * The semester, in the two ways the header states it.
 *
 * First-year documents head the page "I Semester". Third-to-eighth documents
 * write "Semester 3" at the end of the title line, or on a line of its own.
 * §10 — there is no one template, so both are read rather than one being
 * assumed and every document using the other losing its semester.
 */
const SEMESTER_BEFORE = /^\s*(I|II|III|IV|V|VI|VII|VIII)\s+Semester\b/i;
/**
 * The numeral after the word, Roman or Arabic.
 *
 * Longest-first alternation, so "Semester VIII" does not read as VI followed
 * by stray letters.
 */
const SEMESTER_AFTER = /\bSemester\s*[-–]?\s*(VIII|VII|VI|V|IV|III|II|I|[1-8])\b/i;

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

/** A header cell, so a course title is never read out of one. */
const HEADER_LABEL =
  /^(Course\s*(Code|Title|Type)|Teaching|Total\s*(Hours|Marks)|Credits|CIE|SEE|Exam|Examination|Prerequisite|\(Theory)/i;

/**
 * A module heading.
 *
 * Three shapes, all real: `Module-1: Probability Distributions`,
 * `Module-1 8Hours`, and `MODULE-1 No. of Hours: 8`. Whatever a shape does not
 * state stays null rather than being filled in from one of the others.
 */
const MODULE = /^Module\s*[-–—]?\s*(\d)\s*[:.]?\s*(.*)$/i;

/** Hours, before or after the word, with or without the "No. of" preamble. */
const HOURS_PHRASE =
  /\(?\s*(?:No\.?\s*of\s*)?(?:(\d{1,2})\s*(?:Hours?|Hrs?)|(?:Hours?|Hrs?)\s*[:.]?\s*(\d{1,2}))\s*\)?/i;

/**
 * A topic heading inside a module's body: an opening phrase ended by a colon.
 *
 * This is the shape VTU uses to head the parts of a module, in capitals
 * (`STACKS:`) and in sentence case (`Quantum Mechanics:`) alike.
 *
 * The 50-character ceiling is what separates a heading from a sentence that
 * happens to contain a colon. `Requisites of a laser system, Semiconductor
 * Diode Laser, Applications:` is prose, and it runs to 68 characters before its
 * colon; the longest real heading in the documents read is 47.
 */
const TOPIC = /^([A-Za-z][^:;!?]{2,49}?)\s*:/;
/** The same heading alone on its line — which is how a module title prints. */
const TOPIC_ALONE = /^([A-Za-z][^:;!?]{2,49}?)\s*:\s*$/;

/**
 * Lines whose colon introduces bibliography or teaching notes, not a topic.
 *
 * Named rather than inferred: each is a label the documents use repeatedly, and
 * none of them names a piece of the syllabus.
 */
const NOT_A_TOPIC =
  /^(text\s*books?|reference\s*books?|e[-\s]*books?|web\s*links?|pre\s*-?\s*requisite|self[-\s]*learning|note|suggested|assessment|course|module|semester|teaching|sl\.?\s*no|experiment|chapter|unit|marks|credits)/i;

const OUTCOME = /^(?:\d{1,2}[.)]\s*)?(CO\s*\d)\b\s*(.*)$/i;

/**
 * Where the header stops and the body begins.
 *
 * Bounding this matters more than it looks. A laboratory course has no modules
 * at all, so "everything before the first module" was the whole document — and
 * the assessment section near the end says "Total Marks 30", which was then
 * read as the course's own total. The objectives heading follows the header
 * table in every template seen.
 */
const BODY_START = /^(Course\s*objectives?|Teaching[-\s]*Learning|Sl\.?\s*NO|Course\s*outcome)/i;

const SECTION_END =
  /^(Course\s*outcome|Assessment\s*Details|Suggested\s*Learning|Reference\s*Books?|Text\s*Books?|Web\s*link|Teaching[-\s]*Learning|Practical\s*Component|Suggested\s*software|Sl\.?\s*NO|Experiments)/i;

const OBJECTIVES_START = /^Course\s*objectives?\s*:?/i;

/**
 * What a figure may plausibly be, so a typesetting slip is visible as one.
 *
 * `Credits 01 Exam Hours 100` is printed in a real VTU laboratory syllabus. No
 * examination lasts a hundred hours; that cell has collected a marks figure
 * from the column beside it. Reading it as a duration would be worse than
 * reading nothing, so the value is kept as printed and the field is marked
 * `ambiguous` (§5) — the reading survives for someone to look at, and no
 * consumer can mistake it for an established fact.
 */
const PLAUSIBLE = {
  credits: [0, 10],
  examHours: [1, 6],
  marks: [0, 200],
} as const satisfies Readonly<Record<string, readonly [number, number]>>;

const unavailable = <T>(): Field<T> => ({ value: null, state: 'unavailable', page: null });
const resolved = <T>(value: T, page: number): Field<T> => ({ value, state: 'resolved', page });
const ambiguous = <T>(value: T, page: number): Field<T> => ({ value, state: 'ambiguous', page });

/**
 * A labelled number from the header table: "CIE Marks 50" → 50.
 *
 * `bound` names the plausible range for this kind of figure; a number outside
 * it comes back `ambiguous` rather than as fact.
 */
function labelledNumber(
  lines: readonly Line[],
  label: RegExp,
  bound: keyof typeof PLAUSIBLE,
): Field<number> {
  for (const line of lines) {
    const match = label.exec(line.text);
    if (match === null) continue;
    const number = /(\d{1,3})/.exec(line.text.slice(match.index + match[0].length));
    if (number?.[1] === undefined) continue;
    const value = Number(number[1]);
    const [low, high] = PLAUSIBLE[bound];
    return value < low || value > high ? ambiguous(value, line.page) : resolved(value, line.page);
  }
  return unavailable();
}

/* -------------------------------------------------------------------------- */
/* Reading one course                                                         */
/* -------------------------------------------------------------------------- */

/**
 * One course's syllabus, from the lines that belong to it.
 *
 * `header` stops at the objectives heading, NOT at the first module: a
 * laboratory course has no modules, so "everything before the first module"
 * was the entire document, and its closing assessment table — "Total Marks 30"
 * — was read as the course's own total.
 */
function readCourse(lines: readonly Line[]): ParsedSyllabus {
  const bodyAt = lines.findIndex((line) => BODY_START.test(line.text) || MODULE.test(line.text));
  const header = bodyAt === -1 ? lines : lines.slice(0, bodyAt);

  /* ---- Identity ------------------------------------------------------- */

  let code: Field<string> = unavailable();
  let title: Field<string> = unavailable();
  let semester: Field<number> = unavailable();

  for (const [index, line] of header.entries()) {
    const codeMatch = COURSE_CODE.exec(line.text);
    if (codeMatch?.[1] !== undefined && code.value === null) {
      code = resolved(codeMatch[1].toUpperCase(), line.page);
    } else if (code.value === null && /Course\s*Code/i.test(line.text)) {
      /*
       * The label and the code on separate baselines, which is how the header
       * prints when they fall in different table cells. The code is next.
       */
      const next = header[index + 1];
      const bare = next === undefined ? null : BARE_CODE.exec(next.text.trim());
      if (bare?.[1] !== undefined) code = resolved(bare[1].toUpperCase(), next?.page ?? line.page);
    }

    if (title.value === null) {
      const labelled = COURSE_TITLE.exec(line.text);
      if (labelled?.[1] !== undefined) {
        title = resolved(labelled[1].trim(), line.page);
      } else if (TITLE_LABEL_ALONE.test(line.text)) {
        /*
         * The label alone, its value in a cell of its own. WHICH SIDE varies:
         * `BPHYS102` prints the title on the line below, `BCHEC102` on the line
         * above, because the two documents merge the header cells differently.
         * Both are the same statement — the name beside the label — so the
         * nearer neighbour that is not itself a label is taken.
         */
        title = adjacentValue(header, index) ?? title;
      }
    }

    /*
     * The semester, and with it the title in the templates that print no
     * "Course Title" label at all.
     *
     *     DATA STRUCTURES AND APPLICATIONS Semester 3   — both on one line
     *     Semester IV                                   — the title follows
     *     DISCRETE MATHEMATICAL STRUCTURES
     *
     * Neither reading is a guess: this is where these documents put the name
     * of the course, and a course whose header states it nowhere keeps an
     * unavailable title rather than borrowing one from its neighbour.
     */
    const found = semester.value === null ? semesterOn(line.text) : null;
    if (found !== null) {
      semester = resolved(found.value, line.page);
      if (title.value === null) {
        const before = line.text.slice(0, found.index).trim();
        title = usableTitle(before, line) ?? adjacentValue(header, index) ?? title;
      }
    }
  }

  /* ---- Objectives and outcomes ---------------------------------------- */

  const objectives: string[] = [];
  let collecting = false;
  for (const line of lines) {
    if (OBJECTIVES_START.test(line.text)) {
      collecting = true;
      continue;
    }
    if (!collecting) continue;
    if (SECTION_END.test(line.text) || MODULE.test(line.text)) break;
    if (line.text.length > 12) objectives.push(line.text);
  }

  const outcomes: string[] = [];
  for (const line of lines) {
    const match = OUTCOME.exec(line.text);
    if (match?.[2] !== undefined && match[2].trim().length > 5) {
      outcomes.push(`${(match[1] ?? '').replace(/\s+/g, '')} ${match[2].trim()}`);
    }
  }

  /* ---- Modules --------------------------------------------------------- */

  const modules: SyllabusModule[] = [];
  const moduleStarts = lines
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => MODULE.test(line.text));

  for (const [position, start] of moduleStarts.entries()) {
    const match = MODULE.exec(start.line.text);
    const number = Number(match?.[1] ?? '0');
    if (!Number.isInteger(number) || number < 1) continue;

    /*
     * The heading's remainder is a title, a statement of hours, or both. The
     * hours phrase is removed WHOLE — matching only the digits left "No. of"
     * behind and stored it as the module's title.
     */
    const rest = (match?.[2] ?? '').trim();
    const hoursHere = HOURS_PHRASE.exec(rest);
    const headingTitle = rest
      .replace(HOURS_PHRASE, '')
      .replace(/^[-–—:.\s]+|[:.\s]+$/g, '')
      .trim();

    const until = moduleStarts[position + 1]?.index ?? lines.length;
    const body: Line[] = [];
    for (const line of lines.slice(start.index + 1, until)) {
      if (SECTION_END.test(line.text)) break;
      body.push(line);
    }

    /*
     * `Module-1 (8 Hours)` names no title, and prints it on the next line:
     *
     *     Module-1 (8 Hours)
     *     Laser and Optical Fibers:
     *     LASER : Characteristic properties of a LASER beam...
     *
     * A first body line that is a heading and NOTHING ELSE is that title. A
     * line with content after its colon is a topic and stays one — the
     * distinction is the document's own, not a judgement about the words.
     */
    const first = body[0];
    const promoted =
      headingTitle === '' && first !== undefined && !NOT_A_TOPIC.test(first.text.trim())
        ? (TOPIC_ALONE.exec(first.text.trim())?.[1]?.trim() ?? null)
        : null;
    const rest0 = promoted === null ? body : body.slice(1);

    const content = body
      .map((line) => line.text)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    /*
     * A heading that states no hours often has them in its first line instead.
     * Only the first line, not the whole body: "40 hours Theory" further down
     * is the course's pedagogy total, not this module's.
     */
    const hoursInBody = hoursHere === null ? HOURS_PHRASE.exec(body[0]?.text ?? '') : null;

    modules.push({
      number,
      title: headingTitle === '' ? promoted : headingTitle,
      hours: hoursOf(hoursHere) ?? hoursOf(hoursInBody),
      content,
      page: start.line.page,
      topics: topicsOf(rest0),
    });
  }

  return {
    courseCode: code,
    courseTitle: title,
    semester,
    credits: labelledNumber(header, /\bCredits?\b/i, 'credits'),
    cieMarks: labelledNumber(header, /\bCIE\s*Marks?\b/i, 'marks'),
    seeMarks: labelledNumber(header, /\bSEE\s*Marks?\b/i, 'marks'),
    totalMarks: labelledNumber(header, /\bTotal\s*Marks?\b/i, 'marks'),
    examHours: labelledNumber(header, /\bExam\s*Hours?\b/i, 'examHours'),
    teachingHours: teachingHoursOf(header),
    objectives,
    outcomes,
    modules,
    pages: [...new Set(lines.map((line) => line.page))].sort((a, b) => a - b),
  };
}

/**
 * The semester a header line states, and where on the line it states it.
 *
 * Three printed forms, all real: "I Semester", "Semester 3", "Semester IV".
 * The index matters because whatever precedes the word on that line is the
 * course's title in the templates that print no title label.
 */
function semesterOn(text: string): { value: number; index: number } | null {
  const before = SEMESTER_BEFORE.exec(text);
  const early = before?.[1]?.toUpperCase();
  if (early !== undefined && early in ROMAN) {
    return { value: ROMAN[early] as number, index: before?.index ?? 0 };
  }
  const after = SEMESTER_AFTER.exec(text);
  const token = after?.[1]?.toUpperCase();
  if (token === undefined || after === null) return null;
  const value = /^\d$/.test(token) ? Number(token) : ROMAN[token];
  return value === undefined ? null : { value, index: after.index };
}

/** A candidate title, if it reads as a name and not as a header cell. */
function usableTitle(text: string, line: Line): Field<string> | null {
  const trimmed = text.trim();
  return trimmed.length >= 4 && !HEADER_LABEL.test(trimmed) ? resolved(trimmed, line.page) : null;
}

/**
 * The value belonging to a label that stands alone on its line.
 *
 * The line after it, or failing that the line before — whichever is a value
 * rather than another label.
 */
function adjacentValue(header: readonly Line[], index: number): Field<string> | null {
  for (const candidate of [header[index + 1], header[index - 1]]) {
    if (candidate === undefined) continue;
    const text = candidate.text.trim();
    if (text.length < 4 || HEADER_LABEL.test(text)) continue;
    return resolved(text, candidate.page);
  }
  return null;
}

/** Hours from either half of `HOURS_PHRASE` — the digits precede or follow. */
function hoursOf(match: RegExpExecArray | null): number | null {
  const digits = match?.[1] ?? match?.[2];
  return digits === undefined ? null : Number(digits);
}

/** "Teaching Hours/Week (L:T:P: S) 2:2:2:0" → "2:2:2:0". */
function teachingHoursOf(header: readonly Line[]): Field<string> {
  for (const line of header) {
    if (!/Teaching\s*Hours/i.test(line.text)) continue;
    const pattern = /(\d\s*:\s*\d\s*:\s*\d(?:\s*:\s*\d)?)/.exec(line.text);
    if (pattern?.[1] !== undefined) {
      return resolved(pattern[1].replace(/\s+/g, ''), line.page);
    }
  }
  return unavailable();
}

/**
 * The topics a module's body sets out, and none it does not (§8).
 *
 * A topic is a heading phrase ended by a colon — the shape VTU uses to head
 * the parts of a module. A module written as continuous prose yields none,
 * which is the honest answer; the alternative is splitting sentences and
 * presenting the result as the syllabus's own structure.
 */
function topicsOf(body: readonly Line[]): SyllabusTopic[] {
  const topics: SyllabusTopic[] = [];
  for (const line of body) {
    const text = line.text.trim();
    if (NOT_A_TOPIC.test(text)) continue;
    const heading = TOPIC.exec(text)?.[1]?.trim();
    if (heading === undefined || heading.length < 3) continue;
    /* A heading names something; a bare figure or a stray letter does not. */
    if (!/[A-Za-z]{3}/.test(heading)) continue;
    /*
     * A full stop inside the heading means the colon belongs to a sentence,
     * not to a heading. So does a comma, UNLESS the heading is set in capitals
     * — VTU's capitalised headings do use commas, its prose does not stop
     * mid-sentence to shout. Both rules exist to keep wrapped continuation
     * lines out: "Fiber Losses, Applications: Fiber Optic networking" is the
     * back half of a sentence, and §8 forbids inventing a subtopic from it.
     */
    if (heading.includes('.')) continue;
    if (heading.includes(',') && heading !== heading.toUpperCase()) continue;
    if (topics.some((topic) => topic.title.toLowerCase() === heading.toLowerCase())) continue;
    topics.push({ order: topics.length + 1, title: heading, page: line.page });
  }
  return topics;
}

/* -------------------------------------------------------------------------- */
/* Reading a document                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Every course a syllabus document describes.
 *
 * VTU publishes both shapes: one PDF per course for the first year, and one
 * PDF for a whole semester later on. A new "Course Code:" header starts a new
 * course, so both are the same problem.
 */
export function parseSyllabusDocument(pages: readonly SchemePage[]): ParsedSyllabus[] {
  const lines = linesOf(pages);

  const starts: number[] = [];
  for (const [index, line] of lines.entries()) {
    if (!/Course\s*Code/i.test(line.text)) continue;
    /* Ignore a second mention inside one course's own header block. */
    const previous = starts[starts.length - 1];
    if (previous !== undefined && index - previous < 6) continue;
    starts.push(index);
  }
  if (starts.length === 0) return [];

  const courses: ParsedSyllabus[] = [];
  for (const [position, start] of starts.entries()) {
    /*
     * A course's block begins where its PAGE begins, not a fixed few lines
     * above "Course Code".
     *
     * The semester and the title are printed above the code, and how far above
     * depends on how many header cells the template stacks — a fixed lookback
     * of four lines lost the title and the semester for a third of the courses
     * read. VTU starts each course on a fresh page, so the page boundary is
     * the block boundary the document itself draws.
     *
     * The previous course's own start still bounds it, so two courses sharing
     * a page cannot claim each other's header.
     */
    const page = lines[start]?.page;
    const pageStart = lines.findIndex((line) => line.page === page);
    const previous = position === 0 ? 0 : (starts[position - 1] as number) + 1;
    const from = Math.max(previous, pageStart === -1 ? start : pageStart);
    const next = starts[position + 1];
    const to = next === undefined ? lines.length : Math.max(from + 1, nextBlockStart(lines, next));
    const parsed = readCourse(lines.slice(from, to));
    if (parsed.courseCode.value !== null) courses.push(parsed);
  }
  return courses;
}

/** Where the block for the course starting at `at` begins, by the same rule. */
function nextBlockStart(lines: readonly Line[], at: number): number {
  const page = lines[at]?.page;
  const pageStart = lines.findIndex((line) => line.page === page);
  return pageStart === -1 ? at : pageStart;
}
