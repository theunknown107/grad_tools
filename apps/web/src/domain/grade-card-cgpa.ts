/**
 * CGPA reconstructed from grade-card SGPAs — only where the regulation is
 * unambiguous about how.
 *
 * Authority: docs/53 · 22OB 2.16, 3.3(2), 6.6(2), 6.9(1), Annexure-I
 *
 * ---------------------------------------------------------------------------
 * WHY THIS REFUSES SOME STUDENTS
 * ---------------------------------------------------------------------------
 *
 * 22OB 6.6(2)(b) defines CGPA = Σ(Ci × Si) / Σ Ci with Ci "the total number of
 * credits in that semester". The regulation's own worked example (Annexure-I
 * (a)) divides instead by the credits EXCLUDING courses under F: 279/39 = 7.15,
 * where the clause as written gives 279/46 = 6.07 for the same student. The two
 * readings agree exactly when no course of any counted semester is under F (or
 * absent) — credits earned equal credits registered — and disagree otherwise.
 *
 * So the reconstruction is offered only in that case, through the engine's own
 * `calculateCGPA`. Where any semester has credits not earned, GradTools does not
 * choose between the clause and the example: it says so, and shows nothing.
 *
 * Grade cards print SGPAs rounded to two decimals (22OB 6.6), so a CGPA built
 * from them can differ from the card's own CGPA in the second decimal. The
 * result is labelled as a reconstruction for that reason, never as the CGPA.
 */

import {
  calculateCGPA,
  calculatePercentage,
  getRuleSet,
  VTU_2022_RULE_SET_ID,
  type RuleSet,
} from '@gradtools/academic-rules';
import type { GradeCardSemester, StudentProfile } from './types.js';

/** What a student typed for one semester, before it is accepted. */
export interface GradeCardDraft {
  readonly semester: string;
  readonly sgpa: string;
  readonly creditsRegistered: string;
  readonly creditsEarned: string;
}

export type GradeCardField = keyof GradeCardDraft;

export interface GradeCardIssue {
  readonly field: GradeCardField;
  readonly message: string;
}

/** The first semester of a student's degree: 3 for diploma (lateral) entry (22OB 2.2). */
export function firstSemesterOf(profile: Pick<StudentProfile, 'entryRoute'> | null): number {
  return profile?.entryRoute === 'diploma' ? 3 : 1;
}

/**
 * Everything wrong with one typed row, or an empty list. Nothing is erased: the
 * caller keeps the draft and shows these beside it.
 */
export function gradeCardIssues(draft: GradeCardDraft, firstSemester: number): GradeCardIssue[] {
  const issues: GradeCardIssue[] = [];
  const semester = Number(draft.semester);
  if (!Number.isInteger(semester) || semester < 1 || semester > 8) {
    issues.push({ field: 'semester', message: 'Choose a semester from 1 to 8.' });
  } else if (semester < firstSemester) {
    issues.push({
      field: 'semester',
      message: `Your profile says you joined in semester ${String(firstSemester)} (diploma entry), so semester ${String(semester)} is not part of your degree.`,
    });
  }

  const sgpaText = draft.sgpa.trim();
  const sgpa = Number(sgpaText);
  if (sgpaText === '' || !Number.isFinite(sgpa)) {
    issues.push({ field: 'sgpa', message: 'Enter the SGPA printed on the grade card.' });
  } else if (sgpa < 0 || sgpa > 10) {
    issues.push({ field: 'sgpa', message: 'An SGPA is between 0 and 10.' });
  } else if (!/^\d{1,2}(\.\d{1,2})?$/.test(sgpaText)) {
    issues.push({
      field: 'sgpa',
      message: 'A grade card prints the SGPA to two decimals, such as 8.43.',
    });
  }

  const registered = Number(draft.creditsRegistered);
  const earned = Number(draft.creditsEarned);
  if (draft.creditsRegistered.trim() === '' || !Number.isInteger(registered) || registered < 1) {
    issues.push({
      field: 'creditsRegistered',
      message: 'Enter the credits registered for the semester, as printed (a whole number).',
    });
  }
  if (draft.creditsEarned.trim() === '' || !Number.isInteger(earned) || earned < 0) {
    issues.push({
      field: 'creditsEarned',
      message: 'Enter the credits earned for the semester, as printed (a whole number).',
    });
  } else if (Number.isInteger(registered) && earned > registered) {
    issues.push({
      field: 'creditsEarned',
      message: 'Credits earned cannot be more than credits registered.',
    });
  }
  return issues;
}

export type GradeCardCgpa =
  | {
      readonly status: 'available';
      readonly cgpa: number;
      readonly percentage: number | null;
      readonly semesters: readonly number[];
      readonly totalCredits: number;
    }
  | {
      readonly status: 'unavailable';
      /** What is missing or unresolved, in words a student can act on. */
      readonly reasons: readonly string[];
    };

const CONFLICT =
  'credits not earned (an F or absent course) change the CGPA, and VTU’s regulation is not consistent about how: clause 6.6(2)(b) divides by every credit registered, while its own worked example (Annexure-I) leaves out the credits of courses under F. GradTools does not choose between them.';

/**
 * The CGPA over every semester from the student's first to their latest entry,
 * or the reasons it cannot be given.
 */
export function gradeCardCgpa(
  entries: readonly GradeCardSemester[],
  options: { readonly firstSemester: number; readonly schemeId: string | null },
): GradeCardCgpa {
  const reasons: string[] = [];
  const ruleSet: RuleSet | undefined =
    options.schemeId === 'vtu-2022' ? getRuleSet(VTU_2022_RULE_SET_ID) : undefined;
  if (ruleSet === undefined) {
    reasons.push('This calculation is set up for the VTU 2022 scheme only.');
  }

  const seen = new Set<number>();
  for (const entry of entries) {
    if (seen.has(entry.semester))
      reasons.push(`Semester ${String(entry.semester)} is entered twice. Keep one.`);
    seen.add(entry.semester);
    if (entry.semester < options.firstSemester) {
      reasons.push(
        `Semester ${String(entry.semester)} is before your first semester (${String(options.firstSemester)}).`,
      );
    }
  }

  const ordered = [...entries].sort((a, b) => a.semester - b.semester);
  const latest = ordered.at(-1)?.semester ?? 0;
  /* 22OB 2.16: a CGPA is computed from the second semester onwards. */
  if (latest < options.firstSemester + 1) {
    reasons.push(
      `Enter at least semesters ${String(options.firstSemester)} and ${String(options.firstSemester + 1)}: a CGPA starts from your second semester (22OB 2.16).`,
    );
  }
  const missing: number[] = [];
  for (let semester = options.firstSemester; semester <= latest; semester += 1) {
    if (!seen.has(semester)) missing.push(semester);
  }
  if (missing.length > 0) {
    reasons.push(
      `A CGPA covers every semester from your first. Add semester${missing.length === 1 ? '' : 's'} ${missing.join(', ')}.`,
    );
  }

  const withFailures = ordered.filter((entry) => entry.creditsEarned < entry.creditsRegistered);
  if (withFailures.length > 0) {
    reasons.push(
      `Semester${withFailures.length === 1 ? '' : 's'} ${withFailures.map((e) => e.semester).join(', ')} ${withFailures.length === 1 ? 'has' : 'have'} ${CONFLICT}`,
    );
  }

  if (reasons.length > 0 || ruleSet === undefined) return { status: 'unavailable', reasons };

  const outcome = calculateCGPA(
    ordered.map((entry) => ({
      credits: entry.creditsRegistered,
      sgpa: entry.sgpa,
      semester: entry.semester,
    })),
    ruleSet,
  );
  if (!outcome.ok) return { status: 'unavailable', reasons: [outcome.detail] };
  const percentage = calculatePercentage(outcome.value, ruleSet);
  return {
    status: 'available',
    cgpa: outcome.value,
    percentage: percentage.ok ? percentage.value : null,
    semesters: ordered.map((entry) => entry.semester),
    totalCredits: ordered.reduce((sum, entry) => sum + entry.creditsRegistered, 0),
  };
}
