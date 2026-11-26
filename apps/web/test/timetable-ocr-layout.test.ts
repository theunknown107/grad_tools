/**
 * What a SCANNED or PHOTOGRAPHED college timetable does to the grid reader,
 * reproduced by geometry. Each case is a failure measured on real VTU college
 * timetable scans (counts only; the documents stay private):
 *
 *   - the batch / roll-number table printed to the RIGHT of the grid was read
 *     into the last hour of the day as classes ("E001-E032");
 *   - a "LUNCH" label whose own column header was not read fell into the
 *     teaching column beside it, became that cell's subject, and pulled the
 *     next hour's lab into the wrong column;
 *   - a lab rotation written once across two hours and CENTRED over them
 *     ("PHYE1/POPE2") started an hour late.
 *
 * Coordinates are y-up, as both real extractors produce them (pdf-layout.ts,
 * ocr-layout.ts). EVERY CODE AND NAME IS SYNTHETIC.
 */
import { describe, expect, it } from 'vitest';
import { parseTimetable, type PlacedLike } from '../src/domain/timetable-import.js';

const at = (text: string, x: number, y: number, width = 40): PlacedLike => ({
  text,
  x,
  y,
  width,
  height: 10,
  page: 1,
});

/** Column LEFT edges; each header is 80 wide, so columns are 100 apart. */
const COLUMNS = [100, 200, 300, 400, 500, 600, 700];
const HEADER = [
  at('10:00-10:55am', 100, 700, 80),
  at('10:55-11:50am', 200, 700, 80),
  at('11:50-12.10pm', 300, 700, 80),
  at('12.10-1:05pm', 400, 700, 80),
  at('1:05-02:00pm', 500, 700, 80),
  at('03:10-04:05pm', 600, 700, 80),
  at('04:05-05:00pm', 700, 700, 80),
];
const CONTEXT = [
  at('EXAMPLE INSTITUTE OF TECHNOLOGY', 60, 780, 400),
  at('TIME-TABLE (R2)', 400, 760, 150),
  at('W.E.F: 07/11/2026', 700, 760, 150),
];
const DICTIONARY = [
  at('BQATS101 Mathematics-I for CSE Stream MAT Prof. Anita R 2+2+2 2+2+2', 60, 300, 700),
  at('BQHYS102 Applied Physics for CSE stream PHY Prof. Bala V 2+2+2 2+2+2', 60, 280, 700),
  at('BQOPS103 Principles of Programming POP Prof. Chandra M 3+0+2 2+0+2', 60, 260, 700),
  at('BQSCK104B Introduction to Electrical ESC Prof. Divya K 4+0+0 3+0+0', 60, 240, 700),
  at('BQTCK105I Introduction to Cyber Security ETC Dr. Esha G 2+0+2 2+0+2', 60, 220, 700),
];

/** A cell centred in column `index` (0-based), as a scan prints it. */
const cell = (text: string, index: number, y: number, width = 40) =>
  at(text, (COLUMNS[index] as number) + (80 - width) / 2, y, width);

const DAYS = [
  [
    at('MONDAY', 20, 660, 60),
    cell('ESC', 0, 660),
    cell('MAT', 1, 660),
    cell('PHY', 3, 660),
    cell('POP', 4, 660),
  ],
  [
    at('TUESDAY', 20, 620, 60),
    cell('ETC', 0, 620),
    cell('ESC', 1, 620),
    cell('MAT', 3, 620),
    cell('POP', 4, 620),
  ],
  [
    at('WEDNESDAY', 20, 580, 60),
    cell('MAT', 0, 580),
    cell('PHY', 1, 580),
    cell('ETC', 3, 580),
    cell('ESC', 4, 580),
  ],
];

const classesOf = (placed: PlacedLike[]) =>
  parseTimetable(placed).classes.map(
    (c) => `${c.day} ${c.start}-${c.end} ${String(c.subjectCode)}`,
  );

describe('a scanned timetable: what lies beside the grid', () => {
  it('reads nothing from a batch table printed to the right of the grid', () => {
    const batchTable = [
      at('E001-E032', 900, 660, 70),
      at('E033-E063', 900, 620, 70),
      at('B115, B121', 900, 580, 70),
    ];
    const got = classesOf([...CONTEXT, ...HEADER, ...DAYS.flat(), ...batchTable, ...DICTIONARY]);
    expect(got.some((entry) => /null/.test(entry))).toBe(false);
    expect(got).toHaveLength(12);
  });

  it('never makes a class of a break label that fell into a teaching column', () => {
    // The 2:00-3:10 lunch header was not read, so "LUNCH" lands beside 1:05.
    const thursday = [
      at('THURSDAY', 20, 540, 60),
      cell('PHY', 0, 540),
      cell('ETC', 4, 540),
      at('LUNCH', 560, 548, 45), // set higher than the cell, as the vertical label is
      at('BREAK', 560, 536, 45),
      cell('MAT', 5, 540, 30),
    ];
    const got = classesOf([...CONTEXT, ...HEADER, ...DAYS.flat(), ...thursday, ...DICTIONARY]);
    const thu = got.filter((entry) => entry.startsWith('Thu'));
    expect(thu).toContain('Thu 13:05-14:00 BQTCK105I'); // ETC kept, at its own hour
    expect(thu.some((entry) => entry.startsWith('Thu 15:10') && entry.endsWith('BQATS101'))).toBe(
      true,
    );
    expect(got.some((entry) => /LUNCH|BREAK/i.test(entry))).toBe(false);
    expect(
      parseTimetable([
        ...CONTEXT,
        ...HEADER,
        ...DAYS.flat(),
        ...thursday,
        ...DICTIONARY,
      ]).classes.some((c) => /lunch|break/i.test(c.initials)),
    ).toBe(false);
  });
});

describe('a merged cell centred across two hours', () => {
  it('starts in the first hour it covers, and spans both', () => {
    // "PHYE1/POPE2" written once across 10:00 and 10:55, centred on the boundary.
    const friday = [
      at('FRIDAY', 20, 540, 60),
      at('PHYE1/POPE2', 140, 540, 120),
      cell('MAT', 3, 540),
    ];
    const parsed = parseTimetable([
      ...CONTEXT,
      ...HEADER,
      ...DAYS.flat(),
      ...friday,
      ...DICTIONARY,
    ]);
    const lab = parsed.classes.filter((c) => c.day === 'Fri' && c.batch !== null);
    expect(
      lab.map((c) => `${c.start}-${c.end} ${String(c.subjectCode)} ${String(c.batch)}`).sort(),
    ).toEqual(['10:00-11:50 BQHYS102 E1', '10:00-11:50 BQOPS103 E2']);
    expect(lab.every((c) => c.spansSlots === 2)).toBe(true);
  });

  it('does not move a label that merely overflows its own narrow column', () => {
    // Wider than its column by a few letters, centred in 12:10: not a span.
    const friday = [at('FRIDAY', 20, 540, 60), at('ESC', 390, 540, 100)];
    const parsed = parseTimetable([
      ...CONTEXT,
      ...HEADER,
      ...DAYS.flat(),
      ...friday,
      ...DICTIONARY,
    ]);
    const esc = parsed.classes.find((c) => c.day === 'Fri');
    expect(esc?.start).toBe('12:10');
  });
});
