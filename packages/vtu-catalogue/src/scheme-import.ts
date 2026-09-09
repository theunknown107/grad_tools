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

import type { PositionedText } from './positioned-text.js';

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
  /**
   * The course this one is an ALTERNATIVE to, when the scheme pairs them.
   *
   * A first-year table offers some slots as a choice between two named
   * courses — "Communicative English" OR "Professional Writing Skills" — and
   * prints ONE set of columns for the pair, on the row carrying the word "OR".
   * Both options are worth what that row says. Null for an ordinary course.
   */
  readonly viaAlternativeTo: string | null;
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

/*
 * THE SPACE IS OPTIONAL, because a PDF's text runs do not have to respect it.
 * The first-year CSE-stream scheme heads its tables "ISemester (CSE" and
 * "IISemester(CSEStream)" — the roman numeral and the word arrive in one run
 * with nothing between them. Requiring whitespace there made this reader miss
 * every physics-group table and file the chemistry-group ones as semesters 1
 * and 2: the wrong cycle's courses under the right numbers.
 */
const SEMESTER_HEADING = /^(I|II|III|IV|V|VI|VII|VIII)\s*SEMESTER\b/i;

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
 *
 * A COLON IS REQUIRED, and that is the whole point. The first-year scheme
 * prints a column HEADER reading "TD/PSB" — no colon, and further left than any
 * value in the column. Matching it made the header's own position the ceiling
 * for every title on the page, so titles beginning at exactly that x were
 * clipped to nothing and their courses refused for "no course title". A
 * department VALUE always names a department after a colon; a header does not.
 */
const DEPARTMENT_CELL = /^(TD|PSB)\b[^:]{0,14}:/i;

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
 * The word a scheme prints between two courses a student picks ONE of.
 *
 * The whole cell, not a word inside one: a title containing "or" is not an
 * alternative marker.
 */
const ALTERNATIVE_MARKER = /^OR$/i;

/**
 * The fewest numeric cells a SHARED alternative row prints.
 *
 * Shorter than a full course row, because the pair's row carries the serial
 * number, the marks heads, the total and the credits without repeating the
 * teaching pattern. Below this the columns are not on this baseline at all.
 */
const MIN_SHARED_CELLS = 4;

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
      courses.push({
        code,
        title,
        credits,
        semester,
        page,
        viaElectiveSlot: null,
        viaAlternativeTo: null,
      });
    }
  }

  /*
   * ---------------------------------------------------------------------
   * ALTERNATIVE COURSES, AND THE ROW THEY SHARE
   * ---------------------------------------------------------------------
   *
   * A first-year table offers some slots as a choice between two named
   * courses and prints ONE set of columns for the pair. The layout is not
   * ambiguous — it is a structure the document states:
   *
   *     BENGK106   Communicative English
   *          OR                             1 0 0 0  01  50 50 100  01
   *     BPWSK106   Professional Writing Skills
   *
   * The word "OR" is the marker, the course above and the course below are
   * its two options, and the columns on the OR row's OWN baseline belong to
   * the pair. Both options are worth what that row says.
   *
   * This deliberately does NOT widen the row band, take the nearest number
   * below a course, or special-case the seven codes that exposed it (§7).
   * Any of those would eventually hand a course its neighbour's credits. The
   * relationship is read from the document's own marker or it is not read.
   */
  const alternatives: SchemeCourse[] = [];
  for (const { page, items: raw } of pages) {
    const pageItems = raw.filter((item) => item.text.trim() !== '');
    const semester = semesterOf(pageItems);
    if (semester === null) continue;

    const codeCells = pageItems.filter((cell) => COURSE_CODE.test(cell.text.trim()));

    for (const marker of pageItems.filter((cell) => ALTERNATIVE_MARKER.test(cell.text.trim()))) {
      const above = codeCells.filter((c) => c.y > marker.y).sort((a, b) => a.y - b.y)[0];
      const below = codeCells.filter((c) => c.y < marker.y).sort((a, b) => b.y - a.y)[0];
      if (above === undefined || below === undefined) continue;

      const numbers = pageItems
        .filter(
          (cell) => Math.abs(cell.y - marker.y) <= band && WHOLE_NUMBER.test(cell.text.trim()),
        )
        .sort((a, b) => a.x - b.x);

      /*
       * The shared row is short — a serial number, the marks heads, the total
       * and the credits. Fewer than that and the columns are not on this
       * baseline, so the pair stays unresolved rather than borrowing from a
       * neighbouring row.
       */
      if (numbers.length < MIN_SHARED_CELLS) continue;
      const credits = Number(numbers[numbers.length - 1]?.text ?? '');
      if (!Number.isInteger(credits) || credits > MAX_CREDITS) continue;

      for (const [option, partner] of [
        [above, below],
        [below, above],
      ] as const) {
        const code = option.text.trim();
        if (courses.some((c) => c.code === code && c.semester === semester)) continue;
        if (alternatives.some((c) => c.code === code && c.semester === semester)) continue;
        alternatives.push({
          code,
          title: titleBeside(pageItems, option, band, departmentColumn(pageItems)),
          credits,
          semester,
          page,
          viaElectiveSlot: null,
          viaAlternativeTo: partner.text.trim(),
        });
      }
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
  /*
   * Slots include those the alternative pass just resolved. The ETC and PLC
   * slots are themselves printed as an OR pair, so their options could not
   * find them while this ran first.
   */
  const slots = [...courses, ...alternatives].filter((course) => /x$/i.test(course.code));
  const inherited: SchemeCourse[] = [];
  const stillRejected: SchemeRejection[] = [];

  for (const rejection of rejected) {
    const number = /\d{3}/.exec(rejection.code)?.[0];
    const matches =
      number === undefined ? [] : slots.filter((slot) => /\d{3}/.exec(slot.code)?.[0] === number);

    /*
     * SEVERAL SLOTS ARE FINE WHEN THEY SAY THE SAME THING.
     *
     * A first-year scheme prints its tables once per cycle group — the same
     * `BESCK104x` slot appears in the physics-group semester 1 and again in the
     * chemistry-group semester 1, both worth 3 credits. Refusing that as
     * ambiguous was over-cautious: nothing about the figure is in doubt.
     *
     * What must be unambiguous is the ANSWER, not the number of places it is
     * written. Slots that disagree on credits or on the semester leave the
     * option unresolved, because then there really is a choice to make and
     * nothing in the document makes it.
     */
    const agreed =
      matches.length > 0 &&
      new Set(matches.map((m) => `${String(m.credits)}@${String(m.semester)}`)).size === 1;
    /*
     * Where several agreeing slots share a number, prefer the one whose letters
     * match the option's own. `BPLCK205B` belongs to the `BPLCK205x` slot, not
     * to the `BETCK205x` it is printed beside — they are an OR pair with the
     * same credits, so the figure was right either way, but the attribution
     * was not. Exact prefix, never a similarity score.
     */
    const prefixOf = (value: string) => /^[A-Z]+/.exec(value)?.[0] ?? '';
    const slot = agreed
      ? (matches.find((m) => prefixOf(m.code) === prefixOf(rejection.code)) ?? matches[0])
      : undefined;
    if (slot === undefined) {
      stillRejected.push(
        matches.length > 1
          ? {
              ...rejection,
              reason: `More than one elective slot carries course number ${String(number)} and they do not agree on the credits, so which applies cannot be settled.`,
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
      viaAlternativeTo: null,
    });
  }

  const resolvedByAlternative = new Set(alternatives.map((c) => c.code));

  return {
    courses: [...courses, ...inherited, ...alternatives],
    rejected: stillRejected.filter((r) => !resolvedByAlternative.has(r.code)),
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

/**
 * The title printed beside one course code.
 *
 * Shared by the main pass and the alternative pass so a course recovered from
 * an OR group is named the same way as any other.
 */
function titleBeside(
  pageItems: readonly PositionedText[],
  code: PositionedText,
  band: number,
  departmentX: number,
): string {
  return pageItems
    .filter(
      (cell) =>
        Math.abs(cell.y - code.y) <= band &&
        cell.x > code.x &&
        cell.x < departmentX &&
        !DEPARTMENT_CELL.test(cell.text.trim()) &&
        !WHOLE_NUMBER.test(cell.text.trim()) &&
        !COURSE_CODE.test(cell.text.trim()) &&
        !ALTERNATIVE_MARKER.test(cell.text.trim()),
    )
    .sort((a, b) => a.x - b.x)
    .map((cell) => cell.text.trim())
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/* -------------------------------------------------------------------------- */
/* The totals a scheme prints for itself                                      */
/* -------------------------------------------------------------------------- */

export interface SemesterTotal {
  readonly semester: number;
  /** The credit figure the document's own TOTAL row states. */
  readonly credits: number;
  readonly page: number;
}

/**
 * The credit total each semester's table prints on its own TOTAL row.
 *
 * This is the document checking our arithmetic, which is the only check worth
 * having: a parser that reads every row wrongly and consistently produces a
 * catalogue that looks self-consistent. VTU prints the answer at the foot of
 * each table —
 *
 *     TOTAL   400   400   800   20
 *
 * — and the last figure on that row is the credits. Marks columns come first
 * and are much larger, so "the last number" is not a guess about column order:
 * it is where the credits column is, in both templates seen.
 *
 * DELIBERATELY SEPARATE FROM `parseScheme`. The parser's behaviour against
 * seventeen real documents is verified, and a validation aid has no business
 * changing what it returns.
 */
export function semesterTotalsOf(pages: readonly SchemePage[]): SemesterTotal[] {
  const totals: SemesterTotal[] = [];
  /*
   * The heading CARRIES FORWARD. A semester's table runs across pages and only
   * its first page prints "III SEMESTER", so requiring the heading on the same
   * page as the TOTAL row lost every total that fell on a continuation page.
   */
  let semester: number | null = null;
  for (const { page, items } of pages) {
    semester = semesterOf(items) ?? semester;
    if (semester === null) continue;

    for (const row of rowsOf(items)) {
      const first = row[0]?.text.trim() ?? '';
      if (!/^TOTAL\b/i.test(first)) continue;

      const numbers = row
        .slice(1)
        .map((cell) => cell.text.trim())
        .filter((text) => WHOLE_NUMBER.test(text));
      const credits = Number(numbers[numbers.length - 1] ?? '');
      /*
       * A plausible semester's worth of credits.
       *
       * Both ends of the range matter. A TOTAL row yielding 800 is the marks
       * column, read because the credits cell was not on this baseline. A row
       * yielding 2 is a running-header fragment — the CSBS scheme's first page
       * produces "Total | 2" and "Total | d" from its page furniture. Either
       * one, reported, would fail a comparison for a reason that has nothing
       * to do with the catalogue.
       *
       * No VTU semester is worth fewer than ten credits or more than thirty.
       */
      if (!Number.isInteger(credits) || credits < 10 || credits > 30) continue;
      totals.push({ semester, credits, page });
    }
  }
  return totals;
}

/** The page's text clustered onto printed rows, left to right. */
function rowsOf(items: readonly PositionedText[]): PositionedText[][] {
  const rows = new Map<number, PositionedText[]>();
  for (const item of items) {
    if (item.text.trim() === '') continue;
    const key = Math.round(item.y);
    const bucket = rows.get(key);
    if (bucket === undefined) rows.set(key, [item]);
    else bucket.push(item);
  }
  return [...rows.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([, cells]) => cells.sort((a, b) => a.x - b.x));
}
