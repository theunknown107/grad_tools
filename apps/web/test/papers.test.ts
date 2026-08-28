/**
 * The question-paper library: what the browser decides on its own.
 *
 * Authority: docs/17 §17.13 · M8 §40
 *
 * Pure functions, so these are the cheapest tests in the suite and the ones
 * that guard the rules most likely to be softened by a later convenience:
 * a blocked paper never gets an Open button, an unknown field never acquires a
 * default, and the semester hint never becomes a filter.
 */

import { describe, expect, it } from 'vitest';
import type { QuestionPaper } from '@gradtools/shared-types';
import {
  AVAILABILITY_LABEL,
  FORMAT_LABEL,
  actionsFor,
  extractionSummary,
  isDemo,
  matchesSemester,
  paperFacts,
  safeText,
  schemeLabel,
  sortForStudent,
} from '../src/domain/papers.js';

function paper(overrides: Partial<QuestionPaper> = {}): QuestionPaper {
  return {
    id: 'paper-1',
    title: 'A synthetic paper',
    subjectId: null,
    subjectCode: 'BCS403',
    subjectTitle: 'Database Management Systems',
    schemeId: 'vtu-2022',
    branchId: 'cse',
    branchName: 'Computer Science and Engineering',
    semester: 4,
    examYear: 2025,
    examSession: 'June/July 2025',
    paperFormat: 'descriptive',
    pageCount: 4,
    sourceId: 'demo-question-papers',
    sourceName: 'Demo University (synthetic)',
    sourceUrl: null,
    availability: 'host',
    rightsStatus: 'permitted',
    questionCount: null,
    mcqItemCount: null,
    extractionSource: null,
    parserVersion: null,
    needsReview: null,
    addedAt: '2026-08-01T00:00:00+05:30',
    ...overrides,
  };
}

/* -------------------------------------------------------------------------- */
/* Availability                                                               */
/* -------------------------------------------------------------------------- */

describe('what a student may do with a paper', () => {
  it('offers to open a hosted paper here', () => {
    const actions = actionsFor(paper({ availability: 'host' }));
    expect(actions.canOpenHere).toBe(true);
    expect(actions.unavailableReason).toBeNull();
  });

  /*
   * NEVER "OPEN HERE" FOR A LINK (M8 §15). GradTools does not have the file,
   * and fetching it would make the app a proxy for material whose rights
   * nobody established.
   */
  it('never offers to open a link-only paper here, only at its source', () => {
    const actions = actionsFor(
      paper({ availability: 'link', sourceUrl: 'https://example.org/p.pdf' }),
    );
    expect(actions.canOpenHere).toBe(false);
    expect(actions.canOpenOriginal).toBe(true);
  });

  it('says so when a link paper has no link at all', () => {
    const actions = actionsFor(paper({ availability: 'link', sourceUrl: null }));
    expect(actions.canOpenHere).toBe(false);
    expect(actions.canOpenOriginal).toBe(false);
    expect(actions.unavailableReason).not.toBeNull();
  });

  /* A blocked paper gets no action of any kind (M8 §17). */
  it('offers nothing for a blocked paper, even one with a source URL', () => {
    const actions = actionsFor(
      paper({ availability: 'blocked', sourceUrl: 'https://example.org/p.pdf' }),
    );
    expect(actions.canOpenHere).toBe(false);
    expect(actions.canOpenOriginal).toBe(false);
    expect(actions.unavailableReason).toBe('This paper is not available.');
  });

  /* Should never reach the library, and is still handled (M8 §16). */
  it('offers nothing for a private paper', () => {
    const actions = actionsFor(paper({ availability: 'private' }));
    expect(actions.canOpenHere).toBe(false);
    expect(actions.canOpenOriginal).toBe(false);
  });

  it('describes availability as what happens next, not as a licence', () => {
    expect(AVAILABILITY_LABEL.host).toBe('Available here');
    expect(AVAILABILITY_LABEL.link).toBe('At the original source');
    expect(AVAILABILITY_LABEL.blocked).toBe('Not available');
  });
});

/* -------------------------------------------------------------------------- */
/* Metadata                                                                   */
/* -------------------------------------------------------------------------- */

describe('what a paper row says', () => {
  it('shows only fields that have a value', () => {
    const facts = paperFacts(
      paper({ examSession: null, examYear: null, semester: null, branchName: null }),
    );
    expect(facts).toEqual(['2022 scheme', 'Descriptive']);
  });

  it('falls back from the sitting to the bare year, never inventing either', () => {
    expect(paperFacts(paper({ examSession: null, examYear: 2024 }))[0]).toBe('2024');
    // With neither, no sitting fact appears at all — the list starts with the
    // semester instead of with an invented year.
    expect(paperFacts(paper({ examSession: null, examYear: null }))[0]).toBe('Semester 4');
  });

  /* `unknown` is a real format and is named as one (docs/17 §17.12). */
  it('names an unknown format rather than calling it something else', () => {
    expect(FORMAT_LABEL.unknown).toBe('Format unknown');
    expect(paperFacts(paper({ paperFormat: 'unknown' }))).toContain('Format unknown');
  });

  it('reads a scheme id the way a student says it', () => {
    expect(schemeLabel('vtu-2022')).toBe('2022 scheme');
    // Nothing is invented for an id with no year in it.
    expect(schemeLabel('experimental')).toBe('experimental');
  });

  /* The label follows the source, so editing a title cannot remove it (M8 §18). */
  it('marks demo papers by their source, not by their title', () => {
    expect(isDemo(paper({ title: 'No demo word here' }))).toBe(true);
    expect(isDemo(paper({ sourceId: 'some-real-source', title: 'DEMO — looks synthetic' }))).toBe(
      false,
    );
  });
});

/* -------------------------------------------------------------------------- */
/* Extraction                                                                 */
/* -------------------------------------------------------------------------- */

describe('the structured preview', () => {
  it('says nothing at all when no parser has run', () => {
    expect(extractionSummary(paper({ questionCount: null }))).toBeNull();
  });

  it('reports counts when a parser has run', () => {
    expect(extractionSummary(paper({ questionCount: 10, mcqItemCount: 0 }))).toBe(
      '10 questions found',
    );
    expect(extractionSummary(paper({ questionCount: 0, mcqItemCount: 50 }))).toContain(
      '50 multiple-choice items',
    );
  });

  /* A run that found nothing is a result, not an absence (docs/17 §17.11d). */
  it('distinguishes "found nothing" from "never looked"', () => {
    expect(extractionSummary(paper({ questionCount: 0, mcqItemCount: 0 }))).toBe(
      'No question structure was found in this paper.',
    );
  });

  /* NO ACCURACY FIGURE IS EVER PRODUCED, because none was measured (M8 §20). */
  it('never states a percentage or a confidence score', () => {
    const summary = extractionSummary(paper({ questionCount: 10, mcqItemCount: 2 })) ?? '';
    expect(summary).not.toMatch(/%|accura|confiden|verified/i);
  });
});

/* -------------------------------------------------------------------------- */
/* Relevance                                                                  */
/* -------------------------------------------------------------------------- */

describe('the semester hint', () => {
  const context = { schemeId: 'vtu-2022', branchId: null, currentSemester: 4 };

  it('matches a paper from the student’s own semester', () => {
    expect(matchesSemester(paper({ semester: 4 }), context)).toBe(true);
    expect(matchesSemester(paper({ semester: 5 }), context)).toBe(false);
  });

  /* Unknown is not a claim in either direction (M8 §7). */
  it('does not treat an unknown semester as a match', () => {
    expect(matchesSemester(paper({ semester: null }), context)).toBe(false);
  });

  it('matches nothing when the student has not said which semester they are in', () => {
    expect(matchesSemester(paper({ semester: 4 }), { ...context, currentSemester: null })).toBe(
      false,
    );
  });

  /*
   * SORTING, NOT FILTERING (M8 §25). Every paper is still present afterwards —
   * a student with a backlog needs a semester-3 paper while sitting in
   * semester 5.
   */
  it('orders the student’s semester first without removing anything', () => {
    const papers = [
      paper({ id: 'a', semester: 6, examYear: 2025 }),
      paper({ id: 'b', semester: 4, examYear: 2020 }),
      paper({ id: 'c', semester: 3, examYear: 2024 }),
    ];
    const sorted = sortForStudent(papers, context);

    expect(sorted[0]?.id).toBe('b');
    expect(sorted).toHaveLength(3);
    expect(sorted.map((p) => p.id).sort()).toEqual(['a', 'b', 'c']);
  });

  /*
   * THE SERVER'S ORDER SURVIVES (M8 §11). A student who chose "oldest sitting
   * first" must not have that quietly overruled on the way to the screen — the
   * only thing this function may change is which group comes first.
   */
  it('preserves the order it was given within each group', () => {
    const sorted = sortForStudent(
      [
        paper({ id: 'old', semester: 4, examYear: 2019 }),
        paper({ id: 'mid', semester: 4, examYear: 2022 }),
        paper({ id: 'new', semester: 4, examYear: 2025 }),
      ],
      context,
    );
    expect(sorted.map((p) => p.id)).toEqual(['old', 'mid', 'new']);
  });

  it('leaves a page alone entirely when no semester is known', () => {
    const papers = [paper({ id: 'a' }), paper({ id: 'b' }), paper({ id: 'c' })];
    const sorted = sortForStudent(papers, { ...context, currentSemester: null });
    expect(sorted.map((p) => p.id)).toEqual(['a', 'b', 'c']);
  });

  it('does not mutate the array it was given', () => {
    const papers = [paper({ id: 'a', semester: 6 }), paper({ id: 'b', semester: 4 })];
    sortForStudent(papers, context);
    expect(papers.map((p) => p.id)).toEqual(['a', 'b']);
  });
});

/* -------------------------------------------------------------------------- */
/* Text from a PDF                                                            */
/* -------------------------------------------------------------------------- */

describe('text extracted from a PDF is untrusted', () => {
  /*
   * React escapes markup, so the script case is already closed. What React does
   * not do is stop a bidirectional override from rearranging how a line READS
   * (M8 §21) — a display attack rather than a script one.
   */
  it('removes bidirectional overrides and isolates', () => {
    expect(safeText('Define a relation‮gnihtemos esle‬')).toBe('Define a relationgnihtemos esle');
    expect(safeText('a⁦b⁩c')).toBe('abc');
  });

  it('removes zero-width characters and the byte-order mark', () => {
    expect(safeText('﻿BCS​403')).toBe('BCS403');
  });

  it('removes control characters but keeps tabs and newlines', () => {
    expect(safeText('a bc')).toBe('abc');
    expect(safeText('line one\nline two')).toBe('line one\nline two');
  });

  /* Markup is left alone: React escapes it, and mangling it would corrupt a
     legitimate question about HTML. */
  it('leaves ordinary punctuation and markup-looking text intact', () => {
    expect(safeText('Explain <table> vs <div> in HTML.')).toBe('Explain <table> vs <div> in HTML.');
  });
});
