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
 *
 * ---------------------------------------------------------------------------
 * A ROW IS KEYED ON THE MIDDLE OF A WORD, NOT ITS BOTTOM
 * ---------------------------------------------------------------------------
 *
 * A PDF positions text on its BASELINE, which every word on a line shares
 * exactly. OCR reports the box around the INK, which no two words share: a word
 * with a descender reaches lower than one without.
 *
 * On a real recognised card `BQAS401` came back as (227, 254) and `ALGORITHMS`,
 * printed on the same line, as (231, 245) — the Q's tail putting nine pixels
 * between their bottom edges, more than the row tolerance allows. The row split
 * in two, the subject code was separated from its marks, and a perfectly
 * recognised card parsed as zero subjects.
 *
 * The vertical CENTRE moves by half a descender instead of a whole one, and
 * moves the same way for every word on the line. Two and a half pixels of
 * spread against a forty-pixel line pitch is the difference between a table and
 * a pile of words.
 */
export function wordsToPositioned(words: readonly OcrWord[], pageHeight: number): PositionedText[] {
  const usable = words.filter((word) => word.text.trim() !== '');
  const angle = skewOf(usable);
  const cos = Math.cos(-angle);
  const sin = Math.sin(-angle);
  const pivotX = Math.max(0, ...usable.map((word) => word.bbox.x1)) / 2;
  const pivotY = pageHeight / 2;

  return usable.map((word) => {
    const width = Math.max(0, word.bbox.x1 - word.bbox.x0);
    const height = Math.max(1, word.bbox.y1 - word.bbox.y0);
    /* The word's centre, turned back by the page's skew (a no-op when it has none). */
    const cx = (word.bbox.x0 + word.bbox.x1) / 2 - pivotX;
    const cy = (word.bbox.y0 + word.bbox.y1) / 2 - pivotY;
    const x = cx * cos - cy * sin + pivotX;
    const y = cx * sin + cy * cos + pivotY;
    return {
      text: word.text,
      x: x - width / 2,
      /*
       * Image y grows downward; the row reader expects PDF user space, where it
       * grows upward. Subtracting from the page height converts one to the
       * other and keeps the arithmetic in one place.
       */
      y: pageHeight - y,
      width,
      height,
    };
  });
}

/**
 * How far a photographed page is turned, in radians, from its own words.
 *
 * MEASURED: a real result card photographed 1.5° off level lost EVERY row. At
 * that angle one printed row drifts ~50px down a 2000px-wide page, several
 * times the row tolerance, so the code, the title and the marks landed on
 * different "lines" and not one of them parsed. The engine read the words
 * fine; the geometry was what broke.
 *
 * So the angle is taken from the words themselves: each word and its nearest
 * neighbour to the right on the same line, of about the same height, give a
 * slope, and the MEDIAN slope is the page's. Deterministic, no second recognition pass, no image work.
 * Nothing is turned below 0.2° (straight pages stay byte-for-byte as they
 * were), above 10° (that is a rotated page, not a skewed one), or on fewer than
 * eight pairs (too little evidence).
 */
export function skewOf(words: readonly OcrWord[]): number {
  const angles: number[] = [];
  for (const word of words) {
    const height = word.bbox.y1 - word.bbox.y0;
    const cy = (word.bbox.y0 + word.bbox.y1) / 2;
    let best: OcrWord | null = null;
    for (const other of words) {
      const gap = other.bbox.x0 - word.bbox.x1;
      if (gap < 0 || gap > height * 12) continue;
      if (Math.abs((other.bbox.y0 + other.bbox.y1) / 2 - cy) > height) continue;
      /*
       * Only words of about the same ink height. OCR boxes the INK, so a code
       * with a descender beside a word without one differs in centre by a few
       * pixels on a perfectly level line — which would read as a false slope.
       */
      if (Math.abs(other.bbox.y1 - other.bbox.y0 - height) > height * 0.2) continue;
      if (best === null || other.bbox.x0 < best.bbox.x0) best = other;
    }
    if (best === null) continue;
    const dx = (best.bbox.x0 + best.bbox.x1) / 2 - (word.bbox.x0 + word.bbox.x1) / 2;
    const dy = (best.bbox.y0 + best.bbox.y1) / 2 - cy;
    if (dx > 0) angles.push(Math.atan2(dy, dx));
  }
  if (angles.length < 8) return 0;
  angles.sort((a, b) => a - b);
  const median = angles[Math.floor(angles.length / 2)] as number;
  const degrees = Math.abs((median * 180) / Math.PI);
  return degrees < 0.2 || degrees > 10 ? 0 : median;
}

export interface OcrPageResult {
  readonly lines: readonly ImportLine[];
  /** The same words, still positioned, for documents that are grids (M10A.8). */
  readonly placed: readonly PositionedText[];
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
  const positioned = wordsToPositioned(usable, pageHeight);
  const lines = itemsToLines(positioned, page);

  const total = usable.reduce((sum, word) => sum + word.confidence, 0);

  return {
    lines,
    placed: positioned,
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
