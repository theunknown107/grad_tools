/**
 * Multi-format ingestion: Office/ODF and plain-text extraction, and the
 * detection that routes to it.
 *
 * The invariant under test is that FORMAT DOES NOT DETERMINE SEMANTICS. The same
 * synthetic result card, represented as DOCX, ODT, RTF, XLSX, ODS, ODP, ODG,
 * PPTX, CSV, TSV, Markdown and plain text, all produce lines that the EXISTING
 * deterministic parsers — `classifyDocument`, `parseResultCard` — read exactly as
 * they read a PDF's text layer. The extractor is a text layer, never an authority
 * over marks or pass/fail.
 *
 * Fixtures are synthetic (see fixtures/office/make-fixtures.mjs): no real name,
 * USN, email or mark.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { classifyDocument } from '../src/domain/document-type.js';
import { parseResultCard } from '../src/domain/result-import.js';
import { fileKind, sniffKind } from '../src/lib/result-file.js';
import { OfficeReadError, readOfficeFile, readTextFile } from '../src/lib/office-extract.js';

const dir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'office');

/** A fixture's bytes as a standalone ArrayBuffer. */
function fixture(name: string): ArrayBuffer {
  const buf = readFileSync(join(dir, name));
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

/** A File carrying a fixture's real bytes, named/typed as the caller says. */
function fixtureFile(name: string, as = name, type = ''): File {
  return new File([new Uint8Array(readFileSync(join(dir, name)))], as, { type });
}

const fileOf = (name: string, type = ''): File => new File([new Blob(['x'])], name, { type });

/** The card every fixture encodes — the baseline semantic parity target. */
const SEAT = 'University Seat Number : 1XX22CS001';
const FIRST_ROW = 'BQAS401 ENGINEERING MATHEMATICS 46 34 80 P';
const EXPECTED_ROWS = 3;
const OFFICE_FIXTURES: [string, string][] = [
  ['result-card.docx', 'docx'],
  ['result-card.odt', 'odt'],
  ['result-card.rtf', 'rtf'],
  ['result-card.xlsx', 'xlsx'],
  ['result-card.ods', 'ods'],
  ['result-card.odp', 'odp'],
  ['result-card.odg', 'odg'],
  ['result-card.pptx', 'pptx'],
];

describe('fileKind detection (upload allow-list: images, PDF, DOCX, XLSX)', () => {
  it('accepts Word and Excel by MIME type, and refuses every other office format', () => {
    expect(
      fileKind(
        fileOf('a.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'),
      ),
    ).toBe('office');
    expect(
      fileKind(
        fileOf('a.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'),
      ),
    ).toBe('office');
    const refused: [string, string][] = [
      ['application/vnd.openxmlformats-officedocument.presentationml.presentation', 'a.pptx'],
      ['application/vnd.oasis.opendocument.text', 'a.odt'],
      ['application/vnd.oasis.opendocument.spreadsheet', 'a.ods'],
      ['application/vnd.ms-excel', 'a.xls'],
      ['application/rtf', 'a.rtf'],
    ];
    for (const [type, name] of refused) expect(fileKind(fileOf(name, type))).toBe('unsupported');
  });

  it('accepts Word and Excel by extension when the picker omits the type (Android)', () => {
    expect(fileKind(fileOf('r.docx', ''))).toBe('office');
    expect(fileKind(fileOf('r.xlsx', ''))).toBe('office');
    for (const name of ['r.pptx', 'r.odt', 'r.ods', 'r.odp', 'r.odg', 'r.rtf', 'r.xls']) {
      expect(fileKind(fileOf(name, ''))).toBe('unsupported');
    }
  });

  it('refuses text exports and saved web pages', () => {
    for (const name of ['r.csv', 'r.tsv', 'r.md', 'r.markdown', 'r.txt', 'r.html']) {
      expect(fileKind(fileOf(name, ''))).toBe('unsupported');
    }
    expect(fileKind(fileOf('r.csv', 'text/csv'))).toBe('unsupported');
    expect(fileKind(fileOf('r.html', 'text/html'))).toBe('unsupported');
  });

  it('still refuses genuinely unsupported files', () => {
    expect(fileKind(fileOf('malware.exe', 'application/octet-stream'))).toBe('unsupported');
    expect(fileKind(fileOf('clip.mp4', 'video/mp4'))).toBe('unsupported');
  });

  it('leaves PDF and image routing intact', () => {
    expect(fileKind(fileOf('r.pdf', 'application/pdf'))).toBe('pdf');
    expect(fileKind(fileOf('r.jpg', 'image/jpeg'))).toBe('image');
  });
});

describe('sniffKind magic-byte routing', () => {
  it('reads a Word or Excel file by its signature when it says it is DOCX or XLSX', async () => {
    expect(await sniffKind(fixtureFile('result-card.docx', 'card.docx', ''))).toBe('office');
    expect(await sniffKind(fixtureFile('result-card.xlsx', 'card.xlsx', ''))).toBe('office');
  });

  it('refuses other ZIP-based and office formats, and a ZIP that does not say DOCX/XLSX', async () => {
    for (const [name] of OFFICE_FIXTURES.filter(([, kind]) => kind !== 'docx' && kind !== 'xlsx')) {
      expect(await sniffKind(fixtureFile(name))).toBe('unsupported');
    }
    expect(await sniffKind(fixtureFile('result-card.docx', 'mystery.bin', ''))).toBe('unsupported');
  });

  it('refuses signature-less text exports', async () => {
    expect(await sniffKind(new File(['a,b,c'], 'x.csv', { type: '' }))).toBe('unsupported');
    expect(await sniffKind(new File(['# notes'], 'x.md', { type: '' }))).toBe('unsupported');
    expect(await sniffKind(new File(['plain'], 'x.txt', { type: '' }))).toBe('unsupported');
  });

  it('still refuses an unknown binary with no usable name or type', async () => {
    const junk = new File([new Uint8Array([0x00, 0x01, 0x02, 0x03])], 'mystery.bin', { type: '' });
    expect(await sniffKind(junk)).toBe('unsupported');
  });

  it('leaves the existing PDF/image detection intact', async () => {
    expect(await sniffKind(new File(['%PDF-1.7\n'], 'card.jpg', { type: 'image/jpeg' }))).toBe(
      'pdf',
    );
  });
});

describe('readOfficeFile extraction, provenance and parity', () => {
  // Every binary format carries the identical card; extraction + classification +
  // parsing must agree across all of them.
  it.each(OFFICE_FIXTURES)(
    'extracts %s as a result card, identically to every other format',
    async (name, format) => {
      const reading = await readOfficeFile(fixture(name), name);

      // A text extraction, never dressed up as a measured confidence.
      expect(reading.source).toBe('text');
      expect(reading.meanConfidence).toBeNull();
      expect(reading.placed).toEqual([]); // Office/ODF carry no reliable geometry.

      // Provenance travels with the reading.
      expect(reading.provenance).toEqual({
        engine: 'officeparser',
        engineVersion: expect.any(String),
        format,
        mode: 'text-extraction',
      });

      const text = reading.lines.map((line) => line.text);
      expect(text).toContain(SEAT);
      expect(text).toContain('Semester : 4');
      // The table/row arrives space-joined, the shape a PDF text layer produces.
      expect(text).toContain(FIRST_ROW);

      // Reading order is preserved: the seat number precedes the first subject.
      expect(text.indexOf(SEAT)).toBeLessThan(text.findIndex((l) => l.startsWith('BQAS401')));

      // FORMAT DOES NOT DETERMINE SEMANTICS: the existing classifier and parser
      // read these lines as a result card, identically for every format.
      expect(classifyDocument(reading.lines).type).toBe('result');
      const card = parseResultCard(reading.lines);
      expect(card.rows.length).toBe(EXPECTED_ROWS);
      // The parsed codes agree, not just the count.
      expect(card.rows.map((r) => r.subjectCode)).toEqual(['BQAS401', 'BQCS402', 'BQCS403']);
    },
  );

  it('fails cleanly on bytes that are not a real document — no silent reinterpretation', async () => {
    const junk = new TextEncoder().encode('this is not an office file').buffer;
    await expect(readOfficeFile(junk, 'broken.docx')).rejects.toBeInstanceOf(OfficeReadError);
  });

  it('reports cancellation distinctly when aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      readOfficeFile(fixture('result-card.docx'), 'result-card.docx', controller.signal),
    ).rejects.toThrow(/cancelled/i);
  });
});

describe('readTextFile', () => {
  const PREAMBLE = ['University Seat Number : 1XX22CS001', 'Semester : 4'];
  const HEADER = [
    'Subject Code',
    'Subject Name',
    'Internal Marks',
    'External Marks',
    'Total',
    'Result',
  ];
  const ROWS = [
    ['BQAS401', 'ENGINEERING MATHEMATICS', '46', '34', '80', 'P'],
    ['BQCS402', 'DATA STRUCTURES', '40', '38', '78', 'P'],
    ['BQCS403', 'OPERATING SYSTEMS', '42', '35', '77', 'P'],
  ];
  const LEGEND = 'P -> PASS, F -> FAIL, A -> ABSENT';

  const delimited = (sep: string): string =>
    [...PREAMBLE, HEADER.join(sep), ...ROWS.map((r) => r.join(sep)), LEGEND].join('\n');
  const pipeTable = (): string =>
    [
      ...PREAMBLE,
      `| ${HEADER.join(' | ')} |`,
      `|${HEADER.map(() => '---').join('|')}|`,
      ...ROWS.map((r) => `| ${r.join(' | ')} |`),
      LEGEND,
    ].join('\n');

  it.each([
    ['results.csv', 'text/csv', delimited(',')],
    ['results.tsv', 'text/tab-separated-values', delimited('\t')],
    ['results.md', 'text/markdown', pipeTable()],
    ['results.txt', 'text/plain', delimited(' ')],
  ])('reads %s into reviewable, parseable lines', async (name, type, body) => {
    const reading = await readTextFile(new File([body], name, { type }));
    const text = reading.lines.map((line) => line.text);
    expect(text).toContain(FIRST_ROW);
    expect(reading.provenance?.engine).toBe('builtin');
    expect(reading.source).toBe('text');
    expect(classifyDocument(reading.lines).type).toBe('result');
    expect(parseResultCard(reading.lines).rows.length).toBe(EXPECTED_ROWS);
  });

  it('refuses a text file too large to be a result export', async () => {
    const huge = new File(['x'.repeat(6 * 1024 * 1024)], 'big.txt', { type: 'text/plain' });
    await expect(readTextFile(huge)).rejects.toBeInstanceOf(OfficeReadError);
  });
});
