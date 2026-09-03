/**
 * Turning OCR word boxes into the rows a result parser can read.
 *
 * Authority: docs/22 §22.51 · M10A.6B §12, §13, §37
 *
 * ---------------------------------------------------------------------------
 * THE BUG THIS FILE EXISTS TO PREVENT
 * ---------------------------------------------------------------------------
 *
 * A PDF places text in user space, where larger y is HIGHER on the page. An
 * image numbers rows downward, so larger y is LOWER. Hand image coordinates to
 * a reader that assumes the first convention and the page comes out upside
 * down — the subject rows arrive BEFORE the "Semester : 4" line that gives them
 * their semester, and a card that plainly states its semester parses as one
 * with none.
 *
 * That failure produces a plausible-looking screen. Nothing crashes; the
 * student is simply asked which semester their clearly-labelled card is for.
 *
 * Every value here is synthetic.
 */

import { describe, expect, it } from 'vitest';
import {
  isWorthReviewing,
  LOW_CONFIDENCE,
  ocrPageToLines,
  wordsToPositioned,
  type OcrWord,
} from '../src/domain/ocr-layout.js';
import { parseResultCard } from '../src/domain/result-import.js';

/** A word at an image-space box. `top` is distance from the TOP of the page. */
function word(text: string, x: number, top: number, confidence = 95, width = text.length * 8) {
  return {
    text,
    bbox: { x0: x, y0: top, x1: x + width, y1: top + 12 },
    confidence,
  };
}

const PAGE_HEIGHT = 1000;

describe('image coordinates become page coordinates', () => {
  it('flips the axis so the page reads top to bottom', () => {
    /*
     * THE WHOLE POINT. `Semester : 4` is printed ABOVE the rows, so in image
     * space it has the SMALLER top. After the flip it must come first.
     */
    const words = [word('BQAS401', 60, 400), word('Semester', 60, 200), word(': 4', 140, 200)];
    const lines = ocrPageToLines(words, PAGE_HEIGHT).lines;
    expect(lines.map((line) => line.text)).toEqual(['Semester : 4', 'BQAS401']);
  });

  it('would read the card upside down without the flip', () => {
    /*
     * Guarding the guard. "No flip" means taking the image's own y as the page
     * y — which is what happens if OCR boxes are handed straight to a reader
     * built for PDF user space. Sorted the way that reader sorts (larger y
     * first), the LOWEST row on the page comes out on top.
     */
    const words = [word('BQAS401', 60, 400), word('Semester : 4', 60, 200)];

    const flipped = ocrPageToLines(words, PAGE_HEIGHT).lines.map((line) => line.text);
    const unflipped = [...words]
      .sort((a, b) => b.bbox.y0 - a.bbox.y0)
      .map((candidate) => candidate.text);

    expect(flipped[0]).toBe('Semester : 4');
    expect(unflipped[0]).toBe('BQAS401');
  });

  it('keeps a word box as a width and a height, never negative', () => {
    const positioned = wordsToPositioned([word('BQAS401', 60, 400, 95, 56)], PAGE_HEIGHT);
    expect(positioned[0]?.width).toBe(56);
    expect(positioned[0]?.height).toBe(12);
    expect(positioned[0]?.x).toBe(60);
  });

  it('drops blank words rather than letting them vote on row membership', () => {
    const words = [word(' ', 10, 400), word('', 20, 400), word('BQAS401', 60, 400)];
    expect(ocrPageToLines(words, PAGE_HEIGHT).lines).toEqual([{ text: 'BQAS401', page: 1 }]);
  });
});

describe('rows from OCR words', () => {
  it('rebuilds a table row from words scattered across it', () => {
    /*
     * OCR returns words, not rows, and in no dependable order. The row exists
     * because the boxes say so — the same rule the PDF path uses, which is why
     * there is one implementation rather than two.
     */
    const words = [
      word('80', 420, 400),
      word('BQAS401', 60, 400),
      word('P', 470, 400),
      word('ALGORITHMS', 150, 400),
      word('44', 320, 400),
      word('36', 370, 400),
    ];
    expect(ocrPageToLines(words, PAGE_HEIGHT).lines[0]?.text).toBe('BQAS401 ALGORITHMS 44 36 80 P');
  });

  it('produces lines the result parser reads as a card', () => {
    // End to end for this module: OCR boxes in, a parsed result card out.
    const row = (top: number, code: string, internal: string, external: string, total: string) => [
      word(code, 60, top),
      word('SUBJECT', 150, top),
      word(internal, 320, top),
      word(external, 370, top),
      word(total, 420, top),
      word('P', 470, top),
    ];

    const words: OcrWord[] = [
      word('VISVESVARAYA', 60, 100),
      word('TECHNOLOGICAL', 200, 100),
      word('UNIVERSITY,', 380, 100),
      word('BELAGAVI', 520, 100),
      word('University', 60, 140),
      word('Seat', 160, 140),
      word('Number', 220, 140),
      word(':', 300, 140),
      word('9ZZ99ZZ999', 320, 140),
      word('Internal', 320, 170),
      word('Marks', 400, 170),
      word('Semester', 60, 200),
      word(':', 150, 200),
      word('4', 170, 200),
      ...row(400, 'BQAS401', '44', '36', '80'),
      ...row(430, 'BQAS402', '40', '19', '59'),
    ];

    const card = parseResultCard(ocrPageToLines(words, PAGE_HEIGHT).lines);
    expect(card.looksLikeResultCard).toBe(true);
    expect(card.semester).toBe(4);
    expect(card.rows.map((r) => [r.subjectCode, r.internal, r.external, r.total])).toEqual([
      ['BQAS401', 44, 36, 80],
      ['BQAS402', 40, 19, 59],
    ]);
  });

  it('keeps a descender from splitting a row in two', () => {
    /*
     * THE BUG THAT COST A WHOLE CARD.
     *
     * These boxes are the ones a real recogniser returned for one line of a
     * synthetic card. `BQAS401` reaches from 227 to 254 because of the Q's
     * tail; `ALGORITHMS`, printed on the same line, from 231 to 245. Keyed on
     * the BOTTOM edge those are nine pixels apart — more than the row tolerance
     * — so the row split, the subject code was separated from its marks, and a
     * perfectly recognised card parsed as zero subjects.
     *
     * Keyed on the CENTRE they are two and a half pixels apart.
     */
    const box = (text: string, x0: number, x1: number, y0: number, y1: number): OcrWord => ({
      text,
      bbox: { x0, y0, x1, y1 },
      confidence: 92,
    });

    const observed = [
      box('BQAS401', 61, 141, 227, 254),
      box('ALGORITHMS', 210, 335, 231, 245),
      box('44', 560, 580, 227, 254),
      box('36', 661, 680, 231, 245),
      box('80', 761, 780, 231, 245),
      box('P', 851, 862, 231, 245),
    ];

    const lines = ocrPageToLines(observed, PAGE_HEIGHT).lines;
    expect(lines).toHaveLength(1);
    expect(lines[0]?.text).toBe('BQAS401 ALGORITHMS 44 36 80 P');

    // And the row still parses as a subject, which is the point of the row.
    const card = parseResultCard([{ text: 'Semester : 4', page: 1 }, ...lines]);
    expect(card.rows.map((row) => [row.subjectCode, row.internal, row.external, row.total])).toEqual(
      [['BQAS401', 44, 36, 80]],
    );
  });

  it('carries the page number through', () => {
    expect(ocrPageToLines([word('BQAS401', 60, 400)], PAGE_HEIGHT, 3).lines[0]?.page).toBe(3);
  });
});

describe('confidence is reported, never acted on', () => {
  it('summarises per-word confidence without discarding anything', () => {
    /*
     * A low-confidence word is COUNTED, not dropped. Dropping it would remove
     * the evidence that a row is doubtful while leaving the row — a gap in the
     * marks with nothing on screen explaining it.
     */
    const words = [word('BQAS401', 60, 400, 96), word('4A', 320, 400, 42)];
    const result = ocrPageToLines(words, PAGE_HEIGHT);

    expect(result.wordCount).toBe(2);
    expect(result.lowConfidenceWords).toBe(1);
    expect(result.meanConfidence).toBeCloseTo(69, 5);
    // The doubtful word is still in the line, for a person to check.
    expect(result.lines[0]?.text).toContain('4A');
  });

  it('reports no confidence at all for a page that produced no words', () => {
    const result = ocrPageToLines([], PAGE_HEIGHT);
    expect(result.meanConfidence).toBeNull();
    expect(result.wordCount).toBe(0);
  });

  it('counts a word exactly at the threshold as confident', () => {
    const at = ocrPageToLines([word('BQAS401', 60, 400, LOW_CONFIDENCE)], PAGE_HEIGHT);
    expect(at.lowConfidenceWords).toBe(0);
  });
});

describe('whether a page is worth showing at all', () => {
  it('refuses a handful of junk words rather than inventing rows', () => {
    /*
     * A photograph of a wall. Presenting its output as a result to review
     * manufactures rows the student then has to disprove — worse than saying
     * the document could not be read and offering manual entry (§37).
     */
    const junk = [word('sdf', 10, 10, 20), word('##', 40, 30, 15)];
    expect(isWorthReviewing(ocrPageToLines(junk, PAGE_HEIGHT))).toBe(false);
  });

  it('refuses a page of many words that are all doubtful', () => {
    const blurred = Array.from({ length: 40 }, (_, i) => word(`w${String(i)}`, 10, i * 20, 25));
    expect(isWorthReviewing(ocrPageToLines(blurred, PAGE_HEIGHT))).toBe(false);
  });

  it('accepts a page with enough confident words', () => {
    const good = Array.from({ length: 40 }, (_, i) => word(`w${String(i)}`, 10, i * 20, 88));
    expect(isWorthReviewing(ocrPageToLines(good, PAGE_HEIGHT))).toBe(true);
  });
});
