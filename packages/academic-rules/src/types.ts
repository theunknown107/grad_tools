/**
 * Core types for the GradTools academic rules engine.
 *
 * Authority: docs/16_ACADEMIC_RULES_ENGINE.md
 *
 * Design rule (16 §16.2.3): rules are DATA, not code. Every threshold, band and
 * formula lives on a RuleSet, so a different scheme is a different row rather
 * than a different code path. No VTU-specific number appears in this package's
 * logic — only in the seeded rule sets under ./rulesets.
 */

/** Reason a calculation could not produce a value. Never a thrown exception. */
export type FailureReason =
  | 'insufficient_input'
  | 'ineligible'
  | 'unreachable'
  | 'invalid_input'
  /**
   * The rule needed to answer exists in the regulation but its behaviour is not
   * yet verified, so the engine refuses to guess.
   *
   * Currently reached only by the `AB` grade, whose grade-point behaviour is
   * unresolved (docs/32 OQ-018, docs/16 A-16.4). Added during M3 implementation —
   * see docs/16 §16.10.
   */
  | 'unverified_rule';

/** A single step in a derivation, shown to the student via "How this was calculated". */
export interface ExplanationStep {
  readonly label: string;
  readonly value: number;
}

/**
 * Returned on EVERY call, success or failure (16 §16.10).
 *
 * This is what makes FR-008 ("every calculator can show its formula, inputs and
 * cited clause") a property of the engine rather than UI decoration: the UI
 * structurally cannot obtain a number without also obtaining its derivation.
 */
export interface Explanation {
  readonly formula: string;
  readonly clause: string;
  readonly sourceUrl: string;
  readonly inputs: Readonly<Record<string, number>>;
  readonly steps: readonly ExplanationStep[];
  readonly ruleSetId: string;
  readonly ruleSetVersion: number;
}

export interface RuleSuccess<T> {
  readonly ok: true;
  readonly value: T;
  readonly explanation: Explanation;
}

export interface RuleFailure {
  readonly ok: false;
  readonly reason: FailureReason;
  readonly detail: string;
  readonly explanation: Explanation;
}

/**
 * Discriminated result. An impossible case can never be mistaken for a number,
 * and NaN / Infinity / null never leak to a caller (16 §16.2.6).
 */
export type RuleResult<T> = RuleSuccess<T> | RuleFailure;

/** A regular letter grade band mapping a marks percentage to grade points (22OB 6.1). */
export interface GradeBand {
  readonly letter: string;
  readonly descriptor: string;
  readonly points: number;
  readonly minPct: number;
  readonly maxPct: number;
}

/**
 * A non-standard grade (22OB 6.2): DX, AU, AB, PP, NP, IC, W.
 *
 * `pointsVerified === false` means the regulation does not state the grade-point
 * behaviour and GradTools has not verified it from another source. Any
 * calculation touching such a grade returns `unverified_rule` rather than
 * assuming a value.
 */
export interface SpecialGrade {
  readonly letter: string;
  readonly meaning: string;
  /** Grade points, or null when not verified. */
  readonly points: number | null;
  readonly pointsVerified: boolean;
  /**
   * Whether this course participates in the SGPA/CGPA ratio at all — both the
   * numerator and the credit denominator.
   *
   * DX is false: "Credits are not included in CGPA" (22OB 6.2(1)).
   * Note that F is NOT a special grade — it is a normal band with 0 points whose
   * credits DO count. Getting that pair backwards is the highest-impact single
   * bug available in this system (16 §16.4).
   */
  readonly includedInGpa: boolean;
  readonly clause: string;
}

/** Class equivalence band (22OB 6.8). */
export interface ClassBand {
  readonly label: string;
  readonly shortLabel: string;
  readonly minPct: number;
  readonly maxPct: number;
}

export interface RoundingPolicy {
  readonly decimalPlaces: number;
  readonly mode: 'half_up';
  /** Rounding is applied once, at the end. Intermediate values keep full precision. */
  readonly stage: 'final_only';
}

/**
 * A versioned bundle of academic rules for a (scheme, college?) pair.
 *
 * Two schemes never share calculation logic by default: they are separate
 * RuleSet values with separate verified provenance (16 §16.13).
 */
export interface RuleSet {
  readonly id: string;
  readonly schemeId: string;
  /** null = applies to every college under the scheme. */
  readonly collegeId: string | null;
  readonly version: number;
  readonly active: boolean;
  /**
   * ISO date the rules were verified against the cited source document.
   * A rule set with `verifiedAt === null` can never compute a student-facing
   * number (mirrors the database constraint in docs/09 §9.4).
   */
  readonly verifiedAt: string | null;
  readonly sourceUrl: string;
  readonly sourceClause: string;
  readonly effectiveFrom: string;
  readonly effectiveTo: string | null;

  readonly gradeBands: readonly GradeBand[];
  readonly specialGrades: readonly SpecialGrade[];

  /** Maximum CIE marks for a course (22OB 4.1). */
  readonly cieMax: number;
  /** Minimum CIE, as a percentage of cieMax, to be eligible for the SEE (22OB 6.3(1)). */
  readonly cieMinPct: number;
  /** Maximum SEE marks as written (22OB 4.1). */
  readonly seeMax: number;
  /** Minimum SEE, as a percentage of the SEE scale, to pass that head (22OB 6.3(2)). */
  readonly seeMinPct: number;
  /** Maximum marks for the whole course, CIE + scaled SEE (22OB 4.1(4)). */
  readonly courseMax: number;
  /** Minimum overall, as a percentage of courseMax, to pass the course (22OB 6.3(3)). */
  readonly overallMinPct: number;

  /** Attendance required per course (22OB 3.7(1)). */
  readonly attendanceRequiredPct: number;
  /** Maximum discretionary condonation, in percentage points (22OB 3.7(1)). */
  readonly attendanceCondonablePct: number;
  /** Below this, the course is marked DX (22OB 6.2(1)). */
  readonly attendanceDxFloorPct: number;

  /**
   * Formula identifiers, resolved against registries at call time.
   * Typed as `string` rather than a literal union because rule sets will be
   * loaded from the database in a later milestone; an unrecognised identifier
   * must fail cleanly rather than fail to compile.
   */
  readonly sgpaFormulaId: string;
  readonly cgpaFormulaId: string;
  readonly percentageFormulaId: string;

  readonly classBands: readonly ClassBand[];
  readonly rounding: RoundingPolicy;
}

/** One course in a semester, for SGPA. */
export interface CourseGrade {
  readonly credits: number;
  readonly gradeLetter: string;
  readonly subjectCode?: string;
}

/** One completed semester, for CGPA. */
export interface SemesterSummary {
  readonly credits: number;
  readonly sgpa: number;
  readonly semester?: number;
}

export type AttendanceStatus = 'safe' | 'below_requirement' | 'dx_risk';

export interface AttendanceOutcome {
  readonly percentage: number;
  readonly status: AttendanceStatus;
  readonly requiredPct: number;
  readonly dxFloorPct: number;
}

/** Which of the simultaneous thresholds actually determines the required SEE mark. */
export type BindingConstraint = 'see_minimum' | 'overall_target';

export interface RequiredMarksOutcome {
  readonly requiredSee: number;
  readonly seeMax: number;
  readonly bindingConstraint: BindingConstraint;
}

/** Target for a required-marks calculation, resolved against the rule set. */
export type MarksTarget =
  | { readonly kind: 'pass' }
  | { readonly kind: 'grade'; readonly letter: string }
  | { readonly kind: 'percentage'; readonly percentage: number };
