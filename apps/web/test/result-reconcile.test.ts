/**
 * Several files at once, and the disagreements nothing here resolves.
 *
 * Authority: docs/22 §22.48 · M10A.6 §12, §13, §14, §34, §61
 *
 * The rule this file exists to pin: when two documents describe one semester
 * differently, no property of the documents says which is right.
 *
 *   A REVALUATION legitimately changes one mark upward — the newer file wins.
 *   A DUPLICATE DOWNLOAD is identical — either wins.
 *   A WRONG FILE is neither, and its row count and arithmetic look perfect.
 *
 * "Pick the later one" gets the third case wrong silently. So the difference is
 * shown and a person decides.
 */

import { describe, expect, it } from 'vitest';
import { parseResultCard, type ImportLine } from '../src/domain/result-import.js';
import {
  blockingReason,
  differencesBetween,
  groupBySemester,
  isReadyToImport,
} from '../src/domain/result-reconcile.js';

function card(rows: readonly string[], semester: number | null = 4): ImportLine[] {
  return [
    'VISVESVARAYA TECHNOLOGICAL UNIVERSITY, BELAGAVI',
    'VTU PROVISIONAL RESULTS OF UG / PG EXAMINATION',
    'University Seat Number : 9ZZ99ZZ999',
    ...(semester === null ? [] : [`Semester : ${String(semester)}`]),
    'Subject Code  Subject Name  Internal Marks  External Marks  Total  Result',
    ...rows,
  ].map((text) => ({ text, page: 1 }));
}

const ROWS = [
  'BQAS401  ALGORITHMS            44  36  80  P  2026-07-23',
  'BQAS402  FINANCIAL MANAGEMENT  40  19  59  P  2026-07-23',
];

/** The same semester after a revaluation raised one external mark. */
const REVALUED = [
  'BQAS401  ALGORITHMS            44  41  85  P  2026-09-01',
  'BQAS402  FINANCIAL MANAGEMENT  40  19  59  P  2026-07-23',
];

const file = (fileName: string, lines: ImportLine[]) => ({
  fileName,
  card: parseResultCard(lines),
});

describe('grouping files by the semester their pages state', () => {
  it('puts four semesters into four groups', () => {
    const groups = groupBySemester([
      file('a.pdf', card(ROWS, 1)),
      file('b.pdf', card(ROWS, 2)),
      file('c.pdf', card(ROWS, 3)),
      file('d.pdf', card(ROWS, 4)),
    ]);
    expect(groups.map((g) => g.semester)).toEqual([1, 2, 3, 4]);
    expect(groups.every((g) => g.duplicate === 'none')).toBe(true);
    expect(groups.every(isReadyToImport)).toBe(true);
  });

  it('does not take a semester from a filename', () => {
    /*
     * The file is called s3 and its page says 4. The page wins, because a name
     * is something somebody typed (§11).
     */
    const groups = groupBySemester([file('result_s3.pdf', card(ROWS, 4))]);
    expect(groups[0]?.semester).toBe(4);
  });

  it('keeps files with no stated semester in their own group, and blocks them', () => {
    const groups = groupBySemester([file('scan.pdf', card(ROWS, null))]);
    expect(groups[0]?.semester).toBeNull();
    expect(isReadyToImport(groups[0] as never)).toBe(false);
    expect(blockingReason(groups[0] as never)).toMatch(/semester was not printed/i);
  });
});

describe('two files for one semester', () => {
  it('calls an identical pair a duplicate, and lets it through', () => {
    const groups = groupBySemester([file('a.pdf', card(ROWS)), file('copy.pdf', card(ROWS))]);
    expect(groups[0]?.duplicate).toBe('identical');
    expect(groups[0]?.differences).toEqual([]);
    // A duplicate download is safe to import once.
    expect(isReadyToImport(groups[0] as never)).toBe(true);
  });

  it('shows a revaluation field by field, and refuses to choose', () => {
    const groups = groupBySemester([file('a.pdf', card(ROWS)), file('b.pdf', card(REVALUED))]);
    const group = groups[0] as never as { duplicate: string; differences: unknown[] };

    expect(group.duplicate).toBe('differs');
    expect(group.differences).toEqual([
      { subjectCode: 'BQAS401', field: 'external', a: '36', b: '41' },
      { subjectCode: 'BQAS401', field: 'total', a: '80', b: '85' },
      { subjectCode: 'BQAS401', field: 'announcedOn', a: '2026-07-23', b: '2026-09-01' },
    ]);
    // NOT ready: nothing here can tell a revaluation from the wrong file.
    expect(isReadyToImport(groups[0] as never)).toBe(false);
    expect(blockingReason(groups[0] as never)).toMatch(/describe this semester differently/i);
  });

  it('reports a subject present in one file and absent from the other', () => {
    // Usually a sign the two documents are not the same card at all.
    const differences = differencesBetween(
      parseResultCard(card(ROWS)),
      parseResultCard(card([ROWS[0] as string])),
    );
    expect(differences).toContainEqual({
      subjectCode: 'BQAS402',
      field: 'total',
      a: '59',
      b: 'not in this file',
    });
  });
});

describe('a semester that already has a saved result', () => {
  it('is blocked rather than silently replaced', () => {
    // ONE SAVED RESULT PER SEMESTER is the existing invariant (§61); an import
    // must not be the way around it.
    const groups = groupBySemester([file('a.pdf', card(ROWS, 4))], [4]);
    expect(groups[0]?.alreadySaved).toBe(true);
    expect(isReadyToImport(groups[0] as never)).toBe(false);
    expect(blockingReason(groups[0] as never)).toMatch(/already has a saved result/i);
  });

  it('leaves other semesters alone', () => {
    const groups = groupBySemester(
      [file('a.pdf', card(ROWS, 4)), file('b.pdf', card(ROWS, 5))],
      [4],
    );
    expect(groups.map((g) => isReadyToImport(g))).toEqual([false, true]);
  });
});

describe('a file that is not a result card', () => {
  it('blocks the group and offers manual entry instead', () => {
    const invoice = ['ACME SUPPLIES', 'WIDGET900  BRASS FITTING  44  36  80  P'].map((text) => ({
      text,
      page: 1,
    }));
    const groups = groupBySemester([file('invoice.pdf', invoice)]);
    expect(isReadyToImport(groups[0] as never)).toBe(false);
    expect(blockingReason(groups[0] as never)).toMatch(/does not look like a VTU result card/i);
  });

  it('does not stop the other files in the batch', () => {
    /*
     * PARSE FAILURE ISOLATION (§59). Four good files and one bad one is four
     * ready groups and one blocked, not a rejected batch.
     */
    const invoice = [{ text: 'ACME SUPPLIES LIMITED', page: 1 }];
    const groups = groupBySemester([
      file('a.pdf', card(ROWS, 1)),
      file('b.pdf', card(ROWS, 2)),
      file('c.pdf', card(ROWS, 3)),
      file('junk.pdf', invoice),
    ]);
    expect(groups.filter(isReadyToImport)).toHaveLength(3);
    expect(groups.filter((g) => !isReadyToImport(g))).toHaveLength(1);
  });
});
