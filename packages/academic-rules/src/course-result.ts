/**
 * Did this course pass, and is it a backlog?
 *
 * Authority: 22OB 6.3 · docs/16 §16.13
 *
 * ---------------------------------------------------------------------------
 * WHY THIS LIVES HERE AND NOWHERE ELSE
 * ---------------------------------------------------------------------------
 *
 * A VTU provisional result prints internal, external and total, and a one-letter
 * status. It does NOT print a grade, a grade point, credits or an SGPA. So the
 * question a student actually has in front of a real result card is not "what
 * grade did I get" — it is "did I pass, and if not, why not".
 *
 * `validateCourseMarks` checks a row is well formed. `calculateRequiredMarks`
 * answers what is still needed. Neither answers what already happened, and the
 * temptation is to answer it in a component with a hard-coded number. That is
 * how a regulation ends up duplicated in three screens and wrong in two of them.
 *
 * ---------------------------------------------------------------------------
 * THE THREE HEADS (22OB 6.3)
 * ---------------------------------------------------------------------------
 *
 *   1. CIE      >= cieMinPct% of the CIE maximum      eligibility to sit the SEE
 *   2. SEE      >= seeMinPct% of the SEE scale        passing the SEE head
 *   3. Total    >= overallMinPct% of the course max   passing the course
 *
 * All three must hold. Failing any one of them means the course is carried.
 *
 * ---------------------------------------------------------------------------
 * A COURSE WITH NO SEE IS NOT A COURSE THAT FAILED ITS SEE
 * ---------------------------------------------------------------------------
 *
 * This is the case that makes a naive threshold dangerous, and it is not
 * hypothetical — a real VTU card carries a Physical Education row whose internal
 * is above the ordinary CIE maximum of 50, whose external is 0, and which is
 * printed PASS. The marks are not reproduced here or in the tests; the shape is
 * what matters, and a student's own scores are not needed to describe it.
 *
 * Read with a bare "external below the minimum means a backlog", such a row is a
 * failure. It is not: the course is assessed on CIE alone over the whole course
 * maximum (22OB 6.1(3)), so there is no SEE to fall short of and the external
 * column is structurally zero. The SEE head is therefore NOT APPLICABLE rather
 * than failed, and `hasSee` — which `validateCourseMarks` already carries — is
 * what distinguishes the two.
 *
 * Getting this wrong would tell a student they have a backlog in a subject the
 * university has passed them in.
 */

import { validateCourseMarks, type CourseMarks, type ValidatedCourseMarks } from './marks.js';
import { buildExplanation, isOk, succeed } from './result.js';
import type { RuleResult, RuleSet } from './types.js';

/**
 * How one head of the assessment came out.
 *
 * `not_applicable` is a distinct outcome from `passed` on purpose. A head that
 * does not exist has not been satisfied — there was nothing to satisfy — and
 * collapsing the two would make "passed every head" true of a course that was
 * never examined.
 */
export type CourseHeadOutcome = 'passed' | 'failed' | 'not_applicable';

export interface CourseResult {
  readonly marks: ValidatedCourseMarks;

  /** Eligibility to sit the SEE, 22OB 6.3(1). */
  readonly cie: CourseHeadOutcome;
  /** The SEE head, 22OB 6.3(2). `not_applicable` when the course has no SEE. */
  readonly see: CourseHeadOutcome;
  /** The course total, 22OB 6.3(3). */
  readonly overall: CourseHeadOutcome;

  /** True only when no head failed. */
  readonly passed: boolean;
  /**
   * True when the course must be carried and re-sat.
   *
   * The exact complement of `passed`. It exists as its own field because
   * "backlog" is the word the product and the student use, and a screen reading
   * `!passed` invites somebody to redefine it locally.
   */
  readonly backlog: boolean;

  /** The minimum that had to be reached, on the PRINTED scale, per head. */
  readonly cieMinimum: number;
  /** Null when the course has no SEE — there is no minimum to state. */
  readonly seeMinimum: number | null;
  readonly overallMinimum: number;
}

/**
 * Evaluates one printed mark row against the three passing heads.
 *
 * Takes the marks EXACTLY as the result card prints them. Nothing here rescales
 * a raw SEE script: `external` is the SEE's printed contribution, which is what
 * a student is reading off the page (see `calculateRequiredMarks` for the two
 * scales and why they differ).
 *
 * `hasSee` defaults to true, because most courses have one. Pass `false` for a
 * CIE-only course; the caller knows this from reference data, and it must never
 * be guessed from the marks — an external of 0 is equally consistent with "no
 * SEE" and with "sat the SEE and scored nothing".
 */
export function evaluateCourseResult(
  marks: CourseMarks,
  ruleSet: RuleSet,
  options: { readonly hasSee?: boolean } = {},
): RuleResult<CourseResult> {
  const validated = validateCourseMarks(marks, ruleSet, options);
  if (!isOk(validated)) return validated;

  const value = validated.value;
  const { hasSee } = value;

  /*
   * The same split `validateCourseMarks` uses: with no SEE the CIE is assessed
   * over the whole course maximum, so its minimum scales with it.
   */
  const cieMaximum = hasSee ? ruleSet.cieMax : ruleSet.courseMax;
  const seeMaximum = ruleSet.courseMax - ruleSet.cieMax;

  const cieMinimum = (ruleSet.cieMinPct / 100) * cieMaximum;
  const seeMinimum = hasSee ? (ruleSet.seeMinPct / 100) * seeMaximum : null;
  const overallMinimum = (ruleSet.overallMinPct / 100) * ruleSet.courseMax;

  const cie: CourseHeadOutcome = value.internal >= cieMinimum ? 'passed' : 'failed';
  const see: CourseHeadOutcome =
    seeMinimum === null ? 'not_applicable' : value.external >= seeMinimum ? 'passed' : 'failed';
  const overall: CourseHeadOutcome = value.total >= overallMinimum ? 'passed' : 'failed';

  const passed = cie === 'passed' && see !== 'failed' && overall === 'passed';

  const explanation = buildExplanation(ruleSet, {
    formula: 'pass = CIE >= cieMin AND (no SEE OR SEE >= seeMin) AND total >= overallMin',
    clause: '22OB 6.3',
    inputs: {
      internal: value.internal,
      external: value.external,
      total: value.total,
      hasSee: hasSee ? 1 : 0,
    },
    steps: [
      {
        label: `CIE minimum (${String(ruleSet.cieMinPct)}% of ${String(cieMaximum)})`,
        value: cieMinimum,
      },
      ...(seeMinimum === null
        ? []
        : [
            {
              label: `SEE minimum (${String(ruleSet.seeMinPct)}% of ${String(seeMaximum)})`,
              value: seeMinimum,
            },
          ]),
      {
        label: `Total minimum (${String(ruleSet.overallMinPct)}% of ${String(ruleSet.courseMax)})`,
        value: overallMinimum,
      },
    ],
  });

  /*
   * A failure of the RULES is not a failure of the COURSE. A carried course is
   * a valid, successful evaluation whose answer happens to be "not passed", so
   * it is returned as a success. There is no failure path here at all:
   * `validateCourseMarks` above has already refused anything the regulation
   * cannot speak to, and every minimum below is arithmetic on rule-set numbers.
   * A defensive branch for minima that cannot be non-finite would be
   * unreachable, and this package holds a 100% branch coverage standard
   * precisely so unreachable code is noticed rather than accumulated.
   */
  return succeed(
    {
      marks: value,
      cie,
      see,
      overall,
      passed,
      backlog: !passed,
      cieMinimum,
      seeMinimum,
      overallMinimum,
    },
    explanation,
  );
}
