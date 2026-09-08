/**
 * Course codes the university itself writes two ways.
 *
 * Authority: Phase 7C.1 §6, §7, §26
 *
 * The rule under test is a NEGATIVE one as much as a positive: two codes are
 * the same course only when a document says so. Everything else — a shared
 * prefix, a near-identical title, a one-letter difference — resolves to
 * nothing, because a wrong course identity puts a wrong credit into a real
 * SGPA and does it silently.
 */

import { describe, expect, it } from 'vitest';
import { COURSE_ALIASES, aliasEvidence, aliasesOf } from '../src/domain/course-aliases.js';
import { buildSubjectIndex, creditsFor, resolveSubject } from '../src/domain/subjects.js';
import type { Subject } from '@gradtools/shared-types';

const catalogueRow = (code: string, title: string, credits: number): Subject => ({
  id: `c-${code}`,
  schemeId: 'vtu-2022',
  branchId: 'CB',
  semester: 3,
  code,
  title,
  credits,
  category: 'elective',
  cieMax: 50,
  seeMax: 50,
  hasSee: null,
  moduleCount: null,
  schemeLectureHours: null,
  schemeTutorialHours: null,
  schemePracticalHours: null,
  sourcePage: null,
  provenance: {
    sourceUrl: 'https://vtu.ac.in/pdf/2022_3to8/38csbssch.pdf',
    sourceClause: null,
    verifiedAt: '2026-09-08T00:00:00Z',
    verifiedBy: null,
  },
});

describe('a code the scheme and the syllabus spell differently', () => {
  it('resolves a card written the syllabus way against a scheme written the other way', () => {
    /*
     * THE REAL CASE. The CSBS 2022 scheme's third-semester option list prints
     * BCSL358D; the course's own syllabus page — and the result card the
     * university issued — print BCS358D for "Data Visualization with Python",
     * 1 credit. Without this the semester sat at eight resolved courses of
     * nine and had no SGPA at all.
     */
    const index = buildSubjectIndex({
      catalogue: [catalogueRow('BCSL358D', 'Data Visualization with Python', 1)],
    });

    expect(creditsFor(resolveSubject(index, 'BCS358D'))).toEqual({ credits: 1, from: 'catalogue' });
    /* And the spelling the scheme used still resolves too. */
    expect(creditsFor(resolveSubject(index, 'BCSL358D'))).toEqual({
      credits: 1,
      from: 'catalogue',
    });
  });

  it('works in the other direction as well', () => {
    const index = buildSubjectIndex({
      catalogue: [catalogueRow('BCS358D', 'Data Visualization with Python', 1)],
    });
    expect(creditsFor(resolveSubject(index, 'BCSL358D')).credits).toBe(1);
  });

  it('does not touch a code with no documented partner', () => {
    // §7: no edit distance, no near-miss. BCS358C is one letter from a code in
    // the table and resolves to nothing, because nothing establishes it.
    const index = buildSubjectIndex({
      catalogue: [catalogueRow('BCSL358D', 'Data Visualization with Python', 1)],
    });
    expect(creditsFor(resolveSubject(index, 'BCS358C')).credits).toBeNull();
    expect(aliasesOf('BCS999Z')).toEqual(['BCS999Z']);
  });

  it('cites the document behind every entry', () => {
    /*
     * An entry without a citation cannot be checked, and an equivalence nobody
     * can check is a guess with a table around it (§26).
     */
    expect(COURSE_ALIASES.length).toBeGreaterThan(0);
    for (const alias of COURSE_ALIASES) {
      expect(alias.evidence).toMatch(/VTU|syllabus|scheme|corrigendum/i);
      expect(alias.evidence.length).toBeGreaterThan(30);
      expect(alias.title.trim()).not.toBe('');
      expect(alias.variant).not.toBe(alias.canonical);
    }
  });

  it('offers the evidence for a screen to show', () => {
    expect(aliasEvidence('BCS358D')?.canonical).toBe('BCS358D');
    expect(aliasEvidence('BCS358D')?.evidence).toMatch(/syllabus/i);
    expect(aliasEvidence('BCS301')).toBeNull();
  });
});
