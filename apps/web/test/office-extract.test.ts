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
const FIRST_ROW = 'BQAS401 ENGINEERING MATHEMATICS 44 36 80 P';
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

describe('fileKind detection', () => {
  it('routes Office/ODF by MIME type', () => {
    const cases: [string, string][] = [
      ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'a.docx'],
      ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'a.xlsx'],
      ['application/vnd.openxmlformats-officedocument.presentationml.presentation', 'a.pptx'],
      ['application/vnd.oasis.opendocument.text', 'a.odt'],
      ['application/vnd.oasis.opendocument.spreadsheet', 'a.ods'],
      ['application/vnd.oasis.opendocument.presentation', 'a.odp'],
      ['application/vnd.oasis.opendocument.graphics', 'a.odg'],
      ['application/rtf', 'a.rtf'],
    ];
    for (const [type, name] of cases) expect(fileKind(fileOf(name, type))).toBe('office');
  });

  it('routes Office/ODF by extension when the picker omits the type (Android)', () => {
    for (const name of [
      'r.docx',
      'r.xlsx',
      'r.pptx',
      'r.odt',
      'r.ods',
      'r.odp',
      'r.odg',
      'r.rtf',
    ]) {
      expect(fileKind(fileOf(name, ''))).toBe('office');
    }
  });

  it('routes plain-text exports to the text path, not the heavy engine', () => {
    for (const name of ['r.csv', 'r.tsv', 'r.md', 'r.markdown', 'r.txt']) {
      expect(fileKind(fileOf(name, ''))).toBe('text');
    }
    expect(fileKind(fileOf('r.csv', 'text/csv'))).toBe('text');
    expect(fileKind(fileOf('r.txt', 'text/plain'))).toBe('text');
  });

  it('still refuses genuinely unsupported files', () => {
    expect(fileKind(fileOf('malware.exe', 'application/octet-stream'))).toBe('unsupported');
    expect(fileKind(fileOf('clip.mp4', 'video/mp4'))).toBe('unsupported');
  });

  it('leaves the existing PDF/image/HTML routing intact', () => {
    expect(fileKind(fileOf('r.pdf', 'application/pdf'))).toBe('pdf');
    expect(fileKind(fileOf('r.jpg', 'image/jpeg'))).toBe('image');
    expect(fileKind(fileOf('r.html', 'text/html'))).toBe('html');
  });
});

describe('sniffKind magic-byte routing', () => {
  it('routes a real Office/ODF file to the office decoder by SIGNATURE, not name', async () => {
    // Rename every fixture to a neutral ".bin" with no declared type, so only the
    // first bytes can decide — a mislabelled docx must still be detected.
    for (const [name] of OFFICE_FIXTURES) {
      expect(await sniffKind(fixtureFile(name, 'mystery.bin', ''))).toBe('office');
    }
  });

  it('routes signature-less text exports by extension', async () => {
    expect(await sniffKind(new File(['a,b,c'], 'x.csv', { type: '' }))).toBe('text');
    expect(await sniffKind(new File(['# notes'], 'x.md', { type: '' }))).toBe('text');
    expect(await sniffKind(new File(['plain'], 'x.txt', { type: '' }))).toBe('text');
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
    ['BQAS401', 'ENGINEERING MATHEMATICS', '44', '36', '80', 'P'],
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
