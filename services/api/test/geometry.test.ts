/**
 * Positional geometry and deterministic structural extraction.
 *
 * Authority: docs/17 §17.16 · docs/32 OQ-019a · M5A.4 §16
 *
 * Synthetic TSV fixtures, built here, so every case is deterministic and the
 * suite needs neither a PDF nor an OCR engine. The fixtures reproduce the two
 * real formats faithfully enough to exercise the geometry: a two-column
 * descriptive paper with a right-hand `marks | L | CO` table, and a
 * single-column MCQ flow.
 */

import { describe, expect, it } from 'vitest';
import { groupIntoLines, parseTsv, type PositionedToken } from '../src/documents/geometry.js';
import { extractStructure, extractDescriptive, extractMcq } from '../src/documents/structure.js';

/* -------------------------------------------------------------------------- */
/* Fixture builders                                                           */
/* -------------------------------------------------------------------------- */

interface Word {
  readonly text: string;
  readonly x: number;
  readonly y: number;
  readonly w?: number;
  readonly conf?: number;
  readonly page?: number;
}

/** Tesseract's column order: block before par. */
function ocrTsv(words: readonly Word[]): string {
  const header =
    'level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext';
  const rows = words.map((w, i) =>
    [
      5,
      w.page ?? 1,
      1,
      1,
      1,
      i + 1,
      w.x,
      w.y,
      w.w ?? w.text.length * 12,
      20,
      w.conf ?? 95,
      w.text,
    ].join('\t'),
  );
  return [header, ...rows].join('\n');
}

/** Poppler's column order: par before block, plus marker rows. */
function nativeTsv(words: readonly Word[]): string {
  const header =
    'level\tpage_num\tpar_num\tblock_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext';
  const rows = [
    ['1', '1', '0', '0', '0', '0', '0', '0', '595', '842', '-1', '###PAGE###'].join('\t'),
    ...words.map((w, i) =>
      [
        5,
        w.page ?? 1,
        1,
        1,
        1,
        i + 1,
        w.x,
        w.y,
        w.w ?? w.text.length * 6,
        10,
        w.conf ?? 100,
        w.text,
      ].join('\t'),
    ),
  ];
  return [header, ...rows].join('\n');
}

/** A descriptive row: question/sub label, body, then the right-hand columns. */
function row(
  y: number,
  cells: { label?: string; body: string; marks?: number; L?: string; co?: string },
): Word[] {
  const words: Word[] = [];
  if (cells.label !== undefined) words.push({ text: cells.label, x: 40, y, w: 18 });
  cells.body.split(' ').forEach((word, i) => {
    words.push({ text: word, x: 80 + i * 40, y });
  });
  if (cells.marks !== undefined) words.push({ text: String(cells.marks), x: 760, y, w: 16 });
  if (cells.L !== undefined) words.push({ text: cells.L, x: 800, y, w: 16 });
  if (cells.co !== undefined) words.push({ text: cells.co, x: 840, y, w: 24 });
  return words;
}

const PAGE_EDGE: Word = { text: '.', x: 900, y: 5, w: 4 };

/* -------------------------------------------------------------------------- */
/* Parsing                                                                    */
/* -------------------------------------------------------------------------- */

describe('TSV parsing', () => {
  /*
   * The two tools disagree on column ORDER. Parsing by index would silently
   * swap block and paragraph and scramble every grouping.
   */
  it('reads both column orders correctly by header name', () => {
    const words = [{ text: 'Hello', x: 10, y: 10 }];
    const fromOcr = parseTsv(ocrTsv(words), 'ocr', 150);
    const fromNative = parseTsv(nativeTsv(words), 'native');

    expect(fromOcr[0]?.text).toBe('Hello');
    expect(fromNative[0]?.text).toBe('Hello');
  });

  /* Tesseract reports pixels; poppler reports points. One scale downstream. */
  it('converts OCR pixels to points and leaves native points alone', () => {
    const words = [{ text: 'X', x: 150, y: 300 }];
    const ocr = parseTsv(ocrTsv(words), 'ocr', 150);
    const native = parseTsv(nativeTsv(words), 'native');

    expect(ocr[0]?.x).toBeCloseTo(72, 5); // 150 px at 150 dpi = 1 inch = 72 pt
    expect(native[0]?.x).toBe(150);
  });

  it('drops poppler marker rows, which are layout and not words', () => {
    const tokens = parseTsv(nativeTsv([{ text: 'Real', x: 10, y: 10 }]), 'native');
    expect(tokens).toHaveLength(1);
    expect(tokens[0]?.text).toBe('Real');
  });

  it('keeps confidence where reported', () => {
    const tokens = parseTsv(ocrTsv([{ text: 'X', x: 1, y: 1, conf: 42 }]), 'ocr');
    expect(tokens[0]?.confidence).toBe(42);
  });

  it('returns nothing for empty or headerless input', () => {
    expect(parseTsv('', 'ocr')).toEqual([]);
    expect(parseTsv('junk\nrows', 'ocr')).toEqual([]);
  });
});

describe('line grouping', () => {
  /*
   * The tools' own line numbers restart per block, and on a two-column paper
   * the question text and its marks column ARE different blocks. Grouping by
   * vertical overlap is what reassembles the row.
   */
  it('joins tokens across blocks into one row by vertical overlap', () => {
    const tokens = parseTsv(
      ocrTsv([...row(100, { body: 'Explain this', marks: 6, L: 'L2', co: 'CO1' })]),
      'ocr',
    );
    const lines = groupIntoLines(tokens);
    expect(lines).toHaveLength(1);
    expect(lines[0]?.text).toContain('Explain');
    expect(lines[0]?.text).toContain('CO1');
  });

  it('keeps separate rows separate', () => {
    const tokens = parseTsv(
      ocrTsv([...row(100, { body: 'First row' }), ...row(400, { body: 'Second row' })]),
      'ocr',
    );
    expect(groupIntoLines(tokens)).toHaveLength(2);
  });

  it('orders rows by page then vertical position', () => {
    const tokens = parseTsv(
      ocrTsv([
        { text: 'later', x: 10, y: 500, page: 1 },
        { text: 'onpage2', x: 10, y: 10, page: 2 },
        { text: 'first', x: 10, y: 100, page: 1 },
      ]),
      'ocr',
    );
    expect(groupIntoLines(tokens).map((l) => l.text)).toEqual(['first', 'later', 'onpage2']);
  });

  it('reports the lowest confidence on a row', () => {
    const tokens = parseTsv(
      ocrTsv([
        { text: 'good', x: 10, y: 10, conf: 95 },
        { text: 'bad', x: 100, y: 10, conf: 30 },
      ]),
      'ocr',
    );
    expect(groupIntoLines(tokens)[0]?.minConfidence).toBe(30);
  });
});

/* -------------------------------------------------------------------------- */
/* Descriptive structure                                                      */
/* -------------------------------------------------------------------------- */

const DESCRIPTIVE_PAPER = ocrTsv([
  PAGE_EDGE,
  ...row(40, { body: 'Note: 1. Answer any FIVE full questions from each module' }),
  ...row(80, { body: 'Module-1' }),
  ...row(120, {
    label: 'Q.1',
    body: 'a. Explain the three-schema architecture',
    marks: 6,
    L: 'L2',
    co: 'CO1',
  }),
  ...row(160, { label: 'b', body: 'Discuss data independence', marks: 7, L: 'L2', co: 'CO1' }),
  ...row(200, { label: 'c', body: 'Describe the ER model', marks: 7, L: 'L3', co: 'CO1' }),
  ...row(240, { body: 'Module-2' }),
  ...row(280, { label: 'Q.2', body: 'a. Draw an ER diagram', marks: 8, L: 'L3', co: 'CO2' }),
  ...row(320, { label: 'b', body: 'Normalize the relation', marks: 6, L: 'L2', co: 'CO2' }),
]);

describe('descriptive extraction', () => {
  const lines = groupIntoLines(parseTsv(DESCRIPTIVE_PAPER, 'ocr'));
  const questions = extractDescriptive(lines);

  it('finds the questions and no instruction rows', () => {
    expect(questions.map((q) => q.questionNumber)).toEqual(['1', '2']);
  });

  /*
   * The instruction line is numbered exactly like a question. It is excluded
   * POSITIONALLY: it has nothing in the right-hand table.
   */
  it('excludes the numbered instruction block', () => {
    expect(questions.some((q) => q.text.includes('Answer any FIVE'))).toBe(false);
  });

  it('tracks the module across questions', () => {
    expect(questions[0]?.module).toBe('1');
    expect(questions[1]?.module).toBe('2');
  });

  /* The measurement OQ-019a asked for: sub-labels from their own cell. */
  it('recovers sub-question labels from their column', () => {
    expect(questions[0]?.subQuestions.map((s) => s.label)).toEqual(['a', 'b', 'c']);
    expect(questions[1]?.subQuestions.map((s) => s.label)).toEqual(['a', 'b']);
  });

  it('attaches marks, Bloom level and CO to each sub-question', () => {
    const b = questions[0]?.subQuestions[1];
    expect(b?.marks).toBe(7);
    expect(b?.bloomLevel).toBe('L2');
    expect(b?.courseOutcome).toBe('CO1');
  });

  it('keeps the question text free of the right-hand columns', () => {
    expect(questions[0]?.text).not.toMatch(/\bL2\b|\bCO1\b/);
  });

  it('marks a complete row as high confidence', () => {
    expect(questions[0]?.confidence).toBe('high');
    expect(questions[0]?.needsReview).toBe(false);
  });

  it('records a bounding box for every record', () => {
    for (const q of questions) {
      expect(q.boundingBox.width).toBeGreaterThan(0);
      for (const s of q.subQuestions) expect(s.boundingBox.width).toBeGreaterThan(0);
    }
  });
});

describe('confidence states', () => {
  /* Marks present and in the marks column: everything agrees. */
  it('high when number, text and column marks all agree', () => {
    const lines = groupIntoLines(
      parseTsv(
        ocrTsv([
          PAGE_EDGE,
          ...row(100, { label: 'Q.1', body: 'Explain it', marks: 6, L: 'L2', co: 'CO1' }),
        ]),
        'ocr',
      ),
    );
    expect(extractDescriptive(lines)[0]?.confidence).toBe('high');
  });

  /*
   * Conflicting geometry: two question numbers on one row means the grouping
   * has gone wrong, whatever the rest of the row says.
   */
  it('review_required when two question numbers share a row', () => {
    const lines = groupIntoLines(
      parseTsv(
        ocrTsv([
          PAGE_EDGE,
          ...row(100, { label: 'Q.1', body: 'Q.2 both here', marks: 6, L: 'L2', co: 'CO1' }),
        ]),
        'ocr',
      ),
    );
    const q = extractDescriptive(lines)[0];
    expect(q?.confidence).toBe('review_required');
    expect(q?.needsReview).toBe(true);
  });

  it('ignores a number outside the plausible marks range', () => {
    const lines = groupIntoLines(
      parseTsv(
        ocrTsv([
          PAGE_EDGE,
          ...row(100, { label: 'Q.1', body: 'Explain', marks: 97, L: 'L2', co: 'CO1' }),
        ]),
        'ocr',
      ),
    );
    // 97 is not marks; the row still has L and CO so it is a real question.
    expect(extractDescriptive(lines)[0]?.marks).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* MCQ                                                                        */
/* -------------------------------------------------------------------------- */

const MCQ_PAPER = ocrTsv([
  { text: '1.', x: 40, y: 100 },
  { text: 'Which', x: 80, y: 100 },
  { text: 'protocol?', x: 160, y: 100 },
  { text: 'a)', x: 60, y: 140 },
  { text: 'TCP', x: 100, y: 140 },
  { text: 'b)', x: 60, y: 180 },
  { text: 'UDP', x: 100, y: 180 },
  { text: '2.', x: 40, y: 240 },
  { text: 'Define', x: 80, y: 240 },
  { text: 'latency', x: 160, y: 240 },
]);

describe('MCQ extraction', () => {
  const items = extractMcq(groupIntoLines(parseTsv(MCQ_PAPER, 'ocr')));

  it('finds numbered items', () => {
    expect(items.map((i) => i.itemNumber)).toEqual([1, 2]);
  });

  it('attaches options to their item', () => {
    expect(items[0]?.options.map((o) => o.label)).toEqual(['a', 'b']);
    expect(items[0]?.options[0]?.text).toBe('TCP');
  });

  /*
   * Descriptive fields are NOT invented for MCQ papers, which have no modules
   * and no Bloom's column. Grading one against the other's template is the
   * mistake that scored four correctly-read papers as failures.
   */
  it('produces no descriptive fields', () => {
    const paper = extractStructure(groupIntoLines(parseTsv(MCQ_PAPER, 'ocr')), 'mcq');
    expect(paper.questions).toEqual([]);
    expect(paper.mcqItems.length).toBeGreaterThan(0);
    for (const item of paper.mcqItems) {
      expect(item).not.toHaveProperty('module');
      expect(item).not.toHaveProperty('bloomLevel');
    }
  });
});

/* -------------------------------------------------------------------------- */
/* Unknown format                                                             */
/* -------------------------------------------------------------------------- */

describe('unknown format', () => {
  /* Never silently becomes descriptive or MCQ. */
  it('extracts nothing and says why', () => {
    const lines = groupIntoLines(parseTsv(DESCRIPTIVE_PAPER, 'ocr'));
    const paper = extractStructure(lines, 'unknown');

    expect(paper.questions).toEqual([]);
    expect(paper.mcqItems).toEqual([]);
    expect(paper.needsReview).toBe(true);
    expect(paper.reviewReason).toMatch(/format could not be identified/i);
  });
});

describe('page boundaries', () => {
  it('keeps records on their own page', () => {
    const tokens: PositionedToken[] = parseTsv(
      ocrTsv([
        PAGE_EDGE,
        ...row(100, { label: 'Q.1', body: 'Page one', marks: 6, L: 'L2', co: 'CO1' }),
        ...row(100, { label: 'Q.2', body: 'Page two', marks: 7, L: 'L2', co: 'CO2' }).map((w) => ({
          ...w,
          page: 2,
        })),
      ]),
      'ocr',
    );
    const questions = extractDescriptive(groupIntoLines(tokens));
    expect(questions[0]?.page).toBe(1);
    expect(questions[1]?.page).toBe(2);
    expect(extractStructure(groupIntoLines(tokens), 'descriptive').pages).toBe(2);
  });
});
