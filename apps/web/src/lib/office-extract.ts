/**
 * Office, OpenDocument and plain-text files, as lines a result parser can read.
 *
 * Authority: docs/12 · multi-format ingestion milestone
 *
 * ---------------------------------------------------------------------------
 * AN EXTRACTION LAYER, NEVER AN AUTHORITY
 * ---------------------------------------------------------------------------
 *
 * This module turns a DOCX / XLSX / PPTX / ODF / RTF — or a CSV / TXT / MD — into
 * the SAME `FileReading` shape a PDF text layer or a saved HTML page produces:
 * lines in reading order, each a row of space-joined cells. It does not decide
 * what a mark means, whether a student passed, or which course a row is: that is
 * the job of the existing deterministic parsers (`classifyDocument`,
 * `parseResultCard`, `parseTimetable`), which read these lines exactly as they
 * read a PDF's. The file format must not change the meaning of its contents.
 *
 * ---------------------------------------------------------------------------
 * LOCAL-FIRST, AND BOUNDED
 * ---------------------------------------------------------------------------
 *
 * Everything runs on this device. officeParser's slim browser build carries its
 * own zip (fflate) and XML reader and contacts nothing; no bytes leave the
 * phone. It is imported LAZILY — only when an Office/ODF file actually appears —
 * so the dashboard never pays for it. A malicious archive is defended by
 * `DecompressionLimits`: a zip bomb, a cell- or row-repeat amplification, or a
 * flood of tiny XML elements is bounded before it can exhaust memory. The file's
 * declared type is ignored; officeParser detects the real type from the magic
 * bytes and validates the container, so a mislabelled extension cannot force the
 * wrong decoder or smuggle past the checks.
 */

import type { FileReading, ReadProvenance } from './result-file.js';

export class OfficeReadError extends Error {}

/**
 * Bounds for a student document on a phone, tighter than officeParser's
 * server-scale defaults. A genuinely enormous spreadsheet is TRUNCATED with a
 * warning rather than throwing, so partial content still reaches review; a true
 * decompression bomb trips the byte/entry/element ceilings and is refused.
 *
 * ponytail: fixed ceilings sized for result cards and timetables; raise them (and
 * the memory budget) only if real student exports start hitting them.
 */
const LIMITS = {
  maxUncompressedBytes: 64 * 1024 * 1024, // 64 MB unpacked, vs the 512 MB default
  maxZipEntries: 4096, // vs 10000
  maxTableCells: 200_000, // vs 1,000,000 — a result card has well under a hundred rows
  maxXmlElements: 500_000, // vs 2,000,000
};

const ENGINE = 'officeparser';
// ponytail: the AST exposes no version; keep this in step with the apps/web
// `officeparser` dependency (a single string to bump on upgrade).
const ENGINE_VERSION = '8.1.0';

/** The extension, lower-case and without the dot, for provenance and CSV handling. */
function extensionOf(fileName: string): string {
  const match = /\.([a-z0-9]+)$/i.exec(fileName);
  return match?.[1]?.toLowerCase() ?? '';
}

/**
 * One rendered table row — "| CS101 | Data Structures | 85 | P |" — as the same
 * space-joined line `parseResultCard` reads from a PDF text layer or an HTML
 * `<tr>`. A separator row (`|---|---|`) carries no data and is dropped.
 *
 * ponytail: a heuristic keyed on a line that both starts and ends with a pipe; a
 * prose paragraph that happened to do so would be squashed too, but result cards
 * and timetables do not write such sentences.
 */
function flattenTableRow(line: string): string | null {
  if (!/^\|.*\|$/.test(line)) return null;
  const cells = line
    .slice(1, -1)
    .split('|')
    .map((cell) => cell.trim())
    .filter((cell) => cell !== '' && !/^-+$/.test(cell));
  return cells.length > 0 ? cells.join(' ') : null;
}

/** Plain-text output into non-empty lines, with table rows flattened. */
function toLines(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === '') continue;
    const table = flattenTableRow(line);
    out.push(table ?? line.replace(/\s+/g, ' '));
  }
  return out;
}

/**
 * A DOCX / XLSX / PPTX / ODT / ODS / ODP / ODG / RTF, as lines.
 *
 * `signal` lets a leaving student stop a parse and release its working memory;
 * officeParser checks it during decompression and AST building.
 */
export async function readOfficeFile(
  data: ArrayBuffer,
  fileName: string,
  signal?: AbortSignal,
): Promise<FileReading> {
  // Lazy: officeParser and its zip/XML machinery load only now, never at startup.
  // The slim build excludes the PDF and OCR engines the app already ships.
  const { parseOffice } = await import('officeparser/slim');

  let ast;
  try {
    // A Uint8Array view is accepted on every runtime; a bare ArrayBuffer is not.
    ast = await parseOffice(new Uint8Array(data), {
      // No `fileType` hint: the type is established from the magic bytes, not the
      // extension, and the container is validated as it is unpacked.
      decompressionLimits: LIMITS,
      abortSignal: signal ?? null,
    });
  } catch (cause) {
    if (signal?.aborted) throw new OfficeReadError('This import was cancelled.', { cause });
    throw new OfficeReadError(
      'This document could not be read. It may be password-protected, damaged, or not the kind of file it claims to be. Try exporting it to a PDF, or enter the result by hand.',
      { cause },
    );
  }

  const rendered = (await ast.to('text')).value;
  const lines = toLines(typeof rendered === 'string' ? rendered : '');

  const provenance: ReadProvenance = {
    engine: ENGINE,
    engineVersion: ENGINE_VERSION,
    format: extensionOf(fileName),
    mode: 'text-extraction',
  };

  return {
    lines: lines.map((text) => ({ text, page: 1 })),
    // Office and ODF formats carry no reliable page geometry (as with HTML), so
    // the positioned view is empty; row-based parsing reads the lines above.
    placed: [],
    source: 'text',
    pageCount: ast.metadata.pages ?? 1,
    meanConfidence: null,
    lowConfidenceWords: 0,
    provenance,
  };
}

/** A saved result export is tens of kilobytes; anything this size is not one. */
export const MAX_TEXT_BYTES = 5 * 1024 * 1024;

/**
 * A CSV, TSV, Markdown or plain-text file, as lines — no officeParser needed, so
 * a plain export never loads the heavy engine.
 *
 * A delimited row (CSV/TSV) becomes one line of space-joined cells; a Markdown
 * pipe-table row is flattened the same way an Office table is — so every source,
 * heavy or light, hands `parseResultCard` the same row shape.
 */
export async function readTextFile(file: File): Promise<FileReading> {
  if (file.size > MAX_TEXT_BYTES) {
    throw new OfficeReadError('This text file is too large to be a result export.');
  }
  const ext = extensionOf(file.name);
  const delimiter = ext === 'tsv' ? '\t' : ext === 'csv' ? ',' : null;
  const content = await file.text();

  const lines: string[] = [];
  for (const raw of content.split(/\r?\n/)) {
    const trimmed = raw.trim();
    if (trimmed === '') continue;
    let line: string;
    if (delimiter !== null) {
      // ponytail: a naive split — a quoted cell containing the delimiter would
      // mis-split. Result exports don't quote; switch to a CSV parser only if one
      // in the wild does.
      line = raw
        .split(delimiter)
        .map((cell) => cell.trim())
        .filter((cell) => cell !== '')
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
    } else {
      // Markdown and plain text: flatten a pipe-table row, otherwise squash.
      line = flattenTableRow(trimmed) ?? trimmed.replace(/\s+/g, ' ');
    }
    if (line !== '') lines.push(line);
  }

  return {
    lines: lines.map((text) => ({ text, page: 1 })),
    placed: [],
    source: 'text',
    pageCount: 1,
    meanConfidence: null,
    lowConfidenceWords: 0,
    provenance: { engine: 'builtin', engineVersion: '1', format: ext, mode: 'text' },
  };
}
