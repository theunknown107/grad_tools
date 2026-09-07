/**
 * Course kinds and exam sessions.
 *
 * Authority: Phase 7B §8 · 22OB 6.1 · DEC-037
 *
 * The assertions that matter most here are the NEGATIVE ones: what stays
 * unknown, and stays unknown loudly. A course kind that guesses is worse than
 * one that admits it does not know, because the guess reports a backlog the
 * university never gave.
 */

import { describe, expect, it } from 'vitest';
import { examSessionOf, resolveCourseKind, hasSeeFor } from '../src/domain/exams.js';
import { normalizeResultSubject } from '../src/domain/results.js';
import { asStudentProfileId } from '../src/domain/identity.js';
import type { ResultSubject, SemesterResult } from '../src/domain/types.js';

function subject(over: Record<string, unknown>): ResultSubject {
  return normalizeResultSubject({
    id: 's1',
    subjectCode: 'BCS401',
    subjectTitle: 'Analysis and Design of Algorithms',
    internal: 40,
    external: 30,
    total: 70,
    resultStatus: 'P',
    announcedOn: null,
    gradeLetter: null,
    gradePoint: null,
    credits: 4,
    hasSee: null,
    provenance: 'manual',
    ...over,
  });
}

function result(semester: number, subjects: readonly ResultSubject[]): SemesterResult {
  return {
    id: 'r1',
    profileId: asStudentProfileId('p1'),
    semester,
    schemeId: 'vtu-2022',
    ruleSetId: 'vtu-2022-v1',
    sgpaAsserted: null,
    subjects: [...subjects],
    createdAt: '',
    updatedAt: '',
  };
}

describe('resolving what kind of course a row describes', () => {
  it('takes the reference answer first, in both directions', () => {
    expect(resolveCourseKind(subject({ hasSee: true }))).toMatchObject({
      kind: 'see_bearing',
      from: 'catalogue',
      hasSee: true,
      countsTowardGpa: true,
    });
    expect(resolveCourseKind(subject({ hasSee: false }))).toMatchObject({
      kind: 'cie_only',
      from: 'catalogue',
      hasSee: false,
      countsTowardGpa: true,
    });
  });

  it('reads a printed PP, NP or AU as the kind of course it was awarded on', () => {
    // The regulations DEFINE these as the grades of non-credit and audited
    // courses. Reading them is reading, not inference.
    expect(resolveCourseKind(subject({ gradeLetter: 'PP', external: 0 })).kind).toBe('non_credit');
    expect(resolveCourseKind(subject({ gradeLetter: 'NP', external: 0 })).kind).toBe('non_credit');
    expect(resolveCourseKind(subject({ gradeLetter: 'AU', external: 0 })).kind).toBe('audit');
  });

  it('never reads DX, AB, IC or W as a kind of course', () => {
    /*
     * Each describes what happened to a STUDENT in a course, not what kind of
     * course it is. A DX is an ordinary SEE-bearing subject the student was
     * debarred from, and treating it as a category would drop it out of the
     * SGPA it belongs in.
     */
    for (const letter of ['DX', 'AB', 'IC', 'W']) {
      expect(resolveCourseKind(subject({ gradeLetter: letter, external: 0 })).kind).toBeNull();
    }
  });

  it('resolves a positive external, because marks prove the exam happened', () => {
    const resolved = resolveCourseKind(subject({ hasSee: null, external: 30 }));
    expect(resolved).toMatchObject({ kind: 'see_bearing', from: 'marks', hasSee: true });
  });

  it('resolves NOTHING from a zero external, which is DEC-037 exactly', () => {
    /*
     * THE ASYMMETRY IS THE WHOLE POINT. An external of 0 is equally consistent
     * with "this course has no SEE" and "sat the SEE and scored nothing", and
     * those have opposite outcomes. No amount of arithmetic separates them, so
     * nothing here tries.
     */
    const resolved = resolveCourseKind(subject({ hasSee: null, external: 0 }));
    expect(resolved.kind).toBeNull();
    expect(resolved.hasSee).toBeNull();
    expect(resolved.countsTowardGpa).toBeNull();
    expect(hasSeeFor(subject({ hasSee: null, external: 0 }))).toBeNull();
  });

  it('resolves nothing from a missing external either', () => {
    expect(resolveCourseKind(subject({ hasSee: null, external: null })).kind).toBeNull();
  });

  it('prefers the reference answer over the marks when they disagree', () => {
    /*
     * A catalogue row saying a course is CIE-only outranks a positive external,
     * which in that situation is evidence the EXTRACTION is wrong — and the
     * review screen exists for that.
     */
    expect(resolveCourseKind(subject({ hasSee: false, external: 30 })).from).toBe('catalogue');
    expect(resolveCourseKind(subject({ hasSee: false, external: 30 })).kind).toBe('cie_only');
  });

  it('falls back to the subject index when the row itself carries nothing', () => {
    const identity = {
      code: 'BCS401',
      canonicalTitle: null,
      titles: [],
      credits: null,
      studentCredits: null,
      hasSee: false,
      semesters: [],
      sources: [],
    };
    expect(resolveCourseKind(subject({ hasSee: null, external: 0 }), identity).kind).toBe(
      'cie_only',
    );
  });
});

describe('the sitting a result came from', () => {
  it('is the semester and the date its rows agree on', () => {
    const session = examSessionOf(
      result(4, [
        subject({ id: 'a', announcedOn: '2026-07-23' }),
        subject({ id: 'b', subjectCode: 'BCS402', announcedOn: '2026-07-23' }),
      ]),
    );
    expect(session.id).toBe('sem-4@2026-07-23');
    expect(session.announcedOn).toBe('2026-07-23');
    expect(session.label).toContain('Semester 4');
  });

  it('has no date when the rows disagree, rather than picking one', () => {
    /*
     * Rows announced on different days are not one sitting. Choosing the
     * earliest, or the most common, would state a date the card does not.
     */
    const session = examSessionOf(
      result(4, [
        subject({ id: 'a', announcedOn: '2026-07-23' }),
        subject({ id: 'b', subjectCode: 'BCS402', announcedOn: '2026-08-02' }),
      ]),
    );
    expect(session.announcedOn).toBeNull();
    expect(session.id).toBe('sem-4@undated');
  });

  it('tells two attempts at the same semester apart', () => {
    // The reason this exists: a cleared backlog and the original failure are
    // the same semester and the same subject, and only the sitting separates
    // them.
    const first = examSessionOf(result(4, [subject({ announcedOn: '2026-07-23' })]));
    const repeat = examSessionOf(result(4, [subject({ announcedOn: '2027-02-11' })]));
    expect(first.id).not.toBe(repeat.id);
  });

  it('is undated rather than absent when no row carries a date', () => {
    const session = examSessionOf(result(4, [subject({ announcedOn: null })]));
    expect(session.announcedOn).toBeNull();
    expect(session.label).toBe('Semester 4');
  });
});
