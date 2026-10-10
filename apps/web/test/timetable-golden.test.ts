// @vitest-environment node
/**
 * A GOLDEN timetable: the S. G. Balekundri Semester 5 grid's STRUCTURE, drawn
 * as a real PDF text layer and read by the shipped extractor and parser.
 *
 * What the real document does, reproduced here by geometry — never by any rule
 * about this document in the parser:
 *
 *   - times printed over two lines per column ("10:00 -" over "10:55am");
 *   - SHORT BREAK and LUNCH BREAK set vertically, one letter per line, down
 *     merged columns that span every day;
 *   - rooms printed on the line under each subject;
 *   - "Value added" / "Course" cells wrapped over two lines (the real column is
 *     too narrow for it on one);
 *   - merged cells: Mini project and two lab rotations across two hours, and
 *     "Placement & Training" across two;
 *   - "ESEVM" in the grid where the subject list's title gives ESEWM;
 *   - the subject list BELOW the grid, one title wrapped with the faculty
 *     between its halves.
 *
 * The expected sessions live in fixtures/timetable-sgb-structure.golden.json,
 * written by hand from this layout. When the parser's output changes, the
 * diff below is the semantic diff: fix the parser, or change the golden file
 * with a stated reason — never regenerate it from output.
 *
 * EVERY SUBJECT, ROOM AND NAME IS SYNTHETIC.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { extractPdfLines } from '../src/lib/pdf-text.js';
import { parseTimetable } from '../src/domain/timetable-import.js';
import { makePdf, type Placed } from './helpers/pdf.js';

const workerSrc = pathToFileURL(
  createRequire(import.meta.url).resolve('pdfjs-dist/legacy/build/pdf.worker.min.mjs'),
).href;

const golden = JSON.parse(
  readFileSync(new URL('./fixtures/timetable-sgb-structure.golden.json', import.meta.url), 'utf8'),
) as {
  breakColumns: string[];
  dictionaryCodes: string[];
  sessions: [string, string, string, string | null, string, string | null, string | null, number][];
};

/* Column centres: two narrow break columns, as the real grid draws them. */
const X = [150, 240, 318, 390, 480, 563, 650, 760];
const HEADER: [string, string][] = [
  ['10:00 -', '10:55am'],
  ['10:55 -', '11:50am'],
  ['11:50 -', '12:10pm'],
  ['12:10 -', '1:05pm'],
  ['1:05 -', '2:00pm'],
  ['2:00 -', '3:10pm'],
  ['3:10 -', '4:05pm'],
  ['4:05 -', '5:00pm'],
];

/** A day: its label, then each cell as [column, top line, room line]. */
type Cell = readonly [number, string, string | null];
const DAYS: [string, number, Cell[]][] = [
  [
    'Monday',
    500,
    [
      [0, 'RMIPR', 'LH-302'],
      [1, 'CN', 'LH-302'],
      [3, 'FM', 'LH-302'],
      [4, 'TOC-T', 'LH-302'],
      [6.5, '----Mini project---', null],
    ],
  ],
  [
    'Tuesday',
    460,
    [
      [0, 'CN', 'LH-302'],
      [1, 'RMIPR', 'LH-302'],
      [3, 'TOC', 'LH-302'],
      [4, 'Value added', 'Course'],
      [6, 'ESEVM', null],
      [7, 'TOC-T', null],
    ],
  ],
  [
    'Wednesday',
    420,
    [
      [0, 'FM', 'LH-302'],
      [1, 'MRMM', 'LH-302'],
      [3, 'TOC', 'LH-302'],
      [4, 'ESEVM', null],
      [6.5, 'CNL-B1/CSL-B2', null],
    ],
  ],
  [
    'Thursday',
    380,
    [
      [0, 'RMIPR', 'LH-302'],
      [1, 'MRMM', 'LH-302'],
      [3, 'TOC', 'LH-302'],
      [4, 'Value added', 'Course'],
      [6.5, 'CSL-B1/CNL-B2', null],
    ],
  ],
  [
    'Friday',
    340,
    [
      [0, 'TOC', 'LH-302'],
      [1, 'FM', 'LH-302'],
      [3, 'CN', 'LH-302'],
      [4, 'RMIPR', 'LH-302'],
      [6, 'MRMM', null],
      [7, 'FM', null],
    ],
  ],
  [
    'Saturday',
    300,
    [
      [1, 'Value added', 'Course'],
      [3.5, 'Placement & Training', null],
    ],
  ],
];

const LEGEND = [
  'BCB501 Fundamentals of Management Prof. A. Example 3+0+0 3+0+0',
  'BCS502 Computer Networks(T/L) Prof. B. Sample 3+0+2 3+0+2',
  'BCSL502-Computer Networks Lab Prof. B. Sample 0+0+2 0+0+2',
  'BCS503 Theory of Computation Dr. C. Placeholder 3+2+0 3+2+0',
  'BCSL504-Computational Statistics Lab Prof. D. Fictional 0+0+2 0+0+2',
  'BCB515A Marketing Research & Marketing',
  'Prof. E. Invented 3+0+0 3+0+0',
  'Management',
  'BRMK557 Research Methodology and IPR Prof. F. Madeup 2+0+0 2+0+0',
  'BESK508 Environmental Studies and E-waste Management Prof. G. Unreal 1+0+0 1+0+0',
  'BCB586-Mini project Prof. H. Nobody 0+0+2 0+0+2',
];

/** Where a column (or a merged pair, e.g. 6.5) is centred, as a left edge. */
const left = (column: number, text: string) => {
  const low = X[Math.floor(column)] as number;
  const centre = Number.isInteger(column) ? low : (low + (X[Math.ceil(column)] as number)) / 2;
  return Math.round(centre - text.length * 2.5);
};

function sgbStructure(): ArrayBuffer {
  const placed: Placed[] = [
    { text: "S. S. Education Trust's", x: 380, y: 670 },
    { text: 'S. G. BALEKUNDRI INSTITUTE OF TECHNOLOGY', x: 300, y: 655 },
    { text: 'Department of Computer Science and Business System', x: 290, y: 640 },
    { text: 'With effective from: 12.09.2026', x: 60, y: 620 },
    { text: 'V (B) - Timetable for the Academic year 2026-27 (R0)', x: 330, y: 620 },
    { text: 'Day/Hour', x: 40, y: 560 },
  ];
  HEADER.forEach(([top, bottom], column) => {
    placed.push({ text: top, x: left(column, top), y: 566 });
    placed.push({ text: bottom, x: left(column, bottom), y: 554 });
  });
  for (const [day, y, cells] of DAYS) {
    placed.push({ text: day, x: 40, y });
    for (const [column, top, below] of cells) {
      placed.push({ text: top, x: left(column, top), y: y + 7 });
      if (below !== null) placed.push({ text: below, x: left(column, below), y: y - 7 });
    }
  }
  /* The merged break columns: one letter per line, top to bottom, across every day. */
  for (const [column, word] of [
    [2, 'SHORTBREAK'],
    [5, 'LUNCHBREAK'],
  ] as const) {
    [...word].forEach((letter, index) => {
      placed.push({ text: letter, x: (X[column] as number) - 3, y: 515 - index * 22 });
    });
  }
  /* The lab rotations' rooms, one under each hour they span. */
  for (const y of [420, 380]) {
    placed.push({ text: 'OJAS', x: left(6, 'OJAS'), y: y - 7 });
    placed.push({ text: 'TEJOMAYI', x: left(7, 'TEJOMAYI'), y: y - 7 });
  }
  placed.push({ text: 'Subject code - Initials - Name', x: 60, y: 250 });
  placed.push({ text: 'Faculty name', x: 520, y: 250 });
  LEGEND.forEach((line, index) => placed.push({ text: line, x: 60, y: 232 - index * 16 }));
  return makePdf([placed], { width: 1000, height: 700 });
}

describe('the S. G. Balekundri-structured timetable, read from its PDF', () => {
  it('reproduces every session relationship in the golden file', async () => {
    const extraction = await extractPdfLines(sgbStructure(), { workerSrc });
    const parsed = parseTimetable(extraction.placed);

    const sessions = parsed.classes
      .map((entry) => [
        entry.day,
        entry.start,
        entry.end,
        entry.subjectCode,
        entry.resolution,
        entry.batch,
        entry.room,
        entry.spansSlots,
      ])
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
    const expected = [...golden.sessions].sort((a, b) =>
      JSON.stringify(a).localeCompare(JSON.stringify(b)),
    );

    // The dictionary the grid resolves through, from the page itself.
    expect(parsed.dictionary.map((entry) => entry.subjectCode)).toEqual(golden.dictionaryCodes);
    // Break columns are columns, never classes.
    expect(parsed.slots.filter((slot) => slot.isBreak).map((slot) => slot.start)).toEqual(
      golden.breakColumns,
    );
    expect(sessions).toEqual(expected);
    // No invented code for an activity, and the look-alike is flagged, not trusted.
    expect(parsed.warnings.join(' ')).toMatch(/ESEVM is not in this timetable's subject list/);
    expect(parsed.coverage.looksComplete).toBe(true);
  });
});
