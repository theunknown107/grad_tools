/**
 * Reading a supplied VTU examination time table.
 *
 * Authority: Phase 7B.2 §33 · docs/40 (source audit)
 *
 * ---------------------------------------------------------------------------
 * THE FIXTURE IS THE REAL LAYOUT, WITH INVENTED CONTENT
 * ---------------------------------------------------------------------------
 *
 * The geometry below — a scheme header merged over two semester columns, the
 * session printed once beneath each semester, a date column on the left, `--`
 * where a column has no exam — is the layout of the real document recorded in
 * docs/40, measured from it.
 *
 * The CONTENT is invented. `BQQ301` is not a VTU code, `Dec.2099/Jan.2100` is
 * not a VTU exam cycle, and no real student's examination appears anywhere in
 * this file. The one real document available is a low-resolution image whose
 * table body OCRs to noise — `BBOK407 / BBOC407` comes back as
 * `[BBOK4O7/BBOC4O7|` at confidence 13 — so it cannot be a fixture, and
 * pretending otherwise would be testing against a transcription error.
 */
import { describe, expect, it } from 'vitest';
import { classifyExamCell, parseExamTimetable, type ExamPage } from '../src/domain/exam-import.js';
import type { PositionedText } from '../src/domain/pdf-layout.js';

const HEIGHT = 11;
const at = (text: string, x: number, y: number, width = text.length * 6): PositionedText => ({
  text,
  x,
  y,
  width,
  height: HEIGHT,
});

/** Column geometry, as the real document lays it out. */
const COL = { date: 60, third: 320, fourth: 520, fifth: 720 } as const;

const TITLE = [
  at('Visvesvaraya Technological University, Belagavi', 170, 760),
  at(
    'Draft Time Table for Eligible Students of B.E. III & IV (2022 Scheme), V semester (2021 Scheme)',
    80,
    740,
  ),
  at('[CBCS] Examinations, Dec.2099/Jan.2100', 300, 720),
];

/** The two-level header: scheme merged above, semester and session below. */
const HEADER = [
  at('2022 Scheme [CBCS]', COL.third - 20, 690, 400),
  at('2021 Scheme [CBCS]', COL.fifth - 20, 690, 200),
  at('Date, Day', COL.date, 660),
  at('III - Semester', COL.third, 660),
  at('IV - Semester', COL.fourth, 660),
  at('V - Semester', COL.fifth, 660),
  at('2.00pm to 5.00pm', COL.third, 645),
  at('2.00pm to 5.00pm', COL.fourth, 645),
  at('9.30am to 12.30pm', COL.fifth, 645),
];

const NOTES = [
  at('Note : As per the Revised Notification No.VTU/QQQ/BOS/000/2099-99/0000 dt.01/01/2099', 100, 200),
];

/** One dated row: the date cell, then one cell per semester column. */
const row = (y: number, date: string, third: string, fourth: string, fifth: string) => [
  at(date, COL.date, y),
  at(third, COL.third, y),
  at(fourth, COL.fourth, y),
  at(fifth, COL.fifth, y),
];

const page = (...rows: readonly PositionedText[][]): ExamPage[] => [
  { page: 1, items: [...TITLE, ...HEADER, ...rows.flat(), ...NOTES] },
];

/* -------------------------------------------------------------------------- */

describe('what the document says about itself', () => {
  it('reads the exam cycle in the document’s own words', () => {
    /* §6: the cycle is whatever the source calls it, never a normalised enum. */
    const parsed = parseExamTimetable(page(row(600, '23-01-2099, Friday', 'BQQ301', '--', '--')));
    expect(parsed.context.examCycle).toBe('Dec.2099/Jan.2100');
  });

  it('reads the publication state out of the title', () => {
    const parsed = parseExamTimetable(page(row(600, '23-01-2099, Friday', 'BQQ301', '--', '--')));
    expect(parsed.context.publicationState).toBe('draft');
  });

  it('keeps the notification the document cites', () => {
    const parsed = parseExamTimetable(page(row(600, '23-01-2099, Friday', 'BQQ301', '--', '--')));
    expect(parsed.context.notification).toBe('VTU/QQQ/BOS/000/2099-99/0000');
  });

  it('names every scheme the header carries', () => {
    const parsed = parseExamTimetable(page(row(600, '23-01-2099, Friday', 'BQQ301', '--', '--')));
    expect([...parsed.context.schemes].sort()).toEqual(['2021', '2022']);
  });
});

describe('one document, several schemes and several semesters', () => {
  /*
   * §11. The scheme is a MERGED header spanning the semester columns beneath
   * it. What applies to a student is decided by the column, never by the
   * document — a Semester V student must not inherit a Semester III exam
   * because they arrived in the same PDF.
   */
  it('gives each column its own scheme and semester', () => {
    const parsed = parseExamTimetable(
      page(row(600, '23-01-2099, Friday', 'BQQ301', 'BQQ401', 'BQQ501')),
    );
    expect(parsed.events.map((e) => [e.scheme, e.semester, e.printed])).toEqual([
      ['2022', 3, 'BQQ301'],
      ['2022', 4, 'BQQ401'],
      ['2021', 5, 'BQQ501'],
    ]);
  });

  it('takes the session from the column, not from the row', () => {
    /* §10: printed once in the header and inherited by every exam beneath. */
    const parsed = parseExamTimetable(
      page(row(600, '23-01-2099, Friday', 'BQQ301', '--', 'BQQ501')),
    );
    const third = parsed.events.find((e) => e.semester === 3);
    const fifth = parsed.events.find((e) => e.semester === 5);
    expect(third).toMatchObject({ startTime: '14:00', endTime: '17:00' });
    expect(fifth).toMatchObject({ startTime: '09:30', endTime: '12:30' });
    expect(third?.session).toBe('2.00pm to 5.00pm');
  });
});

describe('what a cell can be', () => {
  it('reads an ordinary course code', () => {
    expect(classifyExamCell('BQQ301')).toEqual({ kind: 'code', codes: ['BQQ301'] });
  });

  it('reads two codes for one sitting', () => {
    /* The alternatives pair, as the real document prints for Biology. */
    expect(classifyExamCell('BQQK407 / BQQC407')).toEqual({
      kind: 'alternatives',
      codes: ['BQQK407', 'BQQC407'],
    });
  });

  it('keeps a pattern as a pattern, and names NO course for it', () => {
    /*
     * §12. `B**301` stands for a shape, not a course. Expanding the asterisks
     * would mean inventing the branch letters the document deliberately did
     * not print, and that invented code would then read exactly like a real
     * one. So the codes list is empty — deliberately, not for want of trying.
     */
    for (const printed of ['B**301', 'B**456*', '21**51']) {
      expect(classifyExamCell(printed)).toEqual({ kind: 'pattern', codes: [] });
    }
  });

  it('treats a cell as a pattern when ANY part of it is one', () => {
    /* `B**301 / BMAT301` names a shape and an example of it, not two courses. */
    expect(classifyExamCell('B**301 / BQQMAT301')).toEqual({ kind: 'pattern', codes: [] });
  });

  it('reads a code from a scheme this product does not model', () => {
    /*
     * §13. `21RMI56` is a 2021-scheme code. It does not fit the catalogue's
     * grammar and is kept anyway: a student sitting an arrear paper should see
     * it, even though nothing here can say what it is.
     */
    expect(classifyExamCell('21RMI56')).toEqual({ kind: 'code', codes: ['21RMI56'] });
    expect(classifyExamCell('21CIV57')).toEqual({ kind: 'code', codes: ['21CIV57'] });
  });

  it('does not force something unrecognisable into a code', () => {
    expect(classifyExamCell('Practical examination')).toEqual({ kind: 'other', codes: [] });
  });
});

describe('a column with no exam that day', () => {
  it('produces no event, and is not mistaken for missing data', () => {
    /*
     * §14. `--` is an answer: this column has no exam on this date. Reading it
     * as an unknown would put a question mark on a free afternoon; reading it
     * as an exam would put an examination there.
     */
    const parsed = parseExamTimetable(
      page(row(600, '23-01-2099, Friday', 'BQQ301', '--', '--')),
    );
    expect(parsed.events).toHaveLength(1);
    expect(parsed.events[0]?.printed).toBe('BQQ301');
    expect(parsed.warnings).toEqual([]);
  });
});

describe('the dates', () => {
  it('reads a day-first printed date without reinterpreting it', () => {
    /*
     * `05-02-2099` is the fifth of February. Read month-first it becomes the
     * second of May — a real exam on the wrong day, from one silent
     * assumption about locale.
     */
    const parsed = parseExamTimetable(
      page(row(600, '05-02-2099, Thursday', 'BQQ301', '--', '--')),
    );
    expect(parsed.events[0]?.examDate).toBe('2099-02-05');
  });

  it('keeps the weekday the document printed', () => {
    const parsed = parseExamTimetable(
      page(row(600, '23-01-2099, Friday', 'BQQ301', '--', '--')),
    );
    expect(parsed.events[0]?.weekday).toBe('Friday');
  });

  it('reads every dated row, and nothing that is not one', () => {
    const parsed = parseExamTimetable(
      page(
        row(600, '23-01-2099, Friday', 'BQQ301', '--', '--'),
        row(580, '27-01-2099, Tuesday', '--', 'BQQ401', '--'),
        row(560, '03-02-2099, Tuesday', 'BQQ304', '--', '21RMI56'),
      ),
    );
    expect(parsed.events.map((e) => e.examDate)).toEqual([
      '2099-01-23',
      '2099-01-27',
      '2099-02-03',
      '2099-02-03',
    ]);
  });
});

describe('when the document cannot be read', () => {
  it('says so rather than returning an empty timetable', () => {
    expect(parseExamTimetable([]).warnings[0]).toMatch(/nothing could be read/i);
  });

  it('refuses to take exams from a document whose columns it cannot find', () => {
    /*
     * No header means no scheme, no semester and no session — and an exam with
     * none of those cannot be shown to the right student. Better to report the
     * document as unreadable than to file its exams under a guess.
     */
    const parsed = parseExamTimetable([
      { page: 1, items: [at('23-01-2099, Friday', 60, 600), at('BQQ301', 320, 600)] },
    ]);
    expect(parsed.events).toEqual([]);
    expect(parsed.warnings[0]).toMatch(/columns .* could not be read/i);
  });

  it('warns that a pattern names no course, rather than resolving it', () => {
    const parsed = parseExamTimetable(
      page(row(600, '23-01-2099, Friday', 'B**301', '--', '--')),
    );
    expect(parsed.events[0]).toMatchObject({ kind: 'pattern', codes: [] });
    expect(parsed.warnings.join(' ')).toMatch(/code pattern/i);
  });
});
