/**
 * Positional structure extraction — the bridge from geometry to records.
 *
 * Authority: docs/17 §17.16, §17.17 · docs/32 OQ-019a · M5A.5 §1, §4, §10
 *
 *   native PDF   pdftotext -tsv  ─┐
 *                                 ├─► PositionedToken ─► lines ─► ExtractedPaper
 *   scanned PDF  tesseract tsv   ─┘
 *
 * This module owns only the plumbing: getting TSV out of a document and handing
 * it to the parser M5A.4 already built and measured. No parsing rule lives here
 * — `geometry.ts` and `structure.ts` remain the single description of how a
 * question is recognised.
 *
 * STILL NO AI. No LLM, no embeddings, no semantic classification, no equation
 * reconstruction (M5A.5 §23, §11).
 *
 * THE PARSER VERSION IS THE IDENTITY OF THIS PIPELINE. It covers the geometry
 * representation, the line grouping and the structural rules together, because
 * a change to any of them changes the output. Bumping it is what makes a
 * re-extraction a NEW version rather than an overwrite of a result someone may
 * already have reviewed (M5A.5 §15).
 */

import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ExtractionSource } from '@gradtools/shared-types';
import { groupIntoLines, parseTsv, type PositionedToken } from './geometry.js';
import { detectFormat, type PaperFormat } from './format.js';
import { extractStructure, type ExtractedPaper } from './structure.js';
import { extractStructureV2, PARSER_VERSION_V2 } from './structure-v2.js';

/**
 * Geometry + grouping + structural rules, versioned as one thing.
 *
 * Bump this whenever any of the three changes in a way that alters output.
 */
export const PARSER_VERSION = PARSER_VERSION_V2;

/**
 * v1, FROZEN. It produced the M5A.6 corpus, and a baseline you cannot re-run is
 * not a baseline (M5A.7 §2). Re-extracting under v2 adds an extraction version
 * beside the v1 rows and inherits none of their review state.
 */
export const PARSER_VERSION_V1 = 'positional-v1';

/** Which structural parser to run. `v1` exists for baseline comparison only. */
export type ParserChoice = 'v1' | 'v2';

function parserFor(choice: ParserChoice) {
  return choice === 'v1'
    ? { extract: extractStructure, version: PARSER_VERSION_V1 }
    : { extract: extractStructureV2, version: PARSER_VERSION_V2 };
}

/** docs/17 §17.16 — `pdftotext -tsv` on a 4-page native paper measured 32 ms. */
export const TSV_TIMEOUT_MS = 60_000;
export const MAX_TSV_BYTES = 16 * 1024 * 1024;

/**
 * Binary location, overridable by environment for deployment.
 *
 * NOT COSMETIC. `pdftotext` is an ambiguous name: Xpdf ships one and poppler
 * ships another, and only poppler's supports `-tsv`. A machine with both on
 * PATH silently gets whichever comes first, and positional extraction then
 * fails on every native document while text extraction keeps working — a
 * failure mode observed on the development machine during M5A.5 §18.
 *
 * Read once at module load. A caller cannot influence which binary runs.
 */
const PDFTOTEXT_BIN = process.env.PDFTOTEXT_BIN ?? 'pdftotext';

export interface PositionalExtraction {
  readonly source: ExtractionSource;
  readonly parserVersion: string;
  readonly paper: ExtractedPaper;
  readonly durationMs: number;
}

/* -------------------------------------------------------------------------- */
/* Native PDFs                                                                */
/* -------------------------------------------------------------------------- */

function runPdfToTsv(path: string): Promise<string> {
  return new Promise((resolvePromise, rejectPromise) => {
    execFile(
      PDFTOTEXT_BIN,
      // -tsv gives word boxes in PDF points. -enc UTF-8 keeps the output
      // deterministic across locales.
      ['-tsv', '-enc', 'UTF-8', '-q', path, '-'],
      {
        timeout: TSV_TIMEOUT_MS,
        maxBuffer: MAX_TSV_BYTES,
        killSignal: 'SIGKILL',
        // No shell. The path is a temp file we created; nothing user-controlled
        // reaches a command line (docs/13 §T-03).
        shell: false,
        windowsHide: true,
      },
      (error, stdout) => {
        if (error) rejectPromise(error);
        else resolvePromise(stdout);
      },
    );
  });
}

/**
 * Extracts structure from a PDF's own text layer.
 *
 * Cheap enough to run inline: 32 ms for a 4-page paper, against ~759 ms per
 * page for OCR (docs/23 §23.3.6). Never throws for a bad document — a failure
 * is a `null` result, because unreadable input is expected traffic.
 */
export async function extractNativeStructure(
  bytes: Buffer,
  choice: ParserChoice = 'v2',
): Promise<PositionalExtraction | null> {
  const started = Date.now();
  const dir = await mkdtemp(join(tmpdir(), 'gradtools-positional-'));
  const path = join(dir, 'input.pdf');

  try {
    await writeFile(path, bytes);
    const tsv = await runPdfToTsv(path);
    const tokens = parseTsv(tsv, 'native');
    if (tokens.length === 0) return null;

    const lines = groupIntoLines(tokens);
    const format = detectFormat(lines.map((line) => line.text).join('\n')).format;

    const parser = parserFor(choice);

    return {
      source: 'native',
      parserVersion: parser.version,
      paper: parser.extract(lines, format),
      durationMs: Date.now() - started,
    };
  } catch {
    return null;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/* -------------------------------------------------------------------------- */
/* Scans                                                                      */
/* -------------------------------------------------------------------------- */

export interface OcrPageTsv {
  readonly pageNumber: number;
  readonly tsv: string;
}

/**
 * Builds structure from TSV that OCR has ALREADY produced.
 *
 * Takes the geometry rather than the bytes on purpose: OCR is the expensive
 * step, and it emitted this TSV in the same recognition pass that produced the
 * text (docs/17 §17.17). Re-reading the images here would double a
 * ~759 ms/page workload to recompute what we are already holding.
 *
 * The format is passed in rather than re-detected. It was established by the
 * two-pass probe in `runOcr`, including the `eng+kan` retry that a Kannada
 * paper depends on (docs/17 §17.12) — re-deciding it from the same text could
 * only agree or be wrong.
 *
 * Tesseract numbers every page 1, because it is handed one image at a time. The
 * document's real page number is restored here; without it every question in
 * the paper would claim to be on page 1, and the provenance M5A.5 §4 requires
 * would be a fiction.
 */
export function structureFromOcrTsv(
  pages: readonly OcrPageTsv[],
  dpi: number,
  format: PaperFormat,
  choice: ParserChoice = 'v2',
): PositionalExtraction {
  const started = Date.now();

  const tokens: PositionedToken[] = [];
  for (const page of pages) {
    for (const token of parseTsv(page.tsv, 'ocr', dpi)) {
      tokens.push({ ...token, page: page.pageNumber });
    }
  }

  const lines = groupIntoLines(tokens);
  const parser = parserFor(choice);
  return {
    source: 'ocr',
    parserVersion: parser.version,
    paper: parser.extract(lines, format),
    durationMs: Date.now() - started,
  };
}
