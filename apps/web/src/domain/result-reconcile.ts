/**
 * Several result files at once, and what to do when two of them disagree.
 *
 * Authority: docs/32 OQ-049 · M10A.6 §12, §13, §14, §34, §61, §81, §90
 *
 * ---------------------------------------------------------------------------
 * FILES ARE READ SEPARATELY AND MERGED NEVER
 * ---------------------------------------------------------------------------
 *
 * Each file is parsed on its own (§12). Only then are the readings compared,
 * and comparing is where this module stops: it reports that two documents say
 * different things about the same semester and leaves the choice to the student
 * (§13, §34).
 *
 * The temptation is to pick "the later one", or "the one with more rows", or
 * "the one whose totals add up". Every such rule is wrong in a real case:
 *
 *   - A REVALUATION legitimately changes one mark upward. The newer file is
 *     right.
 *   - A DUPLICATE DOWNLOAD of the same card is identical and either is right.
 *   - A WRONG FILE for the wrong student is neither, and its row count and
 *     arithmetic look perfect.
 *
 * No property of the documents separates the third case from the first. A
 * person looking at both can. So the difference is shown, field by field, and
 * nothing is resolved here (§14).
 */

import type { ParsedCard, ParsedRow } from './result-import.js';
import { subjectKey } from './subjects.js';

export interface ImportedFile {
  /** The name as given. Shown to the student; never used as evidence (§11, §90). */
  readonly fileName: string;
  readonly card: ParsedCard;
}

/** One field of one subject, read differently by two documents. */
export interface FieldDifference {
  readonly subjectCode: string;
  readonly field: 'internal' | 'external' | 'total' | 'resultStatus' | 'announcedOn';
  readonly a: string;
  readonly b: string;
}

export interface SemesterGroup {
  /** Null for files whose semester the page did not state. */
  readonly semester: number | null;
  readonly files: readonly ImportedFile[];
  /**
   * Set when two files cover this semester.
   *
   * `identical` is a duplicate download and is safe to import once. `differs`
   * needs a person: a revaluation and a wrong file look the same from here.
   */
  readonly duplicate: 'none' | 'identical' | 'differs';
  readonly differences: readonly FieldDifference[];
  /** True when this semester already has a saved result (§61). */
  readonly alreadySaved: boolean;
}

function rowsByCode(card: ParsedCard): Map<string, ParsedRow> {
  return new Map(card.rows.map((row) => [subjectKey(row.subjectCode), row]));
}

function show(value: number | string | null): string {
  return value === null ? '—' : String(value);
}

/**
 * Every field on which two readings of the same semester disagree.
 *
 * A subject present in one file and absent from the other is a difference too,
 * and a loud one: it usually means the two documents are not the same card.
 */
export function differencesBetween(a: ParsedCard, b: ParsedCard): FieldDifference[] {
  const left = rowsByCode(a);
  const right = rowsByCode(b);
  const codes = [...new Set([...left.keys(), ...right.keys()])].sort();

  const differences: FieldDifference[] = [];
  for (const code of codes) {
    const rowA = left.get(code);
    const rowB = right.get(code);

    if (rowA === undefined || rowB === undefined) {
      differences.push({
        subjectCode: code,
        field: 'total',
        a: rowA === undefined ? 'not in this file' : show(rowA.total),
        b: rowB === undefined ? 'not in this file' : show(rowB.total),
      });
      continue;
    }

    const fields = ['internal', 'external', 'total', 'resultStatus', 'announcedOn'] as const;
    for (const field of fields) {
      if (rowA[field] !== rowB[field]) {
        differences.push({ subjectCode: code, field, a: show(rowA[field]), b: show(rowB[field]) });
      }
    }
  }
  return differences;
}

/**
 * Files grouped by the semester their pages state.
 *
 * Files whose semester was not printed are grouped together under `null` rather
 * than guessed at, and the import screen asks (§11). They are never quietly
 * folded into a numbered group because their row set happens to look similar.
 */
export function groupBySemester(
  files: readonly ImportedFile[],
  savedSemesters: readonly number[] = [],
): SemesterGroup[] {
  const groups = new Map<number | null, ImportedFile[]>();
  for (const file of files) {
    const key = file.card.semester;
    groups.set(key, [...(groups.get(key) ?? []), file]);
  }

  const saved = new Set(savedSemesters);

  return [...groups.entries()]
    .map(([semester, grouped]) => {
      const [first, second] = grouped;
      const differences =
        first === undefined || second === undefined
          ? []
          : differencesBetween(first.card, second.card);

      return {
        semester,
        files: grouped,
        duplicate:
          grouped.length < 2
            ? ('none' as const)
            : differences.length === 0
              ? ('identical' as const)
              : ('differs' as const),
        differences,
        alreadySaved: semester !== null && saved.has(semester),
      };
    })
    .sort((a, b) => (a.semester ?? 99) - (b.semester ?? 99));
}

/**
 * Whether a group can be imported without a person deciding something first.
 *
 * Deliberately conservative. "Ready" here means the import screen may offer a
 * confirm button; it never means the import happens on its own (§28).
 */
export function isReadyToImport(group: SemesterGroup): boolean {
  return (
    group.semester !== null &&
    group.duplicate !== 'differs' &&
    !group.alreadySaved &&
    group.files.every((file) => file.card.looksLikeResultCard && file.card.rows.length > 0)
  );
}

/**
 * Why a group is not ready, in words a student can act on.
 *
 * One reason at a time, most blocking first: a list of four problems is a
 * screen nobody reads, and fixing the first often resolves the rest.
 */
export function blockingReason(group: SemesterGroup): string | null {
  if (group.files.some((file) => !file.card.looksLikeResultCard)) {
    return 'This file does not look like a VTU result card. You can still enter the result by hand.';
  }
  if (group.semester === null) {
    return 'The semester was not printed on this document. Choose one before importing.';
  }
  if (group.duplicate === 'differs') {
    return 'Two files describe this semester differently. Check the differences and choose which to import.';
  }
  if (group.alreadySaved) {
    return 'This semester already has a saved result. Importing would replace it, so review it first.';
  }
  return null;
}
