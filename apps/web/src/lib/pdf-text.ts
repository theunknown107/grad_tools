/**
 * Getting positioned text out of a PDF, on the device.
 *
 * Authority: docs/12 §12.x · docs/13 §T-03 · M10A.6 §4, §6, §27, §34, §37
 *
 * ---------------------------------------------------------------------------
 * THE FILE DOES NOT LEAVE THE DEVICE
 * ---------------------------------------------------------------------------
 *
 * A result card carries a name, a seat number and every mark a student has. So
 * the bytes are read in the browser and never uploaded: no OCR service, no
 * parsing endpoint, no telemetry, and nothing written to storage. The only
 * thing that ever reaches the network is the confirmed, structured result, and
 * only through the sync a student already opted into (§4, §25, §39).
 *
 * A consequence worth stating: this works with the network off (§27).
 *
 * ---------------------------------------------------------------------------
 * THE FILE IS UNTRUSTED
 * ---------------------------------------------------------------------------
 *
 * A PDF is a program container. pdf.js is configured to run none of it:
 * `isEvalSupported` off so no embedded JavaScript is compiled, and no external
 * resource fetching, so a document cannot phone home or pull a font from an
 * attacker's host while a student's marks are on screen (§34).
 *
 * The limits below exist because a 4KB file can legitimately declare thousands
 * of pages. They are refusals with a message, not crashes (§37).
 */

import { itemsToLines, type PositionedText } from '../domain/pdf-layout.js';
import type { ImportLine } from '../domain/result-import.js';

/** A result card is a page or two. Anything past this is not one. */
export const MAX_PAGES = 20;
/** Enough for a very long card; small enough that a hostile file cannot hang a tab. */
export const MAX_ITEMS_PER_PAGE = 20_000;
export const MAX_FILE_BYTES = 10 * 1024 * 1024;

export class PdfReadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PdfReadError';
  }
}

interface PdfTextItem {
  readonly str?: unknown;
  readonly width?: unknown;
  readonly height?: unknown;
  readonly transform?: unknown;
}

/**
 * One pdf.js text item as a position.
 *
 * The transform is `[a, b, c, d, e, f]`; `e` and `f` are the translation, which
 * is where the run starts. `height` is taken from the item rather than from `d`
 * because pdf.js already accounts for the font matrix there.
 */
function toPositioned(item: PdfTextItem): PositionedText | null {
  const text = typeof item.str === 'string' ? item.str : '';
  const transform = item.transform;
  if (!Array.isArray(transform) || transform.length < 6) return null;

  const x = Number(transform[4]);
  const y = Number(transform[5]);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;

  const width = Number(item.width);
  const height = Number(item.height);

  return {
    text,
    x,
    y,
    width: Number.isFinite(width) ? width : 0,
    height: Number.isFinite(height) && height > 0 ? height : 10,
  };
}

export interface PdfExtraction {
  readonly lines: readonly ImportLine[];
  readonly pageCount: number;
  /**
   * False when the document carried no text at all.
   *
   * The signal that a file is a SCAN. It is reported rather than worked around:
   * reading a scan needs OCR, which this build does not have, and pretending
   * otherwise would produce an empty result that looks like a parse failure
   * (§39).
   */
  readonly hasTextLayer: boolean;
}

/**
 * Every line of a PDF, rebuilt from the coordinates its text was placed at.
 *
 * pdf.js is imported lazily so that the ~350KB engine is fetched only by a
 * student who actually imports a result, rather than by everyone who opens the
 * dashboard.
 */
export async function extractPdfLines(
  data: ArrayBuffer,
  options: { readonly workerSrc?: string } = {},
): Promise<PdfExtraction> {
  if (data.byteLength > MAX_FILE_BYTES) {
    throw new PdfReadError(
      `This file is larger than ${String(MAX_FILE_BYTES / (1024 * 1024))}MB. A result card is normally a few hundred kilobytes.`,
    );
  }

  /*
   * THE LEGACY BUILD, DELIBERATELY.
   *
   * pdf.js v6's default build calls `Promise.try`, which exists only in very
   * recent engines — Chrome 128+, Safari 18.2+, Node 23+. On anything older it
   * does not throw where you can catch it: the failure happens inside the
   * worker message handler, the promise never settles, and the import silently
   * hangs forever. A student on last year's phone would watch a spinner.
   *
   * The legacy build is the same API transpiled down. pdf.js itself prints
   * "Please use the `legacy` build in Node.js environments"; the browser reason
   * is the stronger one.
   */
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');

  /*
   * WHERE THE WORKER COMES FROM IS THE ONE THING THE CALLER CAN CHANGE.
   *
   * In the browser it is resolved by the bundler and served from our own
   * origin — `?url` rather than a CDN, because a student's result card is open
   * in this tab and fetching the engine from someone else's host would make a
   * third party a participant in reading it. That also keeps the path working
   * with the network off (§27).
   *
   * The `?url` specifier is a bundler instruction, and it resolves to a
   * dev-server path that Node cannot import. So tests pass a filesystem URL
   * instead. The seam exists for that reason alone; nothing else about the
   * extraction differs between the two.
   */
  const bundled = await (options.workerSrc === undefined
    ? import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url').then(
        (module) => (module as { default?: string }).default,
      )
    : Promise.resolve(options.workerSrc));
  const workerSrc = bundled ?? '';
  (pdfjs.GlobalWorkerOptions as { workerSrc: string }).workerSrc = workerSrc;

  /*
   * The LOADING TASK is kept, not just the document it resolves to: `destroy`
   * lives on the task, and it is what actually tears the worker down. Naming it
   * `pdf` rather than `document` also keeps it clear that this is not the DOM
   * global, which exists in the browser build.
   */
  let task;
  let pdf;
  try {
    task = pdfjs.getDocument({
      data: new Uint8Array(data),
      /*
       * Nothing is fetched while a student's card is on screen (§34).
       *
       * There is no `isEvalSupported` to switch off: pdf.js v6 removed its eval
       * path entirely, so embedded JavaScript cannot be compiled at all. The
       * options that remain are about the network — no font faces, no worker
       * fetch — so a document cannot pull a resource from an attacker's host.
       */
      disableFontFace: true,
      useSystemFonts: false,
      useWorkerFetch: false,
      stopAtErrors: false,
    });
    pdf = await task.promise;
  } catch {
    /*
     * The message deliberately says nothing about the parser's internals. A
     * malformed file is a student problem to solve, not a stack trace to read.
     */
    throw new PdfReadError('This file could not be opened as a PDF.');
  }

  try {
    if (pdf.numPages > MAX_PAGES) {
      throw new PdfReadError(
        `This PDF has ${String(pdf.numPages)} pages. A result card is normally one or two.`,
      );
    }

    const lines: ImportLine[] = [];
    let items = 0;

    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      const raw = content.items as PdfTextItem[];

      items += raw.length;
      if (items > MAX_ITEMS_PER_PAGE * MAX_PAGES) {
        throw new PdfReadError('This PDF contains far more text than a result card.');
      }

      const positioned = raw
        .map(toPositioned)
        .filter((item): item is PositionedText => item !== null);
      lines.push(...itemsToLines(positioned, pageNumber));
      page.cleanup();
    }

    return {
      lines,
      pageCount: pdf.numPages,
      hasTextLayer: lines.some((line) => line.text.trim() !== ''),
    };
  } finally {
    // Released either way: an early return on a limit must not leave the
    // document's buffers alive for the life of the tab.
    await task.destroy();
  }
}
