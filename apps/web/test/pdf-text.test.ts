// @vitest-environment node
/**
 * Reading a real PDF, end to end, with a real PDF engine.
 *
 * RUNS IN THE NODE ENVIRONMENT, not jsdom. Extraction touches no DOM, and
 * pdf.js only takes its main-thread path when it detects Node — under jsdom it
 * tries to construct a real Worker, which jsdom cannot run, and the read hangs
 * rather than failing. The environment is part of the test's setup, not a
 * property of the code under test.
 *
 * Authority: docs/22 §22.49 · M10A.6 §6, §11, §34, §37, §48
 *
 * ---------------------------------------------------------------------------
 * THE PDFs HERE ARE BUILT BYTE BY BYTE
 * ---------------------------------------------------------------------------
 *
 * A fixture file would be a binary blob nobody can review, and generating one
 * with a PDF-writing library would mean a dependency that ships to no user. So
 * the documents below are assembled from PDF operators in a few lines — which
 * also means a reader can see EXACTLY what the parser is being fed, including
 * the coordinates, and change one number to construct a new case.
 *
 * Every value is synthetic. No real student's card, marks or identifiers appear
 * here or anywhere in this repository.
 */

import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { extractPdfLines as extract, MAX_FILE_BYTES, PdfReadError } from '../src/lib/pdf-text.js';
import { parseResultCard } from '../src/domain/result-import.js';

/*
 * The worker as a FILESYSTEM url. In the browser the bundler resolves it with
 * `?url`, which produces a dev-server path Node cannot import — the one thing
 * that differs between the two environments, and the reason the source is
 * injectable at all.
 */
const workerSrc = pathToFileURL(
  createRequire(import.meta.url).resolve('pdfjs-dist/legacy/build/pdf.worker.min.mjs'),
).href;
const extractPdfLines = (data: ArrayBuffer) => extract(data, { workerSrc });

/** One `Td`/`Tj` pair: place the pen, draw the text. */
interface Placed {
  readonly text: string;
  readonly x: number;
  readonly y: number;
  readonly size?: number;
}

/**
 * A minimal, uncompressed, standards-conforming PDF.
 *
 * Uncompressed on purpose: the bytes stay greppable, so a failing test can be
 * diagnosed by reading the fixture rather than by decoding it.
 */
function makePdf(pages: readonly (readonly Placed[])[]): ArrayBuffer {
  const escape = (text: string) => text.replace(/([\\()])/g, '\\$1');

  const objects: string[] = [];
  const pageIds: number[] = [];
  // 1 = catalogue, 2 = page tree, 3 = font; pages and streams follow.
  let next = 4;

  const streams: string[] = [];
  for (const placed of pages) {
    const content =
      'BT\n' +
      placed
        .map(
          (item) =>
            `/F1 ${String(item.size ?? 10)} Tf\n1 0 0 1 ${String(item.x)} ${String(item.y)} Tm\n(${escape(item.text)}) Tj`,
        )
        .join('\n') +
      '\nET';
    const streamId = next++;
    const pageId = next++;
    pageIds.push(pageId);
    streams.push(
      `${String(streamId)} 0 obj\n<< /Length ${String(content.length)} >>\nstream\n${content}\nendstream\nendobj\n`,
    );
    objects.push(
      `${String(pageId)} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${String(streamId)} 0 R >>\nendobj\n`,
    );
  }

  const body = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    `2 0 obj\n<< /Type /Pages /Kids [${pageIds.map((id) => `${String(id)} 0 R`).join(' ')}] /Count ${String(pageIds.length)} >>\nendobj\n`,
    '3 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n',
    ...streams,
    ...objects,
  ];

  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  for (const object of body) {
    offsets.push(pdf.length);
    pdf += object;
  }
  const xref = pdf.length;
  const count = body.length + 1;

  pdf += `xref\n0 ${String(count)}\n0000000000 65535 f \n`;
  /*
   * Objects are emitted in the order above, and each xref entry must sit at the
   * index of ITS object number — so the table is filled by number, not by
   * emission order.
   */
  const byNumber = new Map<number, number>();
  body.forEach((object, index) => {
    const number = Number(/^(\d+) 0 obj/.exec(object)?.[1] ?? '0');
    byNumber.set(number, offsets[index] as number);
  });
  for (let number = 1; number < count; number += 1) {
    pdf += `${String(byNumber.get(number) ?? 0).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${String(count)} /Root 1 0 R >>\nstartxref\n${String(xref)}\n%%EOF`;

  return new TextEncoder().encode(pdf).buffer as ArrayBuffer;
}

/** A synthetic VTU-shaped result page. */
function resultPage(semester: number, rows: readonly string[][]): Placed[] {
  const placed: Placed[] = [
    { text: 'VISVESVARAYA TECHNOLOGICAL UNIVERSITY, BELAGAVI', x: 60, y: 750 },
    { text: 'VTU PROVISIONAL RESULTS OF UG / PG EXAMINATION', x: 60, y: 735 },
    { text: 'University Seat Number : 9ZZ99ZZ999', x: 60, y: 715 },
    { text: `Semester : ${String(semester)}`, x: 60, y: 700 },
    { text: 'Subject Code', x: 60, y: 680 },
    { text: 'Internal Marks', x: 300, y: 680 },
    { text: 'External Marks', x: 380, y: 680 },
  ];

  /*
   * Columns are placed independently, exactly as a real producer emits a table.
   * The row only exists because the coordinates say so.
   */
  rows.forEach((row, index) => {
    const y = 660 - index * 18;
    const xs = [60, 140, 310, 390, 450, 490, 520];
    row.forEach((cell, column) => {
      placed.push({ text: cell, x: xs[column] as number, y });
    });
  });

  return placed;
}

describe('reading a synthetic result PDF', () => {
  it('extracts the rows a real producer emits column by column', async () => {
    const pdf = makePdf([
      resultPage(4, [
        ['BQAS401', 'ALGORITHMS', '44', '36', '80', 'P', '2026-07-23'],
        ['BQAS402', 'FINANCE', '40', '19', '59', 'P', '2026-07-23'],
      ]),
    ]);

    const extraction = await extractPdfLines(pdf);
    expect(extraction.hasTextLayer).toBe(true);
    expect(extraction.pageCount).toBe(1);

    const card = parseResultCard(extraction.lines);
    expect(card.looksLikeResultCard).toBe(true);
    expect(card.semester).toBe(4);
    expect(card.rows).toHaveLength(2);
    expect(card.rows[0]).toMatchObject({
      subjectCode: 'BQAS401',
      internal: 44,
      external: 36,
      total: 80,
      resultStatus: 'P',
      announcedOn: '2026-07-23',
    });
  });

  it('reads an 8-subject and a 9-subject card without a fixed count', async () => {
    const rows = (count: number, prefix: string) =>
      Array.from({ length: count }, (_, i) => [
        `${prefix}${String(i)}`,
        `SUBJECT ${String(i)}`,
        '40',
        '30',
        '70',
        'P',
        '2026-03-13',
      ]);

    const eight = await extractPdfLines(makePdf([resultPage(1, rows(8, 'BQAS10'))]));
    const nine = await extractPdfLines(makePdf([resultPage(4, rows(9, 'BQAS40'))]));

    expect(parseResultCard(eight.lines).rows).toHaveLength(8);
    expect(parseResultCard(nine.lines).rows).toHaveLength(9);
  });

  it('reads a two-page document and keeps the page each row came from', async () => {
    const pdf = makePdf([
      resultPage(4, [['BQAS401', 'ALGORITHMS', '44', '36', '80', 'P', '2026-07-23']]),
      resultPage(4, [['BQAS402', 'FINANCE', '40', '19', '59', 'P', '2026-07-23']]),
    ]);

    const extraction = await extractPdfLines(pdf);
    expect(extraction.pageCount).toBe(2);

    const card = parseResultCard(extraction.lines);
    expect(card.rows.map((row) => [row.subjectCode, row.page])).toEqual([
      ['BQAS401', 1],
      ['BQAS402', 2],
    ]);
  });

  it('reports a total that does not add up, from a real PDF', async () => {
    // The refusal, all the way through the real engine rather than only over
    // hand-written lines.
    const pdf = makePdf([
      resultPage(4, [['BQAS401', 'ALGORITHMS', '44', '36', '90', 'P', '2026-07-23']]),
    ]);
    const card = parseResultCard((await extractPdfLines(pdf)).lines);
    expect(card.rows[0]?.total).toBe(90);
    expect(card.rows[0]?.warnings.map((w) => w.kind)).toEqual(['total_mismatch']);
  });
});

describe('a PDF that is not a result card', () => {
  it('is read successfully and recognised as something else', async () => {
    /*
     * Reading and RECOGNISING are separate steps. The engine has no trouble
     * with this file; the parser declines to treat it as a result (§11).
     */
    const pdf = makePdf([
      [
        { text: 'ACME SUPPLIES LIMITED', x: 60, y: 700 },
        { text: 'Invoice 4417', x: 60, y: 680 },
      ],
    ]);
    const extraction = await extractPdfLines(pdf);
    expect(extraction.hasTextLayer).toBe(true);
    expect(parseResultCard(extraction.lines).looksLikeResultCard).toBe(false);
  });
});

describe('hostile and malformed input', () => {
  it('refuses a file that is not a PDF, with a message rather than a stack', async () => {
    const notPdf = new TextEncoder().encode('this is not a pdf at all').buffer as ArrayBuffer;
    await expect(extractPdfLines(notPdf)).rejects.toBeInstanceOf(PdfReadError);
  });

  it('refuses a file past the size limit before opening it', async () => {
    // Checked on the byte length FIRST, so an oversized file is never handed to
    // the engine at all (§37).
    const huge = new ArrayBuffer(MAX_FILE_BYTES + 1);
    await expect(extractPdfLines(huge)).rejects.toThrow(/larger than/i);
  });

  it('carries hostile text through as text, and never as markup', async () => {
    /*
     * Extracted text is untrusted (§36). React escapes it on render; this test
     * pins that the PARSER does not treat it specially either — the script tag
     * is simply not a subject row, and the good row beside it still reads.
     */
    const pdf = makePdf([
      resultPage(4, [
        ['BQAS401', '<script>alert(1)</script>', '44', '36', '80', 'P', '2026-07-23'],
      ]),
    ]);
    const card = parseResultCard((await extractPdfLines(pdf)).lines);
    expect(card.rows[0]?.subjectTitle).toBe('<script>alert(1)</script>');
    expect(card.rows[0]?.internal).toBe(44);
  });

  it('reports a document with no text layer instead of returning nothing useful', async () => {
    /*
     * THE SCAN SIGNAL. A page with no text is what an image-only PDF looks
     * like, and it needs OCR — which this build does not have. Saying so is the
     * difference between "we cannot read this" and a silent empty result (§39).
     */
    const blank = makePdf([[]]);
    const extraction = await extractPdfLines(blank);
    expect(extraction.hasTextLayer).toBe(false);
    expect(extraction.lines).toEqual([]);
  });
});
