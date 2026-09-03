/**
 * One dropped file, as lines a result parser can read.
 *
 * Authority: docs/12 §12.x · M10A.6B §11, §15, §16, §17, §37
 *
 * ---------------------------------------------------------------------------
 * TEXT IS PREFERRED OVER RECOGNITION, ALWAYS
 * ---------------------------------------------------------------------------
 *
 * A PDF with a text layer already contains the exact characters the university
 * printed. Rendering it to a picture and recognising that picture would swap
 * certainty for a guess, so OCR is reached ONLY when extraction comes back with
 * no text at all — a scan, or a photo saved as a PDF (§15).
 *
 * ---------------------------------------------------------------------------
 * WHERE A READING CAME FROM TRAVELS WITH IT
 * ---------------------------------------------------------------------------
 *
 * The review screen has to be able to say "these figures were recognised from a
 * picture" rather than presenting them the way it presents extracted text. The
 * two are not equally reliable and the screen must not imply that they are, so
 * `source` and the confidence summary are part of the result rather than
 * something the caller infers (§13, §42).
 *
 * Confidence is a REASON TO LOOK, never a claim of accuracy. A confidently
 * misread digit is exactly as wrong as an unconfident one.
 */

import { isWorthReviewing, type OcrPageResult } from '../domain/ocr-layout.js';
import type { ImportLine } from '../domain/result-import.js';
import { decodeImage, normalizeContrast, OcrError } from './ocr.js';
import { extractPdfLines, renderPdfPage, PdfReadError } from './pdf-text.js';

/** How the lines were obtained. Shown to the student, not just logged. */
export type ReadSource = 'text' | 'ocr';

export interface FileReading {
  readonly lines: readonly ImportLine[];
  readonly source: ReadSource;
  readonly pageCount: number;
  /** OCR only, and null when nothing was recognised. Never shown as accuracy. */
  readonly meanConfidence: number | null;
  readonly lowConfidenceWords: number;
}

/**
 * Recognises one canvas. Supplied by the caller, which owns the worker.
 *
 * Injected rather than imported so the engine is started ONCE for a batch and
 * torn down when the batch ends — and so this module can be tested without one.
 */
export type Recognize = (canvas: HTMLCanvasElement, page: number) => Promise<OcrPageResult>;

/**
 * A scan is at most this many pages before OCR is refused.
 *
 * Recognition costs seconds per page on a phone. A twenty-page scan is not a
 * result card, and grinding through it would look like a hang (§16, §44).
 */
export const MAX_OCR_PAGES = 4;

/** What kind of file this is, by type first and extension second. */
export function fileKind(file: File): 'pdf' | 'image' | 'unsupported' {
  const type = file.type.toLowerCase();
  if (type === 'application/pdf') return 'pdf';
  if (type === 'image/jpeg' || type === 'image/png' || type === 'image/webp') return 'image';

  /*
   * Some Android file pickers hand over an empty type. The extension is a weak
   * signal, so it is used only to CHOOSE A DECODER — never as evidence about
   * the contents, which the decoder itself establishes.
   */
  if (type === '') {
    const name = file.name.toLowerCase();
    if (name.endsWith('.pdf')) return 'pdf';
    if (/\.(jpe?g|png|webp)$/.test(name)) return 'image';
  }
  return 'unsupported';
}

/** The message shown when a page produced too little to be worth reviewing. */
const UNREADABLE =
  'The text on this could not be made out. A sharper, straighter photo in better light may work — or enter this result by hand.';

function summarise(
  pages: readonly OcrPageResult[],
  pageCount: number,
): FileReading {
  const words = pages.reduce((sum, page) => sum + page.wordCount, 0);
  const weighted = pages.reduce(
    (sum, page) => sum + (page.meanConfidence ?? 0) * page.wordCount,
    0,
  );

  return {
    lines: pages.flatMap((page) => page.lines),
    source: 'ocr',
    pageCount,
    // Weighted by word count: a page with three words must not drag the mean
    // about as much as a full one.
    meanConfidence: words === 0 ? null : weighted / words,
    lowConfidenceWords: pages.reduce((sum, page) => sum + page.lowConfidenceWords, 0),
  };
}

/**
 * A photograph or screenshot of a result card.
 *
 * Decoded upright, greyed and contrast-stretched, then recognised. Refused
 * rather than half-read when the page yields too little: a handful of junk
 * words presented as a result manufactures rows the student has to disprove.
 */
export async function readImageFile(file: File, recognize: Recognize): Promise<FileReading> {
  const image = await decodeImage(file);
  normalizeContrast(image.canvas);

  const page = await recognize(image.canvas, 1);
  if (!isWorthReviewing(page)) throw new OcrError(UNREADABLE);

  return summarise([page], 1);
}

/**
 * A PDF: its own text where it has some, recognition of its pages where it does
 * not.
 *
 * `recognize` may be null, which is the honest answer for a scan when no engine
 * is available — the caller is told the file needs OCR rather than handed an
 * empty result that reads as a parse failure.
 */
export async function readPdfFile(
  data: ArrayBuffer,
  recognize: Recognize | null,
): Promise<FileReading> {
  /*
   * A COPY PER READ. pdf.js transfers the array it is given to its worker,
   * which DETACHES the buffer — so a document read once for its text and then
   * rendered for OCR would find an empty buffer the second time, and report a
   * scan as unreadable. One copy of a few hundred kilobytes is the cheap side
   * of that trade.
   */
  const extraction = await extractPdfLines(data.slice(0));
  if (extraction.hasTextLayer) {
    return {
      lines: extraction.lines,
      source: 'text',
      pageCount: extraction.pageCount,
      meanConfidence: null,
      lowConfidenceWords: 0,
    };
  }

  if (recognize === null) {
    throw new PdfReadError(
      'This PDF has no selectable text, so it is a scan or a photo, and text recognition is not available here. Enter this result by hand.',
    );
  }

  if (extraction.pageCount > MAX_OCR_PAGES) {
    throw new PdfReadError(
      `This scan is ${String(extraction.pageCount)} pages. GradTools reads up to ${String(MAX_OCR_PAGES)} scanned pages — split out the result card, or enter it by hand.`,
    );
  }

  /*
   * ONE PAGE AT A TIME, rendered and recognised before the next is rendered. A
   * canvas at this size is several megabytes, and holding four of them open on
   * a phone to save a little wall-clock time is the trade that gets the tab
   * killed instead (§16).
   */
  const pages: OcrPageResult[] = [];
  for (let number = 1; number <= extraction.pageCount; number += 1) {
    const canvas = await renderPdfPage(data.slice(0), number);
    normalizeContrast(canvas);
    pages.push(await recognize(canvas, number));
    // Releasing the backing store now, rather than waiting for the collector to
    // notice, is what keeps peak memory at one page instead of all of them.
    canvas.width = 0;
    canvas.height = 0;
  }

  if (!pages.some(isWorthReviewing)) throw new OcrError(UNREADABLE);
  return summarise(pages, extraction.pageCount);
}
