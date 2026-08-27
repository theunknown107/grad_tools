/**
 * OCR: rasterize, then recognise. Local only.
 *
 * Authority: docs/17 §17.15 · docs/13 §T-03 · M5A.3 §6, §8, §14, §15
 *
 * NOTHING LEAVES THE MACHINE. No hosted OCR, no cloud vision API, no upload.
 * The documents are the student's own or third-party academic material of
 * unresolved rights, and the Documents screen promises they stay here
 * (docs/12). A hosted call would make that promise false.
 *
 * HOSTILE INPUT. These bytes already passed validation, but a validator is not
 * a proof, so both child processes are argument-array invocations with no
 * shell, hard timeouts, and output caps. Nothing user-controlled reaches a
 * command line: the input path is a temp file we create, and the language and
 * PSM come from a closed set decided by our own detector.
 */

import { execFile } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { configFor, detectFormat, looksMathematical, MATH_REVIEW_REASON } from './format.js';
import type { OcrConfig, PaperFormat } from './format.js';

export const OCR_ENGINE = 'tesseract';
export const OCR_EXTRACTOR_VERSION = 'tesseract-v1';

/** Per-page wall clock. A page that takes this long is not going to finish. */
export const OCR_PAGE_TIMEOUT_MS = 60_000;
/** Whole-document ceiling, so one pathological file cannot occupy a worker. */
export const OCR_DOCUMENT_TIMEOUT_MS = 10 * 60_000;
export const RASTERIZE_TIMEOUT_MS = 120_000;
export const MAX_TEXT_BYTES = 8 * 1024 * 1024;

/**
 * Binary locations, overridable by environment for deployment.
 *
 * Read once. A caller cannot influence which binary runs.
 */
const TESSERACT_BIN = process.env.TESSERACT_BIN ?? 'tesseract';
const PDFTOPPM_BIN = process.env.PDFTOPPM_BIN ?? 'pdftoppm';

export interface OcrPageResult {
  readonly pageNumber: number;
  readonly text: string;
  /**
   * Word-level geometry for the same page, from the SAME recognition pass.
   *
   * Tesseract accepts several output configs in one invocation, so `txt tsv`
   * costs one recognition rather than two. Asking for the geometry separately
   * would double a ~759 ms/page workload to obtain information the engine
   * already computed and was about to throw away (docs/17 §17.17).
   */
  readonly tsv: string;
}

export interface OcrResult {
  readonly ok: boolean;
  readonly pages: readonly OcrPageResult[];
  readonly text: string;
  readonly format: PaperFormat;
  readonly config: OcrConfig;
  readonly engine: string;
  readonly engineVersion: string;
  readonly durationMs: number;
  readonly charCount: number;
  readonly needsReview: boolean;
  readonly reviewReason: string | null;
  readonly extractorVersion: string;
  /** Present when `ok` is false. Safe to log and to store; never raw output. */
  readonly failure?: string;
}

function run(bin: string, args: readonly string[], timeoutMs: number): Promise<string> {
  return new Promise((resolvePromise, rejectPromise) => {
    execFile(
      bin,
      [...args],
      {
        timeout: timeoutMs,
        maxBuffer: MAX_TEXT_BYTES,
        killSignal: 'SIGKILL',
        // No shell: every argument is passed as an argv element, so nothing in
        // a path or option can be reinterpreted as a command.
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
 * Which languages the installed engine can actually read.
 *
 * ASKED, NEVER ASSUMED. `tesseract -l eng+kan` on a machine without
 * `kan.traineddata` does not necessarily fail loudly — during M5A.5 §18 it
 * returned English-only output byte-for-byte identical to an `eng` run, with no
 * error and no Kannada recovered at all. A bilingual paper would then be read
 * as English gibberish and reported as a successful reading.
 *
 * That is precisely the silent degradation docs/26 forbids, so the answer is
 * established once and the caller says what it did.
 */
let languageCache: Promise<ReadonlySet<string>> | null = null;

export function availableLanguages(): Promise<ReadonlySet<string>> {
  languageCache ??= run(TESSERACT_BIN, ['--list-langs'], 10_000)
    .then(parseLanguageList)
    // No engine means no languages. Reported as an empty set rather than
    // thrown: the caller's job is to say what it could not do, and the missing
    // engine is already refused at worker startup.
    .catch(() => new Set<string>());
  return languageCache;
}

/**
 * Parses `tesseract --list-langs`.
 *
 * The first line is a heading — `List of available languages in "..." (3):` —
 * and taking it as a language would make this claim one nobody installed.
 */
export function parseLanguageList(stdout: string): ReadonlySet<string> {
  return new Set(
    stdout
      .split(/\r?\n/)
      .slice(1)
      .map((line) => line.trim())
      .filter((line) => line !== ''),
  );
}

/** Test seam. Nothing in production resets this. */
export function resetLanguageCache(): void {
  languageCache = null;
}

/**
 * Never ask for a language the engine does not have.
 *
 * The request would appear to succeed and return English-only text, and the
 * result would claim it had been read bilingually. Falling back to `eng` and
 * SAYING SO is the honest failure: the reading still happens, and nothing
 * downstream is told it is dependable (M5A.5 §12).
 *
 * Pure, so the decision is testable without an engine.
 */
export function withAvailableLanguages(config: OcrConfig, hasKannada: boolean): OcrConfig {
  if (hasKannada || !config.languages.includes('kan')) return config;
  return {
    ...config,
    languages: 'eng',
    needsReview: true,
    reviewReason: KANNADA_UNAVAILABLE_REASON,
  };
}

export const KANNADA_UNAVAILABLE_REASON =
  'This document may be in Kannada, but the Kannada language pack is not installed on ' +
  'this machine, so it was read as English only. The text is not dependable.';

/** Engine version, for the metadata record. Best effort; never fatal. */
export async function tesseractVersion(): Promise<string> {
  try {
    const out = await run(TESSERACT_BIN, ['--version'], 10_000);
    return out.split('\n')[0]?.trim() ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

/**
 * Runs OCR over a validated PDF.
 *
 * Two passes by design. The first rasterizes and reads ONE page to detect the
 * paper format and script; the second reads the whole document with the
 * configuration that choice implies. Detecting from page one costs one extra
 * page of OCR and is what lets a Kannada MCQ paper and an English maths paper
 * each get the settings measured to suit them.
 *
 * Never throws for a bad document: a failure is a RESULT. Accepting scans means
 * unreadable input is expected traffic, not an exception.
 */
export async function runOcr(bytes: Buffer): Promise<OcrResult> {
  const started = Date.now();
  const dir = await mkdtemp(join(tmpdir(), 'gradtools-ocr-'));
  const pdfPath = join(dir, 'input.pdf');

  const fail = (failure: string, config: OcrConfig, format: PaperFormat): OcrResult => ({
    ok: false,
    pages: [],
    text: '',
    format,
    config,
    engine: OCR_ENGINE,
    engineVersion: 'unknown',
    durationMs: Date.now() - started,
    charCount: 0,
    needsReview: true,
    reviewReason: 'Text could not be read from this document.',
    extractorVersion: OCR_EXTRACTOR_VERSION,
    failure,
  });

  const provisional = configFor({
    format: 'unknown',
    mcqCues: 0,
    descriptiveCues: 0,
    hasKannada: false,
  });

  try {
    await writeFile(pdfPath, bytes);

    /*
     * Rasterize at the 150 DPI baseline. Never silently raised: 300 DPI was
     * measured as 2.8x slower at comparable quality, because these scans are
     * low-resolution and upsampling adds interpolation noise rather than
     * information (docs/23 §23.3.4).
     */
    const imageStem = join(dir, 'page');
    try {
      await run(
        PDFTOPPM_BIN,
        ['-r', String(provisional.dpi), '-png', pdfPath, imageStem],
        RASTERIZE_TIMEOUT_MS,
      );
    } catch (cause) {
      return fail(
        `Rasterization failed: ${cause instanceof Error ? cause.message : 'unknown'}`,
        provisional,
        'unknown',
      );
    }

    const images = (await readdir(dir))
      .filter((name) => name.startsWith('page') && name.endsWith('.png'))
      .sort()
      .map((name) => join(dir, name));

    if (images.length === 0) {
      return fail('Rasterization produced no pages.', provisional, 'unknown');
    }

    /*
     * Pass 1: one page, general-purpose settings, to learn what this paper is.
     *
     * The `eng+kan` retry is triggered by FAILING TO CLASSIFY, not by empty
     * output. A Kannada page read with `eng` does not come back empty — it
     * comes back as confident Latin gibberish, which an emptiness check happily
     * accepts and which carries none of the cues the detector needs. Retrying
     * on `unknown` is what actually catches it, and it costs one extra page
     * only for documents we could not otherwise identify.
     */
    const firstImage = images[0];
    const probeBase = join(dir, 'probe');
    let probe =
      firstImage === undefined ? '' : (await ocrPage(firstImage, probeBase, 'eng', 3)).text;
    let evidence = detectFormat(probe);

    const hasKannadaPack = (await availableLanguages()).has('kan');

    if (evidence.format === 'unknown' && firstImage !== undefined && hasKannadaPack) {
      const bilingual = (await ocrPage(firstImage, `${probeBase}-kan`, 'eng+kan', 3)).text;
      const bilingualEvidence = detectFormat(bilingual);
      if (bilingualEvidence.format !== 'unknown' || bilingualEvidence.hasKannada) {
        probe = bilingual;
        evidence = bilingualEvidence;
      }
    }

    let config = configFor(evidence);

    config = withAvailableLanguages(config, hasKannadaPack);

    // Pass 2: the whole document, with the chosen configuration.
    const pages: OcrPageResult[] = [];
    for (const [index, image] of images.entries()) {
      if (Date.now() - started > OCR_DOCUMENT_TIMEOUT_MS) {
        return fail('Reading this document took too long.', config, evidence.format);
      }
      const page = await ocrPage(
        image,
        join(dir, `out-${String(index + 1)}`),
        config.languages,
        config.psm,
      );
      pages.push({ pageNumber: index + 1, text: page.text, tsv: page.tsv });
    }

    const text = pages.map((page) => page.text).join('\f');
    const charCount = text.replace(/\s/g, '').length;

    /*
     * Mathematics is flagged even on success. OCR recovered zero Greek letters,
     * operators, superscripts or subscripts across the qualification sample, so
     * a maths paper's text is usable for search and must not be presented as
     * the original (docs/17 §17.11d, M5A.3 §10).
     */
    const mathematical = looksMathematical(text);
    const needsReview = config.needsReview || mathematical;
    const reviewReason = config.needsReview
      ? config.reviewReason
      : mathematical
        ? MATH_REVIEW_REASON
        : null;

    return {
      ok: charCount > 0,
      pages,
      text,
      format: evidence.format,
      config,
      engine: OCR_ENGINE,
      engineVersion: await tesseractVersion(),
      durationMs: Date.now() - started,
      charCount,
      needsReview: needsReview || charCount === 0,
      reviewReason: charCount === 0 ? 'No text could be read from this scan.' : reviewReason,
      extractorVersion: OCR_EXTRACTOR_VERSION,
    };
  } catch (cause) {
    return fail(cause instanceof Error ? cause.message : 'OCR failed.', provisional, 'unknown');
  } finally {
    /*
     * Rasterized pages are intermediates and are removed whether OCR succeeded
     * or not. They are several times the size of the PDF and are never part of
     * document storage (M5A.3 §8).
     */
    await rm(dir, { recursive: true, force: true });
  }
}

/**
 * Recognises one page, returning both the text and its geometry.
 *
 * ONE PASS, TWO OUTPUTS. `txt tsv` are output configs, not modes: Tesseract
 * recognises once and writes both files. The text is byte-identical to what
 * `stdout` produces (verified against a real scan), apart from the CRLF line
 * endings the file writer uses on Windows, which are normalised here so the
 * result does not depend on the operating system.
 *
 * Writing to files rather than stdout is what makes that possible — `stdout`
 * can only carry one of them.
 */
async function ocrPage(
  imagePath: string,
  outputBase: string,
  languages: string,
  psm: number,
): Promise<{ text: string; tsv: string }> {
  try {
    await run(
      TESSERACT_BIN,
      [imagePath, outputBase, '-l', languages, '--psm', String(psm), 'txt', 'tsv'],
      OCR_PAGE_TIMEOUT_MS,
    );
    const [text, tsv] = await Promise.all([
      readTextFile(`${outputBase}.txt`),
      readTextFile(`${outputBase}.tsv`),
    ]);
    return { text, tsv };
  } catch {
    // One unreadable page does not fail the document; it contributes nothing.
    return { text: '', tsv: '' };
  }
}

async function readTextFile(path: string): Promise<string> {
  try {
    const raw = await readFile(path, 'utf8');
    return raw.replace(/\r\n/g, '\n').slice(0, MAX_TEXT_BYTES);
  } catch {
    return '';
  }
}

/** True when the OCR toolchain is present. Used by readiness, never by a route. */
export async function ocrAvailable(): Promise<boolean> {
  try {
    await run(TESSERACT_BIN, ['--version'], 10_000);
    await run(PDFTOPPM_BIN, ['-v'], 10_000);
    return true;
  } catch {
    return false;
  }
}

export { readFile as readOcrInput };
