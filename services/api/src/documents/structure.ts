/**
 * Deterministic structural extraction from positioned tokens.
 *
 * Authority: docs/17 §17.16 · docs/32 OQ-019a · M5A.4 §6, §7, §10, §12
 *
 * Geometry and regular expressions only. NO LLM, NO EMBEDDINGS, NO SEMANTIC
 * CLASSIFICATION — the point of this milestone is to find out how much
 * structure is recoverable *deterministically*, and a model in the middle would
 * make that unanswerable.
 *
 * WHY POSITION AND NOT FLAT TEXT
 *
 * Flattened OCR recovered the sub-question letter in only 3-4 of 15-20 rows
 * (docs/17 §17.11d), because `a.` sits in a narrow column that flattening
 * merges into the question text. In the token stream it is a distinct box at a
 * predictable x — recoverable by looking where it is rather than by guessing
 * from what it says.
 *
 * The right-hand `marks | L | CO` columns are recovered the same way: by their
 * position on the row, not by a regex over a line that may have collapsed.
 */

import type { PositionedLine } from './geometry.js';
import { pageRight } from './geometry.js';
import type { PaperFormat } from './format.js';

/* -------------------------------------------------------------------------- */
/* Confidence                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Structural confidence. NOT an OCR accuracy score.
 *
 * There is no ground truth for character accuracy, so no numeric score is
 * invented (docs/32 ED-46). These states describe how much of the STRUCTURE
 * agreed, which is a question the geometry can actually answer.
 *
 *   high             a question number, a text body and marks were all found,
 *                    and the marks sit in the right-hand column where the
 *                    marks column belongs
 *   medium           number and text found, but marks are missing or sit
 *                    somewhere the marks column is not
 *   low              the record was inferred from a single weak cue — a bare
 *                    sub-question letter with no owning question, say
 *   review_required  cues contradict each other: two question numbers on one
 *                    row, marks outside the plausible 1-20 range, or an
 *                    implausible module
 */
export type StructuralConfidence = 'high' | 'medium' | 'low' | 'review_required';

/* -------------------------------------------------------------------------- */
/* Output model                                                               */
/* -------------------------------------------------------------------------- */

export interface BoundingBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface ExtractedSubQuestion {
  readonly label: string;
  readonly text: string;
  readonly marks: number | null;
  readonly bloomLevel: string | null;
  readonly courseOutcome: string | null;
  readonly page: number;
  readonly boundingBox: BoundingBox;
  readonly confidence: StructuralConfidence;
  readonly needsReview: boolean;
}

export interface ExtractedQuestion {
  readonly questionNumber: string;
  readonly module: string | null;
  readonly text: string;
  readonly marks: number | null;
  readonly bloomLevel: string | null;
  readonly courseOutcome: string | null;
  readonly page: number;
  readonly boundingBox: BoundingBox;
  readonly confidence: StructuralConfidence;
  readonly needsReview: boolean;
  readonly subQuestions: readonly ExtractedSubQuestion[];
}

export interface ExtractedMcqItem {
  readonly itemNumber: number;
  readonly text: string;
  readonly options: readonly { readonly label: string; readonly text: string }[];
  readonly page: number;
  readonly boundingBox: BoundingBox;
  readonly confidence: StructuralConfidence;
  readonly needsReview: boolean;
}

export interface ExtractedPaper {
  readonly format: PaperFormat;
  readonly questions: readonly ExtractedQuestion[];
  readonly mcqItems: readonly ExtractedMcqItem[];
  readonly pages: number;
  readonly needsReview: boolean;
  readonly reviewReason: string | null;
}

/* -------------------------------------------------------------------------- */
/* Patterns                                                                   */
/* -------------------------------------------------------------------------- */

/** `Q.1`, `Q 1`, `Q1`, `Q.10` — anchored to the START of a row. */
const QUESTION_NUMBER = /^Q\s*[.-]?\s*(\d{1,2})\b/i;
/** A bare `1.` / `10)` at the very left, used when the `Q` is lost to OCR. */
const BARE_NUMBER = /^(\d{1,2})\s*[.)]/;
/** `a.` `b)` `(c)` — a sub-question label occupying its own narrow cell. */
const SUB_LABEL = /^\(?([a-d])\s*[.)]?$/i;
const SUB_LABEL_INLINE = /^\(?([a-d])\s*[.)]\s+(.*)$/i;
const MODULE = /Module\s*[-=–—]?\s*([1-5]|I{1,3}V?|IV|V)\b/i;
const BLOOM = /\bL([1-6])\b/;
const CO = /\bCO\s?(\d)\b/i;
const MCQ_OPTION = /^\(?([a-dA-D])\s*[.)]\s*(.+)$/;

/** Marks on a VTU paper. Outside this range the number is something else. */
const MIN_MARKS = 1;
const MAX_MARKS = 20;

/**
 * Where the marks/L/CO columns live: the right-hand fraction of the page.
 *
 * Positional rather than textual. A bare `6` in the body of a question is prose;
 * the same `6` at x > 70% of the page width is the marks cell. Flat text cannot
 * tell those apart, which is the entire reason for this module.
 */
const MARKS_COLUMN_START = 0.7;

/* -------------------------------------------------------------------------- */
/* Row analysis                                                               */
/* -------------------------------------------------------------------------- */

interface RowFacts {
  readonly questionNumber: string | null;
  readonly subLabel: string | null;
  readonly module: string | null;
  readonly marks: number | null;
  readonly bloom: string | null;
  readonly co: string | null;
  readonly body: string;
  readonly conflicting: boolean;
  readonly marksInColumn: boolean;
}

function analyseRow(line: PositionedLine, rightEdge: number): RowFacts {
  const columnStart = rightEdge * MARKS_COLUMN_START;
  const tokens = [...line.tokens];

  // Right-hand columns first, by POSITION, so they are removed before the rest
  // of the row is read as question text.
  const rightTokens = tokens.filter((token) => token.x >= columnStart);
  const rightText = rightTokens.map((token) => token.text).join(' ');

  const bloomMatch = BLOOM.exec(rightText);
  const coMatch = CO.exec(rightText);

  let marks: number | null = null;
  let marksInColumn = false;
  for (const token of rightTokens) {
    /*
     * PURE digits only, with at most surrounding punctuation.
     *
     * Stripping non-digits first would turn the Bloom's token `L2` into `2` and
     * store it as marks — a real defect caught by a synthetic fixture, and one
     * that would have quietly corrupted the marks on every row where the marks
     * cell itself was lost.
     */
    const digits = /^[|.\s]*(\d{1,2})[|.\s]*$/.exec(token.text);
    if (digits?.[1] !== undefined) {
      const value = Number(digits[1]);
      if (value >= MIN_MARKS && value <= MAX_MARKS) {
        marks = value;
        marksInColumn = true;
        break;
      }
    }
  }

  const leftTokens = tokens.filter((token) => token.x < columnStart);
  const leftText = leftTokens.map((token) => token.text).join(' ');

  // A question number, if this row starts one.
  const qMatch = QUESTION_NUMBER.exec(leftText) ?? BARE_NUMBER.exec(leftText);
  const questionNumber = qMatch?.[1] ?? null;

  // Two question numbers on one row means the geometry has gone wrong.
  const questionHits = (leftText.match(/\bQ\s*[.-]?\s*\d{1,2}\b/gi) ?? []).length;

  /*
   * The sub-question label, recovered POSITIONALLY.
   *
   * A label is a token that is a lone letter near the left of the row. Looked
   * for as its own cell first — that is the case flat text loses — and only
   * then as an inline `a. ...` prefix.
   */
  let subLabel: string | null = null;
  let body = leftText;

  const firstNonQ = leftTokens.filter((token) => !QUESTION_NUMBER.test(token.text));
  for (const token of firstNonQ.slice(0, 3)) {
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

  const moduleMatch = MODULE.exec(line.text);

  return {
    questionNumber,
    subLabel,
    module: moduleMatch?.[1] ?? null,
    marks,
    bloom: bloomMatch?.[1] === undefined ? null : `L${bloomMatch[1]}`,
    co: coMatch?.[1] === undefined ? null : `CO${coMatch[1]}`,
    body,
    conflicting: questionHits > 1,
    marksInColumn,
  };
}

function boxOf(line: PositionedLine): BoundingBox {
  return {
    x: Math.round(line.x),
    y: Math.round(line.y),
    width: Math.round(line.right - line.x),
    height: Math.round(line.bottom - line.y),
  };
}

function confidenceFor(facts: RowFacts, hasText: boolean, owned: boolean): StructuralConfidence {
  if (facts.conflicting) return 'review_required';
  if (facts.marks !== null && (facts.marks < MIN_MARKS || facts.marks > MAX_MARKS)) {
    return 'review_required';
  }
  if (!owned) return 'low';
  if (hasText && facts.marksInColumn) return 'high';
  if (hasText) return 'medium';
  return 'low';
}

/* -------------------------------------------------------------------------- */
/* Descriptive papers                                                         */
/* -------------------------------------------------------------------------- */

export function extractDescriptive(lines: readonly PositionedLine[]): ExtractedQuestion[] {
  const questions: ExtractedQuestion[] = [];
  const rightEdges = new Map<number, number>();
  let currentModule: string | null = null;
  let current: {
    q: ExtractedQuestion;
    subs: ExtractedSubQuestion[];
  } | null = null;

  const flush = (): void => {
    if (current === null) return;
    questions.push({ ...current.q, subQuestions: current.subs });
    current = null;
  };

  for (const line of lines) {
    if (!rightEdges.has(line.page)) rightEdges.set(line.page, pageRight(lines, line.page));
    const facts = analyseRow(line, rightEdges.get(line.page) ?? 0);

    if (facts.module !== null) currentModule = facts.module;

    /*
     * Suppress the numbered INSTRUCTION block.
     *
     * "1. Answer any FIVE full questions..." matches a bare question number
     * exactly as a real question does. The discriminator is POSITIONAL and
     * needs no reading of the words: an instruction has nothing in the
     * right-hand table — no marks, no Bloom's level, no CO — because it is not
     * a row of the question table at all.
     *
     * A first attempt also required "before the first Module heading". That
     * failed on a real file containing TWO model papers, where the second
     * paper's instructions arrive with a module already set. The column test
     * alone handles both.
     *
     * THE TRADE-OFF, STATED: a genuine question whose entire marks column was
     * lost to OCR is skipped rather than kept at low confidence. Across the
     * evaluated corpus this removed 6 false questions and cost none, but on a
     * badly damaged scan it would lose real rows — which is why the poor-scan
     * case is reported separately rather than averaged in.
     */
    const looksLikeInstruction = facts.marks === null && facts.bloom === null && facts.co === null;

    if (facts.questionNumber !== null && !looksLikeInstruction) {
      flush();
      const confidence = confidenceFor(facts, facts.body.length > 3, true);
      current = {
        q: {
          questionNumber: facts.questionNumber,
          module: currentModule,
          text: facts.body,
          marks: facts.marks,
          bloomLevel: facts.bloom,
          courseOutcome: facts.co,
          page: line.page,
          boundingBox: boxOf(line),
          confidence,
          needsReview: confidence === 'review_required',
          subQuestions: [],
        },
        subs: [],
      };
      // A question row can also carry its first sub-question.
      if (facts.subLabel !== null) {
        current.subs.push(makeSub(facts, line, true));
      }
      continue;
    }

    if (facts.subLabel !== null) {
      // A sub-question with no owning question is a weak cue, not a discard.
      current?.subs.push(makeSub(facts, line, current !== null));
      if (current === null) {
        questions.push({
          questionNumber: '?',
          module: currentModule,
          text: facts.body,
          marks: facts.marks,
          bloomLevel: facts.bloom,
          courseOutcome: facts.co,
          page: line.page,
          boundingBox: boxOf(line),
          confidence: 'low',
          needsReview: true,
          subQuestions: [makeSub(facts, line, false)],
        });
      }
      continue;
    }

    // A continuation row: text belonging to whatever is open. Marks found here
    // still belong to the row that carried them.
    if (current !== null && facts.body.length > 0) {
      const target = current.subs[current.subs.length - 1];
      if (target !== undefined) {
        current.subs[current.subs.length - 1] = {
          ...target,
          text: `${target.text} ${facts.body}`.trim(),
          marks: target.marks ?? facts.marks,
          bloomLevel: target.bloomLevel ?? facts.bloom,
          courseOutcome: target.courseOutcome ?? facts.co,
        };
      } else {
        current.q = {
          ...current.q,
          text: `${current.q.text} ${facts.body}`.trim(),
          marks: current.q.marks ?? facts.marks,
          bloomLevel: current.q.bloomLevel ?? facts.bloom,
          courseOutcome: current.q.courseOutcome ?? facts.co,
        };
      }
    }
  }

  flush();
  return questions;
}

function makeSub(facts: RowFacts, line: PositionedLine, owned: boolean): ExtractedSubQuestion {
  const confidence = confidenceFor(facts, facts.body.length > 3, owned);
  return {
    label: facts.subLabel ?? '?',
    text: facts.body,
    marks: facts.marks,
    bloomLevel: facts.bloom,
    courseOutcome: facts.co,
    page: line.page,
    boundingBox: boxOf(line),
    confidence,
    needsReview: confidence === 'review_required' || confidence === 'low',
  };
}

/* -------------------------------------------------------------------------- */
/* MCQ papers                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * MCQ items.
 *
 * Descriptive fields are NOT looked for: an MCQ paper has no modules, no
 * Bloom's column and no per-question marks, and inventing empty ones would be
 * the same mistake as grading it against the wrong template (docs/17 §17.11d).
 */
export function extractMcq(lines: readonly PositionedLine[]): ExtractedMcqItem[] {
  const items: ExtractedMcqItem[] = [];
  let current: { item: ExtractedMcqItem; options: { label: string; text: string }[] } | null = null;

  const flush = (): void => {
    if (current === null) return;
    items.push({ ...current.item, options: current.options });
    current = null;
  };

  for (const line of lines) {
    const numbered = BARE_NUMBER.exec(line.text.trim());
    const optionMatch = MCQ_OPTION.exec(line.text.trim());

    if (numbered?.[1] !== undefined && optionMatch === null) {
      flush();
      const number = Number(numbered[1]);
      const text = line.text.trim().replace(BARE_NUMBER, '').trim();
      current = {
        item: {
          itemNumber: number,
          text,
          options: [],
          page: line.page,
          boundingBox: boxOf(line),
          confidence: text.length > 3 ? 'high' : 'low',
          needsReview: text.length <= 3,
        },
        options: [],
      };
      continue;
    }

    if (optionMatch?.[1] !== undefined && current !== null) {
      current.options.push({
        label: optionMatch[1].toLowerCase(),
        text: (optionMatch[2] ?? '').trim(),
      });
      continue;
    }

    if (current !== null && line.text.trim().length > 0) {
      current.item = { ...current.item, text: `${current.item.text} ${line.text.trim()}`.trim() };
    }
  }

  flush();
  return items;
}

/* -------------------------------------------------------------------------- */
/* Entry point                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Extracts structure for a known format.
 *
 * `unknown` produces NOTHING and says so. Guessing at a template is exactly the
 * error that scored four correctly-read papers as failures during
 * qualification (docs/17 §17.11d), and an empty result with a reason is more
 * useful than a confident wrong one.
 */
export function extractStructure(
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
    const mcqItems = extractMcq(lines);
    return {
      format,
      questions: [],
      mcqItems,
      pages,
      needsReview: mcqItems.some((item) => item.needsReview),
      reviewReason: null,
    };
  }

  const questions = extractDescriptive(lines);
  const flagged = questions.filter(
    (q) => q.needsReview || q.subQuestions.some((s) => s.needsReview),
  ).length;

  return {
    format,
    questions,
    mcqItems: [],
    pages,
    needsReview: flagged > 0,
    reviewReason:
      flagged > 0 ? `${String(flagged)} question(s) have structure that should be checked.` : null,
  };
}
