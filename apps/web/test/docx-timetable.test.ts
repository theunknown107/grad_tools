/**
 * Word timetables read from their TABLES (lib/docx-structure + domain/docx-timetable).
 *
 * Every fixture is SYNTHETIC: a .docx assembled in memory from hand-written
 * WordprocessingML (invented subjects, rooms and codes; no real document). It
 * reproduces the structures a real college Word timetable uses — a header row of
 * time ranges, a day label merged down over a subject row and a room row, a
 * sliver grid column, a lab merged over two slots, a cell naming two subjects
 * over two slots, a catalogue below the grid, and two class sections.
 */
import { zipSync, strToU8 } from 'fflate';
import { describe, expect, it } from 'vitest';
import { readDocxStructure } from '../src/lib/docx-structure.js';
import { docxTimetables } from '../src/domain/docx-timetable.js';

const p = (text: string) => `<w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
const tc = (paras: string[], opts: { span?: number; vMerge?: 'restart' | 'continue' } = {}) =>
  `<w:tc><w:tcPr>${opts.span ? `<w:gridSpan w:val="${String(opts.span)}"/>` : ''}${
    opts.vMerge === 'restart'
      ? '<w:vMerge w:val="restart"/>'
      : opts.vMerge === 'continue'
        ? '<w:vMerge/>'
        : ''
  }</w:tcPr>${paras.length ? paras.map(p).join('') : '<w:p/>'}</w:tc>`;
const tr = (cells: string[]) => `<w:tr>${cells.join('')}</w:tr>`;

/*
 * Grid columns (twips): 0 day | 1 slot1 | 2 sliver | 3 slot2 | 4 break | 5 slot3 | 6 slot4 | 7 slot5
 * The header's slot2 cell spans the sliver too; a body cell spanning slot1+sliver must stay in slot1.
 */
const GRID =
  '<w:tblGrid>' +
  [1400, 1200, 12, 1200, 400, 1200, 1200, 1200]
    .map((w) => `<w:gridCol w:w="${String(w)}"/>`)
    .join('') +
  '</w:tblGrid>';

function grid(roomPrefix: string): string {
  const header = tr([
    tc(['Day/Hour']),
    tc(['9:00 am', 'to', '9:55 am']),
    tc(['9:55am', 'to', '10:50am'], { span: 2 }),
    tc(['10:50 am to 11:10 am']),
    tc(['11:10 am to 12:05 pm']),
    tc(['12:05 pm to 1:00 pm']),
    tc(['2:00 pm to 2:55 pm']),
  ]);
  const room = (r: string) => tc([`${roomPrefix}-${r}`]);
  const days = [
    // Monday: QA in slot1 (cell spans slot1 + sliver), QB in slot2, break, a lab merged over slot3+slot4, QD in slot5
    tr([
      tc(['Monday'], { vMerge: 'restart' }),
      tc(['QA'], { span: 2 }),
      tc(['QB']),
      tc(['S', 'H', 'O', 'R', 'T', 'B', 'R', 'E', 'A', 'K'], { vMerge: 'restart' }),
      tc(['QL LAB (Batch-A1)', 'Lab 3'], { span: 2 }),
      tc(['QZ']),
    ]),
    tr([
      tc([], { vMerge: 'continue' }),
      tc([`${roomPrefix}-101`], { span: 2 }),
      room('101'),
      tc([], { vMerge: 'continue' }),
      tc([], { span: 2 }),
      room('101'),
    ]),
    // Tuesday: one cell naming two subjects over two slots, with one room under each
    tr([
      tc(['Tuesday'], { vMerge: 'restart' }),
      tc(['QB'], { span: 2 }),
      tc(['QA']),
      tc([], { vMerge: 'restart' }),
      tc(['QA  QD'], { span: 2 }),
      tc(['QC-T']),
    ]),
    tr([
      tc([], { vMerge: 'continue' }),
      tc([`${roomPrefix}-101`], { span: 2 }),
      room('101'),
      tc([], { vMerge: 'continue' }),
      room('102'),
      room('103'),
      room('101'),
    ]),
  ];
  const catalogue = [
    tr([tc(['Subject code – Name'], { span: 4 }), tc(['Faculty'], { span: 4 })]),
    tr([tc(['BQX501 Quantum Accounting'], { span: 4 }), tc(['Prof. Q'], { span: 4 })]),
    tr([tc(['BQX502 Queueing Basics'], { span: 4 }), tc(['Dr. Q'], { span: 4 })]),
    tr([tc(['BQXL502 Queueing Basics Lab'], { span: 4 }), tc(['Dr. Q'], { span: 4 })]),
    tr([tc(['BQX503 Quality Dynamics'], { span: 4 }), tc(['Dr. Q'], { span: 4 })]),
    tr([tc(['BQXL505 Quantum Lab'], { span: 4 }), tc(['Dr. Q'], { span: 4 })]),
  ];
  return `<w:tbl>${GRID}${header}${days.join('')}${catalogue.join('')}</w:tbl>`;
}

function docx(body: string, prolog = ''): Uint8Array {
  const xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>${prolog}<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`;
  return zipSync({ 'word/document.xml': strToU8(xml), '[Content_Types].xml': strToU8('<Types/>') });
}

const TWO_SECTIONS = docx(
  `${p('V (A) - Timetable for the Academic year 2099-00 (R0)')}${grid('LH')}${p('V (B) - Timetable for the Academic year 2099-00 (R0)')}${grid('RM')}`,
);

describe('reading the Word structure', () => {
  it('keeps tables, rows, cells, spans and vertical merges — nothing is flattened', () => {
    const s = readDocxStructure(TWO_SECTIONS);
    expect(s).not.toBeNull();
    const tables = s!.blocks.filter((b) => b.kind === 'table');
    expect(tables).toHaveLength(2);
    const t = (
      tables[0] as unknown as {
        table: {
          rows: { colStart: number; colEnd: number; rowSpan: number; paragraphs: string[] }[][];
        };
      }
    ).table;
    const monday = t.rows[1]![0]!;
    expect([monday.paragraphs, monday.rowSpan]).toEqual([['Monday'], 2]);
    const qa = t.rows[1]![1]!;
    expect([qa.colStart, qa.colEnd]).toEqual([1, 2]);
    expect(t.rows[1]![4]!.paragraphs).toEqual(['QL LAB (Batch-A1)', 'Lab 3']);
  });

  it('refuses a document that declares a DOCTYPE (no entity expansion)', () => {
    expect(readDocxStructure(docx(p('x'), '<!DOCTYPE w [<!ENTITY a "aaaa">]>'))).toBeNull();
  });

  it('returns null, not a partial structure, for a non-docx or a broken archive', () => {
    expect(readDocxStructure(new Uint8Array([1, 2, 3, 4]))).toBeNull();
    expect(readDocxStructure(zipSync({ 'x.txt': strToU8('hi') }))).toBeNull();
  });
});

describe('class timetables from Word tables', () => {
  const sections = docxTimetables(readDocxStructure(TWO_SECTIONS)!);
  const a = sections[0]!.timetable;
  const at = (day: string, start: string) =>
    a.classes.filter((c) => c.day === day && c.start === start);

  it('returns one timetable per class section, labelled as printed, never merged', () => {
    expect(sections.map((s) => s.label)).toEqual(['V (A)', 'V (B)']);
    expect(
      sections[1]!.timetable.classes.every((c) => c.room === null || c.room.startsWith('RM-')),
    ).toBe(true);
  });

  it('places a cell by real column overlap: a sliver column does not pull it into the next hour', () => {
    expect(at('Mon', '09:00').map((c) => [c.initials, c.end])).toEqual([['QA', '09:55']]);
    expect(at('Mon', '09:55').map((c) => c.initials)).toEqual(['QB']);
  });

  it("a room is the class's room, never a class or a subject", () => {
    expect(a.classes.some((c) => /^LH-|^Lab /.test(c.initials))).toBe(false);
    expect(at('Mon', '09:00')[0]!.room).toBe('LH-101');
  });

  it('a break column is not a class', () => {
    expect(a.classes.some((c) => /BREAK/i.test(c.sourceText))).toBe(false);
    expect(a.slots.filter((s) => s.isBreak).map((s) => s.start)).toEqual(['10:50']);
  });

  it('a lab merged over two slots is ONE class over both, keeps its batch, and is confirmed only because it spells its lab title', () => {
    const lab = at('Mon', '11:10');
    expect(lab).toHaveLength(1);
    expect([lab[0]!.end, lab[0]!.spansSlots, lab[0]!.batch]).toEqual(['13:00', 2, 'A1']);
    /* "QL LAB" = full initials of the one lab title "Quantum Lab" (see the lab-rule tests below). */
    expect([lab[0]!.subjectCode, lab[0]!.resolution]).toEqual(['BQXL505', 'initialism']);
  });

  it('a cell naming two subjects over two slots, with a room under each, becomes one class per slot', () => {
    expect(at('Tue', '11:10').map((c) => [c.initials, c.end, c.room])).toEqual([
      ['QA', '12:05', 'LH-102'],
    ]);
    expect(at('Tue', '12:05').map((c) => [c.initials, c.end, c.room])).toEqual([
      ['QD', '13:00', 'LH-103'],
    ]);
  });

  it("subjects resolve only through the document's own catalogue; a plain cell prefers the theory course over its lab", () => {
    expect(at('Mon', '09:55')[0]!.subjectCode).toBe('BQX502');
    expect(at('Mon', '09:00')[0]!.subjectCode).toBe('BQX501');
    /* "QZ" is in no catalogue title: kept, never given an invented code. */
    expect(at('Mon', '14:00')[0]!.subjectCode).toBeNull();
  });
});

describe('lab cells and the catalogue (regressions from the 15-document pilot)', () => {
  const lab = (cell: string) => {
    const body = `<w:tbl>${GRID}${tr([tc(['Day']), tc(['9:00 am to 9:55 am'], { span: 2 }), tc(['9:55 am to 10:50 am']), tc(['10:50 am to 11:10 am']), tc(['11:10 am to 12:05 pm']), tc(['12:05 pm to 1:00 pm']), tc(['2:00 pm to 2:55 pm'])])}${tr([tc(['Monday']), tc([cell], { span: 3 }), tc(['BREAK']), tc(['QA']), tc(['QB']), tc(['QB'])])}${tr([tc(['Tuesday']), tc(['QA'], { span: 2 }), tc(['QB']), tc(['BREAK']), tc(['QA']), tc(['QB']), tc(['QA'])])}${tr([tc(['BQX502 Queueing Basics'], { span: 8 })])}${tr([tc(['BQXL502 Queueing Basics Lab'], { span: 8 })])}${tr([tc(['BQXL504 Computational Quality Lab'], { span: 8 })])}${tr([tc(['BQX503 Data Structures Programming'], { span: 8 })])}</w:tbl>`;
    const c = docxTimetables(readDocxStructure(docx(body))!)[0]!.timetable.classes.find(
      (x) => x.day === 'Mon' && x.start === '09:00',
    )!;
    return [c.subjectCode, c.resolution];
  };
  it('a lab cell that spells a lab title\'s full initials ("CQL LAB") is confirmed', () => {
    expect(lab('CQL LAB')).toEqual(['BQXL504', 'initialism']);
  });
  it('a lab cell matching a THEORY title ("DSP LAB") is never confirmed', () => {
    expect(lab('DSP LAB')[1]).not.toBe('initialism');
  });
  it('"QB Lab" (theory initials) and "QBL-B1" (no word LAB) stay suggestions, never confirmed', () => {
    expect(lab('QB Lab')[1]).not.toMatch(/initialism|declared/);
    expect(lab('QBL-B1')[1]).not.toMatch(/initialism|declared/);
  });
});
