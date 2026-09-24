/**
 * One backlog story, told the same way on every screen that tells it.
 *
 * SYNTHETIC STUDENTS ONLY.
 *
 * ---------------------------------------------------------------------------
 * WHY A MATRIX
 * ---------------------------------------------------------------------------
 *
 * A student's backlogs come from two places: the ones they RECORD (the list on
 * My Degree) and the ones their imported results IMPLY (a failed row). The two
 * are kept apart and never added together. The unqualified "Backlogs" count is
 * the recorded one; the results' own figure appears only where it is labelled
 * as such (Academics' CGPA card). And no screen may say "no backlogs", "All
 * cleared", "Good" or "Clear academic record" unless NEITHER source shows one
 * and there are results to rest the claim on (`hasNoBacklogs`).
 *
 * Each page used to answer from a different source, so a recorded backlog read
 * 1 on the dashboard and 0 on Profile, and a failed result read "All cleared"
 * on the dashboard. Every case below is one of the ways those two sources can
 * disagree, rendered on all four pages.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup } from '@testing-library/react';
import { screen, waitFor, within } from '@testing-library/dom';
import { VTU_2022_RULE_SET_ID } from '@gradtools/academic-rules';
import { DashboardPage } from '../src/features/dashboard/DashboardPage.js';
import { SemestersPage } from '../src/features/semesters/SemestersPage.js';
import { ProfilePage } from '../src/features/profile/ProfilePage.js';
import { AcademicsPage } from '../src/features/academics/AcademicsPage.js';
import { normalizeResultSubject } from '../src/domain/results.js';
import { asStudentProfileId } from '../src/domain/identity.js';
import type { BacklogRecord, SemesterResult } from '../src/domain/types.js';
import { createMemoryRepositories, renderWith, type MemorySeed } from './helpers.js';

const profileId = asStudentProfileId('11111111-1111-1111-1111-111111111111');

/*
 * A course with marks and a known semester-end exam, so its pass or fail is
 * worked out by the rules. A failure is read from the MARKS: an internal of 12
 * is below the CIE minimum. The result status and grade letter are not what
 * decides it, and a grade-only row cannot be checked at all (see UNCHECKED).
 */
function course(code: string, internal: number, external: number) {
  return normalizeResultSubject({
    id: `s-${code}`,
    subjectCode: code,
    subjectTitle: code,
    internal,
    external,
    total: internal + external,
    resultStatus: 'P',
    credits: 4,
    gradeLetter: null,
    hasSee: true,
    provenance: 'catalogue',
  });
}

function result(semester: number, subjects: SemesterResult['subjects']): SemesterResult {
  return {
    id: `r${String(semester)}`,
    profileId,
    semester,
    schemeId: 'vtu-2022',
    ruleSetId: VTU_2022_RULE_SET_ID,
    sgpaAsserted: null,
    subjects: [...subjects],
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  };
}

function record(
  status: BacklogRecord['status'],
  subjectCode = 'BMATS201',
  subjectTitle = 'Mathematics II',
): BacklogRecord {
  return {
    id: `b-${subjectCode}`,
    profileId,
    subjectCode,
    subjectTitle,
    originSemester: 2,
    status,
    attempts: 1,
    clearedInSemester: status === 'cleared' ? 3 : null,
    updatedAt: '',
  };
}

const CLEAN = [result(1, [course('BMATS101', 44, 36)]), result(2, [course('BMATS201', 44, 36)])];
/* BMATS201 failed: one backlog implied by the results. */
const FAILED = [result(1, [course('BMATS101', 44, 36)]), result(2, [course('BMATS201', 12, 30)])];
/* A grade letter and no marks: whether it passed cannot be worked out. */
const UNCHECKED = [
  result(1, [
    normalizeResultSubject({
      id: 'u',
      subjectCode: 'BMATS101',
      subjectTitle: 'BMATS101',
      credits: 4,
      gradeLetter: 'A',
    }),
  ]),
];

interface Case {
  readonly name: string;
  readonly seed: MemorySeed;
  /** Recorded outstanding backlogs: the unqualified "Backlogs" count. */
  readonly recorded: number;
  /** Whether any screen may say the student has no backlogs. */
  readonly clear: boolean;
  /** My Degree's "Standing" figure: [value, sub], and the backlog card's title. */
  readonly standing: readonly [string, string];
  readonly standingTitle: string;
  /** Academics' results-derived "Backlogs"; null when the page has no figures. */
  readonly fromResults: string | null;
  /**
   * The line under the dashboard's "Backlogs" count, or null for none. With
   * nothing recorded and a failed result, the count reads 0 — so the line
   * names the results as the source rather than leaving a bare 0 unexplained.
   */
  readonly dashboardSub: string | null;
  /** Profile's header backlog badge, or null for none. */
  readonly profileBadge: string | null;
}

const COULD_NOT = 'Backlogs could not be checked';
const IN_RESULTS = '1 backlog in your results';

const CASES: readonly Case[] = [
  {
    name: 'an active recorded backlog, with clean results',
    seed: { results: CLEAN, backlogs: [record('active')] },
    recorded: 1,
    clear: false,
    standing: ['To clear', '1 backlog'],
    standingTitle: '1 backlog to clear',
    fromResults: '0',
    dashboardSub: null,
    profileBadge: '1 backlog',
  },
  {
    name: 'a re-sat backlog awaiting its result, with clean results',
    seed: { results: CLEAN, backlogs: [record('attempted')] },
    recorded: 1,
    clear: false,
    standing: ['To clear', '1 backlog'],
    standingTitle: '1 backlog to clear',
    fromResults: '0',
    dashboardSub: null,
    profileBadge: '1 backlog',
  },
  {
    name: 'a failed result row, with nothing recorded',
    seed: { results: FAILED },
    recorded: 0,
    clear: false,
    standing: ['To clear', IN_RESULTS],
    standingTitle: '1 backlog to clear',
    fromResults: '1',
    dashboardSub: IN_RESULTS,
    profileBadge: IN_RESULTS,
  },
  {
    name: 'the same subject both recorded and failed (not counted twice)',
    seed: { results: FAILED, backlogs: [record('active')] },
    recorded: 1,
    clear: false,
    standing: ['To clear', '1 backlog'],
    standingTitle: '1 backlog to clear',
    fromResults: '1',
    dashboardSub: null,
    profileBadge: '1 backlog',
  },
  {
    /* Different non-zero figures, so each page's source is visible. */
    name: 'two recorded backlogs and one different failed row',
    seed: {
      results: FAILED,
      backlogs: [record('active', 'BCS301', 'Data Structures'), record('active', 'BCS302', 'OOP')],
    },
    recorded: 2,
    clear: false,
    standing: ['To clear', '2 backlogs'],
    standingTitle: '2 backlogs to clear',
    fromResults: '1',
    dashboardSub: null,
    profileBadge: '2 backlogs',
  },
  {
    name: 'a cleared record, with clean results',
    seed: { results: CLEAN, backlogs: [record('cleared')] },
    recorded: 0,
    clear: true,
    standing: ['Good', 'No backlogs'],
    standingTitle: 'Clear academic record',
    fromResults: '0',
    dashboardSub: 'All cleared',
    profileBadge: 'No backlogs',
  },
  {
    /* The record says cleared, the results still hold the failure: not clear. */
    name: 'a cleared record over a failed result row',
    seed: { results: FAILED, backlogs: [record('cleared')] },
    recorded: 0,
    clear: false,
    standing: ['To clear', IN_RESULTS],
    standingTitle: '1 backlog to clear',
    fromResults: '1',
    dashboardSub: IN_RESULTS,
    profileBadge: IN_RESULTS,
  },
  {
    name: 'clean results and nothing recorded',
    seed: { results: CLEAN },
    recorded: 0,
    clear: true,
    standing: ['Good', 'No backlogs'],
    standingTitle: 'Clear academic record',
    fromResults: '0',
    dashboardSub: 'All cleared',
    profileBadge: 'No backlogs',
  },
  {
    /* No results: a zero that rests on nothing is not "no backlogs". */
    name: 'nothing entered at all',
    seed: {},
    recorded: 0,
    clear: false,
    standing: ['Unavailable', COULD_NOT],
    standingTitle: COULD_NOT,
    fromResults: null,
    dashboardSub: null,
    profileBadge: null,
  },
  {
    /* A row that could not be checked makes the count a floor, not a zero. */
    name: 'a result row that could not be checked',
    seed: { results: UNCHECKED },
    recorded: 0,
    clear: false,
    standing: ['Unavailable', COULD_NOT],
    standingTitle: COULD_NOT,
    fromResults: '0+',
    dashboardSub: null,
    profileBadge: null,
  },
];

/** Every wording that tells the student they have no backlogs. */
const CLEAR_CLAIM = /^(All cleared|No backlogs|Good|Clear academic record)$/;

const bundleFor = (seed: MemorySeed) => createMemoryRepositories(seed).bundle;

afterEach(cleanup);

describe.each(CASES)('backlogs: $name', (c) => {
  it('Dashboard counts the recorded backlogs and says "All cleared" only when clear', async () => {
    renderWith(<DashboardPage />, { repositories: bundleFor(c.seed) });

    const strip = await screen.findByTestId('standing-strip');
    await waitFor(() => {
      const figure = within(strip).getByRole('group', { name: 'Backlogs' });
      expect(within(figure).getByText(String(c.recorded))).toBeTruthy();
    });
    /*
     * The whole cell, read as one: label, count and the line under it — so a
     * sub that went missing, or a bare one that stopped naming its source,
     * fails here rather than passing an absence check.
     */
    const figure = within(strip).getByRole('group', { name: 'Backlogs' });
    expect(figure.textContent).toBe(`Backlogs${String(c.recorded)}${c.dashboardSub ?? ''}`);

    const hero = screen.getByRole('region', { name: /^Good (morning|afternoon|evening)/ });
    expect(within(hero).queryByText(/no backlogs/) !== null).toBe(c.clear);
    expect(screen.queryAllByText(CLEAR_CLAIM).length > 0).toBe(c.clear);
  });

  it('My Degree gives the standing from both sources, and a count that matches', async () => {
    renderWith(<SemestersPage />, { repositories: bundleFor(c.seed) });

    const hero = await screen.findByLabelText('Degree standing');
    const [value, sub] = c.standing;
    await waitFor(() => {
      const standing = within(hero).getByRole('group', { name: 'Standing' });
      expect(within(standing).getByText(value)).toBeTruthy();
      expect(within(standing).getByText(sub)).toBeTruthy();
    });
    expect(screen.getAllByText(c.standingTitle).length).toBeGreaterThan(0);
    expect(screen.queryAllByText(CLEAR_CLAIM).length > 0).toBe(c.clear);
  });

  it('Profile counts the recorded backlogs and claims none only when clear', async () => {
    renderWith(<ProfilePage />, { repositories: bundleFor(c.seed), route: '/profile' });

    await waitFor(() => {
      const figure = screen.getByRole('group', { name: 'Backlogs' });
      expect(within(figure).getByText(String(c.recorded))).toBeTruthy();
    });
    /* Exactly one backlog badge with exactly this wording, or none at all. */
    const header = screen.getByLabelText('Who you are');
    expect(
      within(header)
        .queryAllByText(/backlog/i)
        .map((badge) => badge.textContent),
    ).toEqual(c.profileBadge === null ? [] : [c.profileBadge]);
    expect(screen.queryAllByText(CLEAR_CLAIM).length > 0).toBe(c.clear);
  });

  it('Academics keeps the results figure and the recorded figure apart', async () => {
    renderWith(<AcademicsPage />, { repositories: bundleFor(c.seed) });

    if (c.fromResults === null) {
      expect(await screen.findByText('No calculated figures yet')).toBeTruthy();
      expect(screen.queryByRole('group', { name: 'Backlogs' })).toBeNull();
      return;
    }
    const fromResults = c.fromResults;
    await waitFor(() => {
      const derived = screen.getByRole('group', { name: 'Backlogs' });
      expect(within(derived).getByText(fromResults)).toBeTruthy();
    });
    const recorded = screen.getByRole('group', { name: 'Backlogs recorded' });
    expect(within(recorded).getByText(String(c.recorded))).toBeTruthy();
  });
});
