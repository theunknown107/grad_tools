/**
 * Reading a result card, and the readings that must not be repaired.
 *
 * Authority: docs/22 §22.48 · M10A.6 §17, §21, §31, §32, §50, §52, §87
 *
 * ---------------------------------------------------------------------------
 * EVERY DOCUMENT HERE IS SYNTHETIC
 * ---------------------------------------------------------------------------
 *
 * The STRUCTURE follows the supplied real cards — column order, the legend, the
 * "Semester : N" line. No real student's name, seat number, marks, dates or
 * subject rows appear anywhere in this file or in the repository (§49).
 *
 * ---------------------------------------------------------------------------
 * THE TWO REPAIRS THAT WOULD LOOK LIKE QUALITY
 * ---------------------------------------------------------------------------
 *
 * Recomputing a total that does not add up, and matching an unreadable code to
 * the nearest catalogue entry, both turn a visible problem into an invisible
 * wrong answer. Each has a test below asserting that it does NOT happen.
 */

import { describe, expect, it } from 'vitest';
import {
  parseResultCard,
  parseRow,
  rowToSubject,
  type ImportLine,
} from '../src/domain/result-import.js';
import { evaluateResultSubject } from '../src/domain/results.js';
import { vtu2022RuleSet } from '@gradtools/academic-rules';

/** A synthetic card, in the layout a text extraction produces. */
function card(rows: readonly string[], semester = 4, extra: readonly string[] = []): ImportLine[] {
  return [
    'VISVESVARAYA TECHNOLOGICAL UNIVERSITY, BELAGAVI',
    'VTU PROVISIONAL RESULTS OF UG / PG EXAMINATION',
    'University Seat Number : 9ZZ99ZZ999',
    'Student Name          : SYNTHETIC STUDENT',
    `Semester : ${String(semester)}`,
    'Subject Code  Subject Name           Internal Marks  External Marks  Total  Result  Announced / Updated on',
    ...rows,
    ...extra,
    'P -> PASS   F -> FAIL   A -> ABSENT   W -> WITHHELD   X, NE -> NOT ELIGIBLE',
  ].map((text) => ({ text, page: 1 }));
}

const GOOD_ROW = 'BQAS401  ANALYSIS AND DESIGN OF ALGORITHMS   44  36  80  P  2026-07-23';

describe('reading one row', () => {
  const read = (text: string) => parseRow({ text, page: 1 }, true);

  it('reads code, title, three marks, status and date', () => {
    const row = read(GOOD_ROW);
    expect(row).toMatchObject({
      subjectCode: 'BQAS401',
      subjectTitle: 'ANALYSIS AND DESIGN OF ALGORITHMS',
      internal: 44,
      external: 36,
      total: 80,
      resultStatus: 'P',
      announcedOn: '2026-07-23',
    });
    expect(row?.warnings).toEqual([]);
  });

  it('keeps a title containing ampersands, digits and brackets', () => {
    /*
     * The title is never matched — it is what is LEFT between the code and the
     * marks. So punctuation in a course name needs no special case, which is
     * the point of reading from both ends.
     */
    const row = read('BQAS402  INTERNET OF THINGS (IOT) & B-TREES   40  19  59  P  2026-07-23');
    expect(row?.subjectTitle).toBe('INTERNET OF THINGS (IOT) & B-TREES');
  });

  it('reads a row with no date printed', () => {
    expect(read('BQAS403  DATABASE SYSTEMS   39  28  67  P')).toMatchObject({
      total: 67,
      announcedOn: null,
    });
  });

  it('is not a row when the line is a heading or a legend', () => {
    expect(read('Subject Code  Subject Name  Internal Marks')).toBeNull();
    expect(read('P -> PASS   F -> FAIL')).toBeNull();
    expect(read('Semester : 4')).toBeNull();
  });

  it('REPORTS a total that does not add up, and does not repair it', () => {
    /*
     * THE MOST VALUABLE THING A PARSER CAN NOTICE. Recomputing 80 here would
     * turn a transcription error into a confident wrong number that nothing
     * downstream could question (§17).
     */
    const row = read('BQAS401  ALGORITHMS   44  36  90  P  2026-07-23');
    expect(row?.total).toBe(90);
    expect(row?.warnings.map((w) => w.kind)).toEqual(['total_mismatch']);
    expect(row?.warnings[0]?.message).toMatch(/44 \+ 36 = 80, but 90 was read/);
  });

  it('reports a later-scheme code instead of reinterpreting it', () => {
    /*
     * `1BQAS401` contains `BQAS401`. Stripping the digit to make it match is
     * exactly the failure OQ-053 recorded, and it produces a row that passes
     * every other check (§87).
     */
    const row = read('1BQAS401  ALGORITHMS   44  36  80  P  2026-07-23');
    expect(row?.subjectCode).toBe('1BQAS401');
    expect(row?.warnings.map((w) => w.kind)).toEqual(['scheme_mismatch']);
  });

  it('does not flag a later-scheme code for a student on that scheme', () => {
    const row = parseRow({ text: '1BQAS401  ALGORITHMS  44  36  80  P', page: 1 }, false);
    expect(row?.warnings).toEqual([]);
  });

  it('reports a missing title rather than inventing one', () => {
    const row = read('BQAS404     45  49  94  P  2026-07-23');
    expect(row?.subjectTitle).toBe('');
    expect(row?.warnings.map((w) => w.kind)).toEqual(['missing_title']);
  });

  it('keeps a status the legend does not list, and says so', () => {
    // The card's legend is what this university printed, not a closed universe.
    const row = read('BQAS405  GRAPH THEORY   44  22  66  Z  2026-07-23');
    expect(row?.resultStatus).toBe('Z');
    expect(row?.warnings.map((w) => w.kind)).toEqual(['unknown_status']);
  });

  it('keeps the line it read, so a wrong reading can be explained', () => {
    expect(read(GOOD_ROW)?.sourceLine).toBe(GOOD_ROW);
  });

  it('never silently maps a code onto a similar catalogue entry', () => {
    /*
     * `BQAS403` and `BQAS408` are both plausible codes. A parser that repaired
     * one into the other by similarity would produce a row describing a course
     * the student never took, and every downstream check would pass (§32).
     */
    const row = read('BQAS403  DATABASE SYSTEMS   39  28  67  P');
    expect(row?.subjectCode).toBe('BQAS403');
  });
});

describe('reading a whole card', () => {
  it('reads the semester from the page, never from a filename', () => {
    expect(parseResultCard(card([GOOD_ROW], 4)).semester).toBe(4);
    // A file called result_s3.pdf whose page says 4 is a semester-4 card (§11).
    expect(parseResultCard(card([GOOD_ROW], 1)).semester).toBe(1);
  });

  it('leaves the semester unknown when the page does not say', () => {
    const lines = card([GOOD_ROW]).filter((line) => !/^Semester/.test(line.text));
    const parsed = parseResultCard(lines);
    expect(parsed.semester).toBeNull();
    expect(parsed.warnings[0]?.message).toMatch(/semester was not printed/i);
  });

  it('reads an 8-subject and a 9-subject semester without a fixed count', () => {
    // Both are real shapes. Nothing anywhere assumes either (§53).
    const eight = Array.from(
      { length: 8 },
      (_, i) => `BQAS10${String(i)}  SUBJECT ${String(i)}   40  30  70  P  2026-03-13`,
    );
    const nine = Array.from(
      { length: 9 },
      (_, i) => `BQAS40${String(i)}  SUBJECT ${String(i)}   40  30  70  P  2026-07-23`,
    );
    expect(parseResultCard(card(eight, 1)).rows).toHaveLength(8);
    expect(parseResultCard(card(nine, 4)).rows).toHaveLength(9);
  });

  it('recognises a result card, and declines to read an unrelated document', () => {
    expect(parseResultCard(card([GOOD_ROW])).looksLikeResultCard).toBe(true);

    const invoice = [
      'ACME SUPPLIES LIMITED',
      'Invoice 4417',
      'WIDGET900  BRASS FITTING   44  36  80  P  2026-07-23',
    ].map((text) => ({ text, page: 1 }));
    // A row-shaped line is not enough: a document must say what it is (§48).
    expect(parseResultCard(invoice).looksLikeResultCard).toBe(false);
  });

  it('reads the seat number for context, and nothing depends on it', () => {
    // Shown so a student can see it is their own card. Never an identity (§26).
    expect(parseResultCard(card([GOOD_ROW])).seatNumber).toBe('9ZZ99ZZ999');
    const parsed = parseResultCard(card([GOOD_ROW]).filter((l) => !/Seat Number/.test(l.text)));
    expect(parsed.seatNumber).toBeNull();
    expect(parsed.rows).toHaveLength(1);
  });

  it('reads the rows it can and reports the one it cannot', () => {
    // PARTIAL SUCCESS (§60). One bad row must not discard eight good ones.
    const parsed = parseResultCard(
      card([GOOD_ROW, 'BQAS402  FINANCIAL MANAGEMENT   40  19  99  P  2026-07-23']),
    );
    expect(parsed.rows).toHaveLength(2);
    expect(parsed.rows[0]?.warnings).toEqual([]);
    expect(parsed.rows[1]?.warnings.map((w) => w.kind)).toEqual(['total_mismatch']);
  });
});

describe('a parsed row becoming a result subject', () => {
  it('carries the printed fields and invents no grade', () => {
    /*
     * The whole of OQ-049 applied to an import: a provisional card prints no
     * grade, no grade point and no credits, so the stored row has none.
     */
    const row = parseRow({ text: GOOD_ROW, page: 1 }, true);
    const subject = rowToSubject(row as never, 's1', null);

    expect(subject).toMatchObject({ internal: 44, external: 36, total: 80, resultStatus: 'P' });
    expect(subject.gradeLetter).toBeNull();
    expect(subject.credits).toBeNull();
    expect(subject.hasSee).toBeNull();
    expect(subject.provenance).toBe('manual');
  });

  it('takes credits and SEE applicability from the catalogue where it covers the subject', () => {
    const row = parseRow({ text: GOOD_ROW, page: 1 }, true);
    const subject = rowToSubject(row as never, 's1', { credits: 4, hasSee: true });
    expect(subject).toMatchObject({ credits: 4, hasSee: true, provenance: 'catalogue' });
  });

  it('falls back to the code when no title was printed', () => {
    const row = parseRow({ text: 'BQAS404     45  49  94  P', page: 1 }, true);
    expect(rowToSubject(row as never, 's1', null).subjectTitle).toBe('BQAS404');
  });
});

describe('what the rules engine makes of an imported row', () => {
  const evaluate = (
    line: string,
    reference: { credits: number | null; hasSee: boolean | null },
  ) => {
    const row = parseRow({ text: line, page: 1 }, true);
    return evaluateResultSubject(rowToSubject(row as never, 's1', reference), vtu2022RuleSet);
  };

  it('carries a SEE course at 17 and passes it at 18', () => {
    // The boundary, through the import path rather than around it (§52).
    expect(
      evaluate('BQAS401  ALGORITHMS  40  17  57  F', { credits: 4, hasSee: true }).backlog,
    ).toBe(true);
    expect(
      evaluate('BQAS401  ALGORITHMS  40  18  58  P', { credits: 4, hasSee: true }).backlog,
    ).toBe(false);
  });

  it('does NOT carry a CIE-only course whose external is 0', () => {
    /*
     * THE CASE §21 NAMES. An imported row of 96/0/96 is a pass, and reading the
     * zero as a failed SEE would tell a student they have a backlog in a course
     * the university passed them in.
     */
    const evaluation = evaluate('BQAK459  PHYSICAL EDUCATION  96  0  96  P', {
      credits: 0,
      hasSee: false,
    });
    expect(evaluation.backlog).toBe(false);
    expect(evaluation.outcome?.see).toBe('not_applicable');
  });

  it('answers "not known" when SEE applicability is unverified', () => {
    // Not false, and not true. The catalogue covers semesters I-II only, so an
    // imported semester-4 row legitimately reaches this state (§19, §20).
    const evaluation = evaluate('BQAS405  GRAPH THEORY  44  0  44  P', {
      credits: null,
      hasSee: null,
    });
    expect(evaluation.backlog).toBeNull();
    expect(evaluation.unavailableReason).toMatch(/semester-end exam/i);
  });
});
