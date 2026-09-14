/**
 * Which first-year course a programme actually takes, on the document's word.
 *
 * Authority: Phase 7D §10, §18, §33 · docs/47
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS NOT A WIDER REGEX
 * ---------------------------------------------------------------------------
 *
 * The 2025 first-year scheme does not print a first year. It prints a TEMPLATE
 * of one:
 *
 *     1 ASC 1BMATx101  Applied Mathematics-I (Stream Specific)   ...  04
 *
 * and resolves the `x` elsewhere on the page, in an options table that names a
 * stream against each concrete code:
 *
 *     1BMATC101  Differential Calculus and Linear Algebra: CV Stream
 *     1BMATS101  Calculus and Linear Algebra: CSE Stream
 *
 * and in a third table that says which programmes a stream contains:
 *
 *     4 | Computer Science and Engineering Stream (CSE)
 *       | … (7) Computer Science and Business System (CB), …
 *
 * So a CSBS student's first-year mathematics is `1BMATS101`, and the document
 * says so in three printed steps rather than one. This module walks those
 * three steps and refuses to take any other route.
 *
 *     placeholder row  →  declared stream  →  concrete code  →  programme
 *
 * WHAT IT WILL NOT DO. It does not score titles for similarity, does not fall
 * back to "the option whose letters look closest", and does not resolve a slot
 * whose options name no stream at all. The Programme Specific Course
 * (`1Bxxx105x`) has ten options and not one of them names a stream — it is
 * keyed to the admitted PROGRAMME, which this document never maps — so it
 * comes back unresolved with that reason, and stays a choice nobody has made.
 *
 * THE CREDITS ALWAYS COME FROM THE PLACEHOLDER ROW, never from the option. The
 * options table prints L:T:P and no credit column, exactly as the elective
 * option lists do, so the slot is the only thing that states what the course is
 * worth.
 */

import type { PositionedText } from './positioned-text.js';
import type { ParsedScheme, SchemePage } from './scheme-import.js';

/* -------------------------------------------------------------------------- */
/* Shapes                                                                     */
/* -------------------------------------------------------------------------- */

/** One row of the "UG Programmes under the stream" table. */
export interface StreamMembership {
  /** As printed: "Computer Science and Engineering Stream (CSE)". */
  readonly streamName: string;
  /** The parenthesised short form the option titles use: "CSE". */
  readonly abbreviation: string;
  readonly programmes: readonly { readonly name: string; readonly code: string }[];
  readonly page: number;
}

/** A placeholder row resolved to the concrete course one stream takes. */
export interface ResolvedFirstYearCourse {
  /** The placeholder the document printed, canonicalised: `1BMATX101`. */
  readonly slotCode: string;
  readonly code: string;
  readonly title: string;
  /** The slot's credits. The options table prints none. */
  readonly credits: number;
  readonly semester: number;
  /** Where the concrete code was read. */
  readonly page: number;
  /** Where the placeholder row was read. */
  readonly slotPage: number;
}

/** A placeholder this document gives no way to resolve for this stream. */
export interface UnresolvedFirstYearSlot {
  readonly slotCode: string;
  readonly semester: number;
  readonly credits: number;
  readonly reason: string;
}

export interface FirstYearResolution {
  readonly resolved: readonly ResolvedFirstYearCourse[];
  readonly unresolved: readonly UnresolvedFirstYearSlot[];
}

/* -------------------------------------------------------------------------- */
/* The stream membership table                                                */
/* -------------------------------------------------------------------------- */

/**
 * The table's own heading, which is how the table is found rather than
 * guessed at by position.
 */
const MEMBERSHIP_HEADING = /UG\s+Programmes\s+under\s+the\s+stream/i;

/** A row number in the leftmost column: "1", "2", "3", "4". */
const ROW_NUMBER = /^[1-9]$/;

/** "… Stream (CSE)" — the short form the option titles are written with. */
const ABBREVIATION = /\(([A-Z]{2,4})\)\s*$/;

/** "(7) Computer Science and Business System (CB)". */
const PROGRAMME_ENTRY = /\(\d{1,2}\)\s*([^()]+?)\s*\(([A-Z]{2,3})\)/g;

/**
 * Every stream the document declares, with the programmes it contains.
 *
 * Read from the table's three columns by x-position, which the table makes
 * unambiguous: a row number on the left, the stream's name beside it, the
 * programme list to the right of that. Both of the wide cells wrap over
 * several lines, so a row is a vertical BAND between one row number and the
 * next rather than a single baseline.
 */
export function streamMembershipOf(pages: readonly SchemePage[]): StreamMembership[] {
  const memberships: StreamMembership[] = [];

  for (const { page, items } of pages) {
    const heading = items.find((item) => MEMBERSHIP_HEADING.test(item.text));
    if (heading === undefined) continue;

    /*
     * WHERE THE PROGRAMME COLUMN STARTS, FROM ITS CONTENT.
     *
     * Not from the heading: "UG Programmes under the stream with code" is
     * CENTRED over its column and begins well to the right of the text beneath
     * it, so using its left edge put the whole programme list on the wrong side
     * of the boundary and every row parsed to nothing.
     *
     * The list numbers its entries — "(1) Civil engineering (CV)" — and those
     * numbered entries appear nowhere else in the table, so the leftmost of
     * them is the column's true edge.
     */
    const numbered = items.filter(
      (item) => item.y < heading.y && /\(\d{1,2}\)\s*[A-Za-z]/.test(item.text),
    );
    if (numbered.length === 0) continue;
    const programmeColumn = Math.min(...numbered.map((item) => item.x));
    const numbers = items
      .filter((item) => ROW_NUMBER.test(item.text.trim()) && item.x < programmeColumn)
      .filter((item) => item.y < heading.y)
      .sort((a, b) => b.y - a.y);
    if (numbers.length === 0) continue;

    const numberColumn = Math.min(...numbers.map((item) => item.x));

    for (const [index, start] of numbers.entries()) {
      const next = numbers[index + 1];
      /* The band runs from this row number down to the next one. */
      const inBand = (item: PositionedText): boolean =>
        item.y <= start.y + 2 && (next === undefined || item.y > next.y + 2);

      const cell = (from: number, to: number): string =>
        items
          .filter((item) => inBand(item) && item.x >= from && item.x < to)
          .sort((a, b) => b.y - a.y || a.x - b.x)
          .map((item) => item.text.trim())
          .join(' ')
          .replace(/\s+/g, ' ')
          .trim();

      const streamName = cell(numberColumn + 10, programmeColumn);
      const programmeList = cell(programmeColumn, Number.POSITIVE_INFINITY);

      const abbreviation = ABBREVIATION.exec(streamName)?.[1];
      if (abbreviation === undefined || programmeList === '') continue;

      const programmes: { name: string; code: string }[] = [];
      PROGRAMME_ENTRY.lastIndex = 0;
      for (const match of programmeList.matchAll(PROGRAMME_ENTRY)) {
        const name = match[1]?.trim();
        const code = match[2];
        if (name === undefined || code === undefined || name.length < 3) continue;
        programmes.push({ name, code });
      }
      if (programmes.length === 0) continue;

      memberships.push({ streamName, abbreviation, programmes, page });
    }
  }

  return memberships;
}

/**
 * The stream a programme belongs to, or null when the document does not say.
 *
 * Matched on the programme's printed NAME, normalised only for the `&`/`and`
 * and the spacing that differ between the scheme's own heading ("Computer
 * Science & Business System") and this table ("Computer Science and Business
 * System"). That is a spelling difference in one word, not a similarity score:
 * everything else must be identical.
 */
export function streamForProgramme(
  memberships: readonly StreamMembership[],
  programmeName: string,
): StreamMembership | null {
  const normalise = (value: string): string =>
    value
      .toLowerCase()
      .replace(/&/g, ' and ')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();

  const wanted = normalise(programmeName);
  for (const membership of memberships) {
    if (membership.programmes.some((programme) => normalise(programme.name) === wanted)) {
      return membership;
    }
  }
  return null;
}

/**
 * Which of the two first-year CYCLES this document prints.
 *
 * The first year is not one year, it is two alternatives. A student takes the
 * physics cycle — physics in semester I, chemistry in II — or the chemistry
 * cycle, which is the same courses the other way round. Each document heads its
 * tables with the one it describes: "I Semester (Physic Group)".
 *
 * Both cycles resolve `1BMATX101` to the same `1BMATS101`, and they resolve
 * semester I's science to DIFFERENT courses — `1BPHYS102` against
 * `1BCHES102`. Stored under one identity those two become a semester that
 * requires both, which is a first year no student takes. So the cycle is read
 * and carried, and a caller that cannot say which cycle a student is in gets
 * two clearly separate answers instead of one wrong merged one.
 */
export function cycleGroupOf(pages: readonly SchemePage[]): string | null {
  for (const { items } of pages) {
    for (const item of items) {
      const match = /\b(Physic|Physics|Chemistry)\s*Group\b/i.exec(item.text);
      const word = match?.[1];
      if (word === undefined) continue;
      return /^chem/i.test(word) ? 'Chemistry Group' : 'Physics Group';
    }
  }
  return null;
}

/* -------------------------------------------------------------------------- */
/* The option's own printed cell                                              */
/* -------------------------------------------------------------------------- */

/** The shape of a concrete code in an options table. */
const OPTION_CODE = /^1?B[A-Z]{2,7}\d{3}[A-Za-z]?$/;

/** The baseline drift that still belongs to one printed row. */
const CELL_BAND = 2;

export interface OptionCell {
  readonly code: string;
  /** Only what is printed between this code and the next one on its row. */
  readonly text: string;
  readonly page: number;
}

/**
 * Each concrete code with the text of ITS OWN CELL, and nothing else.
 *
 * THE PARSER'S TITLE IS NOT SAFE TO TEST A STREAM AGAINST. The options tables
 * are laid out two sub-tables wide, so a row reads
 *
 *     1BESC104B  Introduction to Electrical Engineering  3 0 0  |  1BPLC105B  Python Programming (for CSE and allied programmes)  3
 *
 * and a title assembled by x-position alone runs straight through the divider.
 * `1BESC104B` is an Engineering Science option — a course the scheme explicitly
 * requires a student to pick from OUTSIDE their own stream — and it came back
 * resolved as the CSE stream's course, because the neighbouring cell mentions
 * CSE. One contaminated title, one wrong first-year course for every CSBS
 * student.
 *
 * So the cell is bounded by the thing that actually bounds it: the next course
 * code on the same baseline. A wrapped continuation line carries no code and
 * sits on its own baseline, so it is excluded too — which shortens some titles
 * and cannot import a neighbour's stream.
 */
export function optionCellsOf(pages: readonly SchemePage[]): OptionCell[] {
  const cells: OptionCell[] = [];

  for (const { page, items } of pages) {
    const descending = items
      .filter((item) => item.text.trim() !== '')
      .slice()
      .sort((a, b) => b.y - a.y);

    const bands: PositionedText[][] = [];
    let current: PositionedText[] = [];
    let baseline = 0;
    for (const item of descending) {
      if (current.length === 0) {
        baseline = item.y;
        current = [item];
      } else if (baseline - item.y <= CELL_BAND) {
        current.push(item);
      } else {
        bands.push(current);
        baseline = item.y;
        current = [item];
      }
    }
    if (current.length > 0) bands.push(current);

    for (const band of bands) {
      const row = band.slice().sort((a, b) => a.x - b.x);
      for (const [index, cell] of row.entries()) {
        const code = cell.text.trim();
        if (!OPTION_CODE.test(code)) continue;
        const parts: string[] = [];
        for (let next = index + 1; next < row.length; next += 1) {
          const text = (row[next] as PositionedText).text.trim();
          if (OPTION_CODE.test(text)) break;
          parts.push(text);
        }
        cells.push({ code, text: parts.join(' ').replace(/\s+/g, ' ').trim(), page });
      }
    }
  }

  return cells;
}

/* -------------------------------------------------------------------------- */
/* Resolving the placeholders                                                 */
/* -------------------------------------------------------------------------- */

/**
 * A placeholder row, in the two shapes the first-year tables print.
 *
 *   1BMATX101   the marker is INSIDE the code: "whichever stream's maths"
 *   1BPLC105x   the marker is the trailing letter, the elective-slot shape
 *
 * Both are slots; only the first is invisible to the elective pass, which
 * requires the trailing `x`. `stem` is the discipline letters before the
 * marker, and it is empty for `1BXXX105x` where the discipline varies too.
 */
const SLOT_SHAPE = /^(1?B)([A-Z]*?)(X*)(L?)(\d{3})([A-Za-z]?)$/;

interface Slot {
  readonly code: string;
  readonly stem: string;
  readonly number: string;
  readonly credits: number;
  readonly semester: number;
  readonly page: number;
}

function slotOf(code: string): { stem: string; number: string } | null {
  const match = SLOT_SHAPE.exec(code);
  if (match === null) return null;
  const stem = match[2] ?? '';
  const marker = match[3] ?? '';
  const number = match[5] ?? '';
  const tail = match[6] ?? '';
  /* A slot carries a marker somewhere: inside the code, or as its tail. */
  if (marker === '' && !/^x$/i.test(tail)) return null;
  return { stem, number };
}

/**
 * Whether a concrete option's printed title declares it to be this stream's.
 *
 * The abbreviation must appear as a WHOLE WORD. The titles write it several
 * ways — "CSE Stream", "(CSE stream)", "(CSE)", "for CSE and allied
 * programmes" — and all of them are the document naming the stream, while none
 * of the other options for the same slot mentions it at all.
 */
function namesStream(title: string, abbreviation: string): boolean {
  return new RegExp(`(^|[^A-Za-z])${abbreviation}([^A-Za-z]|$)`).test(title);
}

/**
 * The concrete first-year courses one stream takes, and the slots this
 * document leaves it no way to fill.
 *
 * Every candidate for a slot must share its course NUMBER and its discipline
 * stem, which is the same link the elective pass uses and the same one VTU
 * numbers its tables to make. Among those candidates exactly one must name the
 * stream: none means the slot is keyed to something this document does not
 * map, and more than one means the document contradicts itself. Both come back
 * unresolved, with which it was.
 */
export function resolveFirstYearForStream(
  pages: readonly SchemePage[],
  parsed: ParsedScheme,
  membership: StreamMembership,
): FirstYearResolution {
  const cells = optionCellsOf(pages);
  const slots: Slot[] = [];
  for (const course of parsed.courses) {
    const shape = slotOf(course.code);
    if (shape === null) continue;
    if (course.viaElectiveSlot !== null || course.viaAlternativeTo !== null) continue;
    slots.push({
      code: course.code,
      stem: shape.stem,
      number: shape.number,
      credits: course.credits,
      semester: course.semester,
      page: course.page,
    });
  }

  /*
   * Candidates are every concrete code this document printed that is not itself
   * a slot. Each is judged on ITS OWN CELL, never on a title assembled across
   * the divider between two side-by-side option tables.
   */
  const titles = new Map<string, string>();
  for (const row of [...parsed.rejected, ...parsed.courses]) {
    if (!titles.has(row.code) && row.title !== '') titles.set(row.code, row.title);
  }
  const candidates = [...new Map(cells.map((cell) => [cell.code, cell])).keys()]
    .filter((code) => slotOf(code) === null)
    .map((code) => ({
      code,
      cells: cells.filter((cell) => cell.code === code),
      title: titles.get(code) ?? code,
      page: cells.find((cell) => cell.code === code)?.page ?? 0,
    }));

  const resolved: ResolvedFirstYearCourse[] = [];
  const unresolved: UnresolvedFirstYearSlot[] = [];

  for (const slot of slots) {
    const forThisSlot = candidates.filter(
      (row) =>
        /\d{3}/.exec(row.code)?.[0] === slot.number &&
        (slot.stem === '' || row.code.startsWith(`1B${slot.stem}`) || row.code.startsWith(`B${slot.stem}`)),
    );
    const naming = forThisSlot.filter((row) =>
      row.cells.some((cell) => namesStream(cell.text, membership.abbreviation)),
    );

    if (naming.length === 1) {
      const chosen = naming[0] as { code: string; title: string; page: number };
      resolved.push({
        slotCode: slot.code,
        code: chosen.code,
        title: chosen.title,
        credits: slot.credits,
        semester: slot.semester,
        page: chosen.page,
        slotPage: slot.page,
      });
      continue;
    }

    unresolved.push({
      slotCode: slot.code,
      semester: slot.semester,
      credits: slot.credits,
      reason:
        naming.length > 1
          ? `${String(naming.length)} of this slot's options name the ${membership.abbreviation} stream, so which one applies cannot be settled.`
          : forThisSlot.length === 0
            ? 'No option for this placeholder is printed in this document.'
            : `None of this slot's ${String(forThisSlot.length)} options names the ${membership.abbreviation} stream, so it is keyed to something this document does not map.`,
    });
  }

  return { resolved, unresolved };
}
