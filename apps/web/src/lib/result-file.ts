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
import { classifyDocument } from '../domain/document-type.js';
import { parseTimetable } from '../domain/timetable-import.js';
import { decodeImage, normalizeContrast, OcrError, turnCanvas, UPSCALE_TO } from './ocr.js';
import { extractPdfLines, renderPdfPage, PdfReadError, type PlacedText } from './pdf-text.js';
import { PDF_READ_MS, withDeadline } from './deadline.js';

/** pdf.js runs in a worker; one that dies silently must not hang the import. */
const pdfTimedOut = (): Error =>
  new PdfReadError(
    'Reading this PDF took too long on this device. Try again, or try another copy of the document.',
  );

/** How the lines were obtained. Shown to the student, not just logged. */
export type ReadSource = 'text' | 'ocr';

/**
 * Where a reading came from, kept for the record — never presented as a claim of
 * academic correctness. A parser extracting text cleanly says nothing about
 * whether the marks it read are the marks the university awarded.
 */
export interface ReadProvenance {
  /** The extraction engine, e.g. `officeparser`, `pdfjs`, `tesseract`, `builtin`. */
  readonly engine: string;
  readonly engineVersion: string;
  /** The source format as a short label, e.g. `docx`, `pdf`, `csv`. */
  readonly format: string;
  /** How the text was obtained, e.g. `text-extraction`, `ocr`, `text`. */
  readonly mode: string;
}

export interface FileReading {
  readonly lines: readonly ImportLine[];
  /**
   * The same text, still positioned.
   *
   * Lines answer "what does this row say"; a timetable needs "which column is
   * this in" as well, and joining words into lines has already discarded that
   * (M10A.8 §8).
   */
  readonly placed: readonly PlacedText[];
  readonly source: ReadSource;
  readonly pageCount: number;
  /** OCR only, and null when nothing was recognised. Never shown as accuracy. */
  readonly meanConfidence: number | null;
  readonly lowConfidenceWords: number;
  /** Where this reading came from. Optional; the PDF/image/HTML paths omit it. */
  readonly provenance?: ReadProvenance;
}

/**
 * Recognises one canvas. Supplied by the caller, which owns the worker.
 *
 * Injected rather than imported so the engine is started ONCE for a batch and
 * torn down when the batch ends — and so this module can be tested without one.
 */
export type Recognize = (
  canvas: HTMLCanvasElement,
  page: number,
  options?: { readonly sparse?: boolean },
) => Promise<OcrPageResult>;

/**
 * A scan is at most this many pages before OCR is refused.
 *
 * Recognition costs seconds per page on a phone. A twenty-page scan is not a
 * result card, and grinding through it would look like a hang (§16, §44).
 */
export const MAX_OCR_PAGES = 4;

/*
 * THE UPLOAD ALLOW-LIST: images (JPEG, PNG, WebP), PDF, Word (DOCX) and Excel
 * (XLSX). Everything else is refused as an invalid format, including HTML,
 * text exports, PowerPoint, OpenDocument, RTF and legacy binary XLS (which the
 * bundled office reader cannot open).
 */
export type FileKind = 'pdf' | 'image' | 'office' | 'unsupported';

/** The one message every refusal shows. */
export const INVALID_FORMAT_MESSAGE =
  'Invalid format. GradTools accepts images (JPG, PNG, WebP), PDF, Word (DOCX) and Excel (XLSX) files.';

/** Word and Excel, routed to officeParser, which then validates the container. */
const OFFICE_EXT = /\.(docx|xlsx)$/;
const OFFICE_MIME = new Set([
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
]);

/** What kind of file this is, by type first and extension second. */
export function fileKind(file: File): FileKind {
  const type = file.type.toLowerCase();
  if (type === 'application/pdf') return 'pdf';
  if (type === 'image/jpeg' || type === 'image/png' || type === 'image/webp') return 'image';
  if (OFFICE_MIME.has(type)) return 'office';

  /*
   * Some Android file pickers hand over an empty type. The extension is a weak
   * signal, so it is used only to CHOOSE A DECODER — never as evidence about
   * the contents, which the decoder itself establishes. For Office/ODF that
   * decoder is officeParser, which reads the magic bytes and validates the
   * container, so a mislabelled extension is caught there and refused cleanly.
   */
  const name = file.name.toLowerCase();
  if (name.endsWith('.pdf')) return 'pdf';
  if (/\.(jpe?g|png|webp)$/.test(name)) return 'image';
  if (OFFICE_EXT.test(name)) return 'office';
  return 'unsupported';
}

/**
 * What a file IS, from its first bytes — not from its name or declared type.
 *
 * A name and a MIME type are claims the file makes about itself. Android's
 * pickers routinely hand over a photo named only by a UUID, with or without a
 * type, and a renamed file can claim anything. The signature decides which
 * decoder runs; the decoder itself still refuses content it cannot parse.
 * Every accepted format has a signature, so a file with none is refused.
 */
export async function sniffKind(file: File): Promise<ReturnType<typeof fileKind>> {
  // The PDF header may sit anywhere in the first kilobyte (ISO 32000 §7.5.2).
  const head = new Uint8Array(await file.slice(0, 1024).arrayBuffer());
  const starts = (...bytes: number[]): boolean => bytes.every((byte, at) => head[at] === byte);
  const ascii = (from: number, text: string): boolean =>
    [...text].every((char, at) => head[from + at] === char.charCodeAt(0));

  if (new TextDecoder('latin1').decode(head).includes('%PDF-')) return 'pdf';
  if (starts(0xff, 0xd8, 0xff)) return 'image';
  if (starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return 'image';
  if (ascii(0, 'RIFF') && ascii(8, 'WEBP')) return 'image';
  // A ZIP is accepted only as Word or Excel: PowerPoint and OpenDocument are ZIPs
  // too, so the declared type or name must say DOCX/XLSX, and officeParser then
  // validates the real type from the bytes.
  if (starts(0x50, 0x4b, 0x03, 0x04)) return fileKind(file) === 'office' ? 'office' : 'unsupported';
  // No accepted signature matched: refused, whatever the name or type claims.
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

/**
 * Rows a student could import AS READ: a DISTINCT subject code whose marks pass
 * the internal + external = total invariant. This is the quality signal that
 * reading-selection ranks on FIRST, so a second OCR pass can never win by:
 *   - CORRUPTING a mark — a total that no longer adds up is not a sound row;
 *   - DUPLICATING a row — the same code is counted once;
 *   - manufacturing NOISE — a line without consistent marks does not count.
 * Row COUNT alone would accept all three (a flagged-wrong row is still a parsed
 * row). Marks are never invented here; an unsound row is still shown for review,
 * it just does not get to outrank a reading whose marks were already right.
 */
function soundRows(lines: readonly ImportLine[]): number {
  const codes = new Set<string>();
  for (const row of parseResultCard(lines).rows) {
    const unsound = row.warnings.some(
      (warning) =>
        warning.kind === 'total_mismatch' ||
        warning.kind === 'non_numeric_mark' ||
        warning.kind === 'ambiguous_marks',
    );
    if (!unsound) codes.add(row.subjectCode);
  }
  return codes.size;
}

/** The message shown when a page produced too little to be worth reviewing. */
const UNREADABLE =
  'The text on this could not be made out. A sharper, straighter photo in better light may work — or enter this result by hand.';

function summarise(pages: readonly OcrPageResult[], pageCount: number): FileReading {
  const words = pages.reduce((sum, page) => sum + page.wordCount, 0);
  const weighted = pages.reduce(
    (sum, page) => sum + (page.meanConfidence ?? 0) * page.wordCount,
    0,
  );

  return {
    lines: pages.flatMap((page) => page.lines),
    placed: pages.flatMap((page, index) =>
      page.placed.map((item) => ({ ...item, page: index + 1 })),
    ),
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
  let page = await recognizeBothWays(image.canvas, 1, recognize);

  /*
   * A SMALL, CRISP SCREENSHOT whose glyphs were too small to separate — words
   * merging into one token, rows the parser could not read — gets ONE retry at a
   * larger scale, and `betterReading` keeps whichever read more rows. A card
   * already read well at native size wins on row count and is never replaced, so
   * upscaling can only help: a 2.6x blow-up of an adequate card read one row and
   * produced a wrong mark, and that reading loses here. Measured on .qa/real: a
   * sem-1 screenshot went from 4 readable rows to 8, titles from 0 to 7.
   * ponytail: the retry is a second full recognition — gated on the first pass
   * being poor, so a clean card never pays for it; drop the gate only if a
   * cheaper small-glyph signal proves reliable.
   */
  const longest = Math.max(image.sourceWidth, image.sourceHeight);
  if (longest < UPSCALE_TO && (droppedRows(page.lines) > 0 || readableRows(page.lines) < 3)) {
    const bigger = await decodeImage(file, { upscaleTo: UPSCALE_TO });
    page = betterReading(page, await recognizeBothWays(bigger.canvas, 1, recognize));
  }

  /*
   * A PAGE WHOSE PIXELS LIE ON THEIR SIDE (M2.2). `decodeImage` honours EXIF
   * orientation, but a photo that is sideways IN ITS PIXELS — no tag, or a tag
   * saying "upright" — reaches the engine on its side and reads as noise. Only a
   * reading that failed (unreadable, or not recognised as a document and read
   * with low confidence) pays for the check, so an upright page never does.
   */
  if (
    !isWorthReviewing(page) ||
    (classifyDocument(page.lines).type === 'unsupported' &&
      (page.meanConfidence ?? 0) < SIDEWAYS_SUSPECT)
  ) {
    page = (await readTurned(file, page, recognize)) ?? page;
  }

  if (!isWorthReviewing(page)) throw new OcrError(UNREADABLE);
  return summarise([page], 1);
}

/** A failed reading below this mean confidence (0-100) may be a sideways page. */
const SIDEWAYS_SUSPECT = 50;
/** How much more confidently a turned page must read before it replaces the upright one. */
const SIDEWAYS_MARGIN = 15;

/**
 * The page read at the quarter turn that makes it legible, or null if none does.
 *
 * One cheap pass per turn decides: a page the right way up reads with far more
 * confidence than the same page on its side. Measured on 14 real timetable
 * photos, the four sideways ones read at 57–65 turned and 31–37 as decoded,
 * while every upright one read best as decoded. Turns are tried in the order
 * phone photos are found sideways (90° anticlockwise first), stopping at the
 * first clear winner, which then gets the full reading. A turn that does not
 * beat the upright reading by `SIDEWAYS_MARGIN` is never used, so a page that is
 * simply poor stays refused rather than being "rescued" by noise.
 *
 * The turns are drawn from a fresh decode; the canvas the caller read is not
 * reused, because the contrast stretch has already been applied to it.
 * ponytail: up to three extra probe passes on a failed reading; add Tesseract's
 * orientation detection only if its model is ever shipped.
 */
async function readTurned(
  file: File,
  upright: OcrPageResult,
  recognize: Recognize,
): Promise<OcrPageResult | null> {
  const floor = (upright.meanConfidence ?? 0) + SIDEWAYS_MARGIN;
  const decoded = await decodeImage(file);
  try {
    for (const quarterTurns of [3, 1, 2] as const) {
      const probe = turnCanvas(decoded.canvas, quarterTurns);
      if (probe === null) return null;
      normalizeContrast(probe);
      const quick = await recognize(probe, 1);
      probe.width = 0;
      if (!isWorthReviewing(quick) || (quick.meanConfidence ?? 0) < floor) continue;

      const turned = turnCanvas(decoded.canvas, quarterTurns);
      if (turned === null) return null;
      const full = await recognizeBothWays(turned, 1, recognize);
      turned.width = 0;
      return isWorthReviewing(full) ? full : null;
    }
    return null;
  } finally {
    decoded.canvas.width = 0;
  }
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

  return sparseIfGrid(canvas, page, recognize, betterReading(stretched, raw));
}

/**
 * One more reading, in sparse mode, when the document turns out to be a grid.
 *
 * MEASURED, NOT ASSUMED. On a real college timetable the engine's default page
 * segmentation returned the subject dictionary — the only place the grid's
 * initials are defined — as EMPTY, and the whole timetable therefore produced
 * no classes at all. In sparse mode the same photograph gave up seven of its
 * eight dictionary rows.
 *
 * It is not the default because it is WORSE where the default is right: on the
 * same real result cards, sparse mode dropped a nine-row card to four and
 * produced one incorrect mark. An incorrect mark is the failure this whole
 * workflow exists to prevent.
 *
 * So the extra pass is gated on the document actually being a timetable, and
 * on the ordinary reading having produced a poor grid. A result card and a
 * calendar never pay for it.
 */
async function sparseIfGrid(
  canvas: HTMLCanvasElement,
  page: number,
  recognize: Recognize,
  best: OcrPageResult,
): Promise<OcrPageResult> {
  /*
   * The sparse pass fires when the default reading IS a timetable but a poor
   * one — AND when the default reading is UNSUPPORTED. A dense ruled grid can
   * defeat the default segmentation so thoroughly that the day/time signals
   * never surface and the document fails even to classify (on a real college
   * timetable the default pass read no grid at all). Gating sparse behind a
   * successful timetable classification therefore never let that document reach
   * the one reading that could recognise it. A result card classifies as
   * `result` and returns here untouched, so it never pays for the sparse pass
   * that is worse for it.
   */
  const bestType = classifyDocument(best.lines).type;
  if (bestType !== 'college_timetable' && bestType !== 'unsupported') return best;

  /*
   * "POOR" MEANS NOT A WHOLE WEEK — the parser's own `looksComplete`, the same
   * judgement that warns the student "only part of this timetable could be
   * read". It used to mean EMPTY (no dictionary or no classes), so a reading
   * that kept one or two classes of a nine-column grid counted as good and the
   * sparse pass never ran. Measured on two real VTU college timetable scans:
   * the default pass stored 2 and 3 entries, none of them correct; the sparse
   * pass reads every day, eight time columns and seven of eight subject rows.
   */
  const before = parseTimetable(best.placed.map((item) => ({ ...item, page })));
  if (bestType === 'college_timetable' && before.coverage.looksComplete) return best;

  const sparse = await recognize(canvas, page, { sparse: true });
  /*
   * The retry only wins if the sparse reading actually recognises a timetable.
   * An unsupported photo whose default pass read nothing must not be promoted
   * just because sparse mode found a few stray words — it has to classify AND
   * yield a grid the student can use.
   */
  if (classifyDocument(sparse.lines).type !== 'college_timetable') return best;
  const after = parseTimetable(sparse.placed.map((item) => ({ ...item, page })));

  /*
   * More classes wins, then more dictionary rows. Both are things a student can
   * actually use; word count is not, and confidence least of all.
   */
  if (after.classes.length !== before.classes.length) {
    return after.classes.length > before.classes.length ? sparse : best;
  }
  return after.dictionary.length > before.dictionary.length ? sparse : best;
}

/**
 * Which of two readings of the same page to keep.
 *
 * MORE SOUND ROWS WINS — distinct subject codes whose marks add up — because
 * that, not the raw row count, is what the student can trust. Ranking on row
 * count alone let a second pass win by adding a row while corrupting a mark,
 * duplicating a subject, or inventing noise: each still parses to a "row". Only
 * when the sound-row count ties does more TOTAL rows break it (a flagged row the
 * student can still fix beats nothing), then fewer rows the parser gave up on,
 * then more words.
 *
 * Confidence is deliberately absent. On a real watermarked card the stretched
 * pass was the MORE confident of the two and its marks had vanished — exactly
 * the reading the sound-row count now demotes, because a row with no marks is
 * not a sound one.
 *
 * Ties go to `first`, the stretched pass that helps dim screenshots, keeping the
 * choice stable when neither reading is better.
 */
export function betterReading(first: OcrPageResult, second: OcrPageResult): OcrPageResult {
  const sound = [soundRows(first.lines), soundRows(second.lines)];
  if (sound[0] !== sound[1]) return (sound[1] as number) > (sound[0] as number) ? second : first;

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
  /** Called as each scanned page starts being recognised — real progress, never estimated. */
  onPage?: (page: number, total: number) => void,
): Promise<FileReading> {
  /*
   * A COPY PER READ. pdf.js transfers the array it is given to its worker,
   * which DETACHES the buffer — so a document read once for its text and then
   * rendered for OCR would find an empty buffer the second time, and report a
   * scan as unreadable. One copy of a few hundred kilobytes is the cheap side
   * of that trade.
   */
  const extraction = await withDeadline(extractPdfLines(data.slice(0)), PDF_READ_MS, pdfTimedOut);
  if (extraction.hasTextLayer) {
    return {
      lines: extraction.lines,
      placed: extraction.placed,
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
    onPage?.(number, extraction.pageCount);
    const canvas = await withDeadline(
      renderPdfPage(data.slice(0), number),
      PDF_READ_MS,
      pdfTimedOut,
    );
    pages.push(await recognizeBothWays(canvas, number, recognize));
    // Releasing the backing store now, rather than waiting for the collector to
    // notice, is what keeps peak memory at one page instead of all of them.
    canvas.width = 0;
    canvas.height = 0;
  }

  if (!pages.some(isWorthReviewing)) throw new OcrError(UNREADABLE);
  return summarise(pages, extraction.pageCount);
}

/* -------------------------------------------------------------------------- */
/* A saved web page                                                           */
/* -------------------------------------------------------------------------- */

/** A saved result page is tens of kilobytes; anything this size is not one. */
export const MAX_HTML_BYTES = 5 * 1024 * 1024;

export class HtmlReadError extends Error {}

/** Elements whose text is never page content. */
const SKIPPED = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'HEAD', 'IFRAME', 'OBJECT']);

/** Elements that end a line of text. Everything else is inline. */
const BLOCKS = new Set([
  'ADDRESS',
  'ARTICLE',
  'ASIDE',
  'BLOCKQUOTE',
  'BR',
  'CAPTION',
  'DD',
  'DIV',
  'DL',
  'DT',
  'FIELDSET',
  'FIGCAPTION',
  'FIGURE',
  'FOOTER',
  'FORM',
  'H1',
  'H2',
  'H3',
  'H4',
  'H5',
  'H6',
  'HEADER',
  'HR',
  'LI',
  'MAIN',
  'NAV',
  'OL',
  'P',
  'PRE',
  'SECTION',
  'TABLE',
  'TBODY',
  'TD',
  'TFOOT',
  'TH',
  'THEAD',
  'UL',
]);

/**
 * A table row, in either of the shapes a result page uses: a real `<tr>`, or
 * the `divTableRow` / `role="row"` divs the VTU page lays its marks out with.
 *
 * A row that CONTAINS another row is a layout wrapper, not a data row, and is
 * walked like any other block — flattening it would fuse a whole page into one
 * line.
 */
function isRow(element: Element): boolean {
  const shaped =
    element.tagName === 'TR' ||
    element.getAttribute('role') === 'row' ||
    /tablerow/i.test(element.getAttribute('class') ?? '');
  return (
    shaped &&
    element.querySelector('tr, [role="row"], [class*="ableRow"], [class*="ablerow"]') === null
  );
}

const squash = (text: string): string => text.replace(/\s+/g, ' ').trim();

/**
 * A saved result page (Save page as → HTML), as lines.
 *
 * PARSED, NEVER RENDERED. `DOMParser` builds an inert document: its scripts do
 * not run, its event handlers never fire, and its images, styles and frames are
 * never fetched — the page is read as text on this device and nothing it
 * references is contacted.
 *
 * Each table row becomes ONE line, its cells joined by spaces, which is exactly
 * the shape `parseResultCard` reads from a PDF's text layer: code, title,
 * marks, status, date. Other block text becomes a line of its own, so the
 * headings (`University Seat Number`, `Semester : 4`) arrive as they do there.
 */
export async function readHtmlFile(file: File): Promise<FileReading> {
  if (file.size > MAX_HTML_BYTES) {
    throw new HtmlReadError(
      'This web page is too large to be a saved result page. Save the result page itself (Save page as → HTML only), or print it to a PDF.',
    );
  }
  const document = new DOMParser().parseFromString(await file.text(), 'text/html');

  const lines: string[] = [];
  let pending = '';
  const flush = (): void => {
    const text = squash(pending);
    if (text !== '') lines.push(text);
    pending = '';
  };
  const walk = (node: Node): void => {
    if (node.nodeType === Node.TEXT_NODE) {
      pending += node.textContent ?? '';
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const element = node as Element;
    if (SKIPPED.has(element.tagName)) return;
    if (isRow(element)) {
      flush();
      const cells = [...element.children]
        .filter((cell) => !SKIPPED.has(cell.tagName))
        .map((cell) => squash(cell.textContent ?? ''))
        .filter((text) => text !== '');
      if (cells.length > 0) lines.push(cells.join(' '));
      return;
    }
    const block = BLOCKS.has(element.tagName);
    if (block) flush();
    element.childNodes.forEach(walk);
    if (block) flush();
  };
  if (document.body !== null) walk(document.body);
  flush();

  return {
    lines: lines.map((text) => ({ text, page: 1 })),
    placed: [],
    source: 'text',
    pageCount: 1,
    meanConfidence: null,
    lowConfidenceWords: 0,
  };
}
