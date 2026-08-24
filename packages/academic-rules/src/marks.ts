/**
 * Grade-card mark rows: structure and internal consistency.
 *
 * Authority: docs/16_ACADEMIC_RULES_ENGINE.md §16.5 (22OB 4.1(4)), §16.6 (22OB 6.3)
 * Corroborated against a real VTU provisional result (docs/32 OQ-024).
 *
 * WHAT A REAL GRADE CARD ACTUALLY PRINTS
 *
 * A VTU provisional result prints three mark columns per course —
 * `Internal`, `External`, `Total` — and the printed relationship is a plain sum:
 *
 *     Total = Internal + External
 *
 * The `External` column is therefore the SEE's **contribution to the course
 * total** (out of `courseMax - cieMax`, i.e. 50), NOT the raw SEE script mark
 * out of `seeMax` (100). The two express the same performance on different
 * scales — an external of 36 here is a raw SEE of 72 — but they are different
 * numbers, and confusing them halves or doubles a student's marks.
 *
 * This module works entirely in the **printed** scale, because that is the only
 * scale a student can read off the document in their hand. `targets.ts` works in
 * the raw SEE scale, because that is what the regulation's thresholds are stated
 * against. Neither is wrong; they must simply never be silently interchanged.
 */

import { assertUsableRuleSet, buildExplanation, fail, isFiniteNumber, succeed } from './result.js';
import type { RuleResult, RuleSet } from './types.js';

/**
 * Subject-code shape observed on real VTU 2022-scheme documents.
 *
 * Three or four letters, three digits, and an optional trailing letter that
 * marks an elective choice within a group (`BCS405B`, `BCB456D`). Anchored, so
 * a code with trailing text is rejected rather than partially matched.
 */
const SUBJECT_CODE = /^[A-Z]{3,4}\d{3}[A-Z]?$/;

/** One printed row of a grade card, in the scale the document uses. */
export interface CourseMarks {
  readonly subjectCode: string;
  /** CIE as printed. */
  readonly internal: number;
  /** The SEE's contribution as printed — already scaled, not the raw script mark. */
  readonly external: number;
  /** As printed. Must equal `internal + external`. */
  readonly total: number;
}

export interface ValidatedCourseMarks extends CourseMarks {
  /** `total` as a percentage of `courseMax`, ready for band lookup. */
  readonly percentage: number;
  /** False for a course assessed on CIE alone (22OB 6.1(3)). */
  readonly hasSee: boolean;
}

/**
 * Validates one printed mark row against the rule set.
 *
 * `hasSee` defaults to true. Pass `false` for a course with no semester-end
 * examination (22OB 6.1(3)): its CIE is then assessed over the whole
 * `courseMax`, and its external column is 0. A real card shows exactly this for
 * Physical Education — an internal above the ordinary CIE maximum, an external of 0 and a printed P — which the
 * ordinary CIE maximum of 50 would otherwise reject as impossible.
 *
 * This checks that a row is *internally consistent and in range*. It does not
 * decide pass or fail; that is three separate thresholds (22OB 6.3) applied to
 * the raw SEE scale.
 */
export function validateCourseMarks(
  marks: CourseMarks,
  ruleSet: RuleSet,
  options: { readonly hasSee?: boolean } = {},
): RuleResult<ValidatedCourseMarks> {
  const hasSee = options.hasSee ?? true;
  const explanation = buildExplanation(ruleSet, {
    formula: 'total = internal + external',
    clause: '22OB 4.1(4), 6.1(3)',
    inputs: { internal: marks.internal, external: marks.external, total: marks.total },
  });

  const guard = assertUsableRuleSet(ruleSet, explanation);
  if (guard) return guard;

  if (!SUBJECT_CODE.test(marks.subjectCode.trim().toUpperCase())) {
    return fail(
      'invalid_input',
      `"${marks.subjectCode}" is not a valid VTU subject code.`,
      explanation,
    );
  }

  for (const [label, value] of [
    ['Internal', marks.internal],
    ['External', marks.external],
    ['Total', marks.total],
  ] as const) {
    if (!isFiniteNumber(value)) {
      return fail('invalid_input', `${label} marks must be a finite number.`, explanation);
    }
    if (value < 0) {
      return fail('invalid_input', `${label} marks cannot be negative.`, explanation);
    }
  }

  // A course with no SEE is assessed on CIE over the full course maximum;
  // otherwise CIE and the SEE contribution each carry half (22OB 4.1(4)).
  const internalMax = hasSee ? ruleSet.cieMax : ruleSet.courseMax;
  const externalMax = hasSee ? ruleSet.courseMax - ruleSet.cieMax : 0;

  if (marks.internal > internalMax) {
    return fail(
      'invalid_input',
      `Internal marks (${String(marks.internal)}) exceed the maximum of ${String(internalMax)}.`,
      explanation,
    );
  }
  if (marks.external > externalMax) {
    return fail(
      'invalid_input',
      `External marks (${String(marks.external)}) exceed the maximum of ${String(externalMax)}.`,
      explanation,
    );
  }

  /*
   * The cross-field check that actually catches transcription errors. A row
   * whose columns do not add up has been mistyped or misread, and every number
   * derived from it would be wrong — so it is refused rather than repaired.
   */
  if (marks.total !== marks.internal + marks.external) {
    return fail(
      'invalid_input',
      `Total (${String(marks.total)}) does not equal internal + external ` +
        `(${String(marks.internal)} + ${String(marks.external)} = ` +
        `${String(marks.internal + marks.external)}).`,
      explanation,
    );
  }

  const percentage = (marks.total / ruleSet.courseMax) * 100;

  return succeed(
    { ...marks, subjectCode: marks.subjectCode.trim().toUpperCase(), percentage, hasSee },
    buildExplanation(ruleSet, {
      formula: 'total = internal + external',
      clause: '22OB 4.1(4), 6.1(3)',
      inputs: { internal: marks.internal, external: marks.external, total: marks.total },
      steps: [
        { label: 'Total', value: marks.total },
        { label: 'Percentage of course maximum', value: percentage },
      ],
    }),
  );
}
