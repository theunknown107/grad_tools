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
import {
  parseScheme,
  semesterTotalsOf,
  supersedingPairIn,
  type SchemePage,
} from '@gradtools/vtu-catalogue';
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

describe('a course code longer than four letters', () => {
  it('reads a row whose department needs five', () => {
    /*
     * THE DEFECT THIS EXISTS FOR. The pattern was `B[A-Z]{2,4}` while the
     * comment above it said "the same shape family the result importer
     * accepts" — and that importer takes `B[A-Z]{2,6}`. So a row like
     * `BMATEC301`, "Mathematics-III for EC Engineering", was not a row at all:
     * it was not read, not rejected, and not reported. Its three credits were
     * simply missing from every semester total the document prints, and the
     * only sign was a total that disagreed.
     *
     * EVERY VALUE IS SYNTHETIC; `BQQMAT301` is not a VTU code.
     */
    const parsed = parseScheme(
      page(
        row(322, 'BQQMAT301', 'Invented Mathematics for Invented Engineering', 3),
        row(300, 'BQQ302', 'Invented Course Two', 4),
      ),
    );

    expect(parsed.courses.map((course) => course.code)).toEqual(['BQQMAT301', 'BQQ302']);
    expect(parsed.courses.reduce((sum, course) => sum + course.credits, 0)).toBe(7);
  });

  it('keeps the LATER scheme family distinct instead of collapsing it onto this one', () => {
    /*
     * THIS TEST USED TO ASSERT THAT THE ROW WAS DISCARDED, and the reason it
     * gave was that "the leading digit is a different scheme year, and reading
     * it as this one would reattribute a course to the wrong year".
     *
     * The danger is real and refusing to read the row never addressed it. A
     * discarded row is not a row filed under the right year; it is a course
     * missing from the catalogue, and a whole 2025 document parsed to nothing
     * at all — which looks exactly like a document containing no courses.
     *
     * What actually prevents reattribution is that `scheme_year` is part of a
     * course's identity, read from the document's own heading, so `BQQMAT101`
     * and `1BQQMAT101` are two codes in two schemes and neither can overwrite
     * the other. So the property worth asserting is the one below: the code is
     * read EXACTLY as printed. The digit is never dropped, and never grown.
     */
    const later = parseScheme(page(row(322, '1BQQMAT101', 'Invented Later-Scheme Course', 3)));
    expect(later.courses.map((course) => course.code)).toEqual(['1BQQMAT101']);

    const earlier = parseScheme(page(row(322, 'BQQMAT101', 'Invented Course', 3)));
    expect(earlier.courses.map((course) => course.code)).toEqual(['BQQMAT101']);
  });
});

describe('a row whose code cell names more than one code', () => {
  /*
   * One printed row, one set of columns, several codes. VTU writes it three
   * ways, and none of them matched a pattern anchored on a single code — so
   * the whole row went unread, and with it the credits the document counts in
   * its own semester total. Thirteen of the twenty-two semesters that
   * disagreed with their printed total disagreed for this reason.
   *
   * EVERY VALUE IS SYNTHETIC.
   */
  it('reads a cell that slashes two whole codes together', () => {
    const parsed = parseScheme(page(row(322, 'BQQ358x/BQQL358x', 'Invented Enhancement Course', 1)));

    expect(parsed.courses.map((course) => [course.code, course.viaAlternativeTo])).toEqual([
      ['BQQ358x', null],
      ['BQQL358x', 'BQQ358x'],
    ]);
    /* The row's credits, once: the first code carries it. */
    expect(parsed.courses.filter((course) => course.viaAlternativeTo === null)).toHaveLength(1);
  });

  it('takes only the printed code from a shared tail, and invents no twin', () => {
    /*
     * `BQQ/ST306x` says the row is `BQQ306x` and is also offered under an
     * `ST` code that is never printed in full. Composing `BST306x` would be
     * writing a code the document does not — and a composed code ending in
     * `x` then behaves as an elective slot with no options to offer.
     */
    const parsed = parseScheme(page(row(322, 'BQQ/ST306x', 'Invented Science Course', 3)));

    expect(parsed.courses.map((course) => course.code)).toEqual(['BQQ306x']);
    expect(parsed.courses[0]?.viaAlternativeTo).toBeNull();
  });

  it('reads two codes set side by side as one row', () => {
    /*
     *     4 BSC BQQC407 BQQK407 Invented Biology ... 2
     *
     * Two codes in the code cell, one set of columns. Read as two rows they
     * were each charged the row's credits and the semester came out over its
     * own printed total by exactly the duplicate.
     */
    const parsed = parseScheme(
      page([
        ...row(322, 'BQQC407', 'Invented Biology for Engineers', 2),
        at('BQQK407', COL.code + 40, 322),
      ]),
    );

    const rows = parsed.courses.filter((course) => course.viaAlternativeTo === null);
    expect(rows.map((course) => course.code)).toEqual(['BQQC407']);
    expect(parsed.courses.find((course) => course.code === 'BQQK407')?.viaAlternativeTo).toBe(
      'BQQC407',
    );
  });

  it('never makes a course its own alternative', () => {
    /* A run repeated by the extractor would otherwise be a choice of one. */
    const parsed = parseScheme(
      page([...row(322, 'BQQ401', 'Invented Course One', 4), at('BQQ401', COL.code + 40, 322)]),
    );
    expect(parsed.courses.every((course) => course.viaAlternativeTo !== course.code)).toBe(true);
  });
});

describe('a code cell the PDF broke apart', () => {
  /*
   * The runs a producer emits are not the cells a table has — the same
   * principle the result-card reader had to learn. Two shapes cost the scheme
   * reader six rows, and with them the credits their documents count in their
   * own totals.
   *
   * EVERY VALUE IS SYNTHETIC.
   */
  it('joins runs that touch on one baseline into the code they spell', () => {
    /*
     * The Ability Enhancement code arrives in pieces with NO gap between them:
     * each ends exactly where the next begins, all in the code column.
     */
    const pieces = [
      { text: 'B', x: COL.code, y: 322, width: 6, height: HEIGHT },
      { text: 'QQ', x: COL.code + 6, y: 322, width: 15, height: HEIGHT },
      { text: '456x', x: COL.code + 21, y: 322, width: 21, height: HEIGHT },
    ];
    const parsed = parseScheme(
      page([...row(322, 'BQQIGNORED', 'Invented Enhancement Course', 1), ...pieces].filter(
        (item) => item.text !== 'BQQIGNORED',
      )),
    );

    expect(parsed.courses.map((course) => course.code)).toEqual(['BQQ456x']);
    expect(parsed.courses[0]?.credits).toBe(1);
  });

  it('leaves runs with a real gap between them alone', () => {
    /* A gap is a space, and a space is two cells. */
    const pieces = [
      { text: 'B', x: COL.code, y: 322, width: 6, height: HEIGHT },
      { text: 'QQ', x: COL.code + 20, y: 322, width: 15, height: HEIGHT },
      { text: '456x', x: COL.code + 60, y: 322, width: 21, height: HEIGHT },
    ];
    const parsed = parseScheme(
      page([...row(322, 'BQQIGNORED', 'Invented Course', 1), ...pieces].filter(
        (item) => item.text !== 'BQQIGNORED',
      )),
    );
    expect(parsed.courses).toHaveLength(0);
  });

  it('joins a compound code the document wrapped after its own slash', () => {
    /*
     *     BQQ402/   the code column, line above
     *     2 IPCC    Aerodynamics ...   the row itself
     *     BQS402    the code column, line below
     *
     * The trailing slash is the document's continuation mark and the row it
     * belongs to is the line BETWEEN the two pieces — which is where the
     * joined cell is placed, on the baseline carrying the title and credits.
     */
    const parsed = parseScheme(
      page([
        ...row(322, 'BQQIGNORED', 'Invented Aerodynamics', 4).filter(
          (item) => item.text !== 'BQQIGNORED',
        ),
        at('BQQ402/', COL.code, 329),
        at('BQS402', COL.code + 2, 315),
      ]),
    );

    expect(parsed.courses.map((course) => [course.code, course.viaAlternativeTo])).toEqual([
      ['BQQ402', null],
      ['BQS402', 'BQQ402'],
    ]);
    expect(parsed.courses[0]?.credits).toBe(4);
  });

  it('does not join a slashed code to a code two rows away', () => {
    const parsed = parseScheme(
      page([
        ...row(322, 'BQQIGNORED', 'Invented Course', 4).filter(
          (item) => item.text !== 'BQQIGNORED',
        ),
        at('BQQ402/', COL.code, 329),
        at('BQS402', COL.code + 2, 240),
      ]),
    );
    expect(parsed.courses.map((course) => course.code)).not.toContain('BQQ402');
  });
});

describe('a credit the row prints off its own baseline', () => {
  /*
   * Where the teaching-department cell wraps over three lines it pushes the
   * marks and credits onto the line ABOVE the code, and the rightmost number
   * left beside the code is a marks figure of 50. The reader refuses that,
   * correctly. The document still says what the credit is, in the column it
   * prints every other row's credit in.
   *
   * The row it belongs to is bounded by the rows either side of it — a SPAN,
   * not a widened band. Two spans cannot overlap, which is what makes the
   * guarantee below hold.
   *
   * EVERY VALUE IS SYNTHETIC.
   */
  const CREDITS_X = COL.credits;

  /** A row whose marks and credits sit one line ABOVE the code. */
  const displaced = (y: number, code: string, title: string, credits: number) => [
    at('1', COL.serial, y),
    at('PCC', COL.category, y),
    at(code, COL.code, y),
    at(title, COL.title, y),
    at('TD: Concerned', COL.department, y + 6),
    at('department', COL.department, y),
    at('PSB: as identified', COL.department, y - 6),
    at('3', COL.lecture, y),
    at('0', COL.tutorial, y),
    at('0', COL.practical, y),
    at('03', COL.duration, y),
    at('50', COL.cie, y),
    at('50', COL.see, y),
    /* The row's own figures, printed a line up. */
    at('100', COL.total, y + 16),
    at(String(credits), CREDITS_X, y + 16),
  ];

  it('reads the credit from the credits column within the row’s own span', () => {
    const parsed = parseScheme(
      page(
        row(398, 'BQQ400', 'Invented Course Zero', 3),
        row(360, 'BQQ401', 'Invented Course One', 4),
        displaced(322, 'BQQ402', 'Invented Course Two', 2),
      ),
    );

    const two = parsed.courses.find((course) => course.code === 'BQQ402');
    expect(two?.credits).toBe(2);
  });

  it('NEVER takes the neighbouring row’s credit', () => {
    /*
     * THE ASSERTION THAT MATTERS. Row A's figure is displaced; row B, printed
     * just above it, has its own. A rule that widened the window would hand A
     * the 4 that belongs to B — which is exactly why the window was kept
     * narrow, and why this is a span between the rows rather than a distance
     * from one.
     */
    const parsed = parseScheme(
      page(
        row(398, 'BQQ400', 'Invented Course Zero', 3),
        row(360, 'BQQ401', 'Invented Course One', 4),
        displaced(322, 'BQQ402', 'Invented Course Two', 2),
      ),
    );

    expect(parsed.courses.find((course) => course.code === 'BQQ401')?.credits).toBe(4);
    expect(parsed.courses.find((course) => course.code === 'BQQ402')?.credits).toBe(2);
    expect(parsed.courses.filter((course) => course.credits === 4)).toHaveLength(1);
  });

  it('still refuses where the span holds no figure of its own', () => {
    /* Nothing in the column for this row: unread beats a borrowed number. */
    const bare = [
      at('1', COL.serial, 322),
      at('PCC', COL.category, 322),
      at('BQQ403', COL.code, 322),
      at('Invented Course Three', COL.title, 322),
      at('50', COL.cie, 322),
      at('50', COL.see, 322),
    ];
    const parsed = parseScheme(
      page(row(398, 'BQQ400', 'Invented Course Zero', 3), row(360, 'BQQ401', 'Invented Course One', 4), bare),
    );
    expect(parsed.courses.map((course) => course.code)).not.toContain('BQQ403');
  });
});

describe('the shapes a VTU code column actually prints', () => {
  /*
   * Each of these cost a row, and with it the credits its document counts in
   * its own semester total. The bounds are measured, not chosen: across the
   * 287 documents of the 2022 crawl the department segment is 2 letters 5046
   * times, 3 letters 1592, 4 letters 563, 5 letters 8, and 7 letters exactly
   * once. There are no tokens of any other length.
   *
   * EVERY VALUE IS SYNTHETIC.
   */
  it('reads a department segment of seven letters', () => {
    /*
     * `BMATELCE301`, "Mathematics for Electronics and Communication
     * Engineering", is the first row of the Electronics & Computer
     * third-semester table. The code was never missing from the PDF — only
     * from the pattern, which stopped at six.
     */
    const parsed = parseScheme(page(row(322, 'BQQMATXY301', 'Invented Mathematics', 3)));
    expect(parsed.courses.map((course) => course.code)).toEqual(['BQQMATXY301']);
  });

  it('refuses a department segment longer than the corpus has', () => {
    /* The bound is evidence, not permission to accept anything after a B. */
    const parsed = parseScheme(page(row(322, 'BQQMATXYZ301', 'Invented Course', 3)));
    expect(parsed.courses).toHaveLength(0);
  });

  it('reads a code the document prints with a space inside the cell', () => {
    /*
     * `BCA 685` is ONE text run, x 132.6 to 170.1, squarely inside the code
     * column the rows above and below use. The space is typography within a
     * cell, not a boundary between two.
     */
    const parsed = parseScheme(page(row(322, 'BQQ 685', 'Invented Project Phase I', 2)));
    expect(parsed.courses.map((course) => [course.code, course.credits])).toEqual([['BQQ685', 2]]);
  });

  it('does not turn a spaced fragment that is not a code into one', () => {
    const parsed = parseScheme(page(row(322, 'PEC 613', 'Invented Elective', 3)));
    expect(parsed.courses).toHaveLength(0);
  });

  it('joins a compound code broken in the MIDDLE of its second half', () => {
    /*
     *     BQS303/B     the code column, line above
     *     3 IPCC  Fluid Mechanics ...   the row itself
     *     QE303        the code column, line below
     *
     * The break lands after the slash on one document and mid-code on another.
     * What the halves spell is checked against the compound grammar before it
     * is believed.
     */
    const parsed = parseScheme(
      page([
        ...row(322, 'BQQIGNORED', 'Invented Fluid Mechanics', 4).filter(
          (item) => item.text !== 'BQQIGNORED',
        ),
        at('BQS303/B', COL.code, 329),
        at('QE303', COL.code + 2, 315),
      ]),
    );

    expect(parsed.courses.map((course) => [course.code, course.viaAlternativeTo])).toEqual([
      ['BQS303', null],
      ['BQE303', 'BQS303'],
    ]);
    expect(parsed.courses[0]?.credits).toBe(4);
  });

  it('joins nothing when the halves do not spell two whole codes', () => {
    const parsed = parseScheme(
      page([
        ...row(322, 'BQQIGNORED', 'Invented Course', 4).filter(
          (item) => item.text !== 'BQQIGNORED',
        ),
        at('BQS303/B', COL.code, 329),
        at('NONSENSE', COL.code + 2, 315),
      ]),
    );
    expect(parsed.courses).toHaveLength(0);
  });
});

/* -------------------------------------------------------------------------- */

describe('the 2025 scheme generation', () => {
  /*
   * -------------------------------------------------------------------------
   * WHAT IS REAL HERE, AND WHAT IS NOT
   * -------------------------------------------------------------------------
   *
   * THE COURSE CODES ARE REAL. `1BCS301`, `1BCSL306`, `1BCSL307A`, `1BCP308`,
   * `1BNSS309` and `1BMATDIP310` are printed in VTU's own CSBS 2025 scheme,
   * https://vtu.ac.in/pdf/2025syll3to8/34csbssch.pdf, and are reproduced here
   * exactly as printed (§50). They are the evidence this grammar was measured
   * against rather than reasoned toward.
   *
   * THE LAYOUT IS NOT. The x-positions below are the 2022 document's, because
   * that is the layout this repository has 288 real documents of. No 2025 PDF
   * has been supplied, so no claim is made here about 2025 column geometry,
   * wrapped titles, option groups, or printed totals — the assertions are
   * about which code shapes the reader RECOGNISES, which is the one thing the
   * printed codes are evidence for.
   *
   * Titles and credits are invented, and are asserted only to show the row was
   * read as a row. Nothing in this file should be read as a statement about
   * what any 2025 course is worth.
   */

  const heading2025 = [
    at('B.E. in Invented Studies', 313, 491),
    at('Scheme of Teaching and Examinations 2025', 319, 477),
    at('III SEMESTER', 56, 435),
  ];

  const page2025 = (...rows: readonly PositionedText[][]): SchemePage[] => [
    { page: 1, items: [...heading2025, ...rows.flat()] },
  ];

  it('reads the codes VTU actually prints in the 2025 scheme', () => {
    /*
     * Before the generation digit was part of the grammar every one of these
     * failed to match, so a 2025 document parsed to zero courses — which is
     * indistinguishable from a document that contains none.
     */
    const parsed = parseScheme(
      page2025(
        row(322, '1BCS301', 'Invented Course One', 4),
        row(300, '1BCSL306', 'Invented Laboratory', 1),
        row(278, '1BCSL307A', 'Invented Optional Laboratory', 1),
        row(256, '1BCP308', 'Invented Project', 2),
        row(234, '1BNSS309', 'Invented Activity', 0),
        row(212, '1BMATDIP310', 'Invented Bridge Course', 0),
      ),
    );

    expect(parsed.courses.map((course) => course.code)).toEqual([
      '1BCS301',
      '1BCSL306',
      '1BCSL307A',
      '1BCP308',
      '1BNSS309',
      '1BMATDIP310',
    ]);
    expect(parsed.rejected).toHaveLength(0);
  });

  it('reads the 2025 codes found on real documents held locally', () => {
    /*
     * A SECOND, INDEPENDENT SOURCE OF EVIDENCE.
     *
     * The codes in the test above are quoted from VTU's published CSBS 2025
     * scheme. These were read off the PAGES of seven 2025-family documents
     * that exist on this machine, by `scripts/source-inventory.ts` — two of
     * which declare a different code than their own filename claims, which is
     * why the page rather than the filename is what is trusted here.
     *
     * They are question papers, not schemes. That matters and is the point:
     * `source-scan.ts` says a question paper "NEVER carries credits, L/T/P,
     * scheme membership", so these establish the CODE GRAMMAR and nothing
     * else. They are used here for exactly the one thing they are evidence of.
     *
     * `BEE105` is in the list deliberately: one of the seven declares a
     * 2022-family code, and the grammar must keep reading those too.
     */
    const observed = [
      'BEE105',
      '1BECHE105',
      '1BESC104C',
      '1BMATC101',
      '1BMATC201',
      '1BPHYS102',
      '1BPLC105E',
    ];

    const parsed = parseScheme(
      page2025(...observed.map((code, index) => row(322 - index * 22, code, 'Invented Title', 3))),
    );
    expect(parsed.courses.map((course) => course.code)).toEqual(observed);
  });

  it('takes the scheme year from the document rather than from the code', () => {
    /*
     * §68: the year is stored at normalization time from what the document
     * says, never inferred later from a filename or a leading digit. The
     * digit marks a generation; the HEADING states the year.
     */
    const parsed = parseScheme(page2025(row(322, '1BCS301', 'Invented Course One', 4)));
    expect(parsed.schemeYear).toBe('2025');
  });

  it('keeps a zero-credit row rather than dropping it', () => {
    // Non-credit and mandatory-activity rows are part of the scheme (§9).
    const parsed = parseScheme(page2025(row(322, '1BNSS309', 'Invented Activity', 0)));
    expect(parsed.courses[0]).toMatchObject({ code: '1BNSS309', credits: 0 });
  });

  it('still reads a 2022 code, and does not grow a digit reading one', () => {
    /*
     * The regression that matters. `BCS301` and `1BCS301` are codes in two
     * different schemes, and the generation digit is optional precisely so
     * that neither is rewritten into the other.
     */
    const parsed = parseScheme(page(row(322, 'BQQ401', 'Invented Course One', 4)));
    expect(parsed.courses[0]?.code).toBe('BQQ401');
  });

  it('carries the generation digit through a shared-tail code cell', () => {
    /*
     * `BTX/ST306x` is VTU's way of printing one row offered under two
     * prefixes, and the reader rebuilds the first code from the parts. Rebuilt
     * WITHOUT the generation it would name a 2022 course that the 2025 cell
     * never printed.
     */
    const parsed = parseScheme(
      page2025([
        ...row(322, 'PLACEHOLDER', 'Invented Course', 4).filter(
          (item) => item.text !== 'PLACEHOLDER',
        ),
        at('1BQX/ST306x', COL.code, 322),
      ]),
    );
    expect(parsed.courses[0]?.code).toBe('1BQX306x');
  });
});

describe('headings the 2025 scheme prints, and the prose it also prints', () => {
  /*
   * The reader used to take a semester heading only from a run of 24
   * characters or fewer. That length was standing in for "a heading, not a
   * sentence", and the 2025 scheme is where the proxy broke: it heads its last
   * two tables
   *
   *     VII SEMESTER (Swappable VII and VIII SEMESTER) (SCHEME-A)
   *
   * at 57 characters, so BOTH semesters were dropped — every seventh- and
   * eighth-semester row refused for "This page states no semester" while the
   * first four semesters imported cleanly. A scheme missing a quarter of its
   * courses still looks like a working import, which is why this is asserted
   * rather than left to the eye.
   */
  const headed = (heading: string, code: string): SchemePage[] => [
    {
      page: 1,
      items: [
        at('B.E. in Invented Studies', 313, 491),
        at('Scheme of Teaching and Examinations 2025', 319, 477),
        at(heading, 56, 435),
        ...row(322, code, 'Invented Course One', 4),
      ],
    },
  ];

  it('reads a heading carrying bracketed qualifiers, however long', () => {
    const parsed = parseScheme(
      headed('VII SEMESTER (Swappable VII and VIII SEMESTER) (SCHEME-A)', 'BQQ401'),
    );

    expect(parsed.semesters).toEqual([7]);
    expect(parsed.courses[0]).toMatchObject({ code: 'BQQ401', semester: 7 });
  });

  it('takes the heading’s own numeral, not one from inside the qualifier', () => {
    /*
     * Both roman numerals appear in that heading and only the first is the
     * page's. Reading the other swaps the two tables — which is exactly what
     * the printed VII and VIII totals would then disagree about.
     */
    const parsed = parseScheme(
      headed('VIII SEMESTER (Swappable VII and VIII SEMESTER) (SCHEME-A)', 'BQQ401'),
    );

    expect(parsed.semesters).toEqual([8]);
  });

  it('still refuses a sentence that opens the same way', () => {
    /*
     * The notes pages begin "III semester to the VI semester (for 4
     * semesters)…". It matches the heading shape, and filing a page of prose
     * under semester three is what the length limit was there to prevent.
     * Words before any bracket are what separate the two.
     */
    const parsed = parseScheme([
      {
        page: 1,
        items: [
          at('B.E. in Invented Studies', 313, 491),
          at('III semester to the VI semester (for 4 semesters) shall be', 56, 435),
          ...row(322, 'BQQ401', 'Invented Course One', 4),
        ],
      },
    ]);

    expect(parsed.semesters).toEqual([]);
    expect(parsed.rejected.map((r) => r.reason)).toContain('This page states no semester.');
  });
});

describe('the placeholder letters, in whichever case the typist used', () => {
  /*
   * `BXX515x` is the document writing "whichever discipline this is", and the
   * row it names carries the elective slot's credits — the 2022 catalogue has
   * shipped six such rows since it was published.
   *
   * The 2025 scheme prints them in BOTH cases, inconsistently within one page:
   * its fourth-semester table row says `1BXXL406x` while the option list
   * directly above says `1BxxL406x`, and its whole eighth-semester table is
   * lowercase — `1Bxx801x`, `1Bxx802x`, `1Bxx803x`, worth 3, 3 and 9 of the
   * 15 credits that table totals. With capitals required, that semester read
   * as zero courses: not refused with a reason, INVISIBLE, because a cell that
   * is not a code is not a row.
   */
  const eighth = (code: string): SchemePage[] => [
    {
      page: 1,
      items: [
        at('B.E. in Invented Studies', 313, 491),
        at('Scheme of Teaching and Examinations 2025', 319, 477),
        at('VIII SEMESTER', 56, 435),
        ...row(322, code, 'Invented Elective Slot', 3),
      ],
    },
  ];

  it('reads a lowercase placeholder as the slot it is', () => {
    const parsed = parseScheme(eighth('1Bxx801x'));

    expect(parsed.courses).toHaveLength(1);
    expect(parsed.courses[0]).toMatchObject({ credits: 3, semester: 8 });
  });

  it('files both spellings under one identity', () => {
    /*
     * Two spellings of one slot would otherwise be two courses, and the
     * document uses both. The canonical form is the one the table itself
     * prints.
     */
    const lower = parseScheme(eighth('1Bxx801x')).courses[0]?.code;
    const upper = parseScheme(eighth('1BXX801x')).courses[0]?.code;

    expect(lower).toBe('1BXX801x');
    expect(upper).toBe('1BXX801x');
  });

  it('leaves the trailing letter exactly as printed', () => {
    /*
     * Only the discipline segment is case-free. A lowercase `x` marks the slot
     * — "whichever option is chosen" — and a capital names one of the options,
     * so `BXX515x` and `BXX515A` are different rows. Folding the tail as well
     * renamed the six placeholder slots the 2022 catalogue publishes.
     */
    expect(parseScheme(eighth('BXX515x')).courses[0]?.code).toBe('BXX515x');
    expect(parseScheme(eighth('BXX515A')).courses[0]?.code).toBe('BXX515A');
  });
});

describe('a department cell that arrives in two runs', () => {
  /*
   * The department cell is excluded from course titles by a pattern that
   * requires the colon, because the bare `TD/PSB` COLUMN HEADER must not match
   * — matching it drags the department column's left edge out to the header
   * and clips every title on the page to nothing.
   *
   * The 2025 scheme splits the cell at exactly that colon, into `"TD/PSB"` and
   * `": CS Allied"` with no gap between them, so neither half matched and both
   * were read as part of the course name. Every row on those pages came out
   * titled "TD/PSB : CS Allied Machine Learning".
   */
  const split = (): SchemePage[] => [
    {
      page: 1,
      items: [
        at('B.E. in Invented Studies', 313, 491),
        at('Scheme of Teaching and Examinations 2025', 319, 477),
        at('V SEMESTER', 56, 435),
        at('1', COL.serial, 322),
        at('PCC', COL.category, 322),
        at('BQQ501', COL.code, 322),
        at('Invented Course One', COL.title, 322),
        /* The two halves meet exactly, which is what marks them one cell. */
        { text: 'TD/PSB', x: COL.department, y: 322, width: 27, height: HEIGHT },
        { text: ': CS Allied', x: COL.department + 27, y: 322, width: 40, height: HEIGHT },
        at('100', COL.total, 328),
        at('3', COL.credits, 328),
        at('3', COL.lecture, 322),
        at('0', COL.tutorial, 322),
        at('0', COL.practical, 322),
        at('03', COL.duration, 322),
        at('50', COL.cie, 322),
        at('50', COL.see, 322),
      ],
    },
  ];

  it('keeps both halves out of the course name', () => {
    const parsed = parseScheme(split());

    expect(parsed.courses).toHaveLength(1);
    expect(parsed.courses[0]?.title).toBe('Invented Course One');
  });
});

describe('the total a semester table prints', () => {
  /*
   * The printed total is the cross-check on everything else here: it is the
   * document's own arithmetic, and comparing it against the rows read is what
   * catches a reader that has quietly lost one. So it has to be attributed to
   * the table that printed it, and read whole.
   *
   * Both fixtures below are the layout of `34csbssch.pdf`, at the coordinates
   * it actually uses.
   */

  const TITLE_BLOCK = at('Scheme of Teaching and Examinations - 2025', 319, 477);

  it('reads a total row whose cells straddle two baselines', () => {
    /*
     * THE ROW IS NOT ONE BASELINE. The seventh-semester total is typeset with
     * `Total` and one figure at y 105 and the whole rest of the row — its
     * credits cell included — at y 104.
     *
     * Bucketing on `Math.round(y)` put a hard boundary through it. The `Total`
     * fragment kept exactly one number, the 15 that happened to share its
     * baseline, and the reader reported this semester as printing 15 credits
     * against a catalogue holding 20. The 15 was never a stray token from
     * elsewhere on the page: it is this row's own term-work column, and the
     * reader was seeing a seventh of the row.
     */
    const totals = semesterTotalsOf([
      {
        page: 1,
        items: [
          TITLE_BLOCK,
          at('VII SEMESTER (Swappable VII and VIII SEMESTER) (SCHEME-A)', 48, 404),
          at('Total', 439, 105),
          at('15', 653, 105),
          at('628', 617, 104),
          at('400', 687, 104),
          at('300', 725, 104),
          at('700', 760, 104),
          at('20', 795, 104),
        ],
      },
    ]);

    expect(totals).toEqual([{ semester: 7, credits: 20, page: 1 }]);
  });

  it('does not give a new table the previous table’s semester', () => {
    /*
     * The semester heading carries across pages because a table runs across
     * pages and only its first page prints one. That holds for CONTINUATION
     * pages, which carry rows and no masthead.
     *
     * The eleventh page of the 2025 scheme is not one. It re-prints the title
     * block and opens a different table — the Scheme-B variant for candidates
     * taking a two-semester internship, which its own caption says covers
     * "VII and VIII semesters" — and states no semester of its own. Inheriting
     * eight from the page before filed that table's 20 credits as an
     * eighth-semester total, against a table that prints 15.
     */
    const totals = semesterTotalsOf([
      {
        page: 1,
        items: [
          TITLE_BLOCK,
          at('VIII SEMESTER (Swappable VII and VIII SEMESTER) (SCHEME-A)', 43, 458),
          at('Total', 439, 272),
          at('540', 606, 272),
          at('9', 644, 272),
          at('200', 676, 271),
          at('200', 715, 271),
          at('400', 756, 271),
          at('15', 794, 271),
        ],
      },
      {
        page: 2,
        items: [
          TITLE_BLOCK,
          at('VII and VIII semesters for the candidates who opt for a two-semesters', 18, 458),
          at('Total', 560, 164),
          at('6', 644, 164),
          at('400', 678, 164),
          at('300', 720, 164),
          at('700', 763, 164),
          at('20', 800, 164),
        ],
      },
    ]);

    expect(totals).toEqual([{ semester: 8, credits: 15, page: 1 }]);
  });

  it('still carries the heading onto a continuation page', () => {
    /*
     * The reason the carry-forward exists, asserted so that narrowing it
     * cannot quietly remove it. This page prints no masthead, so it continues
     * the table above rather than starting one.
     */
    const totals = semesterTotalsOf([
      { page: 1, items: [TITLE_BLOCK, at('V SEMESTER', 48, 380)] },
      {
        page: 2,
        items: [
          at('Total', 485, 132),
          at('658', 648, 132),
          at('500', 704, 132),
          at('400', 732, 132),
          at('900', 768, 132),
          at('22', 806, 132),
        ],
      },
    ]);

    expect(totals).toEqual([{ semester: 5, credits: 22, page: 2 }]);
  });

  it('still reads a total row that prints one number', () => {
    /*
     * Thirty-seven totals in the 2022 corpus have exactly this shape — the
     * label and the credits, the rest of the columns on baselines of their
     * own. Rejecting a one-number row would have been the cheap way to throw
     * out the 15 above, and it would have thrown out these with it.
     */
    const totals = semesterTotalsOf([
      {
        page: 1,
        items: [
          TITLE_BLOCK,
          at('III SEMESTER', 56, 435),
          at('Total', 485, 132),
          at('21', 806, 132),
        ],
      },
    ]);

    expect(totals).toEqual([{ semester: 3, credits: 21, page: 1 }]);
  });
});

describe('a row that prints two codes, each with the code it supersedes', () => {
  /*
   * The first-year Kannada row, in both cycles:
   *
   *     1BKSK109(BKSK107)/1BKBK109(BKBK107)
   *     Samskrutika Kannada / Balake Kannada          1 credit
   *
   * One row, one credit, two named alternatives, each carrying the 2022 code
   * it replaces. It is the only shape in the corpus that brackets a superseded
   * code — four cells across 290 documents, being these two rows each wrapped
   * over two lines — and until it was read, both cycles came up exactly one
   * credit short of the twenty their own documents print.
   */

  /** The row as the document sets it: the cell WRAPS after the slash. */
  const kannadaRow = (
    heading: string,
    head: string,
    tail: string,
    title: string,
  ): SchemePage[] => [
    {
      page: 1,
      items: [
        at('B.E. in Invented Studies', 313, 491),
        at('Scheme of Teaching and Examinations 2025', 319, 477),
        at(heading, 56, 435),
        /* The two halves of the code, one column, two lines. */
        at(head, 140, 328),
        at(tail, 140, 314),
        /* The row itself is the line between them. */
        at('9', 61, 321),
        at('HSMC', 93, 321),
        at(title, 195, 321),
        at('1', 493, 321),
        at('0', 526, 321),
        at('0', 559, 321),
        at('01', 632, 321),
        at('50', 670, 321),
        at('50', 711, 321),
        at('100', 750, 327),
        at('1', 789, 327),
      ],
    },
  ];

  const physics = () =>
    parseScheme(
      kannadaRow(
        'I SEMESTER',
        '1BKSK109(BKSK107)/',
        '1BKBK109(BKBK107)',
        'Samskrutika Kannada/ Balake Kannada',
      ),
    );
  const chemistry = () =>
    parseScheme(
      kannadaRow(
        'II SEMESTER',
        '1BKSK209(BKSK107)/',
        '1BKBK209(BKBK107)',
        'Samskrutika Kannada/ Balake Kannada',
      ),
    );

  it('reads both alternatives and the code each of them supersedes', () => {
    expect(supersedingPairIn('1BKSK109(BKSK107)/1BKBK109(BKBK107)')).toEqual([
      { code: '1BKSK109', supersedes: 'BKSK107' },
      { code: '1BKBK109', supersedes: 'BKBK107' },
    ]);
  });

  it('joins the halves the document wraps after the slash', () => {
    /*
     * The cell is too wide for its column, so the document breaks it after the
     * slash and sets the row on the line between the two halves.
     */
    const parsed = physics();

    expect(parsed.courses.map((course) => course.code).sort()).toEqual([
      '1BKBK109',
      '1BKSK109',
    ]);
  });

  it('charges the semester once, not once per code', () => {
    /*
     * THE WHOLE POINT. Two codes on one printed row are one credit, and a
     * reader that gave each of them the row's credits would put two into a
     * semester that prints one — and into the SGPA that weights by them.
     */
    const parsed = physics();
    const charged = parsed.courses.filter(
      (course) => course.viaElectiveSlot === null && course.viaAlternativeTo === null,
    );

    expect(charged).toHaveLength(1);
    expect(charged[0]?.code).toBe('1BKSK109');
    expect(charged.reduce((total, course) => total + course.credits, 0)).toBe(1);
  });

  it('keeps the second code as an alternative TO the first, not as a separate course', () => {
    /*
     * A student takes Samskrutika Kannada OR Balake Kannada. Both must stay
     * searchable — a student looking up the code on their card has to find it —
     * and neither may become a second requirement.
     */
    const parsed = physics();
    const balake = parsed.courses.find((course) => course.code === '1BKBK109');

    expect(balake).toMatchObject({ viaAlternativeTo: '1BKSK109', credits: 1 });
  });

  it('gives each alternative the title printed against it', () => {
    /*
     * The row writes the names in parallel with the codes — "Samskrutika
     * Kannada / Balake Kannada" against `1BKSK.../1BKBK...` — so they belong to
     * them one for one. Only taken when the counts match: a compound like
     * `BCH358x/BCHL358x` names ONE course under two codes, and splitting its
     * title would hand each half a fragment of a name.
     */
    const parsed = chemistry();

    expect(parsed.courses.find((c) => c.code === '1BKSK209')?.title).toBe('Samskrutika Kannada');
    expect(parsed.courses.find((c) => c.code === '1BKBK209')?.title).toBe('Balake Kannada');
  });

  it('records the superseded code against the course that prints it', () => {
    /*
     * Carried, not discarded — and deliberately not written to the alias table.
     * Both cycles print `(BKSK107)`: the physics cycle against `1BKSK109` in
     * semester I and the chemistry cycle against `1BKSK209` in semester II. One
     * superseded code with two superseding ones is not an alias, and the alias
     * table's own invariant would reject it.
     */
    expect(physics().courses.find((c) => c.code === '1BKSK109')?.supersedes).toBe('BKSK107');
    expect(chemistry().courses.find((c) => c.code === '1BKSK209')?.supersedes).toBe('BKSK107');
    expect(physics().courses.find((c) => c.code === '1BKBK109')?.supersedes).toBe('BKBK107');
  });

  it('reads the row in both first-year cycles', () => {
    /*
     * The physics cycle prints it in semester I and the chemistry cycle in
     * semester II. Same rule, both documents, and the cycles stay apart.
     */
    expect(physics().courses.every((course) => course.semester === 1)).toBe(true);
    expect(chemistry().courses.every((course) => course.semester === 2)).toBe(true);
    expect(chemistry().courses.map((c) => c.code).sort()).toEqual(['1BKBK209', '1BKSK209']);
  });

  it('refuses a half-written pair rather than reading one side of it', () => {
    /*
     * A cell where only one half brackets its superseded code is not a pair
     * this reader understands. Taking the half it can parse would put one
     * Kannada course in the semester and drop the choice silently, so the whole
     * cell is refused.
     */
    expect(supersedingPairIn('1BKSK109(BKSK107)/1BKBK109')).toBeNull();
    expect(supersedingPairIn('1BKSK109(not a code)/1BKBK109(BKBK107)')).toBeNull();
    expect(supersedingPairIn('1BKSK109(BKSK107)')).toBeNull();
  });

  it('does not split the title of an ordinary compound cell', () => {
    /*
     * A compound names ONE course under two codes — the theory variant and the
     * laboratory one, or one table serving two programmes — so its title
     * belongs whole to both. The parallel-title rule is restricted to
     * superseding pairs for exactly this reason: a compound whose name happens
     * to carry a slash would otherwise have it torn in half, and each code
     * would be listed under a fragment.
     */
    const parsed = parseScheme(
      page([
        ...row(322, 'BQQIGNORED', 'Invented Aerodynamics/ Flight Mechanics', 4).filter(
          (item) => item.text !== 'BQQIGNORED',
        ),
        at('BQQ402/', COL.code, 329),
        at('BQS402', COL.code + 2, 315),
      ]),
    );

    for (const course of parsed.courses) {
      expect(course.title).toBe('Invented Aerodynamics/ Flight Mechanics');
    }
  });

  it('leaves an ordinary compound cell alone', () => {
    /*
     * `BCH358x/BCHL358x` has no brackets and must keep going through the rule
     * it always did. This change is additive: a cell that did not match the
     * superseding shape before still does not.
     */
    expect(supersedingPairIn('BCH358x/BCHL358x')).toBeNull();
    expect(supersedingPairIn('BTX/ST306x')).toBeNull();
  });
});
