/**
 * Deterministic structural extraction, version 2.
 *
 * Authority: docs/17 §17.19 · docs/32 OQ-032 · M5A.7 §3, §4, §5
 *
 * Geometry and regular expressions only. NO LLM, NO EMBEDDINGS, NO SEMANTIC
 * CLASSIFICATION, NO EQUATION RECONSTRUCTION — unchanged from v1, and the point
 * of the milestone is that these defects were fixed WITHOUT reaching for any of
 * them.
 *
 * V1 IS NOT DELETED. `structure.ts` is frozen as the baseline that produced the
 * M5A.6 corpus; a v1 paper and a v2 paper sit side by side under different
 * extraction versions so the two can be compared (M5A.7 §2, §10).
 *
 * WHAT V1 GOT WRONG, AND WHY
 *
 * v1 treated "the right-hand 30% of the page" as the marks column. On every
 * paper measured in M5A.6 that boundary was 90-100pt too far LEFT: the real
 * marks column starts at x≈480 on a 550pt-wide page, and 0.7 × 550 = 385. The
 * words between 385 and 480 are question text, and v1 deleted them —
 * "full-wave bridge rectifier" became "full-wave rectifier" (docs/17 §17.18).
 *
 * Worse, on a paper whose marks sit on a different text line from the label,
 * that same boundary made whole rows look like instructions and dropped them,
 * taking the question number with them.
 *
 * THE FIX IS TO MEASURE THE COLUMN INSTEAD OF ASSUMING IT.
 */

import type { PositionedLine, PositionedToken } from './geometry.js';
import { pageRight } from './geometry.js';
import type { PaperFormat } from './format.js';
import type {
  BoundingBox,
  ExtractedMcqItem,
  ExtractedPaper,
  ExtractedQuestion,
  ExtractedSubQuestion,
  StructuralConfidence,
} from './structure.js';

export const PARSER_VERSION_V2 = 'positional-v2';

/* -------------------------------------------------------------------------- */
/* Patterns                                                                   */
/* -------------------------------------------------------------------------- */

const QUESTION_NUMBER = /^Q\s*[.-]?\s*(\d{1,2})\b/i;
const BARE_NUMBER = /^(\d{1,2})\s*[.)]/;
const SUB_LABEL = /^\(?([a-d])\s*[.)]?$/i;
const SUB_LABEL_INLINE = /^\(?([a-d])\s*[.)]\s+(.*)$/i;
const MODULE = /Module\s*[-=–—]?\s*([1-5]|I{1,3}V?|IV|V)\b/i;
const MCQ_OPTION = /^\(?([a-dA-D])\s*[.)]\s*(.+)$/;

/** A marks cell: a bare one- or two-digit number, punctuation tolerated. */
const MARKS_TOKEN = /^[|.\s]*(\d{1,2})[|.\s]*$/;
/** `L2`, and the `L1,2` that real papers use for a two-level cell. */
const BLOOM_TOKEN = /^L\s?(\d(?:\s*,\s*\d)*)$/i;
const CO_TOKEN = /^CO\s?(\d)$/i;

const MIN_MARKS = 1;
const MAX_MARKS = 20;

/* -------------------------------------------------------------------------- */
/* Column detection — the heart of v2                                         */
/* -------------------------------------------------------------------------- */

/**
 * Where the page's marks table actually starts, measured from its own tokens.
 *
 * A marks/Bloom's/CO column is a NARROW STACK: the same kind of short token, at
 * the same x, on row after row. Prose does not do that. So the columns are found
 * by looking for those stacks rather than by assuming a fraction of the width.
 *
 * `0.6 × pageRight` bounds the SEARCH, not the answer. It only says "the marks
 * table is in the right-hand part of the page", which is true of every VTU paper
 * in the corpus; the boundary itself is the leftmost real token of a real
 * column. Without it a mathematics paper's left-margin equation numbers form a
 * dense stack of their own and win (measured on `1BMATC101`, where they sit at
 * x=72 on a 558pt page).
 *
 * Returns null when there is no such table — an MCQ paper, or a page of prose.
 * NULL MEANS "DO NOT TRUNCATE ANYTHING" (M5A.7 §3), which is the opposite of
 * v1's behaviour and the reason this function returns null instead of a
 * fallback.
 */
export function detectMarksColumn(lines: readonly PositionedLine[], page: number): number | null {
  const edge = pageRight(lines, page);
  if (edge <= 0) return null;
  const searchFrom = edge * 0.6;

  const candidates: { x: number; row: number }[] = [];
  for (const line of lines) {
    if (line.page !== page) continue;
    for (const token of line.tokens) {
      if (token.x < searchFrom) continue;
      const isColumnCell =
        BLOOM_TOKEN.test(token.text) || CO_TOKEN.test(token.text) || MARKS_TOKEN.test(token.text);
      if (isColumnCell) candidates.push({ x: token.x, row: Math.round(line.y) });
    }
  }
  if (candidates.length === 0) return null;

  // Cluster by x. 12pt is about two characters at exam-paper type sizes: wide
  // enough to absorb OCR jitter, narrow enough to keep marks, L and CO apart.
  const TOLERANCE = 12;
  const clusters: { x: number; rows: Set<number> }[] = [];
  for (const candidate of [...candidates].sort((a, b) => a.x - b.x)) {
    const last = clusters[clusters.length - 1];
    if (last !== undefined && candidate.x - last.x <= TOLERANCE) {
      last.rows.add(candidate.row);
    } else {
      clusters.push({ x: candidate.x, rows: new Set([candidate.row]) });
    }
  }

  /*
   * A real column repeats down the table. A stray number that happens to sit
   * far right appears once. Requiring at least half the best column's row count
   * separates them without a magic absolute threshold.
   */
  const best = Math.max(...clusters.map((c) => c.rows.size));
  const strong = clusters.filter((c) => c.rows.size >= Math.max(2, best * 0.5));

  /*
   * A TABLE IS SEVERAL COLUMNS SIDE BY SIDE. Two aligned stacks at different x
   * are strong evidence even when the table is only two rows deep — a last page
   * with two questions left on it. One stack on its own has to be taller before
   * it means anything, or a column of page numbers would qualify.
   */
  const enough = strong.length >= 2 || (strong[0]?.rows.size ?? 0) >= 3;
  if (!enough) return null;

  return Math.min(...strong.map((c) => c.x));
}

/**
 * Where the page's sub-question labels sit, measured the same way.
 *
 * A LONE LETTER IS NOT ENOUGH. The English article "A" is a lone letter that
 * matches `[a-d]`, and a real paper opens cells with it — "A semiconductor
 * sample 0.5 mm thick…" begins one on `1BPHYS102`. v1 took whichever lone
 * letter came first among a row's leading tokens and got the right answer only
 * because the real label happened to sit further left.
 *
 * Labels form their own narrow stack, exactly as the marks column does, so the
 * same evidence settles it: a label is a lone letter AT THE LABEL COLUMN.
 * Returns null when no stack is found, and the caller then falls back to
 * "the first token on the row", which is where a label sits when there is only
 * one of them.
 */
export function detectLabelColumn(lines: readonly PositionedLine[], page: number): number | null {
  const edge = pageRight(lines, page);
  const onPage = lines.filter((line) => line.page === page);

  const xs: { x: number; row: number }[] = [];
  for (const line of onPage) {
    for (const token of line.tokens) {
      // Left third only: a label is never in the body or the marks table.
      if (token.x > edge * 0.35) continue;
      if (SUB_LABEL.test(token.text)) xs.push({ x: token.x, row: Math.round(line.y) });
    }
  }
  if (xs.length < 3) return null;

  const TOLERANCE = 10;
  const clusters: { x: number; rows: Set<number> }[] = [];
  for (const candidate of [...xs].sort((a, b) => a.x - b.x)) {
    const last = clusters[clusters.length - 1];
    if (last !== undefined && candidate.x - last.x <= TOLERANCE) last.rows.add(candidate.row);
    else clusters.push({ x: candidate.x, rows: new Set([candidate.row]) });
  }

  const best = clusters.reduce((a, b) => (b.rows.size > a.rows.size ? b : a));
  return best.rows.size >= 3 ? best.x : null;
}

/* -------------------------------------------------------------------------- */
/* Rows and cells                                                             */
/* -------------------------------------------------------------------------- */

interface RowFacts {
  readonly line: PositionedLine;
  readonly questionNumber: string | null;
  readonly subLabel: string | null;
  readonly module: string | null;
  readonly marks: number | null;
  readonly bloom: string | null;
  readonly co: string | null;
  readonly body: string;
  readonly conflicting: boolean;
  /** True when this row carries any right-hand column value: it anchors a cell. */
  readonly anchors: boolean;
}

function readRow(
  line: PositionedLine,
  columnStart: number | null,
  labelColumn: number | null,
): RowFacts {
  const inColumn = (token: PositionedToken): boolean =>
    columnStart !== null && token.x >= columnStart;

  const rightTokens = line.tokens.filter(inColumn);
  const leftTokens = line.tokens.filter((token) => !inColumn(token));

  let marks: number | null = null;
  let bloom: string | null = null;
  let co: string | null = null;

  for (const token of rightTokens) {
    const bloomMatch = BLOOM_TOKEN.exec(token.text);
    if (bloomMatch?.[1] !== undefined) {
      bloom ??= `L${bloomMatch[1].replace(/\s+/g, '')}`;
      continue;
    }
    const coMatch = CO_TOKEN.exec(token.text);
    if (coMatch?.[1] !== undefined) {
      co ??= `CO${coMatch[1]}`;
      continue;
    }
    /*
     * PURE digits only. Stripping non-digits would turn `L2` into marks 2 — a
     * real defect caught by a fixture in M5A.4 and still worth guarding.
     */
    const marksMatch = MARKS_TOKEN.exec(token.text);
    if (marksMatch?.[1] !== undefined) {
      const value = Number(marksMatch[1]);
      if (marks === null && value >= MIN_MARKS && value <= MAX_MARKS) marks = value;
    }
  }

  const leftText = leftTokens.map((token) => token.text).join(' ');
  const qMatch = QUESTION_NUMBER.exec(leftText) ?? BARE_NUMBER.exec(leftText);
  const questionHits = (leftText.match(/\bQ\s*[.-]?\s*\d{1,2}\b/gi) ?? []).length;

  /*
   * The sub-question label, recovered POSITIONALLY: a lone letter in its own
   * narrow cell near the left. This is the case flattening loses, so it is
   * looked for first and the inline `a. ...` form only afterwards.
   */
  let subLabel: string | null = null;
  let body = leftText;

  const afterQuestion = leftTokens.filter((token) => !QUESTION_NUMBER.test(token.text));
  const firstX = afterQuestion[0]?.x ?? 0;
  const atLabelColumn = (token: PositionedToken): boolean =>
    labelColumn !== null ? Math.abs(token.x - labelColumn) <= 10 : token.x <= firstX + 2;

  for (const token of afterQuestion.slice(0, 3)) {
    if (!atLabelColumn(token)) continue;
    const solo = SUB_LABEL.exec(token.text);
    if (solo?.[1] !== undefined) {
      subLabel = solo[1].toLowerCase();
      body = leftTokens
        .filter((other) => other !== token)
        .map((other) => other.text)
        .join(' ');
      break;
    }
  }
  if (subLabel === null) {
    const stripped = leftText.replace(QUESTION_NUMBER, '').trim();
    const inline = SUB_LABEL_INLINE.exec(stripped);
    if (inline?.[1] !== undefined) {
      subLabel = inline[1].toLowerCase();
      body = inline[2] ?? '';
    }
  }

  body = body
    .replace(QUESTION_NUMBER, '')
    .replace(/^[\s|.)-]+/, '')
    .trim();

  return {
    line,
    questionNumber: qMatch?.[1] ?? null,
    subLabel,
    module: MODULE.exec(line.text)?.[1] ?? null,
    marks,
    bloom,
    co,
    body,
    conflicting: questionHits > 1,
    anchors: marks !== null || bloom !== null || co !== null,
  };
}

/**
 * One cell of the marks table, and every text row that belongs to it.
 *
 * A cell is anchored by the row carrying its marks/L/CO and runs until the next
 * anchor. That association is what v1 could not express: on `1BPHYS102` the
 * marks sit on a cell's FIRST text line while the sub-question label sits on its
 * SECOND, so a row-at-a-time parser sees a labelled row with no marks and a
 * marked row with no label, and gets both wrong.
 */
interface Cell {
  readonly rows: RowFacts[];
  readonly anchor: RowFacts;
}

function groupIntoCells(rows: readonly RowFacts[]): { cells: Cell[]; preamble: RowFacts[] } {
  const cells: Cell[] = [];
  const preamble: RowFacts[] = [];

  for (const row of rows) {
    if (row.anchors) {
      cells.push({ rows: [row], anchor: row });
      continue;
    }
    const open = cells[cells.length - 1];
    if (open === undefined) preamble.push(row);
    else open.rows.push(row);
  }
  return { cells, preamble };
}

/* -------------------------------------------------------------------------- */
/* Assembly                                                                   */
/* -------------------------------------------------------------------------- */

function boxOf(rows: readonly RowFacts[]): BoundingBox {
  const lines = rows.map((row) => row.line);
  const x = Math.min(...lines.map((l) => l.x));
  const y = Math.min(...lines.map((l) => l.y));
  return {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.round(Math.max(...lines.map((l) => l.right)) - x),
    height: Math.round(Math.max(...lines.map((l) => l.bottom)) - y),
  };
}

/** `a` follows nothing, `b` follows `a`, and so on. */
function isSuccessor(previous: string | null, label: string): boolean {
  if (previous === null) return false;
  return label.charCodeAt(0) === previous.charCodeAt(0) + 1;
}

function confidenceOf(
  cell: Cell,
  hasText: boolean,
  hasColumn: boolean,
  owned: boolean,
): StructuralConfidence {
  if (cell.rows.some((row) => row.conflicting)) return 'review_required';
  const marks = cell.anchor.marks;
  if (marks !== null && (marks < MIN_MARKS || marks > MAX_MARKS)) return 'review_required';
  if (!owned) return 'low';
  /*
   * `high` requires the marks column to have been FOUND ON THE PAGE and this
   * cell to sit in it. Without a column there is no positional evidence at all,
   * so nothing on that page can be high however clean the text looks — which is
   * the honest reading of M5A.6's finding that `high` was accepted only half
   * the time (M5A.7 §3).
   */
  if (hasText && hasColumn && marks !== null) return 'high';
  if (hasText) return 'medium';
  return 'low';
}

export interface DescriptiveResult {
  readonly questions: ExtractedQuestion[];
  /** True when no marks column was found and text was therefore left whole. */
  readonly columnMissingPages: number[];
}

export function extractDescriptiveV2(lines: readonly PositionedLine[]): DescriptiveResult {
  const pages = [...new Set(lines.map((line) => line.page))].sort((a, b) => a - b);
  const questions: ExtractedQuestion[] = [];
  const columnMissingPages: number[] = [];
  let currentModule: string | null = null;

  /*
   * The open question and the last label seen carry ACROSS PAGE BREAKS.
   *
   * A question that runs from the bottom of one page to the top of the next is
   * one question. Resetting per page split three of them on `1BESC104C` into
   * numberless fragments; carrying the label run keeps `…(b)` on page 2 attached
   * to the `Q.5` that opened it on page 1.
   */
  let previousLabel: string | null = null;
  let open: { question: ExtractedQuestion; subs: ExtractedSubQuestion[] } | null = null;

  const flush = (): void => {
    if (open === null) return;
    questions.push({ ...open.question, subQuestions: open.subs });
    open = null;
  };

  for (const page of pages) {
    const pageLines = lines.filter((line) => line.page === page);
    const columnStart = detectMarksColumn(lines, page);
    if (columnStart === null) columnMissingPages.push(page);

    const labelColumn = detectLabelColumn(lines, page);
    const rows = pageLines.map((line) => readRow(line, columnStart, labelColumn));

    /*
     * NO COLUMN, NO TRUNCATION (M5A.7 §3). Every token stays in the text and
     * every record on the page is flagged. v1 would have deleted the right-hand
     * third of every line and reported the result as `high`.
     */
    if (columnStart === null) {
      // A page with no table cannot continue a table-shaped question.
      flush();
      previousLabel = null;
      questions.push(...withoutColumn(rows, page, currentModule));
      const lastModule = rows.filter((r) => r.module !== null).pop();
      if (lastModule?.module !== undefined && lastModule.module !== null) {
        currentModule = lastModule.module;
      }
      continue;
    }

    /*
     * A module heading anchors no cell — it has no marks — so it would be lost
     * in the preamble or attached to whichever cell happened to follow. Tracking
     * it row by row records the module in force when each cell BEGINS, which is
     * the thing a question actually belongs to.
     */
    const moduleAtRow = new Map<RowFacts, string | null>();
    for (const row of rows) {
      if (row.module !== null) currentModule = row.module;
      moduleAtRow.set(row, currentModule);
    }

    const { cells } = groupIntoCells(rows);

    for (const cell of cells) {
      const cellModule = moduleAtRow.get(cell.anchor) ?? currentModule;

      const label = cell.rows.map((row) => row.subLabel).find((value) => value !== null) ?? null;
      const number =
        cell.rows.map((row) => row.questionNumber).find((value) => value !== null) ?? null;
      const text = cell.rows
        .map((row) => row.body)
        .filter((body) => body.length > 0)
        .join(' ')
        .trim();

      /*
       * A NEW QUESTION STARTS when the labelling restarts, not when a number is
       * seen (M5A.7 §4). `Q.1` may sit on part (b)'s row because the paper
       * centres it across (a), (b) and (c) — so the number is collected from
       * anywhere in the question's run of cells and applied to the whole run.
       */
      const startsQuestion = label === null || !isSuccessor(previousLabel, label);
      if (startsQuestion) {
        flush();
        open = {
          question: {
            questionNumber: null,
            module: cellModule,
            text: label === null ? text : '',
            marks: label === null ? cell.anchor.marks : null,
            bloomLevel: label === null ? cell.anchor.bloom : null,
            courseOutcome: label === null ? cell.anchor.co : null,
            page,
            boundingBox: boxOf(cell.rows),
            confidence: 'medium',
            needsReview: false,
            subQuestions: [],
          },
          subs: [],
        };
      }

      if (open === null) continue;

      // The number owns every cell in the run, wherever in the run it appeared.
      if (number !== null && open.question.questionNumber === null) {
        open.question = { ...open.question, questionNumber: number };
      }

      if (label !== null) {
        const confidence = confidenceOf(cell, text.length > 3, true, true);
        open.subs.push({
          label,
          text,
          marks: cell.anchor.marks,
          bloomLevel: cell.anchor.bloom,
          courseOutcome: cell.anchor.co,
          page,
          boundingBox: boxOf(cell.rows),
          confidence,
          needsReview: confidence === 'review_required' || confidence === 'low',
        });
      }
      previousLabel = label;
    }
  }

  flush();

  /*
   * The question's own confidence is decided once its parts are known: a
   * question whose number was never found is `low` however clean its parts are,
   * because the record cannot be cited without one.
   */
  return {
    questions: questions.map((question) => {
      const numbered = question.questionNumber !== null;
      // A contradiction anywhere in the question outranks everything else.
      const conflicted = question.subQuestions.some((s) => s.confidence === 'review_required');
      // A question already flagged by the no-column path can never be `high`:
      // nothing on such a page has positional evidence behind it.
      const capped = question.needsReview;
      const confidence: StructuralConfidence = conflicted
        ? 'review_required'
        : !numbered
          ? 'low'
          : !capped && (question.subQuestions.length > 0 || question.marks !== null)
            ? 'high'
            : 'medium';
      // `needsReview` is never cleared here: a page with no marks column already
      // set it, and recomputing confidence must not quietly un-flag that.
      return {
        ...question,
        confidence,
        needsReview: question.needsReview || !numbered || conflicted,
      };
    }),
    columnMissingPages,
  };
}

/**
 * A page with no marks table.
 *
 * Every row keeps ALL its text and every record is flagged. Preserving
 * information and saying it is unverified beats deleting it silently
 * (M5A.7 §3).
 */
function withoutColumn(
  rows: readonly RowFacts[],
  page: number,
  module: string | null,
): ExtractedQuestion[] {
  const questions: ExtractedQuestion[] = [];
  let open: { question: ExtractedQuestion; subs: ExtractedSubQuestion[]; rows: RowFacts[] } | null =
    null;

  const flush = (): void => {
    if (open === null) return;
    questions.push({ ...open.question, subQuestions: open.subs });
    open = null;
  };

  for (const row of rows) {
    if (row.questionNumber !== null) {
      flush();
      open = {
        question: {
          questionNumber: row.questionNumber,
          module: row.module ?? module,
          text: row.body,
          marks: null,
          bloomLevel: null,
          courseOutcome: null,
          page,
          boundingBox: boxOf([row]),
          confidence: 'medium',
          needsReview: true,
          subQuestions: [],
        },
        subs: [],
        rows: [row],
      };
      continue;
    }
    if (open === null) continue;

    if (row.subLabel !== null) {
      open.subs.push({
        label: row.subLabel,
        text: row.body,
        marks: null,
        bloomLevel: null,
        courseOutcome: null,
        page,
        boundingBox: boxOf([row]),
        confidence: 'medium',
        needsReview: true,
      });
    } else if (row.body.length > 0) {
      const target = open.subs[open.subs.length - 1];
      if (target !== undefined) {
        open.subs[open.subs.length - 1] = { ...target, text: `${target.text} ${row.body}`.trim() };
      } else {
        open.question = { ...open.question, text: `${open.question.text} ${row.body}`.trim() };
      }
    }
  }
  flush();
  return questions;
}

/* -------------------------------------------------------------------------- */
/* MCQ                                                                        */
/* -------------------------------------------------------------------------- */

interface McqCandidate {
  readonly number: number;
  readonly text: string;
  readonly options: { label: string; text: string }[];
  readonly page: number;
  readonly rows: PositionedLine[];
}

/**
 * MCQ items, with the instruction block removed.
 *
 * THE PROBLEM v1 HAD. The descriptive parser suppresses numbered instructions
 * by their empty marks column (`ED-52`). An MCQ paper has no marks column at
 * all, so "2. Use only Black ball point pen…" is shaped exactly like an item.
 * Three of nine records on `BENGK106` page 1 were instructions (docs/17 §17.18).
 *
 * THE DISCRIMINATOR IS STRUCTURAL, NOT LINGUISTIC (M5A.7 §5). It reads no
 * English, so it works the same on a Kannada paper:
 *
 *   1. Instructions come FIRST and the item numbering RESTARTS after them. A
 *      descent back to 1 after climbing is a new sequence beginning.
 *   2. Instructions carry NO OPTION ROWS. An item offers a choice; an
 *      instruction tells you how to mark it.
 *
 * BOTH are required before anything is dropped. Either alone would discard real
 * items — a paper that simply begins at a number above 1, or an item whose
 * options OCR failed to read.
 */
export function extractMcqV2(lines: readonly PositionedLine[]): ExtractedMcqItem[] {
  const candidates: McqCandidate[] = [];
  let current: McqCandidate | null = null;

  for (const line of lines) {
    const text = line.text.trim();
    const numbered = BARE_NUMBER.exec(text);
    const option = MCQ_OPTION.exec(text);

    if (numbered?.[1] !== undefined && option === null) {
      if (current !== null) candidates.push(current);
      current = {
        number: Number(numbered[1]),
        text: text.replace(BARE_NUMBER, '').trim(),
        options: [],
        page: line.page,
        rows: [line],
      };
      continue;
    }

    if (current === null) continue;

    if (option?.[1] !== undefined) {
      current.options.push({ label: option[1].toLowerCase(), text: (option[2] ?? '').trim() });
      current.rows.push(line);
      continue;
    }
    if (text.length > 0) {
      current = {
        ...current,
        text: `${current.text} ${text}`.trim(),
        rows: [...current.rows, line],
      };
    }
  }
  if (current !== null) candidates.push(current);

  const items = candidates.slice(dropInstructionBlock(candidates));

  return items.map((candidate) => {
    const box = boxOfLines(candidate.rows);
    const hasText = candidate.text.length > 3;
    const confidence: StructuralConfidence = hasText
      ? candidate.options.length > 0
        ? 'high'
        : 'medium'
      : 'low';
    return {
      itemNumber: candidate.number,
      text: candidate.text,
      options: candidate.options,
      page: candidate.page,
      boundingBox: box,
      confidence,
      needsReview: confidence !== 'high',
    };
  });
}

/**
 * How many leading candidates are the instruction block.
 *
 * Returns 0 — drop nothing — unless BOTH structural cues agree.
 */
function dropInstructionBlock(candidates: readonly McqCandidate[]): number {
  // Cue 1: the last point where numbering restarts at 1 after climbing above it.
  let restartAt = -1;
  let peak = 0;
  for (const [index, candidate] of candidates.entries()) {
    if (candidate.number === 1 && peak > 1) restartAt = index;
    peak = Math.max(peak, candidate.number);
  }
  if (restartAt <= 0) return 0;

  // Cue 2: nothing before the restart offered a choice.
  const leading = candidates.slice(0, restartAt);
  if (leading.some((candidate) => candidate.options.length > 0)) return 0;

  return restartAt;
}

function boxOfLines(lines: readonly PositionedLine[]): BoundingBox {
  const x = Math.min(...lines.map((l) => l.x));
  const y = Math.min(...lines.map((l) => l.y));
  return {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.round(Math.max(...lines.map((l) => l.right)) - x),
    height: Math.round(Math.max(...lines.map((l) => l.bottom)) - y),
  };
}

/* -------------------------------------------------------------------------- */
/* Entry point                                                                */
/* -------------------------------------------------------------------------- */

export function extractStructureV2(
  lines: readonly PositionedLine[],
  format: PaperFormat,
): ExtractedPaper {
  const pages = new Set(lines.map((line) => line.page)).size;

  if (format === 'unknown') {
    return {
      format,
      questions: [],
      mcqItems: [],
      pages,
      needsReview: true,
      reviewReason:
        'The paper format could not be identified, so no question structure was extracted.',
    };
  }

  if (format === 'mcq') {
    const mcqItems = extractMcqV2(lines);
    return {
      format,
      questions: [],
      mcqItems,
      pages,
      needsReview: mcqItems.some((item) => item.needsReview),
      reviewReason: mcqItems.some((item) => item.needsReview)
        ? 'Some items are missing their options and should be checked.'
        : null,
    };
  }

  const { questions, columnMissingPages } = extractDescriptiveV2(lines);
  const flagged = questions.filter(
    (q) => q.needsReview || q.subQuestions.some((s) => s.needsReview),
  ).length;

  const reasons: string[] = [];
  if (columnMissingPages.length > 0) {
    reasons.push(
      `No marks column was found on page ${columnMissingPages.join(', ')}, so the text was kept whole and nothing on those pages is confirmed.`,
    );
  }
  if (flagged > 0)
    reasons.push(`${String(flagged)} question(s) have structure that should be checked.`);

  return {
    format,
    questions,
    mcqItems: [],
    pages,
    needsReview: reasons.length > 0,
    reviewReason: reasons.length > 0 ? reasons.join(' ') : null,
  };
}
