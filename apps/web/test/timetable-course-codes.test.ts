/**
 * Which course codes the timetable's subject-list reader accepts (M2.1).
 *
 * Every row here is SYNTHETIC: invented codes, titles and staff. The shapes come
 * from real timetables: VTU scheme codes (`BCS501`, `1BCIV105`) and the
 * year-prefixed codes some colleges print instead (`22CSE142`, `22CSE1234`,
 * `22CSE142X`: two-digit year, three-letter discipline, three or four digits,
 * optional letter).
 */
import { describe, expect, it } from 'vitest';
import { readDictionary, resolveGridSubject } from '../src/domain/timetable/timetable-import.js';

const codes = (rows: string[]) => readDictionary(rows).map((entry) => entry.subjectCode);

describe('VTU scheme codes (unchanged)', () => {
  it('still reads B-codes, 1B-codes and suffixed codes', () => {
    expect(
      codes([
        'BQX501 Quantum Accounting Prof. A B 3+0+0',
        'BQXL502 Queueing Basics Lab Dr. C 0+0+2',
        '1BQXY105 Applied Queues Prof. D 2+2+0',
        'BQX515A Elective One Prof. E 3+0+0',
      ]),
    ).toEqual(['BQX501', 'BQXL502', '1BQXY105', 'BQX515A']);
  });
});

describe('year-prefixed codes', () => {
  const table = [
    '22QQA142 Machine Learning Prof. A B 3+0+0',
    '22QQA1423 Deep Networks Lab Dr. C 0+0+2',
    '22QQB151X Open Elective Prof. D 3+0+0',
    '22QQC160 Project Work Phase-2',
  ];

  it('reads a two-digit year, three letters and three or four digits, with an optional letter', () => {
    expect(codes(table)).toEqual(['22QQA142', '22QQA1423', '22QQB151X', '22QQC160']);
  });

  it('keeps the titles and staff columns exactly as for VTU codes', () => {
    const [ml] = readDictionary(table);
    expect([ml?.title, ml?.faculty, ml?.collegeHours]).toEqual([
      'Machine Learning',
      'Prof. A B',
      '3+0+0',
    ]);
  });

  it('reads a code with punctuation or bullets around it', () => {
    expect(
      codes([
        '• 22QQA142 – Machine Learning',
        '(22QQA143) Data Mining',
        '22QQA144: Compiler Design',
      ]),
    ).toEqual(['22QQA142', '22QQA143', '22QQA144']);
  });

  it('lets a grid abbreviation resolve to a year-prefixed subject', () => {
    const resolved = resolveGridSubject(readDictionary(table), 'ML');
    expect([resolved.subjectCode, resolved.resolution]).toEqual(['22QQA142', 'initialism']);
  });

  it('does not read lower-case codes (the VTU grammar does not either)', () => {
    expect(codes(['22qqa142 Machine Learning', '22qqa143 Data Mining'])).toEqual([]);
  });
});

describe('numbers that are not course codes', () => {
  it.each([
    ['a phone number', 'Office: 0831-2407172, 2554559'],
    ['a time range', '10:00 am - 10:55 am'],
    ['an academic year', 'Academic Year 2024-25 Semester VII'],
    ['a date', 'With effect from 01.10.2026'],
    ['an embedded university seat number', 'Batch A1: 1XX22QQ001 to 1XX22QQ030'],
    ['a two-letter roll range', 'A1: 22QQ001 to 22QQ030'],
    ['an institution code', 'CET Code: E-175 (UG)/T-942 (PG)'],
    ['a room pair', 'Lab N505&N506'],
    ['a two-digit course number', '22QQA12 Too Short'],
    ['five digits', '22QQA12345 Too Long'],
  ])('ignores %s', (_label, row) => {
    expect(codes([row, `${row} again`])).toEqual([]);
  });
});

describe('a page printed in VTU codes is read exactly as before', () => {
  it('a year-like misreading among VTU rows is not taken as a code, and does not split the table', () => {
    const vtu = [
      'BQX501 Quantum Accounting Prof. A B 3+0+0',
      'BQX502 Queueing Basics Dr. C 3+0+0',
      '13QQK557 Research Methods and Practice Prof. D 2+0+0',
      'BQX503 Quality Dynamics Dr. E 3+0+0',
    ];
    expect(codes(vtu)).toEqual(['BQX501', 'BQX502', 'BQX503']);
    /* As before M2.1: the misread row stays inside the previous subject's block. */
    expect(readDictionary(vtu)[1]?.title.startsWith('Queueing Basics')).toBe(true);
  });

  it('a page printed in year-prefixed codes still reads a stray VTU code', () => {
    expect(
      codes(['22QQA142 Machine Learning', '22QQA143 Data Mining', 'BQX501 Quantum Accounting']),
    ).toEqual(['22QQA142', '22QQA143', 'BQX501']);
  });
});
