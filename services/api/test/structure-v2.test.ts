/**
 * Parser v2 regression suite.
 *
 * Authority: docs/17 §17.19 · docs/32 OQ-032 · M5A.7 §8
 *
 * EVERY DEFECT IS PINNED FROM BOTH SIDES. Each test asserts what v1 does — the
 * bug, reproduced — and then what v2 does. Keeping v1 in the assertion is what
 * stops the fix quietly regressing into "well, it passes now": if someone
 * changes v2 back, the v2 half fails, and if someone edits the frozen baseline,
 * the v1 half fails.
 *
 * The fixtures reproduce the geometry measured on real papers in M5A.6, at the
 * real proportions — a 565pt-wide page with its marks column at x≈484, which is
 * what makes v1's 0.7 boundary (x≈396) land in the middle of the question text.
 * No PDF, no OCR engine, no corpus.
 */

import { describe, expect, it } from 'vitest';
import { groupIntoLines, parseTsv } from '../src/documents/geometry.js';
import { extractStructure } from '../src/documents/structure.js';
import { detectMarksColumn, extractStructureV2 } from '../src/documents/structure-v2.js';
import { nativeTsv, type Word } from './fixtures/tsv.js';

/* -------------------------------------------------------------------------- */
/* Fixture builders — real page proportions                                   */
/* -------------------------------------------------------------------------- */

/** Where a real VTU paper puts its three right-hand columns. */
const MARKS_X = 484;
const BLOOM_X = 512;
const CO_X = 540;
/** A token at the page's right edge, so the page is 565pt wide as measured. */
const EDGE: Word = { text: '.', x: 562, y: 8, w: 3 };

interface Cell {
  y: number;
  label?: string;
  question?: string;
  /** Text lines. The first is the anchor line unless `marksOnFirstLine` is false. */
  lines: string[];
  marks?: number;
  L?: string;
  co?: string;
  /** Which text line the label sits on. Default 0. */
  labelLine?: number;
  /** Which text line the question number sits on. Default 0. */
  questionLine?: number;
}

/**
 * Lays out one cell of the marks table.
 *
 * Text starts at x=96 and runs to x≈470 — right up to the marks column, exactly
 * as a justified table cell does on a real paper. That is what makes the
 * truncation fixture meaningful.
 */
function cell(c: Cell): Word[] {
  const words: Word[] = [];
  c.lines.forEach((line, index) => {
    const y = c.y + index * 14;
    if (c.question !== undefined && (c.questionLine ?? 0) === index) {
      words.push({ text: c.question, x: 60, y, w: 20 });
    }
    // The label sits in its own narrow column LEFT of the body, as it does on
    // every paper in the corpus (1BESC104C: label 108, body 118).
    if (c.label !== undefined && (c.labelLine ?? 0) === index) {
      words.push({ text: c.label, x: 104, y, w: 7 });
    }
    // Spread the words so the last of a long line reaches x≈460: inside v1's
    // 0.7 boundary (396) and outside the real column (484).
    const parts = line.split(' ');
    const step = parts.length > 1 ? Math.min(46, 342 / (parts.length - 1)) : 40;
    parts.forEach((word, i) => {
      words.push({ text: word, x: 118 + i * step, y, w: Math.min(step - 4, word.length * 6) });
    });
    if (index === 0) {
      if (c.marks !== undefined) words.push({ text: String(c.marks), x: MARKS_X, y, w: 8 });
      if (c.L !== undefined) words.push({ text: c.L, x: BLOOM_X, y, w: 14 });
      if (c.co !== undefined) words.push({ text: c.co, x: CO_X, y, w: 22 });
    }
  });
  return words;
}

function heading(y: number, text: string): Word[] {
  return text.split(' ').map((word, i) => ({ text: word, x: 250 + i * 40, y, w: 30 }));
}

function parse(words: readonly Word[]) {
  return groupIntoLines(parseTsv(nativeTsv(words), 'native'));
}

/* -------------------------------------------------------------------------- */
/* A. Text reaching into the right-hand region (OQ-032)                       */
/* -------------------------------------------------------------------------- */

describe('A. question text reaching toward the marks column', () => {
  const words: Word[] = [
    EDGE,
    ...heading(40, 'Module - 1'),
    ...cell({
      y: 70,
      question: 'Q.1',
      label: 'a',
      lines: ['With neat circuit diagram, explain the working of a full-wave bridge'],
      marks: 6,
      L: 'L2',
      co: 'CO1',
    }),
    ...cell({
      y: 110,
      label: 'b',
      lines: ['List and explain the characteristics and parameters of an ideal operational'],
      marks: 6,
      L: 'L2',
      co: 'CO1',
    }),
    ...cell({
      y: 150,
      label: 'c',
      lines: ['Describe the operation of a Switched Mode Power Supply with a neat diagram'],
      marks: 8,
      L: 'L3',
      co: 'CO1',
    }),
  ];

  /* THE BUG, REPRODUCED. This is the defect adjudication found on 1BESC104C. */
  it('v1 deletes the words nearest the marks column', () => {
    const v1 = extractStructure(parse(words), 'descriptive');
    const parts = v1.questions[0]?.subQuestions ?? [];

    expect(parts[0]?.text).not.toContain('bridge');
    expect(parts[1]?.text).not.toContain('operational');
  });

  it('v2 keeps the whole line', () => {
    const v2 = extractStructureV2(parse(words), 'descriptive');
    const parts = v2.questions[0]?.subQuestions ?? [];

    expect(parts[0]?.text).toBe(
      'With neat circuit diagram, explain the working of a full-wave bridge',
    );
    expect(parts[1]?.text).toBe(
      'List and explain the characteristics and parameters of an ideal operational',
    );
  });

  /* The fix must not cost the columns it was protecting. */
  it('v2 still reads marks, level and CO out of the column', () => {
    const parts = extractStructureV2(parse(words), 'descriptive').questions[0]?.subQuestions ?? [];

    expect(parts.map((p) => p.marks)).toEqual([6, 6, 8]);
    expect(parts.map((p) => p.bloomLevel)).toEqual(['L2', 'L2', 'L3']);
    expect(parts.map((p) => p.courseOutcome)).toEqual(['CO1', 'CO1', 'CO1']);
  });

  it('measures the column from the page rather than assuming a fraction', () => {
    const lines = parse(words);
    const detected = detectMarksColumn(lines, 1);

    expect(detected).not.toBeNull();
    expect(detected).toBeGreaterThanOrEqual(MARKS_X - 2);
    // Decisively right of where v1 drew the line.
    expect(detected).toBeGreaterThan(565 * 0.7);
  });
});

/* -------------------------------------------------------------------------- */
/* B. Vertically centred question number                                      */
/* -------------------------------------------------------------------------- */

describe('B. a question number centred across its parts', () => {
  /* `Q.1` sits on part (b)'s row, as it does on 1BPHYS102. */
  const words: Word[] = [
    EDGE,
    ...heading(40, 'Module - 1'),
    ...cell({
      y: 70,
      label: 'a',
      labelLine: 1,
      lines: ['Use the time-independent equation for the particle in an', 'infinite well.'],
      marks: 8,
      L: 'L2',
      co: 'CO1',
    }),
    ...cell({
      y: 110,
      question: 'Q.1',
      questionLine: 1,
      label: 'b',
      labelLine: 1,
      lines: ['Discuss the uncertainty principle and state the three', 'relationships.'],
      marks: 8,
      L: 'L2',
      co: 'CO1',
    }),
    ...cell({
      y: 150,
      label: 'c',
      labelLine: 1,
      lines: ['Calculate the change in wavelength of an electron', 'decelerated.'],
      marks: 4,
      L: 'L3',
      co: 'CO1',
    }),
  ];

  it('v1 recovers no question number at all', () => {
    const v1 = extractStructure(parse(words), 'descriptive');
    expect(v1.questions.every((q) => q.questionNumber === null || q.questionNumber === '?')).toBe(
      true,
    );
  });

  it('v2 lets the number own the parts above and below it', () => {
    const v2 = extractStructureV2(parse(words), 'descriptive');

    expect(v2.questions.length).toBe(1);
    expect(v2.questions[0]?.questionNumber).toBe('1');
    expect(v2.questions[0]?.subQuestions.map((s) => s.label)).toEqual(['a', 'b', 'c']);
  });

  /*
   * The marks sit on each cell's FIRST line and the label on its SECOND. v1
   * reads rows one at a time and so sees a labelled row with no marks.
   */
  it('v2 attaches marks written on a different line from the label', () => {
    const parts = extractStructureV2(parse(words), 'descriptive').questions[0]?.subQuestions ?? [];
    expect(parts.map((p) => p.marks)).toEqual([8, 8, 4]);
  });

  it('v2 joins both text lines of a cell', () => {
    const parts = extractStructureV2(parse(words), 'descriptive').questions[0]?.subQuestions ?? [];
    expect(parts[0]?.text).toContain('infinite well.');
    expect(parts[0]?.text).toContain('time-independent');
  });
});

/* -------------------------------------------------------------------------- */
/* C. MCQ numbered instructions                                               */
/* -------------------------------------------------------------------------- */

describe('C. numbered instructions on an MCQ paper', () => {
  function flow(rows: string[]): Word[] {
    return [EDGE, ...rows.flatMap((text, i) => heading(60 + i * 20, text))];
  }

  const paper = flow([
    '1. Answer all the fifty questions each carries one mark.',
    '2. Use only Black ball point pen for darkening the circles.',
    '3. Darkening two circles makes the answer invalid.',
    '1. The direction in which formal communication flows is',
    'a) upward',
    'b) downward',
    '2. Communication with birds and animals is known as',
    'a) extra personal',
    'b) birdistic',
  ]);

  it('v1 reports the instructions as questions', () => {
    const v1 = extractStructure(parse(paper), 'mcq');
    expect(v1.mcqItems.length).toBe(5);
    expect(v1.mcqItems[0]?.text).toContain('Answer all the fifty questions');
  });

  it('v2 keeps only the items', () => {
    const v2 = extractStructureV2(parse(paper), 'mcq');

    expect(v2.mcqItems.length).toBe(2);
    expect(v2.mcqItems[0]?.itemNumber).toBe(1);
    expect(v2.mcqItems[0]?.text).toContain('formal communication');
    expect(v2.mcqItems[1]?.itemNumber).toBe(2);
    expect(v2.mcqItems.some((i) => i.text.includes('ball point pen'))).toBe(false);
  });

  it('v2 keeps the options it found', () => {
    const v2 = extractStructureV2(parse(paper), 'mcq');
    expect(v2.mcqItems[0]?.options.map((o) => o.label)).toEqual(['a', 'b']);
  });

  /*
   * BOTH CUES ARE REQUIRED before anything is dropped. A paper that simply
   * starts at a number above 1 has no restart, so nothing is an instruction.
   */
  it('drops nothing when the numbering never restarts', () => {
    const v2 = extractStructureV2(
      parse(
        flow(['4. Which of these is a noun', 'a) run', '5. Which of these is a verb', 'a) walk']),
      ),
      'mcq',
    );
    expect(v2.mcqItems.length).toBe(2);
    expect(v2.mcqItems[0]?.itemNumber).toBe(4);
  });

  /* An item whose options OCR lost must not be mistaken for an instruction. */
  it('drops nothing when a leading record carries options', () => {
    const v2 = extractStructureV2(
      parse(flow(['1. First item', 'a) yes', '2. Second item', '1. Restarted item', 'a) no'])),
      'mcq',
    );
    expect(v2.mcqItems.length).toBe(3);
  });

  /*
   * THE DISCRIMINATOR READS NO ENGLISH (M5A.7 §5), so a Kannada instruction
   * block is removed on exactly the same evidence.
   */
  it('removes a Kannada instruction block on structure alone', () => {
    const v2 = extractStructureV2(
      parse(
        flow([
          '1. ಎಲ್ಲಾ ಐವತ್ತು ಪ್ರಶ್ನೆಗಳಿಗೆ ಉತ್ತರಿಸಿ',
          '2. ಕಪ್ಪು ಪೆನ್ ಮಾತ್ರ ಬಳಸಿ',
          '1. ಸಂವಹನ ಎಂದರೇನು',
          'a) ಉತ್ತರ ಒಂದು',
          'b) ಉತ್ತರ ಎರಡು',
        ]),
      ),
      'mcq',
    );

    expect(v2.mcqItems.length).toBe(1);
    expect(v2.mcqItems[0]?.text).toContain('ಸಂವಹನ');
  });
});

/* -------------------------------------------------------------------------- */
/* D. A document holding two model papers                                     */
/* -------------------------------------------------------------------------- */

describe('D. two model papers in one document', () => {
  const words: Word[] = [
    EDGE,
    ...heading(40, 'Module - 1'),
    ...cell({
      y: 70,
      question: 'Q.1',
      label: 'a',
      lines: ['First paper part a'],
      marks: 8,
      L: 'L2',
      co: 'CO1',
    }),
    ...cell({ y: 110, label: 'b', lines: ['First paper part b'], marks: 6, L: 'L2', co: 'CO1' }),
    ...heading(150, 'Model Question Paper - II'),
    ...heading(180, 'Module - 1'),
    ...cell({
      y: 210,
      question: 'Q.1',
      label: 'a',
      lines: ['Second paper part a'],
      marks: 8,
      L: 'L3',
      co: 'CO1',
    }),
    ...cell({ y: 250, label: 'b', lines: ['Second paper part b'], marks: 6, L: 'L2', co: 'CO1' }),
  ];

  it('keeps both papers as separate questions rather than merging them', () => {
    const v2 = extractStructureV2(parse(words), 'descriptive');

    expect(v2.questions.length).toBe(2);
    expect(v2.questions.map((q) => q.questionNumber)).toEqual(['1', '1']);
    expect(v2.questions[0]?.subQuestions[0]?.text).toBe('First paper part a');
    expect(v2.questions[1]?.subQuestions[0]?.text).toBe('Second paper part a');
  });
});

/* -------------------------------------------------------------------------- */
/* E. A missing marks cell                                                    */
/* -------------------------------------------------------------------------- */

describe('E. a cell whose marks were lost', () => {
  const words: Word[] = [
    EDGE,
    ...heading(40, 'Module - 1'),
    ...cell({
      y: 70,
      question: 'Q.1',
      label: 'a',
      lines: ['Part a has its marks'],
      marks: 7,
      L: 'L2',
      co: 'CO1',
    }),
    ...cell({ y: 110, label: 'b', lines: ['Part b lost its marks cell'], L: 'L2', co: 'CO2' }),
    ...cell({ y: 150, label: 'c', lines: ['Part c has its marks'], marks: 6, L: 'L3', co: 'CO2' }),
  ];

  /* The part is KEPT, not dropped: losing a cell must not lose a question. */
  it('keeps the part and reports it as less than clear', () => {
    const parts = extractStructureV2(parse(words), 'descriptive').questions[0]?.subQuestions ?? [];

    expect(parts.map((p) => p.label)).toEqual(['a', 'b', 'c']);
    expect(parts[1]?.marks).toBeNull();
    expect(parts[1]?.confidence).toBe('medium');
    expect(parts[1]?.text).toBe('Part b lost its marks cell');
  });

  /* Bloom's and CO survived, so the cell is still anchored by them. */
  it('still anchors the cell on the columns that did survive', () => {
    const parts = extractStructureV2(parse(words), 'descriptive').questions[0]?.subQuestions ?? [];
    expect(parts[1]?.bloomLevel).toBe('L2');
    expect(parts[1]?.courseOutcome).toBe('CO2');
  });
});

/* -------------------------------------------------------------------------- */
/* F. A page with no marks column at all                                      */
/* -------------------------------------------------------------------------- */

describe('F. a descriptive page with no marks table', () => {
  const words: Word[] = [
    EDGE,
    ...heading(40, 'Module - 1'),
    ...cell({
      y: 70,
      question: 'Q.1',
      lines: ['Explain the working of a full-wave bridge rectifier'],
    }),
    ...cell({
      y: 110,
      question: 'Q.2',
      lines: ['Describe an ideal operational amplifier in detail'],
    }),
  ];

  it('finds no column rather than inventing one', () => {
    expect(detectMarksColumn(parse(words), 1)).toBeNull();
  });

  /*
   * PRESERVE, THEN FLAG (M5A.7 §3). v1 would have deleted everything past x=396
   * and reported what was left without comment.
   */
  it('keeps every word and says the page is unconfirmed', () => {
    const v2 = extractStructureV2(parse(words), 'descriptive');

    expect(v2.questions[0]?.text).toContain('bridge rectifier');
    expect(v2.questions[1]?.text).toContain('operational amplifier');
    expect(v2.needsReview).toBe(true);
    expect(v2.reviewReason).toContain('No marks column');
  });

  /* Nothing on such a page may be `high`: there is no positional evidence. */
  it('refuses to call anything clear on a page with no column', () => {
    const v2 = extractStructureV2(parse(words), 'descriptive');
    expect(v2.questions.every((q) => q.confidence !== 'high')).toBe(true);
    expect(v2.questions.every((q) => q.needsReview)).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* G. A mathematics question with damaged OCR                                 */
/* -------------------------------------------------------------------------- */

describe('G. mathematics whose notation OCR destroyed', () => {
  const words: Word[] = [
    EDGE,
    ...heading(40, 'Module - 2'),
    ...cell({
      y: 70,
      question: 'Q.3',
      label: 'a',
      lines: ["Solve x'p? + xyp-6y7 4S by reducing to Clairaut's form"],
      marks: 7,
      L: 'L2',
      co: 'CO2',
    }),
    ...cell({
      y: 110,
      label: 'b',
      lines: ['Evaluate the integral of sin? 6 dO'],
      marks: 6,
      L: 'L3',
      co: 'CO2',
    }),
  ];

  /*
   * STRUCTURE SURVIVES, CONTENT DOES NOT (M5A.7 §6). The parser must not repair
   * the notation, must not drop the question, and must not present the text as
   * authoritative.
   */
  it('keeps the structure of a question whose notation is unreadable', () => {
    const v2 = extractStructureV2(parse(words), 'descriptive');
    const question = v2.questions[0];

    expect(question?.questionNumber).toBe('3');
    expect(question?.module).toBe('2');
    expect(question?.subQuestions.map((s) => s.marks)).toEqual([7, 6]);
    expect(question?.page).toBe(1);
  });

  it('stores the damaged notation exactly as read, repairing nothing', () => {
    const parts = extractStructureV2(parse(words), 'descriptive').questions[0]?.subQuestions ?? [];
    expect(parts[0]?.text).toContain("x'p? + xyp-6y7 4S");
    expect(parts[1]?.text).toContain('sin? 6 dO');
  });
});

/* -------------------------------------------------------------------------- */
/* Behaviour v2 must not have changed                                         */
/* -------------------------------------------------------------------------- */

describe('unchanged from v1', () => {
  it('extracts nothing from an unknown format and says why', () => {
    const v2 = extractStructureV2(
      parse([EDGE, ...heading(40, 'Something else entirely')]),
      'unknown',
    );

    expect(v2.questions).toEqual([]);
    expect(v2.mcqItems).toEqual([]);
    expect(v2.needsReview).toBe(true);
    expect(v2.reviewReason).toContain('could not be identified');
  });

  /* The `L2`-read-as-marks defect from M5A.4 must stay fixed. */
  it("never reads a Bloom's level as a marks value", () => {
    const words: Word[] = [
      EDGE,
      ...heading(40, 'Module - 1'),
      ...cell({ y: 70, question: 'Q.1', label: 'a', lines: ['A question'], L: 'L2', co: 'CO1' }),
      ...cell({ y: 110, label: 'b', lines: ['Another question'], L: 'L3', co: 'CO1' }),
      ...cell({ y: 150, label: 'c', lines: ['A third question'], L: 'L2', co: 'CO1' }),
    ];
    const parts = extractStructureV2(parse(words), 'descriptive').questions[0]?.subQuestions ?? [];

    expect(parts.map((p) => p.marks)).toEqual([null, null, null]);
    expect(parts.map((p) => p.bloomLevel)).toEqual(['L2', 'L3', 'L2']);
  });

  it('records a page number and a bounding box on every record', () => {
    // Two cells, because one row of numbers is not a table and the detector is
    // right to refuse it (see the column-detection rule).
    const words: Word[] = [
      EDGE,
      ...cell({
        y: 70,
        question: 'Q.1',
        label: 'a',
        lines: ['A question'],
        marks: 8,
        L: 'L2',
        co: 'CO1',
      }),
      ...cell({ y: 110, label: 'b', lines: ['Another question'], marks: 6, L: 'L2', co: 'CO1' }),
    ];
    const question = extractStructureV2(parse(words), 'descriptive').questions[0];

    expect(question?.page).toBe(1);
    expect(question?.boundingBox.width).toBeGreaterThan(0);
    expect(question?.subQuestions[0]?.boundingBox.height).toBeGreaterThan(0);
  });
});
