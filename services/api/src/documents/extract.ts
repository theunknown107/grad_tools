/**
 * Text extraction.
 *
 * Authority: docs/17 §17.3 (child-process limits), §17.4 · M5 §15
 *
 * Extraction runs `pdftotext` in a CHILD PROCESS, never in the API process.
 * The reason is stated plainly in docs/17 §17.3: this is what makes a poppler
 * zero-day a rejected document rather than a compromised server. The parent
 * enforces a wall-clock kill so a hostile file that defeats the validator still
 * cannot occupy a worker indefinitely.
 *
 * OCR IS NOT PERFORMED (M5 §15). A scanned paper with no text layer is reported
 * as `ocr_required` and stopped there. Silently OCR-ing everything would hide
 * which documents carry real text and which carry a guess, and that difference
 * matters for everything downstream.
 */

import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ExtractionStatus } from '@gradtools/shared-types';

/** docs/17 §17.3 — parent kills the child at this point regardless. */
export const EXTRACTION_TIMEOUT_MS = 60_000;
/** Output cap, so a document that expands wildly cannot exhaust memory. */
export const MAX_TEXT_BYTES = 8 * 1024 * 1024;

/**
 * Below this many characters per page, the PDF is treated as having no usable
 * text layer.
 *
 * A scanned page commonly yields a handful of stray characters rather than a
 * clean zero, so testing for exactly zero would misclassify real scans as
 * text-bearing. The threshold is deliberately low: it is answering "is there
 * text at all", not "is the text good".
 */
export const MIN_CHARS_PER_PAGE = 24;

export const EXTRACTOR_VERSION = 'pdftotext-v1';

export interface ExtractionResult {
  readonly status: ExtractionStatus;
  readonly text: string;
  readonly extractorVersion: string;
  readonly durationMs: number;
  /** Present when status is `extraction_failed`. Safe to log; never raw output. */
  readonly failure?: string;
}

function runPdfToText(path: string): Promise<{ stdout: string }> {
  return new Promise((resolvePromise, rejectPromise) => {
    execFile(
      'pdftotext',
      // -layout preserves column structure, which question papers rely on.
      // -enc UTF-8 makes the output deterministic across locales.
      ['-layout', '-enc', 'UTF-8', '-q', path, '-'],
      {
        timeout: EXTRACTION_TIMEOUT_MS,
        maxBuffer: MAX_TEXT_BYTES,
        killSignal: 'SIGKILL',
        // No shell: the path is passed as an argv element, so nothing in it can
        // be interpreted as a command even if it somehow contained metacharacters.
        shell: false,
        windowsHide: true,
      },
      (error, stdout) => {
        if (error) {
          rejectPromise(error);
          return;
        }
        resolvePromise({ stdout });
      },
    );
  });
}

/**
 * Extracts text from validated PDF bytes.
 *
 * Takes bytes rather than a storage key so it never needs filesystem knowledge
 * beyond its own scratch directory, which it removes afterwards.
 *
 * Never throws for a bad document: a failure is a RESULT. An unparseable PDF is
 * an expected outcome of accepting uploads, not an exception.
 */
export async function extractText(bytes: Buffer, pageCount: number): Promise<ExtractionResult> {
  const started = Date.now();
  const dir = await mkdtemp(join(tmpdir(), 'gradtools-extract-'));
  const path = join(dir, 'input.pdf');

  try {
    await writeFile(path, bytes);
    const { stdout } = await runPdfToText(path);
    const text = stdout.slice(0, MAX_TEXT_BYTES);
    const durationMs = Date.now() - started;

    const meaningful = text.replace(/\s/g, '').length;
    const perPage = meaningful / Math.max(pageCount, 1);

    if (perPage < MIN_CHARS_PER_PAGE) {
      return {
        status: 'ocr_required',
        // The little text there was is discarded: a handful of stray glyphs
        // from a scan is worse than nothing, because it looks like content.
        text: '',
        extractorVersion: EXTRACTOR_VERSION,
        durationMs,
      };
    }

    return { status: 'text_available', text, extractorVersion: EXTRACTOR_VERSION, durationMs };
  } catch (cause) {
    return {
      status: 'extraction_failed',
      text: '',
      extractorVersion: EXTRACTOR_VERSION,
      durationMs: Date.now() - started,
      failure: cause instanceof Error ? cause.message : 'Extraction failed.',
    };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/**
 * Splits extracted text into positioned sections.
 *
 * Deliberately structural and dumb: pages, then blank-line-separated blocks.
 * Question segmentation and module mapping are the later intelligence milestone
 * (M5 §16). Guessing at question boundaries now would bake an unvalidated
 * assumption into stored data, and stored guesses are much harder to retract
 * than absent ones.
 */
export interface DocumentSection {
  readonly pageNumber: number;
  readonly ordinal: number;
  readonly content: string;
}

export function sectionize(text: string): DocumentSection[] {
  const sections: DocumentSection[] = [];
  // pdftotext emits a form feed between pages.
  const pages = text.split('\f');

  pages.forEach((page, pageIndex) => {
    const blocks = page
      .split(/\n\s*\n/)
      .map((block) => block.trim())
      .filter((block) => block.length > 0);

    blocks.forEach((content, ordinal) => {
      sections.push({ pageNumber: pageIndex + 1, ordinal, content });
    });
  });

  return sections;
}
