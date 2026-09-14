/**
 * Resolving a first-year placeholder to the course a programme actually takes.
 *
 * Authority: Phase 7D §10, §18, §33 · docs/47
 *
 * ---------------------------------------------------------------------------
 * SYNTHETIC BY CONSTRUCTION
 * ---------------------------------------------------------------------------
 *
 * The fixtures reproduce the LAYOUT the 2025 first-year documents use — a
 * placeholder row carrying the credits, an options table set two sub-tables
 * wide with a stream named in each title, and the membership table that says
 * which programmes a stream contains — with invented course codes and invented
 * programme names. The real documents stay out of the repository; what is
 * committed is the shape the reader has to survive.
 *
 * The stream abbreviations are real because they are the evidence under test:
 * the whole resolution turns on the document printing "CSE" against one option
 * and not against the others.
 */

import { describe, expect, it } from 'vitest';
import {
  cycleGroupOf,
  resolveFirstYearForStream,
  streamForProgramme,
  streamMembershipOf,
} from '../src/first-year-streams.js';
import { parseScheme, type SchemePage } from '../src/scheme-import.js';
import type { PositionedText } from '../src/positioned-text.js';

const at = (text: string, x: number, y: number): PositionedText => ({
  text,
  x,
  y,
  width: text.length * 5,
  height: 11,
});

/** One placeholder row of a first-year semester table, with its credits. */
function slotRow(y: number, code: string, title: string, credits: number): PositionedText[] {
  return [
    at('1', 61, y),
    at('ASC', 93, y),
    at(code, 140, y),
    at(title, 195, y),
    at('TD:QQ', 423, y + 7),
    at('PSB:QQ', 423, y - 4),
    at('100', 750, y + 6),
    at(String(credits), 789, y + 6),
    at('3', 493, y),
    at('0', 526, y),
    at('0', 559, y),
    at('03', 632, y),
    at('50', 670, y),
    at('50', 711, y),
  ];
}

/**
 * One row of the options table, which the document sets TWO SUB-TABLES WIDE.
 *
 * `right` is the cell printed beside it, and it is what makes the contamination
 * case real: a title read by x-position alone runs straight through the divider
 * into its neighbour.
 */
function optionRow(
  y: number,
  left: [string, string],
  right?: [string, string],
): PositionedText[] {
  return [
    at(left[0], 60, y),
    at(left[1], 130, y),
    ...(right === undefined ? [] : [at(right[0], 430, y), at(right[1], 500, y)]),
  ];
}

/** The "UG Programmes under the stream with code" table. */
function membershipTable(rows: readonly [string, string][]): PositionedText[] {
  const items: PositionedText[] = [
    at('Sl', 73, 522),
    at('Stream', 142, 522),
    at('UG Programmes under the stream with code', 399, 522),
  ];
  for (const [index, [streamName, programmes]] of rows.entries()) {
    const y = 493 - index * 40;
    items.push(at(String(index + 1), 70, y), at(streamName, 97, y), at(programmes, 237, y));
  }
  return items;
}

const MEMBERSHIP = membershipTable([
  ['Civil Engineering Stream (CV)', '(1) Invented Civil Studies (QC), (2) Invented Mining (QM)'],
  [
    'Computer Science and Engineering Stream (CSE)',
    '(1) Invented Computing (QA), (2) Invented Business Computing (QB)',
  ],
]);

/**
 * A first-year document: one semester table, one options table, one membership
 * table — which is the whole of the evidence the resolution is allowed to use.
 */
const physicsCycle: SchemePage[] = [
  {
    page: 1,
    items: [
      at('Bachelor of Engineering', 313, 560),
      at('Scheme of Teaching and Examinations (2025)', 319, 545),
      at('I Semester (Physic Group)', 56, 435),
      ...slotRow(322, '1BQMATx101', 'Applied Mathematics-I (Stream Specific)', 4),
      ...slotRow(280, '1BQPHYx102', 'Applied Physics (Stream Specific)', 4),
      ...slotRow(240, '1BQxxx105x', 'Programme Specific Course', 3),
    ],
  },
  {
    page: 2,
    items: [
      /* Maths beside Physics, exactly as the document sets them. */
      ...optionRow(
        500,
        ['1BQMATC101', 'Invented Calculus: CV Stream'],
        ['1BQPHYC102', 'Invented Physics (CV stream)'],
      ),
      ...optionRow(
        480,
        ['1BQMATS101', 'Invented Calculus: CSE Stream'],
        ['1BQPHYS102', 'Invented Physics (CSE stream)'],
      ),
      /*
       * The programme-specific options name no stream at all: the document
       * keys them to the admitted programme and never maps one.
       */
      ...optionRow(440, ['1BQCIV105', 'Invented Mechanics']),
      ...optionRow(420, ['1BQEIT105', 'Invented Programming']),
    ],
  },
  { page: 3, items: MEMBERSHIP },
];

/** The other cycle: the same maths, the other science. */
const chemistryCycle: SchemePage[] = [
  {
    page: 1,
    items: [
      at('Bachelor of Engineering', 313, 560),
      at('Scheme of Teaching and Examinations-2025', 319, 545),
      at('I Semester (Chemistry Group)', 56, 435),
      ...slotRow(322, '1BQMATx101', 'Applied Mathematics-I (Stream Specific)', 4),
      ...slotRow(280, '1BQCHEx102', 'Applied Chemistry (Stream Specific)', 4),
      ...slotRow(240, '1BQESC104x', 'Engineering Science Course-I', 3),
      ...slotRow(200, '1BQPLC105x', 'Programming Language Course', 4),
    ],
  },
  {
    page: 2,
    items: [
      ...optionRow(
        500,
        ['1BQMATC101', 'Invented Calculus: CV Stream'],
        ['1BQCHEC102', 'Invented Chemistry (CV stream)'],
      ),
      ...optionRow(
        480,
        ['1BQMATS101', 'Invented Calculus: CSE Stream'],
        ['1BQCHES102', 'Invented Chemistry (CSE stream)'],
      ),
      /*
       * THE ADJACENCY THAT BROKE IT. The engineering-science options name no
       * stream — the scheme requires a student to take one from OUTSIDE their
       * own — and they are printed beside the programming options, one of which
       * names CSE. This is the real layout, at the real distance.
       */
      ...optionRow(
        440,
        ['1BQESC104A', 'Invented Building Sciences'],
        ['1BQPLC105E', 'Invented C Programming (for non-IT programmes)'],
      ),
      ...optionRow(
        420,
        ['1BQESC104B', 'Invented Electrical Engineering'],
        ['1BQPLC105B', 'Invented Python Programming (for CSE and allied programmes)'],
      ),
    ],
  },
  { page: 3, items: MEMBERSHIP },
];

const resolveFor = (pages: SchemePage[], programme: string) => {
  const membership = streamForProgramme(streamMembershipOf(pages), programme);
  if (membership === null) throw new Error('no stream');
  return resolveFirstYearForStream(pages, parseScheme(pages), membership);
};

/* -------------------------------------------------------------------------- */

describe('the stream a programme is declared to be in', () => {
  it('reads the membership table the document prints', () => {
    const memberships = streamMembershipOf(physicsCycle);

    expect(memberships.map((m) => m.abbreviation)).toEqual(['CV', 'CSE']);
    expect(memberships[1]?.programmes.map((p) => p.code)).toEqual(['QA', 'QB']);
  });

  it('places a programme in the stream that lists it, and nowhere else', () => {
    /*
     * The chain this whole module exists to walk: the programme is named in one
     * stream's row, so that is its stream. Nothing is matched on title
     * similarity and a programme the table does not list gets no stream at all.
     */
    const memberships = streamMembershipOf(physicsCycle);

    expect(streamForProgramme(memberships, 'Invented Business Computing')?.abbreviation).toBe(
      'CSE',
    );
    expect(streamForProgramme(memberships, 'Invented Civil Studies')?.abbreviation).toBe('CV');
    expect(streamForProgramme(memberships, 'Invented Something Else')).toBeNull();
  });

  it('reads "&" and "and" as the same word and nothing else as the same', () => {
    /*
     * The scheme heads itself "Computer Science & Business System" and this
     * table writes "and". That is one word spelled two ways, which is not a
     * similarity score — every other character still has to match.
     */
    const memberships = streamMembershipOf(physicsCycle);

    expect(streamForProgramme(memberships, 'Invented Business Computing')).not.toBeNull();
    expect(streamForProgramme(memberships, 'Invented Business Computer')).toBeNull();
  });
});

describe('resolving a placeholder for a stream', () => {
  it('resolves the generic row to the concrete course that names the stream', () => {
    const { resolved } = resolveFor(physicsCycle, 'Invented Business Computing');
    const maths = resolved.find((row) => row.slotCode === '1BQMATX101');

    expect(maths?.code).toBe('1BQMATS101');
  });

  it('does not give one stream another stream’s course', () => {
    /*
     * The same placeholder, read for the Civil stream, must resolve to the
     * Civil option — never to the CSE one that happens to sit beside it.
     */
    const civil = resolveFor(physicsCycle, 'Invented Civil Studies');
    const cse = resolveFor(physicsCycle, 'Invented Business Computing');

    expect(civil.resolved.find((r) => r.slotCode === '1BQMATX101')?.code).toBe('1BQMATC101');
    expect(cse.resolved.find((r) => r.slotCode === '1BQMATX101')?.code).toBe('1BQMATS101');
  });

  it('takes the credits from the placeholder row, not from the option', () => {
    /*
     * §21 and the reason the options table cannot be read on its own: it prints
     * L:T:P and no credit column at all, so the slot is the only row that says
     * what the course is worth. The resolved course names the slot it took the
     * figure from.
     */
    const { resolved } = resolveFor(physicsCycle, 'Invented Business Computing');
    const physics = resolved.find((row) => row.code === '1BQPHYS102');

    expect(physics).toMatchObject({ credits: 4, slotCode: '1BQPHYX102' });
    expect(resolved.find((row) => row.code === '1BQMATS101')?.credits).toBe(4);
  });

  it('reads the option’s own cell and not its neighbour’s', () => {
    /*
     * THE CONTAMINATION CASE, AND IT HAPPENED. The options table is set two
     * sub-tables wide, so a title assembled by x-position runs through the
     * divider. On the real document `1BESC104B` — an Engineering Science
     * option, which the scheme requires a student to take from OUTSIDE their
     * own stream — resolved as the CSE stream's course, because the programming
     * cell printed beside it says "for CSE and allied programmes". One
     * contaminated title, one wrong first-year course for every CSBS student.
     *
     * So the engineering-science slot must stay UNRESOLVED while the
     * programming slot beside it resolves, from the very same two rows.
     */
    const { resolved, unresolved } = resolveFor(chemistryCycle, 'Invented Business Computing');

    expect(resolved.map((row) => row.code)).not.toContain('1BQESC104B');
    expect(unresolved.map((row) => row.slotCode)).toContain('1BQESC104x');
    expect(resolved.find((row) => row.slotCode === '1BQPLC105x')?.code).toBe('1BQPLC105B');
  });
});

describe('what the documents do not say', () => {
  it('leaves a placeholder unresolved when no option names the stream', () => {
    /*
     * The Programme Specific Course is keyed to the admitted PROGRAMME, and
     * this document never maps one. Guessing from a title — "Invented
     * Programming looks like a computing course" — is exactly what must not
     * happen, so the slot comes back unresolved and says why.
     */
    const { resolved, unresolved } = resolveFor(physicsCycle, 'Invented Business Computing');

    expect(resolved.map((row) => row.slotCode)).not.toContain('1BQXXX105x');
    const psc = unresolved.find((row) => row.slotCode === '1BQXXX105x');
    expect(psc?.reason).toMatch(/names the CSE stream/);
    expect(psc?.credits).toBe(3);
  });

  it('reports an unresolved slot rather than dropping it', () => {
    /*
     * §43: a slot that produced nothing must be visible as one. Silence here
     * would look exactly like a first year that has no such course.
     */
    const { unresolved } = resolveFor(physicsCycle, 'Invented Business Computing');

    expect(unresolved.length).toBeGreaterThan(0);
    for (const slot of unresolved) expect(slot.reason.length).toBeGreaterThan(20);
  });
});

describe('the two first-year cycles', () => {
  it('reads which cycle each document describes', () => {
    expect(cycleGroupOf(physicsCycle)).toBe('Physics Group');
    expect(cycleGroupOf(chemistryCycle)).toBe('Chemistry Group');
  });

  it('keeps the alternatives apart instead of requiring both', () => {
    /*
     * A student takes the physics cycle or the chemistry cycle, and each puts a
     * DIFFERENT science in semester I. Merged under one identity that semester
     * would demand physics AND chemistry, which is a first year nobody takes.
     * The maths is genuinely the same in both and must stay one course.
     */
    const physics = resolveFor(physicsCycle, 'Invented Business Computing').resolved;
    const chemistry = resolveFor(chemistryCycle, 'Invented Business Computing').resolved;

    expect(physics.map((r) => r.code)).toContain('1BQPHYS102');
    expect(physics.map((r) => r.code)).not.toContain('1BQCHES102');
    expect(chemistry.map((r) => r.code)).toContain('1BQCHES102');
    expect(chemistry.map((r) => r.code)).not.toContain('1BQPHYS102');

    expect(physics.find((r) => r.slotCode === '1BQMATX101')?.code).toBe('1BQMATS101');
    expect(chemistry.find((r) => r.slotCode === '1BQMATX101')?.code).toBe('1BQMATS101');
  });
});

describe('non-credit rows are not given credits', () => {
  it('refuses a PP row rather than reading its marks as a credit figure', () => {
    /*
     * §7: the NCMC rows print "100" in the marks column and `PP` where the
     * credits would be. Reading the rightmost figure would make a
     * hundred-credit course; the row is refused with that reason instead, and
     * so never reaches the resolution at all.
     */
    const pages: SchemePage[] = [
      {
        page: 1,
        items: [
          at('Scheme of Teaching and Examinations (2025)', 319, 545),
          at('I Semester (Physic Group)', 56, 435),
          at('7', 61, 322),
          at('AEC', 93, 322),
          at('1BQSKS106', 140, 322),
          at('Invented Soft Skills', 195, 322),
          at('100', 670, 322),
          at('PP', 789, 322),
        ],
      },
    ];
    const parsed = parseScheme(pages);

    expect(parsed.courses.map((c) => c.code)).not.toContain('1BQSKS106');
    const refused = parsed.rejected.find((row) => row.code === '1BQSKS106');
    expect(refused?.reason).toMatch(/not a credit count|elective option/);
  });
});
