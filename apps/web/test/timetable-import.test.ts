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
  initialismsFor,
  needsBatch,
  parseTimetable,
  readDictionary,
  readSlot,
  relateTimetable,
  resolveGridSubject,
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

    /*
     * The warning NAMES the abbreviation. It used to be a count — "1 class uses
     * initials this timetable never defines" — and a count is not something a
     * person can act on when the grid holds forty cells.
     */
    expect(parsed.warnings.join(' ')).toMatch(/XYZ/);
    expect(parsed.warnings.join(' ')).toMatch(/never says what/i);
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
    const lab = [at('MONDAY', 40, 660, 70), at('MAT LAB(E1+E2)', COLUMNS[6] as number, 660, 180)];
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
      page(
        MONDAY,
        dayRow('TUESDAY', 640, ['PHYE1/POPE2', null, null, null, null, null, null, null]),
      ),
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

describe('how much of the timetable actually came back', () => {
  it('calls a full reading complete', () => {
    const parsed = parseTimetable(
      page(
        MONDAY,
        dayRow('TUESDAY', 640, ['MAT', 'PHY', null, 'POP', 'ESC', null, null, null]),
        dayRow('WEDNESDAY', 620, ['ETC', 'ESC', null, 'MAT', 'POP', null, null, null]),
      ),
    );
    expect(parsed.coverage.looksComplete).toBe(true);
    expect(parsed.coverage.cellsResolved).toBe(parsed.coverage.cellsFound);
  });

  it('refuses to call a fragment a week', () => {
    /*
     * MEASURED ON A REAL PHOTOGRAPH. A reading can recover the dictionary,
     * every day name and a handful of correct classes while losing most of the
     * time columns — and the classes it did read are right. Presenting those as
     * "your timetable" would be a week missing most of itself that looks whole,
     * which is worse than saying so (§26).
     */
    const thin = parseTimetable([
      ...CONTEXT,
      /* Only two columns of the header survived. */
      at('10:00-10:55am', COLUMNS[0] as number, HEADER_Y),
      at('10:55-11:50am', COLUMNS[1] as number, HEADER_Y),
      ...dayRow('MONDAY', 660, ['ESC', 'MAT']),
      ...DICTIONARY,
    ]);

    expect(thin.coverage.looksComplete).toBe(false);
    expect(thin.warnings.join(' ')).toMatch(/only part of this timetable/i);
  });

  it('counts a class it could not identify as found but not resolved', () => {
    const parsed = parseTimetable(
      page(dayRow('MONDAY', 660, ['XYZ', 'MAT', null, 'PHY', 'POP', null, null, null])),
    );
    expect(parsed.coverage.cellsFound).toBe(4);
    expect(parsed.coverage.cellsResolved).toBe(3);
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

/* -------------------------------------------------------------------------- */
/* The shapes a Word-authored timetable prints                                */
/* -------------------------------------------------------------------------- */

/**
 * A timetable written in Word and exported to PDF does not look like the
 * reference document, and the differences are structural rather than cosmetic.
 * These three cases were each found by running the shipped parser against a
 * real one, which produced ZERO classes and, for two of the three, no error a
 * person could act on.
 */
describe('a header written the way a word processor writes one', () => {
  it('reads a range joined by the word "to"', () => {
    /*
     * The header is three stacked rows — start times, a row of the word "to",
     * and end times — so a column reads "10:00 am to 10:55 am" and contains no
     * dash at all. Requiring a dash found no slot in any column and failed the
     * whole document.
     */
    expect(readSlot('10:00 am to 10:55 am')).toEqual({ start: '10:00', end: '10:55' });
    expect(readSlot('1:05 pm to 2:00 pm')).toEqual({ start: '13:05', end: '14:00' });
  });

  it('reads a punctuated meridiem', () => {
    // `4:05 p.m` and `5:00p.m`, with and without the space.
    expect(readSlot('4:05 p.m to 5:00p.m')).toEqual({ start: '16:05', end: '17:00' });
    expect(readSlot('10:00 a.m. - 10:55 a.m.')).toEqual({ start: '10:00', end: '10:55' });
  });

  it('still refuses a range that is not one', () => {
    // The widened separator must not turn any two clocks into a slot.
    expect(readSlot('10:00 am')).toBeNull();
    expect(readSlot('Mini project')).toBeNull();
  });
});

describe('a day whose label sits on its own printed line', () => {
  /**
   * The label is vertically centred in a tall table row, so it lands on a line
   * of its own with the subjects above it and the rooms below. The parser
   * required the day name to be the FIRST run of a row carrying its cells, so
   * every day matched nothing — and the document reported no error, just no
   * classes.
   */
  const SPLIT_DAY = [
    /* Subjects, on the line above the label. */
    [
      at('ESC', COLUMNS[0] as number, 664),
      at('MAT', COLUMNS[1] as number, 664),
      at('BREAK', COLUMNS[2] as number, 664),
      at('PHY', COLUMNS[3] as number, 664),
    ],
    /* The label, alone. */
    [at('MONDAY', 40, 656, 70)],
    /* Rooms, on the line below. */
    [at('LH-302', COLUMNS[0] as number, 648), at('LH-302', COLUMNS[1] as number, 648)],
  ];

  it('reads the cells above and below the label as that day', () => {
    const parsed = parseTimetable(page(...SPLIT_DAY));
    const monday = parsed.classes.filter((entry) => entry.day === 'Mon');
    expect(monday.length).toBeGreaterThan(0);
    expect(monday.map((entry) => entry.initials)).toContain('PHY');
  });

  it('separates a subject from the room printed under it', () => {
    /*
     * The subject and the room share a column, so the band reads them as one
     * cell — `ESC LH-302`. Without splitting it the cell matches nothing and
     * the class is kept with a null code and no room, which on a real document
     * was 42 classes found and none identified.
     */
    const parsed = parseTimetable(page(...SPLIT_DAY));
    const esc = parsed.classes.find((entry) => entry.initials === 'ESC');
    expect(esc?.room).toBe('LH-302');
    expect(esc?.subjectCode).toBe('BQSCK104B');
  });

  it('does not let the page footer become a class', () => {
    /*
     * The last band has no day label beneath it to stop at, so it is bounded by
     * the median height of the others. Without that, a signature block at the
     * bottom of the page is read as the last day's classes.
     */
    const withFooter = [
      ...SPLIT_DAY,
      [at('TUESDAY', 40, 630, 70), at('POP', COLUMNS[0] as number, 630)],
      /* Far below, where a footer lives. */
      [at('Dept. Academic Coordinator', COLUMNS[0] as number, 40, 200)],
      [at('HoD', COLUMNS[1] as number, 40, 60)],
    ];
    const parsed = parseTimetable(page(...withFooter));
    const text = parsed.classes.map((entry) => entry.sourceText).join(' | ');
    expect(text).not.toMatch(/Coordinator|HoD/i);
  });

  it('still reads a timetable whose days each fit on one line', () => {
    // A band of one row is the previous behaviour exactly, and it must not
    // have changed.
    const parsed = parseTimetable(page(MONDAY));
    expect(parsed.classes.filter((entry) => entry.day === 'Mon').length).toBe(5);
  });
});

/* -------------------------------------------------------------------------- */
/* Abbreviations a subject table does not print                               */
/* -------------------------------------------------------------------------- */

/**
 * The Semester 5 table's own header names an "Initials" column, and then not
 * one row fills it in. Its grid still says CN, TOC, FM, CNL, CSL — built from
 * the TITLES. Reading that is the difference between one subject resolved and
 * most of them, and it is done by a stated rule with a uniqueness requirement,
 * not by similarity scoring.
 */
describe('an abbreviation built from a title', () => {
  it('takes a first letter from each word', () => {
    expect(initialismsFor('Computer Networks Lab')).toContain('CNL');
    expect(initialismsFor('Computational Statistics Lab')).toContain('CSL');
  });

  it('offers the reading with and without the joining words', () => {
    // A college writes both: TOC on this timetable, TC on another.
    const candidates = initialismsFor('Theory of Computation');
    expect(candidates).toContain('TOC');
    expect(candidates).toContain('TC');
  });

  it('carries an acronym already in the title whole', () => {
    // "Research Methodology and IPR" is RMIPR, not RMI.
    expect(initialismsFor('Research Methodology and IPR')).toContain('RMIPR');
  });

  it('treats a parenthetical as a qualifier rather than a word', () => {
    // "(T/L)" says the course has theory and lab parts; the grid still says CN.
    const candidates = initialismsFor('Computer Networks(T/L)');
    expect(candidates).toContain('CN');
    expect(candidates).toContain('CNTL');
  });

  it('splits a hyphenated word into its parts', () => {
    expect(initialismsFor('Environmental Studies and E-waste Management')).toContain('ESEWM');
  });

  it('produces nothing from nothing', () => {
    expect(initialismsFor('')).toEqual([]);
    expect(initialismsFor('X')).toEqual([]);
  });
});

describe('resolving a grid abbreviation to a subject', () => {
  const table = [
    'BQAS501 Fundamentals of Management Prof. A One 3+0+0 3+0+0',
    'BQAS502 Computer Networks(T/L) Prof. B Two 3+0+0 3+0+2',
    'BQASL502-Computer Networks Lab Prof. C Three 0+2+0 0+2+0 Mr. D Four',
  ];

  it('resolves through a unique title initialism when no column declares one', () => {
    const dictionary = readDictionary(table);
    expect(resolveGridSubject(dictionary, 'FM')).toMatchObject({
      subjectCode: 'BQAS501',
      resolution: 'initialism',
      reason: null,
    });
    // CNL is "Computer Networks Lab" and nothing else. It does not
    // nearly-match "Computer Networks", which produces CN.
    expect(resolveGridSubject(dictionary, 'CNL').subjectCode).toBe('BQASL502');
    expect(resolveGridSubject(dictionary, 'CN').subjectCode).toBe('BQAS502');
  });

  it('prefers a column the document actually printed', () => {
    const dictionary = readDictionary([
      'BQAS501 Mathematics-I for CSE Stream MAT Prof. A One 2+2+2 2+2+2',
    ]);
    expect(resolveGridSubject(dictionary, 'MAT')).toMatchObject({
      subjectCode: 'BQAS501',
      resolution: 'declared',
    });
  });

  it('refuses to choose when two subjects would produce the same abbreviation', () => {
    /*
     * THE ASSERTION THAT MATTERS MOST. A rule that resolves an ambiguous
     * abbreviation is worse than one that resolves nothing: it puts a student
     * in the wrong class and says nothing about it.
     */
    const dictionary = readDictionary([
      'BQAS501 Computer Networks Prof. A One 3+0+0 3+0+0',
      'BQAS502 Compiler Notes Prof. B Two 3+0+0 3+0+0',
    ]);
    const resolved = resolveGridSubject(dictionary, 'CN');
    expect(resolved.subjectCode).toBeNull();
    expect(resolved.resolution).toBe('ambiguous');
    // And it says which two, so a person can settle it.
    expect(resolved.reason).toContain('BQAS501');
    expect(resolved.reason).toContain('BQAS502');
  });

  it('says so, by name, when the document never defines the abbreviation', () => {
    const dictionary = readDictionary(table);
    const resolved = resolveGridSubject(dictionary, 'ZZZ');
    expect(resolved.subjectCode).toBeNull();
    expect(resolved.resolution).toBe('unknown');
    expect(resolved.reason).toContain('ZZZ');
  });
});

describe('a subject table that wraps its titles', () => {
  it('joins a title split across printed lines', () => {
    /*
     * A narrow column wraps the title and the faculty and hours land BETWEEN
     * the halves. Reading line by line took the title as "Marketing Research &
     * Marketing" and lost the word that makes the abbreviation MRMM.
     */
    const dictionary = readDictionary([
      'BQAS515A Marketing Research & Marketing',
      'Prof. A One 3+0+0 3+0+0',
      'Management',
    ]);
    expect(dictionary[0]?.title).toBe('Marketing Research & Marketing Management');
    expect(resolveGridSubject(dictionary, 'MRMM').subjectCode).toBe('BQAS515A');
  });

  it('keeps the technical staff out of the title', () => {
    const dictionary = readDictionary([
      'BQASL502-Computer Networks Lab Prof. C Three 0+2+0 0+2+0 Mr. D Four',
    ]);
    expect(dictionary[0]?.title).toBe('Computer Networks Lab');
  });

  it('reads a faculty name whose full stop is spaced away from it', () => {
    // `Prof . A One` is what a PDF converted from a word processor produces,
    // and it used to leave the whole name inside the title.
    const dictionary = readDictionary(['BQAS501 Theory of Computation Prof . A One 3+2+0 3+2+0']);
    expect(dictionary[0]?.title).toBe('Theory of Computation');
  });
});

describe('cell shapes a word-processed grid produces', () => {
  it('splits a hyphenated batch cell into one class per batch', () => {
    /*
     * `CNL-B2/CSL-B1` is the lab rotation: half the group in one lab, half in
     * the other. With only `\s*` between the initials and the batch it matched
     * neither of the real document's two lab cells, and the rotation was read
     * as one unidentified blob.
     */
    const dictionary = readDictionary([
      'BQASL502 Computer Networks Lab Prof. A One 0+2+0 0+2+0',
      'BQASL504 Computational Statistics Lab Prof. B Two 0+0+2 0+0+2',
    ]);
    expect(resolveGridSubject(dictionary, 'CNL').subjectCode).toBe('BQASL502');
    expect(resolveGridSubject(dictionary, 'CSL').subjectCode).toBe('BQASL504');

    const parsed = parseTimetable(page(dayRow('MONDAY', 660, ['CNL-B2/CSL-B1'])));
    const monday = parsed.classes.filter((entry) => entry.day === 'Mon');
    expect(monday.map((entry) => [entry.initials, entry.batch])).toEqual([
      ['CNL', 'B2'],
      ['CSL', 'B1'],
    ]);
  });

  it('reads a component marker as the same subject', () => {
    // `TOC-T` is Theory of Computation, marked as its theory hour.
    const parsed = parseTimetable(page(dayRow('MONDAY', 660, ['ETC-T'])));
    expect(parsed.classes[0]?.initials).toBe('ETC');
  });

  it('does not strip a batch as though it were a component marker', () => {
    // The component set is closed — T, P, L, TH, PR — precisely so that `-B2`
    // is never mistaken for one and a whole class put in the wrong half.
    const parsed = parseTimetable(page(dayRow('MONDAY', 660, ['ETC-B2'])));
    expect(parsed.classes[0]?.initials).not.toBe('ETC');
  });

  it('drops a single letter, which is never a subject', () => {
    /*
     * A timetable sets "SHORT BREAK" vertically down its narrow column, and the
     * extractor returns one letter per printed line. Each became its own class,
     * so a real document produced seventeen abbreviations of which eight were
     * single letters.
     */
    const parsed = parseTimetable(page(dayRow('MONDAY', 660, ['MAT', 'S', 'H', 'O', 'PHY'])));
    expect(parsed.classes.map((entry) => entry.initials)).toEqual(['MAT', 'PHY']);
  });
});

describe('what a class says about its own subject', () => {
  it('carries how it was resolved, so all three outcomes are distinguishable', () => {
    const parsed = parseTimetable(page(dayRow('MONDAY', 660, ['MAT', 'ZZZ'])));
    const resolved = parsed.classes.find((entry) => entry.initials === 'MAT');
    const missing = parsed.classes.find((entry) => entry.initials === 'ZZZ');

    expect(resolved?.resolution).toBe('declared');
    expect(resolved?.unresolvedReason).toBeNull();

    // A null code used to be the only signal, and it meant three different
    // things. It now says which.
    expect(missing?.subjectCode).toBeNull();
    expect(missing?.resolution).toBe('unknown');
    expect(missing?.unresolvedReason).toContain('ZZZ');
  });
});

/* -------------------------------------------------------------------------- */
/* The heading a word-processed timetable prints                              */
/* -------------------------------------------------------------------------- */

/**
 * A timetable written in Word heads itself differently from the reference
 * document, and every one of these was read as `null` on a real one — leaving
 * the saved import record with no class, no revision and no effective date,
 * which is what tells a revision it supersedes the week a student is following.
 */
describe('a heading with no CLASS: label', () => {
  const HEADING = [
    at('V (B) – Timetable for the Academic year 2026 -27 (R0)', 60, 780, 500),
    at('With effective from: 09.09.2026', 60, 760, 300),
  ];

  const headed = (...days: readonly PlacedLike[][]): PlacedLike[] => [
    ...HEADING,
    ...HEADER,
    ...days.flat(),
    ...DICTIONARY,
  ];

  it('reads the class from the heading itself', () => {
    // `V (B)` names the class and the document never writes the word "class".
    expect(parseTimetable(headed(MONDAY)).context.className).toBe('V (B)');
  });

  it('takes the semester from the class name when nothing states one', () => {
    // The roman numeral IS the semester. This document never writes the word.
    expect(parseTimetable(headed(MONDAY)).context.semester).toBe(5);
  });

  it('reads a revision label that is not adjacent to the word', () => {
    // `(R0)` sits at the END of the heading, not beside "Timetable".
    expect(parseTimetable(headed(MONDAY)).context.revision).toBe('R0');
  });

  it('reads an effective date written as a sentence', () => {
    // `With effective from:` rather than `W.E.F:`.
    expect(parseTimetable(headed(MONDAY)).context.effectiveFrom).toBe('2026-09-09');
  });

  it('still reads the abbreviation and the CLASS: label', () => {
    // The reference document's own shapes must not have moved.
    const parsed = parseTimetable(page(MONDAY));
    /* Unchanged, including the trailing "SEMESTER I" the label carries. */
    expect(parsed.context.className).toBe('I (E) CSBS SEMESTER I');
    expect(parsed.context.revision).toBe('R2');
    expect(parsed.context.effectiveFrom).toBe('2026-11-07');
  });

  it('does not read a bare parenthesised label as a revision', () => {
    const parsed = parseTimetable([
      at('Some notice (R9) about something', 60, 780, 400),
      ...HEADER,
      ...MONDAY,
      ...DICTIONARY,
    ]);
    expect(parsed.context.revision).toBeNull();
  });
});

describe('a break set vertically down its column', () => {
  it('spells the column out and marks it as a break', () => {
    /*
     * A narrow column cannot fit "SHORT BREAK" across it, so a timetable sets
     * it down the column and the extractor returns one letter per printed line,
     * spread through every day's rows. None of them is a class and none belongs
     * to a day — but the column they spell is a break, and without reading them
     * it reads as an ordinary free period a student could be told to attend.
     */
    const letters = 'BREAK'.split('').map((letter, index) =>
      /* Stacked down the third column, between the day rows. */
      at(letter, COLUMNS[2] as number, 650 - index * 8, 10),
    );
    const parsed = parseTimetable([...CONTEXT, ...HEADER, ...MONDAY, ...letters, ...DICTIONARY]);

    expect(parsed.slots[2]?.isBreak).toBe(true);
    // And none of those letters became a class.
    expect(parsed.classes.some((entry) => entry.initials.length === 1)).toBe(false);
  });

  it('leaves an ordinary column alone', () => {
    const letters = 'XQZJ'
      .split('')
      .map((letter, index) => at(letter, COLUMNS[6] as number, 650 - index * 8, 10));
    const parsed = parseTimetable([...CONTEXT, ...HEADER, ...MONDAY, ...letters, ...DICTIONARY]);
    expect(parsed.slots[6]?.isBreak).toBe(false);
  });
});
