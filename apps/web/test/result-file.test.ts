/**
 * Which reader a dropped file gets, and what the reading says about itself.
 *
 * Authority: docs/22 §22.53 · M10A.6B §11, §15, §16, §17, §37
 *
 * ---------------------------------------------------------------------------
 * THE DECISION THIS FILE GUARDS
 * ---------------------------------------------------------------------------
 *
 * A PDF that carries a text layer already holds the exact characters the
 * university printed. Rendering it to a picture and recognising that picture
 * would swap certainty for a guess — silently, and with plausible-looking
 * output. So OCR must be reached ONLY when extraction comes back with nothing,
 * and a regression in that order would cost accuracy nobody would notice.
 *
 * The engine itself is stubbed. What Tesseract does with a bitmap is not the
 * question here, and jsdom has no canvas to give it.
 *
 * Every value is synthetic.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ImportLine } from '../src/domain/result-import.js';
import type { OcrPageResult } from '../src/domain/ocr-layout.js';

const state = {
  lines: [] as ImportLine[],
  hasTextLayer: true,
  pageCount: 1,
  rendered: [] as number[],
};

const { PdfReadError } = vi.hoisted(() => ({ PdfReadError: class PdfReadError extends Error {} }));
const { OcrError } = vi.hoisted(() => ({ OcrError: class OcrError extends Error {} }));

vi.mock('../src/lib/pdf-text.js', () => ({
  PdfReadError,
  MAX_FILE_BYTES: 10 * 1024 * 1024,
  extractPdfLines: vi.fn(() =>
    Promise.resolve({
      lines: state.lines,
      pageCount: state.pageCount,
      hasTextLayer: state.hasTextLayer,
    }),
  ),
  renderPdfPage: vi.fn((_data: ArrayBuffer, page: number) => {
    state.rendered.push(page);
    return Promise.resolve({ width: 800, height: 1000 } as unknown as HTMLCanvasElement);
  }),
}));

vi.mock('../src/lib/ocr.js', () => ({
  OcrError,
  decodeImage: vi.fn(() =>
    Promise.resolve({
      canvas: { width: 800, height: 1000 },
      width: 800,
      height: 1000,
      sourceWidth: 1600,
      sourceHeight: 2000,
    }),
  ),
  normalizeContrast: vi.fn(),
}));

const { fileKind, readImageFile, readPdfFile, MAX_OCR_PAGES } = await import(
  '../src/lib/result-file.js'
);

/** An OCR page result, as the engine would report one. */
function page(
  lines: readonly string[],
  { confidence = 90, words = 60, doubtful = 0 } = {},
): OcrPageResult {
  return {
    lines: lines.map((text) => ({ text, page: 1 })),
    meanConfidence: confidence,
    wordCount: words,
    lowConfidenceWords: doubtful,
  };
}

const CARD = [
  'VISVESVARAYA TECHNOLOGICAL UNIVERSITY, BELAGAVI',
  'Semester : 4',
  'BQAS401  ALGORITHMS  44  36  80  P',
];

const recognizer = (result: OcrPageResult) => vi.fn(() => Promise.resolve(result));

beforeEach(() => {
  state.lines = [];
  state.hasTextLayer = true;
  state.pageCount = 1;
  state.rendered = [];
});

describe('choosing a reader', () => {
  it('takes the declared type first', () => {
    expect(fileKind(new File([''], 'a.pdf', { type: 'application/pdf' }))).toBe('pdf');
    expect(fileKind(new File([''], 'a.jpg', { type: 'image/jpeg' }))).toBe('image');
    expect(fileKind(new File([''], 'a.png', { type: 'image/png' }))).toBe('image');
  });

  it('falls back to the extension when a picker gives no type', () => {
    /*
     * Some Android pickers hand over an empty type. The extension chooses a
     * DECODER and nothing else — what the file actually contains is settled by
     * the decoder, which fails honestly on a mislabelled file.
     */
    expect(fileKind(new File([''], 'card.JPEG', { type: '' }))).toBe('image');
    expect(fileKind(new File([''], 'card.pdf', { type: '' }))).toBe('pdf');
    expect(fileKind(new File([''], 'notes.txt', { type: '' }))).toBe('unsupported');
  });

  it('refuses anything else rather than guessing', () => {
    const doc = new File([''], 'marks.docx', { type: 'application/msword' });
    expect(fileKind(doc)).toBe('unsupported');
  });
});

describe('a PDF that has its own text', () => {
  it('is never recognised, however available the engine is', async () => {
    /*
     * THE POINT OF THE FILE. Extraction yields the printed characters; OCR
     * yields a reading of a picture of them. Preferring the second would lose
     * accuracy invisibly.
     */
    state.lines = CARD.map((text) => ({ text, page: 1 }));
    const recognize = recognizer(page(['nonsense']));

    const reading = await readPdfFile(new ArrayBuffer(8), recognize);

    expect(reading.source).toBe('text');
    expect(reading.lines.map((line) => line.text)).toEqual(CARD);
    expect(recognize).not.toHaveBeenCalled();
    expect(state.rendered).toEqual([]);
  });

  it('reports no confidence, because confidence is an OCR idea', async () => {
    state.lines = CARD.map((text) => ({ text, page: 1 }));
    const reading = await readPdfFile(new ArrayBuffer(8), null);
    expect(reading.meanConfidence).toBeNull();
    expect(reading.lowConfidenceWords).toBe(0);
  });
});

describe('a PDF that is a scan', () => {
  it('is rendered and recognised, page by page', async () => {
    state.hasTextLayer = false;
    state.pageCount = 2;
    const recognize = recognizer(page(CARD));

    const reading = await readPdfFile(new ArrayBuffer(8), recognize);

    expect(state.rendered).toEqual([1, 2]);
    expect(recognize).toHaveBeenCalledTimes(2);
    expect(reading.source).toBe('ocr');
    expect(reading.pageCount).toBe(2);
  });

  it('says so plainly when there is no recogniser to hand', async () => {
    /*
     * A device that cannot run OCR gets a sentence it can act on, not an empty
     * result that reads like a parse failure.
     */
    state.hasTextLayer = false;
    await expect(readPdfFile(new ArrayBuffer(8), null)).rejects.toThrow(/no selectable text/i);
  });

  it('refuses a scan longer than a result card could be', async () => {
    /*
     * Recognition costs seconds per page on a phone. Grinding through twenty
     * pages would look like a hang, and twenty pages is not a result card.
     */
    state.hasTextLayer = false;
    state.pageCount = MAX_OCR_PAGES + 1;
    const recognize = recognizer(page(CARD));

    await expect(readPdfFile(new ArrayBuffer(8), recognize)).rejects.toThrow(/scanned pages/i);
    expect(recognize).not.toHaveBeenCalled();
  });

  it('refuses a scan that produced nothing worth reviewing', async () => {
    /*
     * A photograph of a wall, or a card too blurred to read. Presenting its
     * output as a result manufactures rows a student then has to disprove.
     */
    state.hasTextLayer = false;
    const recognize = recognizer(page(['sdf'], { confidence: 20, words: 3 }));

    await expect(readPdfFile(new ArrayBuffer(8), recognize)).rejects.toThrow(/could not be made/i);
  });
});

describe('a photograph', () => {
  it('is recognised, and says it was', async () => {
    const recognize = recognizer(page(CARD, { doubtful: 3 }));
    const reading = await readImageFile(
      new File([''], 'card.jpg', { type: 'image/jpeg' }),
      recognize,
    );

    expect(reading.source).toBe('ocr');
    expect(reading.lines.map((line) => line.text)).toEqual(CARD);
    expect(reading.lowConfidenceWords).toBe(3);
  });

  it('is refused when it yields only junk', async () => {
    const recognize = recognizer(page(['##', 'sdf'], { confidence: 18, words: 4 }));
    await expect(
      readImageFile(new File([''], 'wall.jpg', { type: 'image/jpeg' }), recognize),
    ).rejects.toThrow(/could not be made/i);
  });
});

describe('the confidence summary', () => {
  it('weights pages by how much text they held', async () => {
    /*
     * A page with three words must not drag the mean about as much as a full
     * one. The number is a REASON TO LOOK; an unweighted average would make it
     * a misleading one.
     */
    state.hasTextLayer = false;
    state.pageCount = 2;
    const results = [
      page(CARD, { confidence: 90, words: 90, doubtful: 1 }),
      page(['x'], { confidence: 30, words: 10, doubtful: 4 }),
    ];
    let call = 0;
    const recognize = vi.fn(() => Promise.resolve(results[call++] as OcrPageResult));

    const reading = await readPdfFile(new ArrayBuffer(8), recognize);

    // (90*90 + 30*10) / 100
    expect(reading.meanConfidence).toBeCloseTo(84, 5);
    expect(reading.lowConfidenceWords).toBe(5);
  });
});
