/**
 * Whether a row's three marks agree with each other — for ANY scheme.
 *
 * The card prints internal, external and total, and the total is their sum.
 * That is arithmetic, not an academic rule, so it is checked whether or not
 * this scheme has verified grading rules. A row that does not add up is never
 * turned into a conclusion ("Fail"): it is a reason to look at the document.
 *
 * THE CANDIDATE IS A SUGGESTION, NEVER A CORRECTION. Recognition typically
 * loses or doubles a digit — "44" read as "4". When exactly one of the three
 * values can be made consistent by adding or removing a single digit, that
 * value is offered, with its reading, for the student to accept. Nothing here
 * changes a mark, and two plausible fixes offer neither.
 */

export type MarksAgreement = 'consistent' | 'inconsistent' | 'missing';

export type MarkField = 'internal' | 'external' | 'total';

export interface MarkCandidate {
  readonly field: MarkField;
  readonly read: number;
  readonly possible: number;
}

export interface MarksCheck {
  readonly agreement: MarksAgreement;
  /** internal + external, when both were read. */
  readonly computedTotal: number | null;
  readonly candidate: MarkCandidate | null;
}

/** One digit inserted or removed, nothing else: "4" ↔ "44", "80" ↔ "8". */
function oneDigitApart(read: number, possible: number): boolean {
  const [short, long] = [String(read), String(possible)].sort((a, b) => a.length - b.length) as [
    string,
    string,
  ];
  if (long.length !== short.length + 1) return false;
  for (let skip = 0; skip < long.length; skip += 1) {
    if (long.slice(0, skip) + long.slice(skip + 1) === short) return true;
  }
  return false;
}

/** The largest mark a VTU card prints in any of the three columns. */
const MAX_MARK = 200;

export function checkMarks(
  internal: number | null,
  external: number | null,
  total: number | null,
): MarksCheck {
  if (internal === null || external === null || total === null) {
    return {
      agreement: 'missing',
      computedTotal: internal === null || external === null ? null : internal + external,
      candidate: null,
    };
  }
  const computedTotal = internal + external;
  if (computedTotal === total) return { agreement: 'consistent', computedTotal, candidate: null };

  const fixes: MarkCandidate[] = [
    { field: 'internal' as const, read: internal, possible: total - external },
    { field: 'external' as const, read: external, possible: total - internal },
    { field: 'total' as const, read: total, possible: computedTotal },
  ].filter(
    (fix) => fix.possible >= 0 && fix.possible <= MAX_MARK && oneDigitApart(fix.read, fix.possible),
  );

  return {
    agreement: 'inconsistent',
    computedTotal,
    candidate: fixes.length === 1 ? (fixes[0] as MarkCandidate) : null,
  };
}
