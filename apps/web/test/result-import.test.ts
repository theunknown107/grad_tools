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

/* -------------------------------------------------------------------------- */
/* What a REAL card does that a generated one never does (M10A.6C)            */
/* -------------------------------------------------------------------------- */

/**
 * Every case below is a shape observed on a genuine VTU result card read
 * through the shipped pipeline. None of them appears in a synthetic document,
 * and each one silently cost whole rows before it was fixed.
 *
 * The values are invented. Only the SHAPES are real.
 */
describe('rows as recognition actually delivers them', () => {
  const read = (text: string) => parseRow({ text, page: 1 }, true);

  it('reads a row whose columns are separated by the table rule', () => {
    /*
     * A ruled table read from a picture brings its borders along as pipes,
     * landing inside the row. The marks pattern wants three numbers separated
     * by whitespace, so one border character between two columns cost the whole
     * row — seven readable rows became two.
     */
    const row = read('BQAS101 | MATHEMATICS FOR CSE 38 | 18 56 P 2025-03-13');
    expect(row?.internal).toBe(38);
    expect(row?.external).toBe(18);
    expect(row?.total).toBe(56);
    expect(row?.resultStatus).toBe('P');
  });

  it('reads a row whose code carries a stray quote from the table border', () => {
    const row = read("'BQAK459 PHYSICAL EDUCATION 96 0 96 P 2026-07-23");
    expect(row?.subjectCode).toBe('BQAK459');
    expect(row?.internal).toBe(96);
  });

  it('keeps the marks when the status letter could not be read', () => {
    /*
     * THE TRADE THAT WAS WRONG BEFORE. Recognition dropped the single status
     * letter on three rows out of nine while reading all three marks
     * perfectly, and requiring the letter threw the marks away with it.
     */
    const row = read('BQAS403 DATABASE MANAGEMENT 39 28 67 2026-07-');
    expect(row?.internal).toBe(39);
    expect(row?.external).toBe(28);
    expect(row?.total).toBe(67);
    expect(row?.resultStatus).toBeNull();
    expect(row?.warnings.map((warning) => warning.kind)).toContain('missing_status');
  });

  it('strips punctuation off a status without ever changing the letter', () => {
    expect(read('BQAS401 ALGORITHMS 44 36 80 P. 2026-07-23')?.resultStatus).toBe('P');
    // And a letter is never corrected into a different one: F stays F.
    expect(read('BQAS401 ALGORITHMS 44 36 80 F. 2026-07-23')?.resultStatus).toBe('F');
  });

  it('refuses a truncated date rather than storing half of one', () => {
    // The date column wraps mid-value on a real card: `2026-07-` then `23`.
    const row = read('BQAS405 GRAPH THEORY 44 22 66 P 2026-07-');
    expect(row?.announcedOn).toBeNull();
    expect(row?.total).toBe(66);
  });

  it('reports an unknown status rather than dropping the row', () => {
    const row = read('BQAS404 ALGORITHMS LAB 45 49 94 B 2026-07-23');
    expect(row?.resultStatus).toBe('B');
    expect(row?.warnings.map((warning) => warning.kind)).toContain('unknown_status');
  });
});

describe('a row carrying more numbers than it has columns', () => {
  const read = (text: string) => parseRow({ text, page: 1 }, true);

  it('prefers a run that adds up over the rightmost one', () => {
    /*
     * The rightmost three are NOT automatically the columns. Where an earlier
     * run satisfies the card's own arithmetic and the last three do not, the
     * earlier run is the one the card printed.
     */
    const row = read('BQAS158 SUBJECT 11 22 33 44 2025-03-13');
    expect([row?.internal, row?.external, row?.total]).toEqual([11, 22, 33]);
  });

  it('picks the three that add up, and says it had to', () => {
    /*
     * THE DANGEROUS CLASS. Recognition inserted a stray digit after the total:
     * `27 39 66 3`. Reading three marks from the right shifted every column and
     * produced marks that were WRONG rather than missing — 39, 66 and 3 — which
     * is the failure this whole workflow exists to prevent.
     *
     * The card's own arithmetic says which three are the columns. That chooses
     * an ALIGNMENT; it changes no value and invents none.
     */
    const row = read('BQAS158 INNOVATION AND 27 39 66 3 2025-03-13');
    expect([row?.internal, row?.external, row?.total]).toEqual([27, 39, 66]);
    expect(row?.warnings.map((warning) => warning.kind)).toContain('ambiguous_marks');
  });

  it('keeps the number out of the subject name once it is taken as a mark', () => {
    expect(read('BQAS158 INNOVATION AND 27 39 66 3 2025-03-13')?.subjectTitle).toBe(
      'INNOVATION AND',
    );
  });

  it('falls back to the last three when nothing adds up, and still flags it', () => {
    /*
     * No repair. The rightmost three stand exactly as before, the existing
     * total mismatch is reported, and the row is marked as one to look at.
     */
    const row = read('BQAS158 SUBJECT 11 25 37 49 2025-03-13');
    expect([row?.internal, row?.external, row?.total]).toEqual([25, 37, 49]);
    const kinds = row?.warnings.map((warning) => warning.kind) ?? [];
    expect(kinds).toContain('ambiguous_marks');
    expect(kinds).toContain('total_mismatch');
  });

  it('leaves an ordinary row completely alone', () => {
    // The disambiguation must not fire where there is nothing to disambiguate.
    const row = read('BQAS401 ANALYSIS AND DESIGN 44 36 80 P 2026-07-23');
    expect(row?.warnings).toEqual([]);
    expect(row?.subjectTitle).toBe('ANALYSIS AND DESIGN');
  });
});

describe('a row that could not be read is counted, never dropped in silence', () => {
  it('reports a line that is plainly a subject row and would not parse', () => {
    /*
     * A nine-subject card arriving as eight rows, every one correct, with
     * nothing on screen saying a subject is missing, is the worst available
     * outcome: the card does not print how many subjects it has, so the student
     * cannot notice.
     */
    const card = parseResultCard([
      { text: 'VISVESVARAYA TECHNOLOGICAL UNIVERSITY, BELAGAVI', page: 1 },
      { text: 'University Seat Number : 9ZZ99ZZ999', page: 1 },
      { text: 'Semester : 4', page: 1 },
      { text: 'BQAS401 ALGORITHMS 44 36 80 P 2026-07-23', page: 1 },
      // Recognition lost one mark, so this row cannot be read as a row.
      { text: 'BQAS402 FINANCIAL MANAGEMENT 19 2026-07-', page: 1 },
    ]);

    expect(card.rows).toHaveLength(1);
    expect(card.unreadableRows.map((line) => line.text)).toEqual([
      'BQAS402 FINANCIAL MANAGEMENT 19 2026-07-',
    ]);
    expect(card.warnings.map((warning) => warning.kind)).toContain('unreadable_row');
  });

  it('does not count an ordinary heading as an unreadable row', () => {
    const card = parseResultCard([
      { text: 'Subject Code Subject Name Internal Marks External Marks Total Result', page: 1 },
      { text: 'University Seat Number : 9ZZ99ZZ999', page: 1 },
      { text: 'Semester : 4', page: 1 },
      { text: 'BQAS401 ALGORITHMS 44 36 80 P 2026-07-23', page: 1 },
    ]);
    expect(card.unreadableRows).toEqual([]);
  });
});
