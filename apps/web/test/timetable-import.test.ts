/**
 * Reading a college class timetable, which is a grid rather than a list.
 *
 * Authority: docs/22 §22.60 · M10A.8 §12–§28, §41–§45
 *
 * ---------------------------------------------------------------------------
 * WHY THE FIXTURES ARE COORDINATES
 * ---------------------------------------------------------------------------
 *
 * Every other importer in this product reads LINES: one printed row is one
 * record. A timetable is two-dimensional — `MAT` means nothing until you know
 * which column it is in, and the column is a time printed once in a header far
 * above it. So the fixtures place text where it sits on the page, because that
 * is the only thing the parser can read.
 *
 * The layout below follows the structure of a real college timetable: a header
 * of time ranges, six day rows, break and lunch columns, cells that are bare
 * initials, cells that split by batch, a lab that runs across columns, and a
 * subject table at the foot that is the ONLY place the initials are defined.
 *
 * EVERY VALUE IS SYNTHETIC. No real college, subject, room or person.
 */

import { describe, expect, it } from 'vitest';
import {
  needsBatch,
  parseTimetable,
  readDictionary,
  readSlot,
  relateTimetable,
  slotsForBatch,
  type PlacedLike,
  type SavedTimetable,
} from '../src/domain/timetable-import.js';

/* -------------------------------------------------------------------------- */
/* A synthetic page                                                           */
/* -------------------------------------------------------------------------- */

/** Column centres, matching the reference document's eight columns. */
const COLUMNS = [120, 220, 320, 420, 520, 620, 720, 820];
const WIDTH = 80;

const at = (text: string, x: number, y: number, width = WIDTH): PlacedLike => ({
  text,
  x,
  y,
  width,
  height: 10,
  page: 1,
});

/** The header of time ranges, in the shapes the reference actually prints. */
const HEADER_Y = 700;
const HEADER = [
  at('10:00-10:55am', COLUMNS[0] as number, HEADER_Y),
  at('10:55-11:50am', COLUMNS[1] as number, HEADER_Y),
  at('11:50-12.10pm', COLUMNS[2] as number, HEADER_Y),
  at('12.10-1:05pm', COLUMNS[3] as number, HEADER_Y),
  at('1:05-02:00pm', COLUMNS[4] as number, HEADER_Y),
  at('2:00-03:10pm', COLUMNS[5] as number, HEADER_Y),
  at('03:10-04:05pm', COLUMNS[6] as number, HEADER_Y),
  at('04:05-05:00pm', COLUMNS[7] as number, HEADER_Y),
];

/** The subject table. The ONLY place the grid's initials are defined. */
const DICTIONARY = [
  at('BQATS101 Mathematics-I for CSE Stream MAT Prof. Anita R 2+2+2 2+2+2', 60, 300, 700),
  at('BQHYS102 Applied Physics for CSE stream PHY Prof. Bala V 2+2+2 2+2+2', 60, 280, 700),
  at('BQOPS103 Principles of Programming POP Prof. Chandra M 3+0+2 2+0+2', 60, 260, 700),
  at('BQSCK104B Introduction to Electrical ESC Prof. Divya K 4+0+0 3+0+0', 60, 240, 700),
  at('BQTCK105I Introduction to Cyber Security ETC Dr. Esha G 2+0+2 2+0+2', 60, 220, 700),
];

const CONTEXT = [
  at('EXAMPLE INSTITUTE OF TECHNOLOGY', 60, 780, 400),
  at('CLASS: I (E) CSBS SEMESTER I', 60, 760, 300),
  at('TIME-TABLE (R2)', 400, 760, 150),
  at('ACADEMIC YEAR: 2026-27', 60, 740, 250),
  at('ROOM NO.: B205', 700, 740, 150),
  at('W.E.F: 07/11/2026', 700, 720, 150),
];

/** One day row: `cells` is indexed by column, `null` for an empty cell. */
function dayRow(day: string, y: number, cells: readonly (string | null)[]): PlacedLike[] {
  const row = [at(day, 40, y, 70)];
  cells.forEach((cell, index) => {
    if (cell !== null) row.push(at(cell, COLUMNS[index] as number, y));
  });
  return row;
}

/** A page with the given day rows, plus context, header and dictionary. */
function page(...days: readonly PlacedLike[][]): PlacedLike[] {
  return [...CONTEXT, ...HEADER, ...days.flat(), ...DICTIONARY];
}

const MONDAY = dayRow('MONDAY', 660, ['ESC', 'MAT', 'BREAK', 'PHY', 'POP', 'LUNCH', 'ETC', null]);

/* -------------------------------------------------------------------------- */

describe('time slots come from the document, not from a fixed list', () => {
  it('reads the shapes a real header prints', () => {
    expect(readSlot('10:00-10:55am')).toEqual({ start: '10:00', end: '10:55' });
    /* A full stop instead of a colon, which the reference uses in one column. */
    expect(readSlot('11:50-12.10pm')).toEqual({ start: '11:50', end: '12:10' });
    expect(readSlot('03:10- 04:05pm')).toEqual({ start: '15:10', end: '16:05' });
  });

  it('lets a range end tell its start which half of the day it is in', () => {
    /*
     * `1:05-02:00pm` starts in the afternoon because it ENDS there. Reading the
     * start on its own would put the class eleven hours earlier, at five past
     * one in the morning.
     */
    expect(readSlot('1:05-02:00pm')).toEqual({ start: '13:05', end: '14:00' });
    expect(readSlot('12.10-1:05pm')).toEqual({ start: '12:10', end: '13:05' });
  });

  it('refuses a range that is not one', () => {
    expect(readSlot('MONDAY')).toBeNull();
    expect(readSlot('10:00')).toBeNull();
    /* Backwards is not a range. */
    expect(readSlot('11:00-10:00am')).toBeNull();
  });

  it('takes every column from the header it found', () => {
    const parsed = parseTimetable(page(MONDAY));
    expect(parsed.slots.map((slot) => slot.start)).toEqual([
      '10:00',
      '10:55',
      '11:50',
      '12:10',
      '13:05',
      '14:00',
      '15:10',
      '16:05',
    ]);
  });
});

describe('the grid', () => {
  it('places each cell in the column its position says', () => {
    const parsed = parseTimetable(page(MONDAY));
    const monday = parsed.classes.filter((entry) => entry.day === 'Mon');
    expect(monday.map((entry) => [entry.start, entry.initials])).toEqual([
      ['10:00', 'ESC'],
      ['10:55', 'MAT'],
      ['12:10', 'PHY'],
      ['13:05', 'POP'],
      ['15:10', 'ETC'],
    ]);
  });

  it('does not turn a break or a lunch column into a class', () => {
    /*
     * A break is time passing, not something to attend. Storing one would put
     * "BREAK" in a student's day and, worse, into attendance (§19).
     */
    const parsed = parseTimetable(page(MONDAY));
    expect(parsed.classes.some((entry) => /break|lunch/i.test(entry.initials))).toBe(false);
    expect(parsed.slots.filter((slot) => slot.isBreak)).toHaveLength(2);
  });

  it('reads every day the document prints', () => {
    const parsed = parseTimetable(
      page(
        MONDAY,
        dayRow('TUESDAY', 640, [null, null, null, 'IDT', 'POP', null, null, null]),
        dayRow('SATURDAY', 620, ['MAT', 'ICO', null, 'PHY', 'ESC', null, null, null]),
      ),
    );
    expect([...new Set(parsed.classes.map((entry) => entry.day))]).toEqual(['Mon', 'Tue', 'Sat']);
  });
});

describe('initials mean what THIS document says they mean', () => {
  it('resolves them through the timetable’s own subject table', () => {
    const parsed = parseTimetable(page(MONDAY));
    const mat = parsed.classes.find((entry) => entry.initials === 'MAT');
    expect(mat?.subjectCode).toBe('BQATS101');
  });

  it('keeps the timetable’s own wording of a title as source', () => {
    /*
     * The timetable says "Mathematics-I for CSE Stream"; a result card says
     * "MATHEMATICS FOR CSE STREAM-I". They are the same subject because the
     * CODE says so, never because the words look alike (§21, §22).
     */
    const parsed = parseTimetable(page(MONDAY));
    const entry = parsed.dictionary.find((candidate) => candidate.initials === 'MAT');
    expect(entry?.title).toBe('Mathematics-I for CSE Stream');
    expect(entry?.subjectCode).toBe('BQATS101');
  });

  it('reports initials the document never defines rather than guessing', () => {
    /*
     * `XYZ` is in the grid and not in the table. There is no global truth about
     * what it means, so the class is kept with no code and the student is told.
     */
    const parsed = parseTimetable(
      page(dayRow('MONDAY', 660, ['XYZ', null, null, null, null, null, null, null])),
    );
    const unknown = parsed.classes.find((entry) => entry.initials === 'XYZ');
    expect(unknown?.subjectCode).toBeNull();
    expect(parsed.warnings.join(' ')).toMatch(/never defines/i);
  });

  it('keeps the college’s hours and the scheme’s hours apart', () => {
    /*
     * The reference prints 3+0+2 for what the college teaches and 2+0+2 for
     * what the scheme prescribes. They disagree, and collapsing them would lose
     * exactly that fact (§27).
     */
    const parsed = parseTimetable(page(MONDAY));
    const pop = parsed.dictionary.find((entry) => entry.initials === 'POP');
    expect(pop?.collegeHours).toBe('3+0+2');
    expect(pop?.schemeHours).toBe('2+0+2');
  });

  it('reads a subject table row on its own', () => {
    const entries = readDictionary([
      'BQATS101 Mathematics-I for CSE Stream MAT Prof. Anita R 2+2+2 2+2+2',
    ]);
    expect(entries[0]).toMatchObject({
      subjectCode: 'BQATS101',
      initials: 'MAT',
      title: 'Mathematics-I for CSE Stream',
    });
    expect(entries[0]?.faculty).toMatch(/Anita/);
  });
});

describe('a cell is not always one class', () => {
  it('splits a batch cell into one class per batch', () => {
    /*
     * `PHYE1/POPE2` is two classes at one time for different halves of the
     * group. One class called "PHYE1/POPE2" would be a course nobody teaches;
     * picking a half would put a student in the wrong room (§23).
     */
    const parsed = parseTimetable(
      page(dayRow('TUESDAY', 640, ['PHYE1/POPE2', null, null, null, null, null, null, null])),
    );
    const tuesday = parsed.classes.filter((entry) => entry.day === 'Tue');
    expect(tuesday.map((entry) => [entry.initials, entry.batch])).toEqual([
      ['PHY', 'E1'],
      ['POP', 'E2'],
    ]);
    expect(parsed.batches).toEqual(['E1', 'E2']);
  });

  it('keeps a lab that runs across columns as ONE class', () => {
    /*
     * A lab written once across two columns runs from the first column's start
     * to the last one's end. Three disconnected classes would be three
     * attendance rows for one session (§25).
     */
    const lab = [
      at('MONDAY', 40, 660, 70),
      at('MAT LAB(E1+E2)', COLUMNS[6] as number, 660, 180),
    ];
    const parsed = parseTimetable(page(lab));
    const classes = parsed.classes.filter((entry) => entry.initials === 'MAT');
    expect(classes).toHaveLength(2);
    expect(classes[0]).toMatchObject({ start: '15:10', end: '17:00', batch: 'E1' });
    expect(classes[1]?.batch).toBe('E2');
    expect(classes[0]?.spansSlots).toBe(2);
  });

  it('says when the student must choose a batch', () => {
    const split = parseTimetable(
      page(dayRow('TUESDAY', 640, ['PHYE1/POPE2', null, null, null, null, null, null, null])),
    );
    expect(needsBatch(split)).toBe(true);
    expect(needsBatch(parseTimetable(page(MONDAY)))).toBe(false);
  });
});

describe('what the student’s week becomes', () => {
  const parsed = () =>
    parseTimetable(
      page(MONDAY, dayRow('TUESDAY', 640, ['PHYE1/POPE2', null, null, null, null, null, null, null])),
    );

  let counter = 0;
  const makeId = () => `s${String((counter += 1))}`;

  it('gives a student their own batch’s classes, and the shared ones', () => {
    const e1 = slotsForBatch(parsed(), 'E1', 'p1', makeId);
    const tuesday = e1.filter((slot) => slot.day === 'Tue');
    expect(tuesday.map((slot) => slot.subjectCode)).toEqual(['BQHYS102']);
    /* Monday is nobody's batch in particular, so it is everybody's. */
    expect(e1.filter((slot) => slot.day === 'Mon')).toHaveLength(5);
  });

  it('gives the other batch the other class', () => {
    const e2 = slotsForBatch(parsed(), 'E2', 'p1', makeId);
    expect(e2.filter((slot) => slot.day === 'Tue').map((slot) => slot.subjectCode)).toEqual([
      'BQOPS103',
    ]);
  });

  it('keeps only the shared classes while no batch has been chosen', () => {
    /*
     * Not a guess and not everything: a student who has not said which half
     * they are in gets the classes that are certainly theirs (§23).
     */
    const none = slotsForBatch(parsed(), null, 'p1', makeId);
    expect(none.some((slot) => slot.day === 'Tue')).toBe(false);
    expect(none.length).toBeGreaterThan(0);
  });

  it('produces ordinary timetable slots, so nothing downstream changes', () => {
    const slots = slotsForBatch(parsed(), 'E1', 'p1', makeId);
    expect(slots[0]).toMatchObject({
      profileId: 'p1',
      day: 'Mon',
      startTime: '10:00',
      endTime: '10:55',
      subjectCode: 'BQSCK104B',
    });
    expect(slots[0]?.faculty).toMatch(/Divya/);
  });

  it('drops a class whose subject the document never identified', () => {
    /* An unresolved class cannot become a timetable slot: it has no subject. */
    const unknown = parseTimetable(
      page(dayRow('MONDAY', 660, ['XYZ', null, null, null, null, null, null, null])),
    );
    expect(slotsForBatch(unknown, null, 'p1', makeId)).toHaveLength(0);
  });
});

describe('context comes from the document', () => {
  it('reads the class, semester, year, revision, room and effective date', () => {
    const parsed = parseTimetable(page(MONDAY));
    expect(parsed.context).toMatchObject({
      semester: 1,
      academicYear: '2026-27',
      revision: 'R2',
      effectiveFrom: '2026-11-07',
      room: 'B205',
    });
    /*
     * WITHOUT THE REVISION LABEL BESIDE IT. `CLASS: ...` and `TIME-TABLE (R2)`
     * sit side by side on the real document and land on one reconstructed row.
     * A class name that swallowed the label made two revisions of one class
     * look like two different classes, and the older one stopped being
     * recognised as older — the check that stops a stale upload replacing a
     * student's week.
     */
    expect(parsed.context.className).toBe('I (E) CSBS SEMESTER I');
  });

  it('says so when no effective date is printed', () => {
    const noDate = parseTimetable([
      ...CONTEXT.filter((item) => !/W\.E\.F/i.test(item.text)),
      ...HEADER,
      ...MONDAY,
      ...DICTIONARY,
    ]);
    expect(noDate.context.effectiveFrom).toBeNull();
    expect(noDate.warnings.join(' ')).toMatch(/effective date/i);
  });
});

describe('two classes in one place', () => {
  it('is reported, never resolved', () => {
    /*
     * Which of two printed classes is right is not something a parser can know
     * (§17). Both are kept and the clash is named.
     */
    const parsed = parseTimetable(
      page(
        dayRow('MONDAY', 660, ['MAT', null, null, null, null, null, null, null]),
        /*
         * The same day printed twice with different classes at one hour — what
         * a timetable continued across two pages, or amended in place, gives.
         */
        dayRow('MONDAY', 500, ['PHY', null, null, null, null, null, null, null]),
      ),
    );
    expect(parsed.conflicts).toHaveLength(1);
    expect([...(parsed.conflicts[0]?.initials ?? [])].sort()).toEqual(['MAT', 'PHY']);
    expect(parsed.warnings.join(' ')).toMatch(/more than one class/i);
  });

  it('does not call two batches at one time a conflict', () => {
    /* That is the entire point of a split cell — it is the schedule working. */
    const parsed = parseTimetable(
      page(dayRow('TUESDAY', 640, ['PHYE1/POPE2', null, null, null, null, null, null, null])),
    );
    expect(parsed.conflicts).toHaveLength(0);
  });
});

describe('a revision replaces, a duplicate does not', () => {
  const saved = (over: Partial<SavedTimetable> = {}): SavedTimetable => ({
    id: 't1',
    className: 'I (E) CSBS SEMESTER I',
    semester: 1,
    academicYear: '2026-27',
    revision: 'R1',
    effectiveFrom: '2026-07-01',
    batch: 'E1',
    fingerprint: 'aaaa',
    importedAt: '2026-07-01T00:00:00.000Z',
    slotCount: 20,
    ...over,
  });

  it('recognises the same document again, whatever it was called', () => {
    const relation = relateTimetable(
      { fingerprint: 'aaaa', className: 'I (E) CSBS SEMESTER I', effectiveFrom: '2026-07-01' },
      [saved()],
    );
    expect(relation.kind).toBe('duplicate');
  });

  it('calls a later revision for the same class a revision that supersedes', () => {
    const relation = relateTimetable(
      { fingerprint: 'bbbb', className: 'I (E) CSBS SEMESTER I', effectiveFrom: '2026-07-15' },
      [saved()],
    );
    expect(relation.kind).toBe('revision');
    if (relation.kind === 'revision') expect(relation.supersedes).toBe(true);
  });

  it('does not let an older revision take over because it was uploaded later', () => {
    /*
     * A student who uploads last term's R1 after this term's R2 has not gone
     * back in time. Effective date decides, never upload order (§14, §16).
     */
    const relation = relateTimetable(
      { fingerprint: 'cccc', className: 'I (E) CSBS SEMESTER I', effectiveFrom: '2026-06-01' },
      [saved({ effectiveFrom: '2026-07-15', revision: 'R2' })],
    );
    expect(relation.kind).toBe('revision');
    if (relation.kind === 'revision') expect(relation.supersedes).toBe(false);
  });

  it('treats another class as a new timetable, not a revision', () => {
    const relation = relateTimetable(
      { fingerprint: 'dddd', className: 'II (A) CSE SEMESTER III', effectiveFrom: '2026-07-01' },
      [saved()],
    );
    expect(relation.kind).toBe('new');
  });
});

describe('a document that is not a grid', () => {
  it('says the times could not be read rather than inventing a week', () => {
    const parsed = parseTimetable([at('Some notes about nothing in particular', 60, 700, 400)]);
    expect(parsed.classes).toHaveLength(0);
    expect(parsed.warnings.join(' ')).toMatch(/times along the top/i);
  });

  it('says nothing could be read from an empty document', () => {
    expect(parseTimetable([]).warnings.join(' ')).toMatch(/nothing could be read/i);
  });
});
