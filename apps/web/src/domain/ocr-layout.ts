/**
 * OCR word boxes, as printed rows.
 *
 * Authority: docs/17 §17.21 · M10A.6B §12, §13, §14
 *
 * ---------------------------------------------------------------------------
 * THE SAME PROBLEM AS A PDF, IN A DIFFERENT COORDINATE SYSTEM
 * ---------------------------------------------------------------------------
 *
 * OCR hands back words with boxes, in no particular order — the same shape of
 * problem `pdf-layout.ts` already solves for a PDF's text runs. So this module
 * does not rebuild rows; it TRANSLATES, and then reuses that clustering
 * wholesale. One row-reconstruction rule serves both paths, so a fix to it
 * helps both and the two cannot drift apart.
 *
 * The translation is not a formality. A PDF places text in user space, where
 * larger y is HIGHER on the page. An image numbers rows downward, so larger y
 * is LOWER. Feeding image coordinates to a reader that assumes the first
 * convention returns the page upside down: the subject rows come out before the
 * "Semester : N" line that gives them their semester, and the parser then finds
 * a card with no semester on it.
 *
 * ---------------------------------------------------------------------------
 * CONFIDENCE IS EVIDENCE, NOT TRUTH
 * ---------------------------------------------------------------------------
 *
 * Tesseract's per-word confidence is kept and carried to the review screen as a
 * REASON TO LOOK, never as a claim about correctness. A row of confidently
 * misread digits is exactly as wrong as an unconfident one, and the only thing
 * that catches either is a person reading the row against the card (§13).
 */

import { itemsToLines, type PositionedText } from './pdf-layout.js';
import type { ImportLine } from './result-import.js';

/** One word as OCR reports it: text, a box in IMAGE coordinates, a confidence. */
export interface OcrWord {
  readonly text: string;
  /** Image-space box. `y0` is the TOP edge, so larger y is lower on the page. */
  readonly bbox: {
    readonly x0: number;
    readonly y0: number;
    readonly x1: number;
    readonly y1: number;
  };
  /** 0-100 as Tesseract reports it. Kept as evidence; never shown as accuracy. */
  readonly confidence: number;
}

/**
 * Words below this are not dropped — they are COUNTED.
 *
 * Discarding them would remove the evidence that a row is doubtful while
 * leaving the row itself, which is the worst of both: a gap in the marks and
 * nothing on screen explaining it. The threshold only decides what gets flagged
 * for a human to check.
 */
export const LOW_CONFIDENCE = 70;

/**
 * OCR words as `PositionedText`, ready for the shared row reader.
 *
 * `pageHeight` flips the axis. Without it the page reads bottom-to-top: rows
 * arrive before the heading that names their semester, and a card that plainly
 * says "Semester : 4" parses as a card with no semester at all.
 */
export function wordsToPositioned(words: readonly OcrWord[], pageHeight: number): PositionedText[] {
  return words
    .filter((word) => word.text.trim() !== '')
    .map((word) => ({
      text: word.text,
      x: word.bbox.x0,
      /*
       * Image y grows downward; the row reader expects PDF user space, where it
       * grows upward. Subtracting from the page height converts one to the
       * other and keeps the arithmetic in one place.
       */
      y: pageHeight - word.bbox.y1,
      width: Math.max(0, word.bbox.x1 - word.bbox.x0),
      height: Math.max(1, word.bbox.y1 - word.bbox.y0),
    }));
}

export interface OcrPageResult {
  readonly lines: readonly ImportLine[];
  /** Mean per-word confidence, 0-100. Null when the page produced no words. */
  readonly meanConfidence: number | null;
  readonly wordCount: number;
  readonly lowConfidenceWords: number;
}

/**
 * One OCR'd page, as lines the result parser can read.
 *
 * Returns the confidence summary alongside, because the review screen has to be
 * able to say "this came from OCR and N words were doubtful" — which is a
 * different statement from "this is N% accurate", and the only one the data
 * supports.
 */
export function ocrPageToLines(
  words: readonly OcrWord[],
  pageHeight: number,
  page = 1,
): OcrPageResult {
  const usable = words.filter((word) => word.text.trim() !== '');
  const lines = itemsToLines(wordsToPositioned(usable, pageHeight), page);

  const total = usable.reduce((sum, word) => sum + word.confidence, 0);

  return {
    lines,
    meanConfidence: usable.length === 0 ? null : total / usable.length,
    wordCount: usable.length,
    lowConfidenceWords: usable.filter((word) => word.confidence < LOW_CONFIDENCE).length,
  };
}

/**
 * Whether a page produced enough to be worth showing at all.
 *
 * A photograph of a wall, or a card too blurred to read, yields a handful of
 * junk words. Presenting those as a result to review manufactures rows a
 * student then has to disprove — worse than saying plainly that the document
 * could not be read and offering manual entry (§37, §38).
 */
export function isWorthReviewing(result: OcrPageResult): boolean {
  return result.wordCount >= 20 && (result.meanConfidence ?? 0) >= 40;
}
