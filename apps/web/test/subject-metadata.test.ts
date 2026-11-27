/**
 * Subject metadata resolves from the shipped catalogue — no redundant prompts.
 *
 * Authority: SUBJECT_METADATA_AUDIT (2026-10-25). The hook `useSubjectIndex`
 * now feeds the student's scoped catalogue into `buildSubjectIndex`; these cases
 * pin the VERIFIED values from the official 2022 catalogue so a regression that
 * drops them (or re-introduces an arbitrary credit) fails here. Expected values
 * are read from the published catalogue rows, which carry VTU provenance.
 */

import { describe, expect, it } from 'vitest';
import { coursesForBranch } from '@gradtools/vtu-catalogue/data';
import {
  buildSubjectIndex,
  resolveSubject,
  type CatalogueSubject,
} from '../src/domain/subjects.js';

/** The scope the hook builds for a student of `branch`. */
const scopedCatalogue = (branch: string | null): CatalogueSubject[] =>
  coursesForBranch('2022', branch).map((course) => ({
    code: course.code,
    title: course.title,
    semester: course.semester,
    credits: course.credits,
    hasSee: null,
  }));

const CSBS = 'Computer Science & Business System';

describe('subject metadata from the shipped catalogue', () => {
  it('resolves Physical Education for a CSBS student (title + 0 credits), no prompt', () => {
    const built = buildSubjectIndex({ catalogue: scopedCatalogue(CSBS) });
    for (const code of ['BPEK359', 'BPEK459', 'BPEK559', 'BPEK658']) {
      const pe = resolveSubject(built, code);
      expect(pe?.canonicalTitle).toBe('Physical Education (PE) (Sports and Athletics)');
      expect(pe?.credits).toBe(0); // a mandatory non-credit course; 0 is an answer, not "unknown"
    }
  });

  it('resolves Indian Constitution for first-year (shared across branches), 1 credit', () => {
    // First-year rows are returned for ANY branch, so the metadata is known
    // whatever the student's eventual branch.
    for (const branch of [CSBS, 'Civil engineering', null]) {
      const built = buildSubjectIndex({ catalogue: scopedCatalogue(branch) });
      const ic = resolveSubject(built, 'BICOK107');
      expect(ic?.canonicalTitle).toBe('Indian Constitution');
      expect(ic?.credits).toBe(1);
    }
  });

  it('resolves Communicative English (first-year), 1 credit', () => {
    const built = buildSubjectIndex({ catalogue: scopedCatalogue(CSBS) });
    const eng = resolveSubject(built, 'BENGK106');
    expect(eng?.canonicalTitle).toBe('Communicative English');
    expect(eng?.credits).toBe(1);
  });

  it('resolves Business Communication (CSBS sem 4 elective), 1 credit', () => {
    const built = buildSubjectIndex({ catalogue: scopedCatalogue(CSBS) });
    const bc = resolveSubject(built, 'BCB456D');
    expect(bc?.canonicalTitle).toBe('Business Communication');
    expect(bc?.credits).toBe(1);
  });

  it('still leaves a subject unknown when the catalogue has no applicable row (manual fallback preserved)', () => {
    // A code the published scope does not cover is NOT invented; the UI keeps
    // asking. Here a plausible-but-absent code resolves to nothing.
    const built = buildSubjectIndex({
      catalogue: scopedCatalogue(CSBS),
      results: [
        {
          id: 'r1' as never,
          semester: 7,
          sgpa: null,
          declaredAt: null,
          subjects: [
            { subjectCode: 'BZZ799', subjectTitle: 'Some Unlisted Course', credits: null },
          ],
        } as never,
      ],
    });
    const unknown = resolveSubject(built, 'BZZ799');
    expect(unknown?.canonicalTitle).toBeNull();
    expect(unknown?.credits).toBeNull();
  });
});
