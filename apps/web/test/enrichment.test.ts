/**
 * What is known about a row, and what is honestly not.
 *
 * Authority: Phase 7C §13, §14, §33 · docs/37
 *
 * The assertions that matter most are the ones about ABSENCE. A card prints
 * marks and nothing else, so credits, grade and grade point are all derived and
 * each can fail on its own — and the reported bug was that the review showed no
 * difference between "4 credits" and "nobody knows how many credits this has".
 */

import { describe, expect, it } from 'vitest';
import { vtu2022RuleSet } from '@gradtools/academic-rules';
import { enrichRow } from '../src/domain/enrichment.js';
import { buildSubjectIndex, resolveSubject } from '../src/domain/subjects.js';
import { normalizeResultSubject } from '../src/domain/results.js';
import { asStudentProfileId } from '../src/domain/identity.js';
import type { ResultSubject, SemesterSubject } from '../src/domain/types.js';

const ruleSet = vtu2022RuleSet;

function subject(over: Record<string, unknown> = {}): ResultSubject {
  return normalizeResultSubject({
    id: 's1',
    subjectCode: 'BCS401',
    subjectTitle: 'Analysis and Design of Algorithms',
    internal: 44,
    external: 36,
    total: 80,
    resultStatus: 'P',
    announcedOn: null,
    gradeLetter: null,
    gradePoint: null,
    credits: null,
    hasSee: null,
    provenance: 'manual',
    ...over,
  });
}

function planned(code: string, credits: number): SemesterSubject {
  return {
    id: `plan-${code}`,
    profileId: asStudentProfileId('p1'),
    semester: 4,
    code,
    title: code,
    credits,
    notes: null,
    updatedAt: '',
  };
}

describe('what a reviewed row resolves to', () => {
  it('gives a grade and its point from the marks, and says where each came from', () => {
    /*
     * 80 out of 100 is A+ under 22OB 6.1's bands, worth 9. Neither is printed
     * on a provisional card; both are derived, and the row says so.
     */
    const enriched = enrichRow(subject({ credits: 4, hasSee: true }), null, ruleSet);

    expect(enriched.grade).toMatchObject({ value: 'A+', source: '2022 rule set' });
    expect(enriched.gradePoint).toMatchObject({ value: 9, source: '2022 rule set' });
    expect(enriched.credits.value).toBe(4);
    expect(enriched.complete).toBe(true);
  });

  it('prefers a grade the card printed, and attributes it to the card', () => {
    const enriched = enrichRow(
      subject({ credits: 4, hasSee: true, gradeLetter: 'O' }),
      null,
      ruleSet,
    );
    expect(enriched.grade).toMatchObject({ value: 'O', source: 'Printed on the card' });
    expect(enriched.gradePoint.value).toBe(10);
  });

  it('never labels a figure the student supplied as the catalogue’s', () => {
    /*
     * §14, and the bug it exists to prevent: a credit the student typed was
     * once marked `catalogue` and then trusted as reference data on three other
     * screens. The words are what stop it coming back.
     */
    const enriched = enrichRow(
      subject({ credits: 3, hasSee: true, provenance: 'manual' }),
      null,
      ruleSet,
    );
    expect(enriched.credits.value).toBe(3);
    expect(enriched.credits.source).toBe('Your own record');
    expect(enriched.credits.source).not.toBe('VTU catalogue');
  });

  it('falls back to what the student recorded for the same code elsewhere', () => {
    const index = buildSubjectIndex({ semesterSubjects: [planned('BCS401', 3)] });
    const enriched = enrichRow(subject({ hasSee: true }), resolveSubject(index, 'BCS401'), ruleSet);
    expect(enriched.credits).toMatchObject({ value: 3, source: 'Your own record' });
  });

  it('says credits are UNAVAILABLE, with a reason, rather than showing zero', () => {
    /*
     * §33. `0` and "unknown" are different answers and used to render
     * identically. A non-credit course really is worth zero; a course nobody
     * has a scheme row for is unresolved, and saying "0" for it would put a
     * wrong number into a credit total.
     */
    const enriched = enrichRow(subject({ hasSee: true }), null, ruleSet);
    expect(enriched.credits.value).toBeNull();
    expect(enriched.credits.reason).toMatch(/no canonical course match/i);
    expect(enriched.complete).toBe(false);
  });

  it('shows a genuine zero as zero', () => {
    const enriched = enrichRow(
      subject({ credits: 0, gradeLetter: 'PP', internal: 60, external: 0, total: 60 }),
      null,
      ruleSet,
    );
    expect(enriched.credits.value).toBe(0);
    expect(enriched.credits.reason).toBeNull();
    expect(enriched.courseKind.kind).toBe('non_credit');
  });

  it('says the assessment is not known when an external of 0 cannot settle it', () => {
    const enriched = enrichRow(
      subject({ credits: 4, internal: 40, external: 0, total: 40 }),
      null,
      ruleSet,
    );
    expect(enriched.courseKind.kind).toBeNull();
    expect(enriched.grade.value).toBeNull();
    expect(enriched.grade.reason).toMatch(/semester-end exam is not recorded/i);
  });

  it('refuses a grade for a failed course, and cites the open question', () => {
    /*
     * OQ-054. The regulations band the letter by percentage AND separately
     * require each head, and do not say which a failed course carries. A
     * silent P would print a pass on a course to be re-sat; a silent F would
     * understate an SGPA under the other reading.
     */
    const failed = subject({ credits: 4, hasSee: true, internal: 12, external: 30, total: 42 });
    const enriched = enrichRow(failed, null, ruleSet);

    expect(enriched.grade.value).toBeNull();
    expect(enriched.grade.reason).toMatch(/did not pass/i);
    expect(enriched.grade.reason).toMatch(/OQ-054/);
    expect(enriched.gradePoint.value).toBeNull();
  });

  it('resolves nothing at all without a rule set, and says which part is missing', () => {
    const enriched = enrichRow(subject({ credits: 4, hasSee: true }), null, undefined);
    expect(enriched.grade.value).toBeNull();
    expect(enriched.grade.reason).toMatch(/rule set/i);
    // Credits do not depend on the rule set and survive.
    expect(enriched.credits.value).toBe(4);
  });

  it('counts a non-credit course as complete without a grade point', () => {
    // PP carries no point and is excluded from the average; that is resolved,
    // not missing.
    const enriched = enrichRow(
      subject({ credits: 0, gradeLetter: 'PP', internal: 60, external: 0, total: 60 }),
      null,
      ruleSet,
    );
    expect(enriched.courseKind.countsTowardGpa).toBe(false);
    expect(enriched.complete).toBe(true);
  });
});
