/**
 * Reading a result card that is a picture, on the student's own device.
 *
 * Authority: docs/12 §12.x · docs/13 §T-03 · M10A.6B §5–§14, §42
 *
 * ---------------------------------------------------------------------------
 * NOTHING LEAVES THE DEVICE, AND NOTHING COMES FROM A CDN
 * ---------------------------------------------------------------------------
 *
 * tesseract.js defaults `workerPath`, `corePath` and `langPath` to jsDelivr.
 * All three are overridden here, because the page making those requests has a
 * student's result card open in it: a third party would learn when a student
 * reads their marks, and the feature would stop working offline. The assets are
 * copied onto our own origin by `scripts/vendor-ocr-assets.mjs`.
 *
 * There is no OCR service, no upload, and no telemetry. The image is decoded,
 * recognised and discarded in this tab.
 *
 * ---------------------------------------------------------------------------
 * ONE WORKER, TERMINATED
 * ---------------------------------------------------------------------------
 *
 * A worker per file would put five copies of a 3.7MB engine and a 2.8MB model
 * into memory on a phone. So recognition is SEQUENTIAL through a single worker,
 * created on first use and terminated when the caller is done — including when
 * the caller is done because the student cancelled (§8, §9, §10).
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS DELIBERATELY DOES NOT DO
 * ---------------------------------------------------------------------------
 *
 * It does not correct, score or interpret. It returns words, boxes and
 * confidences; `ocr-layout.ts` turns those into rows and `result-import.ts`
 * decides what they say. Confidence travels with the words as a reason to look,
 * never as a claim about accuracy (§13).
 */

import { ocrPageToLines, type OcrPageResult, type OcrWord } from '../domain/ocr-layout.js';

/** Where `vendor-ocr-assets.mjs` puts the engine, on our own origin. */
const ASSET_BASE = '/ocr';

/** A phone photo is routinely 12-50MP; the file itself is the cheaper guard. */
export const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

/**
 * The longest edge OCR actually sees.
 *
 * A 12MP photo is ~4000px wide. Recognising it costs several times what 2000px
 * costs and finds no more text: Tesseract wants roughly 30px of glyph height,
 * which a result card reaches long before 4000px. Downscaling below this,
 * though, starts dissolving the small print — which is the marks (§14).
 */
export const MAX_EDGE = 2000;

/**
 * The smallest longest-edge worth attempting.
 *
 * Under this the digits in a marks column are a few pixels tall and OCR returns
 * confident nonsense. Refusing is better than producing a row a student has to
 * disprove.
 */
export const MIN_EDGE = 600;

export class OcrError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OcrError';
  }
}

/* -------------------------------------------------------------------------- */
/* Decoding                                                                   */
/* -------------------------------------------------------------------------- */

export interface DecodedImage {
  readonly canvas: HTMLCanvasElement;
  readonly width: number;
  readonly height: number;
  /** The source's own size, before any scaling. Reported, not acted on. */
  readonly sourceWidth: number;
  readonly sourceHeight: number;
}

/**
 * A file as a canvas OCR can read, right way up and a sensible size.
 *
 * `createImageBitmap` is used with `imageOrientation: 'from-image'` so a photo
 * carrying EXIF orientation arrives upright (§13). Without it a portrait phone
 * photo reaches OCR on its side, and a rotated table produces no rows at all
 * while looking, in the preview, perfectly correct.
 */
export async function decodeImage(blob: Blob): Promise<DecodedImage> {
  if (blob.size > MAX_IMAGE_BYTES) {
    throw new OcrError(
      `That image is larger than ${String(MAX_IMAGE_BYTES / 1024 / 1024)}MB. A photo of a result card is normally a few megabytes.`,
    );
  }

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' });
  } catch {
    throw new OcrError('This image could not be opened.');
  }

  try {
    const longest = Math.max(bitmap.width, bitmap.height);
    if (longest < MIN_EDGE) {
      throw new OcrError(
        `This image is only ${String(bitmap.width)}x${String(bitmap.height)}. Text that small cannot be read reliably — try a larger photo, or enter the result by hand.`,
      );
    }

    /*
     * Scaled DOWN only. Enlarging a small photo invents no detail and multiplies
     * the work, and OCR on an upscaled blur is confident nonsense.
     */
    const scale = longest > MAX_EDGE ? MAX_EDGE / longest : 1;
    const width = Math.round(bitmap.width * scale);
    const height = Math.round(bitmap.height * scale);

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (context === null) throw new OcrError('This browser could not prepare the image.');

    /*
     * Drawn on WHITE first. A PNG with transparency composites onto black
     * otherwise, and black-on-black is not text to any recogniser.
     */
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, width, height);
    context.imageSmoothingQuality = 'high';
    context.drawImage(bitmap, 0, 0, width, height);

    return {
      canvas,
      width,
      height,
      sourceWidth: bitmap.width,
      sourceHeight: bitmap.height,
    };
  } finally {
    bitmap.close();
  }
}

/**
 * Greys RGBA pixels IN PLACE and stretches contrast to the ink actually there.
 *
 * DELIBERATELY NOT A THRESHOLD. Binarising a phone photo at a fixed cut point
 * is what destroys the marks column: uneven lighting across a page puts one
 * half of the table below the cut, and those rows vanish entirely rather than
 * arriving misread. A linear stretch between the observed 2nd and 98th
 * percentiles darkens faint print without ever deciding a pixel is background.
 *
 * Tesseract does its own binarisation, and does it locally rather than
 * globally, so the useful thing to hand it is a clean grey — not a decision.
 *
 * Returns whether the stretch was applied. A flat image is left grey but
 * unstretched: there is nothing to stretch, and the divisor would be near zero.
 */
export function stretchGrey(pixels: Uint8ClampedArray | number[]): boolean {
  const histogram = new Uint32Array(256);

  for (let i = 0; i < pixels.length; i += 4) {
    // Rec. 601 luma: the green channel carries most of the perceived detail.
    const grey =
      ((pixels[i] as number) * 299 +
        (pixels[i + 1] as number) * 587 +
        (pixels[i + 2] as number) * 114) /
      1000;
    const level = Math.round(grey);
    histogram[level] = (histogram[level] as number) + 1;
    pixels[i] = level;
    pixels[i + 1] = level;
    pixels[i + 2] = level;
  }

  const cut = Math.floor((pixels.length / 4) * 0.02);

  /*
   * `<=` rather than `<`, so an EMPTY level is always stepped over. On a small
   * or uniform image `cut` rounds to zero, and a strict comparison would leave
   * the ends at 0 and 255 — reporting a full-range image where there is none,
   * and stretching a flat one into black-and-white speckle.
   */
  let low = 0;
  let seen = 0;
  while (low < 255 && seen + (histogram[low] as number) <= cut) {
    seen += histogram[low] as number;
    low += 1;
  }

  let high = 255;
  seen = 0;
  while (high > 0 && seen + (histogram[high] as number) <= cut) {
    seen += histogram[high] as number;
    high -= 1;
  }

  /*
   * Nothing to stretch. Leaving it grey beats dividing by ~0, which would blow
   * the page out to pure black and white — exactly the threshold this avoids.
   */
  if (high - low < 32) return false;

  const span = high - low;
  for (let i = 0; i < pixels.length; i += 4) {
    const stretched = Math.max(
      0,
      Math.min(255, Math.round((((pixels[i] as number) - low) * 255) / span)),
    );
    pixels[i] = stretched;
    pixels[i + 1] = stretched;
    pixels[i + 2] = stretched;
  }
  return true;
}

/** `stretchGrey`, applied to a canvas. */
export function normalizeContrast(canvas: HTMLCanvasElement): void {
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (context === null) return;

  const image = context.getImageData(0, 0, canvas.width, canvas.height);
  stretchGrey(image.data);
  context.putImageData(image, 0, 0);
}

/* -------------------------------------------------------------------------- */
/* The engine                                                                 */
/* -------------------------------------------------------------------------- */

interface TesseractWord {
  readonly text?: unknown;
  readonly confidence?: unknown;
  readonly bbox?: unknown;
}

function toWord(raw: TesseractWord): OcrWord | null {
  const text = typeof raw.text === 'string' ? raw.text : '';
  const box = raw.bbox as Record<string, unknown> | undefined;
  if (box === undefined) return null;

  const numbers = ['x0', 'y0', 'x1', 'y1'].map((key) => Number(box[key]));
  if (numbers.some((value) => !Number.isFinite(value))) return null;
  const [x0, y0, x1, y1] = numbers as [number, number, number, number];

  return {
    text,
    bbox: { x0, y0, x1, y1 },
    confidence: Number.isFinite(Number(raw.confidence)) ? Number(raw.confidence) : 0,
  };
}

export interface OcrSession {
  /**
   * Recognises one canvas. Sequential: calls queue behind one another.
   *
   * `sparse` switches the engine from its default page segmentation to
   * SPARSE_TEXT. Measured on a real college timetable: the default finds a
   * dense ruled table's rows to be nothing at all, and the subject dictionary
   * — the only place the grid's initials are defined — came back EMPTY. In
   * sparse mode it came back with seven of its eight rows.
   *
   * It is not the default because it is worse where the default is right: on
   * the same real result cards, sparse mode dropped a nine-row card to four and
   * produced one INCORRECT mark. So the caller asks for it, and only for the
   * document that needs it (M10A.8.1 §7, §11).
   */
  recognize(
    canvas: HTMLCanvasElement,
    page?: number,
    options?: { readonly sparse?: boolean },
  ): Promise<OcrPageResult>;
  /** Always call this. A worker left running holds the engine in memory. */
  close(): Promise<void>;
}

/**
 * Starts the OCR engine, with every asset served from our own origin.
 *
 * The import is dynamic so a student who never imports a picture never
 * downloads the engine: it is a separate chunk, and the ~6.5MB of worker, core
 * and model is fetched on first use and then cached by the browser (§7).
 */
export async function startOcr(): Promise<OcrSession> {
  const { createWorker } = await import('tesseract.js');

  let worker;
  try {
    worker = await createWorker('eng', 1, {
      /*
       * All three, explicitly. Any one left unset silently reaches jsDelivr,
       * and the request would carry the fact that a student is reading a result
       * card to a third party (§5).
       */
      workerPath: `${ASSET_BASE}/worker.min.js`,
      corePath: ASSET_BASE,
      langPath: ASSET_BASE,
      gzip: true,
      // Nothing is logged: the callback would otherwise carry document text.
      logger: () => undefined,
      errorHandler: () => undefined,
    });
  } catch {
    throw new OcrError(
      'The text recogniser could not start. You can still enter this result by hand.',
    );
  }

  let closed = false;
  /* Sequential by construction: each call awaits the previous one's turn. */
  let queue: Promise<unknown> = Promise.resolve();

  return {
    async recognize(canvas, page = 1, options = {}) {
      if (closed) throw new OcrError('This import was cancelled.');

      const turn = queue.then(async () => {
        if (closed) throw new OcrError('This import was cancelled.');
        /*
         * Set per call rather than per worker, and set BOTH ways round: the
         * engine keeps whatever it was last told, so a sparse pass would leak
         * into the next document in the same batch.
         */
        /*
         * Set per call, and set BOTH ways round: the engine keeps whatever it
         * was last told, so a sparse pass would otherwise leak into the next
         * document in the same batch.
         *
         * THE DPI HINT IS ONLY FOR THE SPARSE PASS. It was added to silence
         * "Estimating resolution as 185", which sparse mode prints to the
         * console on every page — and it turned out to change what the engine
         * READS: on a real result card it gained a row and produced one
         * incorrect total. Silencing a log must not alter a student's marks, so
         * the hint goes only where the noise is, on the path result cards never
         * take.
         */
        await worker.setParameters(
          options.sparse === true
            ? ({ tessedit_pageseg_mode: '11', user_defined_dpi: '300' } as never)
            : /*
               * SIX, not three. tesseract.js never sets this, so what applies
               * otherwise is Tesseract's own default of SINGLE_BLOCK — and
               * setting AUTO instead, which looked like the harmless choice,
               * changed what the engine read on a real result card. Restoring
               * the mode after a sparse pass has to restore the mode that was
               * actually there.
               */
              ({ tessedit_pageseg_mode: '6' } as never),
        );
        const { data } = await worker.recognize(canvas, {}, { blocks: true });

        /*
         * Words come from the block tree. Tesseract also returns a flat `text`,
         * but that is reading order with no coordinates — and reading order is
         * exactly what cannot rebuild a table.
         */
        const words: OcrWord[] = [];
        for (const block of data.blocks ?? []) {
          for (const paragraph of block.paragraphs ?? []) {
            for (const line of paragraph.lines ?? []) {
              for (const word of line.words ?? []) {
                const mapped = toWord(word as TesseractWord);
                if (mapped !== null) words.push(mapped);
              }
            }
          }
        }

        return ocrPageToLines(words, canvas.height, page);
      });

      queue = turn.catch(() => undefined);
      return turn;
    },

    async close() {
      if (closed) return;
      closed = true;
      // Awaited so the worker is gone before the caller moves on; a terminate
      // that is merely started can outlive the screen that owned it.
      await worker.terminate();
    },
  };
}
