/**
 * A course the catalogue does not carry still has credits.
 *
 * Authority: Phase 7C §13, §14, §33 · docs/37 (never invent)
 *
 * ---------------------------------------------------------------------------
 * THE DEFECT THIS PINS
 * ---------------------------------------------------------------------------
 *
 * A VTU grade card prints marks and nothing else, and the shipped catalogue
 * does not carry every course a student takes — a physical-education row, a
 * self-study course, a departmental professional elective. For those the only
 * source of a credit figure is what the student recorded themselves, in their
 * semester plan or against the same code in another semester, which is exactly
 * what the subject index holds.
 *
 * `enrichRow` knew that and the import review used it. Every SAVED screen did
 * not: `semesterSgpa`, `sgpaInputs` and the statistics all read
 * `subject.credits` raw. So the same course resolved to "4 credits" while it
 * was being reviewed and to "—" the moment it was saved, and its semester
 * refused to produce an SGPA for want of credits it already had.
 *
 * NOTHING IS INVENTED HERE. The last test is the one that matters: a code
 * nobody has recorded anywhere stays unresolved, and the semester still says
 * so rather than reaching for a plausible number.
 */

import { describe, expect, it } from 'vitest';
import { vtu2022RuleSet } from '@gradtools/academic-rules';
import { asStudentProfileId } from '../src/domain/identity.js';
import { normalizeResultSubject, semesterSgpa } from '../src/domain/results.js';
import { buildSubjectIndex, resolveSubject } from '../src/domain/subjects.js';
import type { ResultSubject, SemesterResult, SemesterSubject } from '../src/domain/types.js';

const ruleSet = vtu2022RuleSet;
const profileId = asStudentProfileId('p1');

function subject(code: string, over: Record<string, unknown> = {}): ResultSubject {
  return normalizeResultSubject({
    id: `s-${code}`,
    subjectCode: code,
    subjectTitle: code,
    internal: 44,
    external: 36,
    total: 80,
    resultStatus: 'P',
    gradeLetter: null,
    gradePoint: null,
    credits: null,
    hasSee: true,
    provenance: 'manual',
    ...over,
  });
}

function planned(code: string, credits: number): SemesterSubject {
  return {
    id: `plan-${code}`,
    profileId,
    semester: 4,
    code,
    title: code,
    credits,
    notes: null,
    updatedAt: '',
  };
}

function result(subjects: readonly ResultSubject[]): SemesterResult {
  return {
    id: 'r4',
    profileId,
    semester: 4,
    schemeId: 'vtu-2022',
    ruleSetId: ruleSet.id,
    sgpaAsserted: null,
    subjects: [...subjects],
    createdAt: '',
    updatedAt: '',
  };
}

/* A PE row the catalogue has no entry for, recorded by the student as 1 credit. */
const index = buildSubjectIndex({ results: [], semesterSubjects: [planned('BPEK459', 1)] });
const identify = (code: string | null) => (code === null ? null : resolveSubject(index, code));

describe('credits a saved row does not carry itself', () => {
  it('are taken from what the student recorded, so the row is not "not recorded"', () => {
    const saved = result([subject('BCS401', { credits: 4 }), subject('BPEK459')]);

    const without = semesterSgpa(saved, ruleSet);
    const with_ = semesterSgpa(saved, ruleSet, identify);

    /* The PE row contributed nothing before; it contributes its 1 credit now. */
    expect(without.credits).toBe(4);
    expect(with_.credits).toBe(5);
    expect(with_.creditsKnown).toBe(true);
  });

  it('let a semester be graded that used to be refused for want of them', () => {
    const saved = result([subject('BCS401', { credits: 4 }), subject('BPEK459')]);

    /*
     * A PARTIAL SGPA IS A WRONG SGPA (OQ-049 §16), so the semester correctly
     * refused while one course had no credits. The course had them — nobody
     * looked. Resolving them is what completes the input, not relaxing the
     * rule: `complete` is still all-or-nothing.
     */
    expect(semesterSgpa(saved, ruleSet).sgpa).toBeNull();
    expect(semesterSgpa(saved, ruleSet).inputs.missing).toHaveLength(1);

    const graded = semesterSgpa(saved, ruleSet, identify);
    expect(graded.inputs.missing).toEqual([]);
    expect(graded.sgpa).not.toBeNull();
  });

  it('never override a figure the row already carries', () => {
    /*
     * §14. The row's own value is the student speaking about THIS row; the
     * index can only speak about the code in general, and a lookup must never
     * quietly replace the specific with the general.
     */
    const saved = result([subject('BPEK459', { credits: 2 })]);
    expect(semesterSgpa(saved, ruleSet, identify).credits).toBe(2);
  });

  it('stay unresolved when nobody has recorded them anywhere', () => {
    const saved = result([subject('BXX999')]);
    const graded = semesterSgpa(saved, ruleSet, identify);

    expect(graded.creditsKnown).toBe(false);
    expect(graded.credits).toBe(0);
    expect(graded.sgpa).toBeNull();
    expect(graded.inputs.missing).toEqual([{ subjectCode: 'BXX999', reason: 'no credits' }]);
  });

  it('tell an unknown credit figure apart from a genuine zero', () => {
    /*
     * The thing `credits > 0` could not say, and the reason every screen that
     * used it showed "Not recorded" against courses that were recorded.
     */
    const zero = semesterSgpa(result([subject('BNSK459', { credits: 0 })]), ruleSet, identify);
    const unknown = semesterSgpa(result([subject('BXX999')]), ruleSet, identify);

    expect(zero.credits).toBe(0);
    expect(zero.creditsKnown).toBe(true);
    expect(unknown.credits).toBe(0);
    expect(unknown.creditsKnown).toBe(false);
  });
});
