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
import { parseResultCard, type ImportLine } from '../domain/result-import.js';
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

/**
 * How many subject rows a reading actually yields.
 *
 * ---------------------------------------------------------------------------
 * WHY THE PIPELINE READS A PICTURE TWICE
 * ---------------------------------------------------------------------------
 *
 * Preprocessing is not a setting that can be chosen in advance. Measured on two
 * genuine VTU result cards:
 *
 *   A phone screenshot of a print preview — dim, small — went from 53 words
 *   raw to 187 with the contrast stretch, and from one readable row to seven.
 *   Without the stretch it is unusable.
 *
 *   A sharper screenshot carrying the university's diagonal watermark went the
 *   OTHER WAY: raw, all nine rows read with their marks; stretched, the marks
 *   vanished from six of them, because darkening the mid-tones brings the
 *   watermark up to compete with thin digits.
 *
 * No statistic of the image separates those two cases — the one that NEEDS the
 * stretch has the wider dynamic range of the pair. So the choice is not
 * predicted, it is MADE BY MEASUREMENT: recognise both, keep whichever yields
 * more readable subject rows.
 *
 * The second pass is skipped whenever the first leaves nothing on the table, so
 * a clean document pays for one. The score is "rows a student could actually
 * import", not confidence — confidence rose on the stretched watermarked card
 * while the marks disappeared.
 */
function readableRows(lines: readonly ImportLine[]): number {
  return parseResultCard(lines).rows.length;
}

/** Rows the parser could see were rows but could not read. */
function droppedRows(lines: readonly ImportLine[]): number {
  return parseResultCard(lines).unreadableRows.length;
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
  const page = await recognizeBothWays(image.canvas, 1, recognize);
  if (!isWorthReviewing(page)) throw new OcrError(UNREADABLE);

  return summarise([page], 1);
}

/**
 * Recognises a canvas stretched, and again unstretched if that left rows behind.
 *
 * The canvas is MUTATED by the stretch, so the original pixels are kept aside
 * first — re-deriving them by inverting the stretch is not possible once values
 * have clamped, and re-decoding the file costs more than a copy.
 */
async function recognizeBothWays(
  canvas: HTMLCanvasElement,
  page: number,
  recognize: Recognize,
): Promise<OcrPageResult> {
  const context =
    typeof canvas.getContext === 'function'
      ? canvas.getContext('2d', { willReadFrequently: true })
      : null;
  const original = context?.getImageData(0, 0, canvas.width, canvas.height) ?? null;

  normalizeContrast(canvas);
  const stretched = await recognize(canvas, page);

  /*
   * A first pass that read every row it could see has nothing to gain from a
   * second, and a second costs a student seconds on a phone. The retry fires
   * only where the parser can SEE it lost something — a line shaped like a
   * subject row that would not parse — or where it found no rows at all.
   */
  const dropped = droppedRows(stretched.lines);
  const rows = readableRows(stretched.lines);
  if (original === null || (dropped === 0 && rows > 0)) return stretched;

  context?.putImageData(original, 0, 0);
  const raw = await recognize(canvas, page);

  return betterReading(stretched, raw);
}

/**
 * Which of two readings of the same page to keep.
 *
 * MORE READABLE ROWS WINS, because that is what the student can actually
 * import. On a tie, fewer rows the parser saw and could not read; then more
 * words.
 *
 * Confidence is deliberately absent from this decision. On a real watermarked
 * card the stretched pass was the MORE confident of the two and its marks had
 * vanished — a page can be confidently sure of a heading while losing every
 * digit under a watermark.
 *
 * Ties go to `first`, which is the stretched pass: it is the one that helps the
 * dim phone screenshots, and preferring it keeps the choice stable when neither
 * reading is better.
 */
export function betterReading(first: OcrPageResult, second: OcrPageResult): OcrPageResult {
  const rows = [readableRows(first.lines), readableRows(second.lines)];
  if (rows[0] !== rows[1]) return (rows[1] as number) > (rows[0] as number) ? second : first;

  const dropped = [droppedRows(first.lines), droppedRows(second.lines)];
  if (dropped[0] !== dropped[1])
    return (dropped[1] as number) < (dropped[0] as number) ? second : first;

  return second.wordCount > first.wordCount ? second : first;
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
    pages.push(await recognizeBothWays(canvas, number, recognize));
    // Releasing the backing store now, rather than waiting for the collector to
    // notice, is what keeps peak memory at one page instead of all of them.
    canvas.width = 0;
    canvas.height = 0;
  }

  if (!pages.some(isWorthReviewing)) throw new OcrError(UNREADABLE);
  return summarise(pages, extraction.pageCount);
}
