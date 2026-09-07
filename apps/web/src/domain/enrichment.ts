/**
 * What is actually known about one result row, and what is not.
 *
 * Authority: Phase 7C §8, §10, §11, §13, §14, §33 · docs/37 (never invent)
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS
 * ---------------------------------------------------------------------------
 *
 * A VTU result card prints marks and prints nothing else: no credits, no
 * grade, no grade point. Everything beyond the marks is DERIVED — from the
 * scheme, from the rule set, from what the student has already told the
 * product — and each of those derivations can fail independently.
 *
 * The review screen used to show only the raw fields plus empty inputs for
 * credits and grade, so a student could not tell the difference between "this
 * has 4 credits" and "nobody knows how many credits this has". This is the one
 * place that difference is computed, so the review and the results page cannot
 * disagree about it.
 *
 * ---------------------------------------------------------------------------
 * FIVE STATES, NOT TWO (§33)
 * ---------------------------------------------------------------------------
 *
 * `0`, `null`, unknown, unresolved and not-applicable are five different
 * things, and collapsing any pair of them has already caused a real bug here.
 * A non-credit mandatory course genuinely carries ZERO credits; a course whose
 * scheme row nobody has is UNRESOLVED. Both used to render as "0".
 *
 * So every field on `RowEnrichment` carries its own value, its own source and,
 * where it has none, its own reason — and `null` never means zero.
 */

import { isOk, resolveGrade, type RuleSet } from '@gradtools/academic-rules';
import { creditsFor, type CreditsFrom, type SubjectIdentity } from './subjects.js';
import { resolveCourseKind, type CourseKind, type ResolvedCourseKind } from './exams.js';
import { resolveSubjectGrade } from './results.js';
import type { ResultSubject } from './types.js';

/* -------------------------------------------------------------------------- */
/* Provenance                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Where a figure came from, in the words the interface shows.
 *
 * §14: a student-provided value must NEVER be labelled `catalogue`. That is not
 * a style preference — it is the bug that let a typed credit be trusted as
 * reference data on three other screens, and the label is what stops it coming
 * back.
 */
export const CREDIT_SOURCE_LABEL: Readonly<Record<CreditsFrom, string>> = {
  catalogue: 'VTU catalogue',
  yours: 'Your own record',
};

export const COURSE_KIND_LABEL: Readonly<Record<CourseKind, string>> = {
  see_bearing: 'CIE + SEE',
  cie_only: 'CIE only',
  non_credit: 'Non-credit mandatory',
  audit: 'Audit',
};

/* -------------------------------------------------------------------------- */
/* The reading                                                                */
/* -------------------------------------------------------------------------- */

export interface ResolvedField<T> {
  readonly value: T | null;
  /** Shown beside the value. Null when there is no value to attribute. */
  readonly source: string | null;
  /** Why there is no value. Null exactly when there is one. */
  readonly reason: string | null;
}

export interface RowEnrichment {
  readonly credits: ResolvedField<number>;
  readonly courseKind: ResolvedCourseKind;
  /** The letter, from the card or from the rule set. */
  readonly grade: ResolvedField<string>;
  /** The point value of that letter under the pinned rule set. */
  readonly gradePoint: ResolvedField<number>;
  /** True when every part a student needs is known. */
  readonly complete: boolean;
}

function unresolved<T>(reason: string): ResolvedField<T> {
  return { value: null, source: null, reason };
}

/**
 * Everything derivable about one row, with the provenance of each part.
 *
 * Nothing here computes an academic rule of its own: credits come from
 * `creditsFor`, the course kind from `resolveCourseKind`, the letter from
 * `resolveSubjectGrade` and its points from the rule set's own bands. This
 * assembles those answers and attaches the words a person reads.
 */
export function enrichRow(
  subject: ResultSubject,
  identity: SubjectIdentity | null,
  ruleSet: RuleSet | undefined,
): RowEnrichment {
  const kind = resolveCourseKind(subject, identity, ruleSet);

  /* ---- Credits ---------------------------------------------------------- */

  const resolvedCredits = creditsFor(identity);
  /*
   * The row's OWN credits win over the index's. A student who typed a figure
   * during review, or corrected one afterwards, has said something specific
   * about this row — and the index is built from every row of every semester,
   * so it can only speak about the code in general.
   */
  const creditValue = subject.credits ?? resolvedCredits.credits;
  const creditSource =
    subject.credits !== null
      ? subject.provenance === 'catalogue'
        ? CREDIT_SOURCE_LABEL.catalogue
        : CREDIT_SOURCE_LABEL.yours
      : resolvedCredits.from === null
        ? null
        : CREDIT_SOURCE_LABEL[resolvedCredits.from];

  const credits: ResolvedField<number> =
    creditValue === null
      ? unresolved('No canonical course match, and you have not recorded this subject before.')
      : { value: creditValue, source: creditSource, reason: null };

  /* ---- Grade ------------------------------------------------------------ */

  const resolvedGrade = resolveSubjectGrade(subject, ruleSet);

  let grade: ResolvedField<string>;
  if (resolvedGrade !== null) {
    grade = {
      value: resolvedGrade.letter,
      source: resolvedGrade.from === 'card' ? 'Printed on the card' : '2022 rule set',
      reason: null,
    };
  } else if (ruleSet === undefined) {
    grade = unresolved('The rule set this semester was graded under is not available here.');
  } else if (kind.hasSee === null && kind.kind === null) {
    grade = unresolved(
      'Requires review — whether this course had a semester-end exam is not recorded, and an external of 0 reads the same either way.',
    );
  } else if (subject.internal === null || subject.external === null) {
    grade = unresolved('Requires review — the marks this grade would come from are incomplete.');
  } else {
    /*
     * The course was evaluated and did not pass. OQ-054: the supplied
     * regulations band the letter by percentage AND separately require each
     * head, and do not say which the grade card prints for a course that
     * failed a head. Nothing is chosen here.
     */
    grade = unresolved(
      'Requires review — this course did not pass, and the regulations do not state the letter a failed course carries (OQ-054).',
    );
  }

  /* ---- Grade point ------------------------------------------------------ */

  let gradePoint: ResolvedField<number>;
  if (grade.value === null || ruleSet === undefined) {
    gradePoint = unresolved('Follows the grade.');
  } else if (subject.gradePoint !== null) {
    /* A card that prints its own point is stating a fact; it wins. */
    gradePoint = { value: subject.gradePoint, source: 'Printed on the card', reason: null };
  } else {
    const band = resolveGrade(grade.value, ruleSet);
    gradePoint = isOk(band)
      ? { value: band.value.points, source: '2022 rule set', reason: null }
      : unresolved(
          `The rule set gives no point value for "${grade.value}" — it is recorded, not scored.`,
        );
  }

  return {
    credits,
    courseKind: kind,
    grade,
    gradePoint,
    complete:
      credits.value !== null &&
      grade.value !== null &&
      (gradePoint.value !== null || kind.countsTowardGpa === false),
  };
}
