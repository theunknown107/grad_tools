/**
 * The Scheme of Teaching and Examinations, read as a course catalogue.
 *
 * Authority: Phase 7C §8, §10, §14, §33 · docs/08 §8.20
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS
 * ---------------------------------------------------------------------------
 *
 * A VTU result card prints marks and no credits, and SGPA is credit-weighted,
 * so a card on its own can never be graded. The product's only source of
 * credits was the cloud reference API — which on a local-first install that has
 * never reached the network returns nothing. Every imported subject then had
 * `credits: null`, every semester failed the "all subjects or none" test, and
 * the SGPA, the CGPA, the trend and the whole analytics page went blank
 * together. One missing column, five empty screens.
 *
 * The university publishes the missing column. The Scheme of Teaching and
 * Examinations is the document that says what each course is worth, and a
 * student can hand it to the product exactly as they hand it their result
 * cards. That makes credits CATALOGUE data — the top tier of §10 — obtained
 * without the network and without anything being hardcoded here.
 *
 * ---------------------------------------------------------------------------
 * WHAT IS READ, AND WHAT IS REFUSED
 * ---------------------------------------------------------------------------
 *
 * Only the scheme's own table rows. A course that appears in the elective
 * OPTION lists below a table carries no credit column of its own — the credits
 * belong to the placeholder row (`BXX515x`) it would be chosen for — so those
 * rows come back UNRESOLVED with their reason rather than inheriting a figure
 * from a neighbour. Guessing there would put a wrong credit into a real SGPA.
 *
 * Nothing is inferred from the course code. `BCSL404` looks like a lab and
 * labs are usually worth one credit; the scheme still has to say so.
 */

import type { PositionedText } from './pdf-layout.js';

/* -------------------------------------------------------------------------- */
/* Shapes                                                                     */
/* -------------------------------------------------------------------------- */

export interface SchemeCourse {
  readonly code: string;
  readonly title: string;
  /** The scheme's own credit figure. Never inferred, never defaulted. */
  readonly credits: number;
  /** The semester whose table this row sits in. */
  readonly semester: number;
  readonly page: number;
  /**
   * The elective SLOT this course's credits came from, when they came from one.
   *
   * Null for an ordinary table row, which states its own credits. Set for a
   * course listed as one of the OPTIONS for a slot — `BCS306A` under
   * `BCS306x` — where the credit figure belongs to the slot and the option
   * inherits it. Carried so the review can say which, rather than presenting
   * an inherited figure as a row the document printed.
   */
  readonly viaElectiveSlot: string | null;
}

export interface SchemeRejection {
  readonly code: string;
  readonly page: number;
  /** Why this row could not become a catalogue entry, in words. */
  readonly reason: string;
  /**
   * The title printed beside the code, where there was one.
   *
   * Carried because the elective pass below can resolve a row the first pass
   * refused, and a course recovered without its name would be listed by its
   * code alone on every screen that shows it.
   */
  readonly title: string;
}

/**
 * One page's worth of positioned text.
 *
 * The scheme is a fourteen-page document and the semester a row belongs to is
 * printed as a page heading, so unlike every other importer here the page
 * boundary is DATA rather than an implementation detail of the reader.
 */
export interface SchemePage {
  readonly page: number;
  readonly items: readonly PositionedText[];
}

export interface ParsedScheme {
  readonly courses: readonly SchemeCourse[];
  /** Codes seen but not read, and why. Shown; never silently dropped. */
  readonly rejected: readonly SchemeRejection[];
  /** The semesters this document actually covers, ascending. */
  readonly semesters: readonly number[];
  /** The programme name from the heading, when it prints one. */
  readonly programme: string | null;
  /** The scheme year from the heading — "2022" — when it prints one. */
  readonly schemeYear: string | null;
}

/* -------------------------------------------------------------------------- */
/* Recognising the parts                                                      */
/* -------------------------------------------------------------------------- */

/**
 * A VTU course code.
 *
 * Deliberately the same shape family the result importer accepts, including
 * the five-letter first-year codes (`BMATS101`) that an earlier, narrower
 * pattern rejected. `BXX515x` — a placeholder for "whichever elective is
 * chosen" — matches too, and is wanted: it is the row that carries the
 * elective slot's credits.
 */
const COURSE_CODE = /^B[A-Z]{2,4}\d{3}[A-Za-z]?$/;

const SEMESTER_HEADING = /^(I|II|III|IV|V|VI|VII|VIII)\s+SEMESTER\b/i;

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

/**
 * The teaching-department column, which sits between the title and the numbers.
 *
 * `TD:CB` and `PSB:CS` are printed inside the row band and to the left of the
 * first numeric column, so a title assembled by x-position alone swallows them.
 * They are structure, not part of any course's name.
 */
const DEPARTMENT_CELL = /^(TD|PSB)\s*[:/]/i;

/**
 * A whole number as the scheme prints one: `3`, `03`, `100`.
 *
 * Anything else in a numeric column — `---` where a course has no semester-end
 * exam — is not a number and is not treated as one.
 */
const WHOLE_NUMBER = /^\d{1,3}$/;

/**
 * The largest credit figure a single course row may carry.
 *
 * The eighth-semester internship is ten credits, which is the maximum the
 * scheme awards. The guard exists because the credits column is the RIGHTMOST
 * number in the row and the column to its left is the total marks — usually
 * 100. A row whose rightmost number exceeds this has lost its credits column,
 * and that is reported rather than read as a hundred-credit course.
 */
const MAX_CREDITS = 10;

/**
 * The fewest numeric cells a real table row prints.
 *
 * The full row is L, T, P, duration, CIE, SEE, total and credits — eight. The
 * non-credit courses print six, because they have no lecture split and no exam
 * duration. Below six there is no table row, only a course named in prose.
 */
const MIN_NUMERIC_CELLS = 6;

/**
 * How far above or below a code's baseline the rest of its row may sit.
 *
 * The scheme sets the credits and the total marks on their own baseline a few
 * points above the course code, and the department cell a few points below, so
 * a row is not one baseline but a band. One text height either side spans the
 * band and still falls short of the next row, which is a little over two
 * heights away.
 */
const ROW_BAND = 1;

/**
 * How far BELOW a code's baseline a wrapped course title may continue.
 *
 * "Digital Design & Computer Organization" does not fit the title column, so
 * the scheme sets "Organization" on its own baseline just under the rest. That
 * is a little outside the row band the numbers need, and a little inside the
 * gap to the next course — so titles get their own, deeper reach downward
 * while the numeric columns keep the tight one.
 */
const TITLE_WRAP_BAND = 1.6;

function medianHeight(items: readonly PositionedText[]): number {
  const heights = items
    .map((item) => item.height)
    .filter((height) => height > 0)
    .sort((a, b) => a - b);
  return heights.length === 0 ? 10 : (heights[Math.floor(heights.length / 2)] as number);
}

/* -------------------------------------------------------------------------- */
/* Reading                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Every course the scheme states a credit figure for.
 *
 * The document is a table whose columns are stable across pages and whose rows
 * are not: the credit cell and the marks cell are typeset on their own
 * baselines, so a row has to be gathered as a BAND around the course code
 * rather than as a line. Within that band the columns are read by position —
 * the credits are the rightmost number, which is what makes the reading
 * independent of how many optional columns a particular semester prints.
 */
export function parseScheme(pages: readonly SchemePage[]): ParsedScheme {
  const usable = pages.flatMap((page) => page.items.filter((item) => item.text.trim() !== ''));
  const band = medianHeight(usable) * ROW_BAND;

  const courses: SchemeCourse[] = [];
  const rejected: SchemeRejection[] = [];
  const semesters = new Set<number>();

  for (const { page, items: raw } of pages) {
    const pageItems = raw.filter((item) => item.text.trim() !== '');
    const semester = semesterOf(pageItems);
    const departmentX = departmentColumn(pageItems);
    for (const item of pageItems) {
      const code = item.text.trim();
      if (!COURSE_CODE.test(code)) continue;

      /*
       * A course code appears in the option lists as well as in the table, and
       * an option list has no semester heading to belong to. Without one there
       * is no honest way to say which semester the row is for.
       */
      const row = pageItems.filter(
        (other) => Math.abs(other.y - item.y) <= band && other.x > item.x,
      );

      /*
       * The name beside the code, read before any refusal so that a row the
       * elective pass later recovers keeps the title the document gave it.
       * Deliberately loose: an option list has no columns to bound it.
       */
      const nearbyTitle = row
        .filter(
          (cell) =>
            !DEPARTMENT_CELL.test(cell.text.trim()) &&
            !WHOLE_NUMBER.test(cell.text.trim()) &&
            !COURSE_CODE.test(cell.text.trim()),
        )
        .sort((a, b) => a.x - b.x)
        .map((cell) => cell.text.trim())
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();

      if (semester === null) {
        rejected.push({
          code,
          page,
          title: nearbyTitle,
          reason: 'This page states no semester.',
        });
        continue;
      }
      const numbers = row
        .filter((cell) => WHOLE_NUMBER.test(cell.text.trim()))
        .sort((a, b) => a.x - b.x);

      if (numbers.length < MIN_NUMERIC_CELLS) {
        rejected.push({
          code,
          page,
          title: nearbyTitle,
          reason:
            'Listed as an elective option rather than in the table, so the scheme states no credits against it here.',
        });
        continue;
      }

      const credits = Number(numbers[numbers.length - 1]?.text ?? '');
      if (!Number.isInteger(credits) || credits > MAX_CREDITS) {
        rejected.push({
          code,
          page,
          title: nearbyTitle,
          reason: `The rightmost figure in this row is ${String(credits)}, which is not a credit count — the credits column could not be read.`,
        });
        continue;
      }

      /*
       * WHERE THE TITLE STOPS.
       *
       * The column to the right of the title names the teaching department,
       * and on some rows it does so in prose — "Any Department", "Physical
       * Education Director" — which no pattern over the text alone can tell
       * from part of a course's name. Its POSITION can: the department cells
       * that do label themselves (`TD:`, `PSB:`) fix the column's left edge for
       * the whole page, and everything from there rightwards is not the title.
       */
      /*
       * A wrapped title may reach down, but never as far as the next course.
       * The scheme packs some rows barely more than a text height apart, and
       * an unclamped reach reads the row below's title as part of this one's.
       */
      const nextCodeY = Math.max(
        ...pageItems
          .filter((cell) => cell.y < item.y - band && COURSE_CODE.test(cell.text.trim()))
          .map((cell) => cell.y),
        Number.NEGATIVE_INFINITY,
      );
      const titleFloor = Math.max(
        item.y - medianHeight(usable) * TITLE_WRAP_BAND,
        nextCodeY + band,
      );

      const title = pageItems
        .filter(
          (cell) =>
            cell.y <= item.y + band &&
            cell.y >= titleFloor &&
            cell.x > item.x &&
            cell.x < Math.min(departmentX, numbers[0]?.x ?? Number.POSITIVE_INFINITY) &&
            !DEPARTMENT_CELL.test(cell.text.trim()) &&
            !WHOLE_NUMBER.test(cell.text.trim()) &&
            !COURSE_CODE.test(cell.text.trim()),
        )
        .sort((a, b) => b.y - a.y || a.x - b.x)
        .map((cell) => cell.text.trim())
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();

      if (title === '') {
        rejected.push({ code, page, title: '', reason: 'The row prints no course title.' });
        continue;
      }

      semesters.add(semester);
      courses.push({ code, title, credits, semester, page, viaElectiveSlot: null });
    }
  }

  /*
   * ---------------------------------------------------------------------
   * THE ELECTIVE OPTIONS, AND THE SLOT THEY BELONG TO
   * ---------------------------------------------------------------------
   *
   * A scheme states an elective as a placeholder row carrying the credits —
   * `BCS306x`, 3 credits — and then lists the courses a student may choose
   * for it on the following page. The options have no columns of their own,
   * so the first pass refuses them; and on the real document that left a
   * student's semester with seven of nine credits and therefore NO SGPA,
   * because SGPA is credit-weighted across the whole semester.
   *
   * Reading the option's credits off its slot is not inventing them: the
   * document says these courses ARE the choices for that slot, and the slot
   * says what the choice is worth. VTU numbers them to match — the slot and
   * every one of its options share a course number, and only the letters
   * differ, because a lab option carries an L and a placeholder carries XX
   * where the department varies.
   *
   * So the number is the link, and it must be UNAMBIGUOUS: an option is
   * resolved only when exactly one slot in the whole scheme shares its
   * number. Two candidates, or none, and it stays unresolved with its reason.
   */
  const slots = courses.filter((course) => /x$/i.test(course.code));
  const inherited: SchemeCourse[] = [];
  const stillRejected: SchemeRejection[] = [];

  for (const rejection of rejected) {
    const number = /\d{3}/.exec(rejection.code)?.[0];
    const matches =
      number === undefined ? [] : slots.filter((slot) => /\d{3}/.exec(slot.code)?.[0] === number);

    const slot = matches.length === 1 ? matches[0] : undefined;
    if (slot === undefined) {
      stillRejected.push(
        matches.length > 1
          ? {
              ...rejection,
              reason: `More than one elective slot in this scheme carries course number ${String(number)}, so which credits apply cannot be settled.`,
            }
          : rejection,
      );
      continue;
    }

    semesters.add(slot.semester);
    inherited.push({
      code: rejection.code,
      /* The option's own title, where the first pass managed to read one. */
      title: rejection.title === '' ? rejection.code : rejection.title,
      credits: slot.credits,
      semester: slot.semester,
      page: rejection.page,
      viaElectiveSlot: slot.code,
    });
  }

  return {
    courses: [...courses, ...inherited],
    rejected: stillRejected,
    semesters: [...semesters].sort((a, b) => a - b),
    programme: headingMatch(usable, /B\.?E\.?\s+in\s+(.+)/i),
    schemeYear: headingMatch(usable, /Scheme\s+of\s+Teaching\s+and\s+Examinations\s*(20\d{2})/i),
  };
}

/**
 * The semester a page's table is for.
 *
 * Taken from the page's own heading, and only from a SHORT one. The body text
 * on the notes pages opens with "III semester to the VI semester (for 4
 * semesters)…", which matches the heading shape and would file a page of prose
 * under semester three.
 */
function semesterOf(pageItems: readonly PositionedText[]): number | null {
  for (const item of pageItems) {
    const text = item.text.trim();
    if (text.length > 24) continue;
    const match = SEMESTER_HEADING.exec(text);
    const roman = match?.[1]?.toUpperCase();
    if (roman !== undefined && roman in ROMAN) return ROMAN[roman] ?? null;
  }
  return null;
}

function headingMatch(items: readonly PositionedText[], pattern: RegExp): string | null {
  for (const item of items) {
    const match = pattern.exec(item.text.trim());
    const captured = match?.[1]?.trim();
    if (captured !== undefined && captured !== '') return captured;
  }
  return null;
}

/**
 * The left edge of the teaching-department column on one page.
 *
 * Taken from the cells that label themselves — `TD:CB`, `PSB: Maths` — because
 * they sit in the same column as the ones that do not, and there are always
 * several. With none, there is no ceiling to impose and the numeric columns
 * bound the title instead.
 */
function departmentColumn(pageItems: readonly PositionedText[]): number {
  const labelled = pageItems.filter((item) => DEPARTMENT_CELL.test(item.text.trim()));
  return labelled.length === 0
    ? Number.POSITIVE_INFINITY
    : Math.min(...labelled.map((item) => item.x));
}

/**
 * Positioned text from a whole document, grouped into the pages it came from.
 *
 * The extraction hands back one flat list tagged with page numbers, because
 * every other reader here treats a page boundary as noise. A scheme does not:
 * the semester a course belongs to is printed as its page's heading.
 */
export function schemePages(
  placed: readonly (PositionedText & { readonly page: number })[],
): SchemePage[] {
  const byPage = new Map<number, PositionedText[]>();
  for (const item of placed) {
    const bucket = byPage.get(item.page);
    if (bucket === undefined) byPage.set(item.page, [item]);
    else bucket.push(item);
  }
  return [...byPage.entries()].sort(([a], [b]) => a - b).map(([page, items]) => ({ page, items }));
}
