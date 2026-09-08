/**
 * Reading a Scheme of Teaching as a course catalogue.
 *
 * Authority: Phase 7C §7, §8, §10, §33 · docs/08 §8.20
 *
 * ---------------------------------------------------------------------------
 * SYNTHETIC BY CONSTRUCTION
 * ---------------------------------------------------------------------------
 *
 * The fixtures below reproduce the LAYOUT of a VTU scheme — the column
 * positions, the credit cell set a few points above the course code, the
 * wrapped title, the elective options with no credit column — using invented
 * course codes and invented titles. The real document stays out of the
 * repository (§7); what is committed is the shape the reader has to survive,
 * which is the part a test can actually assert on.
 */

import { describe, expect, it } from 'vitest';
import { parseScheme, type SchemePage } from '../src/domain/scheme-import.js';
import type { PositionedText } from '../src/domain/pdf-layout.js';

/** Column x-positions, in the proportions the scheme prints them. */
const COL = {
  serial: 61,
  category: 93,
  code: 140,
  title: 195,
  department: 423,
  lecture: 493,
  tutorial: 526,
  practical: 559,
  duration: 632,
  cie: 670,
  see: 711,
  total: 750,
  credits: 789,
} as const;

const HEIGHT = 11;

function at(text: string, x: number, y: number): PositionedText {
  return { text, x, y, width: text.length * 5, height: HEIGHT };
}

/**
 * One table row, typeset the way the scheme typesets one.
 *
 * The credits and total marks sit on their OWN baseline six points above the
 * course code, and the teaching department six points below. Nothing about
 * this is unusual for the document; it is why a row cannot be read as a line.
 */
function row(
  y: number,
  code: string,
  title: string,
  credits: number,
  options: { readonly practical?: number; readonly wrapped?: string } = {},
): PositionedText[] {
  return [
    at('1', COL.serial, y),
    at('PCC', COL.category, y),
    at(code, COL.code, y),
    at(title, COL.title, y),
    at('TD:CB', COL.department, y + 7),
    at('PSB:CS', COL.department, y - 4),
    at('100', COL.total, y + 6),
    at(String(credits), COL.credits, y + 6),
    at('3', COL.lecture, y),
    at('0', COL.tutorial, y),
    at(String(options.practical ?? 0), COL.practical, y),
    at('03', COL.duration, y),
    at('50', COL.cie, y),
    at('50', COL.see, y),
    ...(options.wrapped === undefined ? [] : [at(options.wrapped, COL.title, y - 13)]),
  ];
}

const HEADING = [
  at('B.E. in Invented Studies', 313, 491),
  at('Scheme of Teaching and Examinations 2022', 319, 477),
  at('IV SEMESTER', 56, 435),
];

const page = (...rows: readonly PositionedText[][]): SchemePage[] => [
  { page: 1, items: [...HEADING, ...rows.flat()] },
];

/* -------------------------------------------------------------------------- */

describe('reading the scheme table', () => {
  it('reads the credits from the rightmost column, not the total marks beside it', () => {
    /*
     * The two live next to each other and the total is nearly always 100. A
     * reader that took the last number on the code's own baseline would get
     * 50, and one that took the largest would get 100 — a semester of
     * hundred-credit courses.
     */
    const parsed = parseScheme(page(row(322, 'BQQ401', 'Invented Course One', 4)));

    expect(parsed.courses).toHaveLength(1);
    expect(parsed.courses[0]).toMatchObject({
      code: 'BQQ401',
      title: 'Invented Course One',
      credits: 4,
      semester: 4,
    });
  });

  it('takes the semester from the page heading rather than from the code', () => {
    // BQQ401's digits say "fourth semester" and the reader must not care: a
    // scheme page states its own semester, and a code is not a promise.
    const parsed = parseScheme([
      {
        page: 1,
        items: [
          at('B.E. in Invented Studies', 313, 491),
          at('VII SEMESTER', 56, 435),
          ...row(322, 'BQQ401', 'Invented Course One', 4),
        ],
      },
    ]);
    expect(parsed.courses[0]?.semester).toBe(7);
  });

  it('keeps a title that wrapped onto its own baseline', () => {
    const parsed = parseScheme(
      page(row(322, 'BQQ402', 'Invented Design and Course', 4, { wrapped: 'Organisation' })),
    );
    expect(parsed.courses[0]?.title).toBe('Invented Design and Course Organisation');
  });

  it('does not read the next course’s title into this one', () => {
    /*
     * Some rows sit barely more than a text height apart, so the reach a
     * wrapped title needs is longer than the gap to the row below. The stop is
     * the next course code, not a distance.
     */
    const parsed = parseScheme(
      page(
        row(322, 'BQQ403', 'Invented Course Three', 3),
        row(308, 'BQQ404', 'Invented Course Four', 2),
      ),
    );
    expect(parsed.courses[0]?.title).toBe('Invented Course Three');
    expect(parsed.courses[1]?.title).toBe('Invented Course Four');
  });

  it('leaves the teaching department out of the course title', () => {
    // Some rows name the department in prose — "Any Department" — which no
    // pattern over the words can tell from part of a course's name. Its
    // COLUMN can.
    const parsed = parseScheme(
      page([...row(322, 'BQQ405', 'Invented Course Five', 1), at('Any Department', 440, 322)]),
    );
    expect(parsed.courses[0]?.title).toBe('Invented Course Five');
  });

  it('reads a non-credit course as genuinely zero credits', () => {
    // §33: zero is an answer here, not an absence. A mandatory non-credit
    // course really is worth nothing towards the average.
    const parsed = parseScheme(
      page([
        at('BQQ459', COL.code, 322),
        at('Invented Mandatory Course', COL.title, 322),
        at('0', COL.lecture, 322),
        at('0', COL.tutorial, 322),
        at('100', COL.cie, 322),
        at('100', COL.total, 328),
        at('0', COL.credits, 328),
        at('2', COL.practical, 322),
      ]),
    );
    expect(parsed.courses[0]?.credits).toBe(0);
    expect(parsed.rejected).toHaveLength(0);
  });
});

describe('what the scheme does not state', () => {
  it('gives an elective option the credits of the slot it is an option for', () => {
    /*
     * Below each table the scheme lists the courses a student may CHOOSE for
     * an elective slot. Those rows have no columns of their own — the credits
     * belong to the placeholder row (`BQQ415x`) above, and the option inherits
     * them.
     *
     * This is reading the document, not guessing at it: the scheme says these
     * courses ARE the choices for that slot, and VTU numbers them to match, so
     * the course number is the link. On the real document, refusing them left
     * a student's semester at seven of nine credits and therefore no SGPA at
     * all, because SGPA is credit-weighted across the whole semester.
     */
    const parsed = parseScheme(
      page(row(322, 'BQQ415x', 'Invented Elective Slot', 3), [
        at('BQQ415A', COL.code, 200),
        at('Invented Elective Option', COL.title, 200),
      ]),
    );

    const option = parsed.courses.find((course) => course.code === 'BQQ415A');
    expect(option).toMatchObject({
      credits: 3,
      semester: 4,
      viaElectiveSlot: 'BQQ415x',
      title: 'Invented Elective Option',
    });
    /* And the slot itself is still a course, stating its own credits. */
    expect(parsed.courses.find((c) => c.code === 'BQQ415x')?.viaElectiveSlot).toBeNull();
    expect(parsed.rejected).toHaveLength(0);
  });

  it('refuses an option when two slots could be the one it belongs to', () => {
    /*
     * The link is the course NUMBER, and it has to be unambiguous. Two slots
     * sharing a number would make the inherited figure a coin toss, and a
     * wrong credit goes straight into a real SGPA.
     */
    const parsed = parseScheme([
      {
        page: 1,
        items: [
          ...HEADING,
          ...row(322, 'BQQ415x', 'First Slot', 3),
          ...row(298, 'BZZ415x', 'Second Slot', 4),
          at('BQQ415A', COL.code, 200),
          at('Invented Elective Option', COL.title, 200),
        ],
      },
    ]);

    expect(parsed.courses.map((c) => c.code).sort()).toEqual(['BQQ415x', 'BZZ415x']);
    expect(parsed.rejected[0]?.reason).toMatch(/more than one elective slot/i);
  });

  it('refuses an option no slot accounts for', () => {
    const parsed = parseScheme(
      page(row(322, 'BQQ415x', 'Invented Elective Slot', 3), [
        at('BQQ999A', COL.code, 200),
        at('Unrelated Course', COL.title, 200),
      ]),
    );

    expect(parsed.courses.map((c) => c.code)).toEqual(['BQQ415x']);
    expect(parsed.rejected[0]).toMatchObject({ code: 'BQQ999A' });
    expect(parsed.rejected[0]?.reason).toMatch(/elective option/i);
  });

  it('refuses a page that states no semester rather than guessing one', () => {
    const parsed = parseScheme([{ page: 2, items: row(322, 'BQQ406', 'Invented Course Six', 4) }]);
    expect(parsed.courses).toHaveLength(0);
    expect(parsed.rejected[0]?.reason).toMatch(/states no semester/i);
  });

  it('does not read a semester out of the running prose on a notes page', () => {
    /*
     * The notes pages open "III semester to the VI semester (for 4
     * semesters)…", which matches the heading's own shape. Filing a page of
     * prose under semester three would attach its elective lists to a real
     * table.
     */
    const parsed = parseScheme([
      {
        page: 2,
        items: [
          at(
            'III semester to the VI semester (for 4 semesters). Successful completion is mandatory.',
            60,
            435,
          ),
          ...row(322, 'BQQ407', 'Invented Course Seven', 4),
        ],
      },
    ]);
    expect(parsed.courses).toHaveLength(0);
  });

  it('refuses a row whose rightmost figure cannot be a credit count', () => {
    // A row that lost its credits column ends at the total marks. Reading 100
    // as the credits would be worse than reading nothing.
    const parsed = parseScheme(
      page([
        at('BQQ408', COL.code, 322),
        at('Invented Course Eight', COL.title, 322),
        at('3', COL.lecture, 322),
        at('0', COL.tutorial, 322),
        at('0', COL.practical, 322),
        at('03', COL.duration, 322),
        at('50', COL.cie, 322),
        at('50', COL.see, 322),
        at('100', COL.total, 328),
      ]),
    );
    expect(parsed.courses).toHaveLength(0);
    expect(parsed.rejected[0]?.reason).toMatch(/not a credit count/i);
  });
});

describe('what the document says about itself', () => {
  it('names the programme and the scheme year from the heading', () => {
    const parsed = parseScheme(page(row(322, 'BQQ409', 'Invented Course Nine', 4)));
    expect(parsed.programme).toBe('Invented Studies');
    expect(parsed.schemeYear).toBe('2022');
  });

  it('lists the semesters it actually covers, and no others', () => {
    const parsed = parseScheme([
      { page: 1, items: [at('IV SEMESTER', 56, 435), ...row(322, 'BQQ410', 'Four', 4)] },
      { page: 3, items: [at('VI SEMESTER', 56, 435), ...row(322, 'BQQ610', 'Six', 4)] },
    ]);
    expect(parsed.semesters).toEqual([4, 6]);
  });

  it('reads nothing at all from an empty document', () => {
    const parsed = parseScheme([]);
    expect(parsed.courses).toHaveLength(0);
    expect(parsed.semesters).toHaveLength(0);
    expect(parsed.programme).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* Two courses that share one row                                             */
/* -------------------------------------------------------------------------- */

/**
 * A first-year table offers some slots as a choice between two named courses
 * and prints ONE set of columns for the pair, on the row carrying "OR":
 *
 *     BQQ106   Invented Course A
 *        OR                        1 0 0 0  01  50 50 100  01
 *     BQQ206   Invented Course B
 *
 * Seven real courses were unresolved because of this, which left the student's
 * first two semesters without credits and therefore without an SGPA.
 */
describe('an OR row shared by two alternative courses', () => {
  /** The pair's shared columns, short: serial, marks, total, credits. */
  const sharedRow = (y: number, credits: number): PositionedText[] => [
    at('OR', COL.title + 80, y),
    at('6', COL.serial, y),
    at('01', COL.duration, y),
    at('50', COL.cie, y),
    at('50', COL.see, y),
    at('100', COL.total, y),
    at(String(credits).padStart(2, '0'), COL.credits, y),
  ];

  const pair = (creditsOnRow: number): SchemePage[] =>
    page([
      at('BQQ106', COL.code, 258),
      at('Invented Course A', COL.title, 258),
      ...sharedRow(239, creditsOnRow),
      at('BQQ206', COL.code, 222),
      at('Invented Course B', COL.title, 222),
    ]);

  it('gives both options the credits the shared row states', () => {
    const parsed = parseScheme(pair(1));
    const a = parsed.courses.find((c) => c.code === 'BQQ106');
    const b = parsed.courses.find((c) => c.code === 'BQQ206');

    expect(a).toMatchObject({ credits: 1, semester: 4, viaAlternativeTo: 'BQQ206' });
    expect(b).toMatchObject({ credits: 1, semester: 4, viaAlternativeTo: 'BQQ106' });
  });

  it('keeps each option’s own title, and the marker out of it', () => {
    const parsed = parseScheme(pair(1));
    expect(parsed.courses.find((c) => c.code === 'BQQ106')?.title).toBe('Invented Course A');
    expect(parsed.courses.find((c) => c.code === 'BQQ206')?.title).toBe('Invented Course B');
  });

  it('does not take a NEIGHBOURING row’s credits when the pair has none of its own', () => {
    /*
     * THE FAILURE MODE THIS RULE EXISTS TO AVOID (§7). With no columns on the
     * OR baseline the pair is unresolved — it does not reach up or down for
     * the nearest number it can find, because that number belongs to another
     * course and would enter a real SGPA as though it were theirs.
     */
    const parsed = parseScheme(
      page(row(322, 'BQQ401', 'A Course With Its Own Row', 4), [
        at('BQQ106', COL.code, 258),
        at('Invented Course A', COL.title, 258),
        at('OR', COL.title + 80, 239),
        at('BQQ206', COL.code, 222),
        at('Invented Course B', COL.title, 222),
      ]),
    );

    expect(parsed.courses.map((c) => c.code)).toEqual(['BQQ401']);
    expect(parsed.courses.find((c) => c.code === 'BQQ106')).toBeUndefined();
  });

  it('needs a code on BOTH sides of the marker', () => {
    // An "OR" with nothing above it pairs nothing, and resolves nothing.
    const parsed = parseScheme(
      page([...sharedRow(239, 1), at('BQQ206', COL.code, 222), at('Only One', COL.title, 222)]),
    );
    expect(parsed.courses.find((c) => c.code === 'BQQ206')).toBeUndefined();
  });

  it('does not treat the word "or" inside a title as a marker', () => {
    const parsed = parseScheme(page(row(322, 'BQQ402', 'Measurement or Estimation Methods', 4)));
    expect(parsed.courses.find((c) => c.code === 'BQQ402')?.credits).toBe(4);
    expect(parsed.courses.every((c) => c.viaAlternativeTo === null)).toBe(true);
  });
});
