/**
 * The degree screen, the dashboard's semester context, and local persistence.
 *
 * Authority: docs/18 §18.9 · M6 §23
 *
 * SYNTHETIC STUDENTS ONLY. Nothing here resembles a real person's record, and
 * nothing real may ever be added (M6 §18).
 */

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup } from '@testing-library/react';
import { screen, waitFor, within } from '@testing-library/dom';
import userEvent from '@testing-library/user-event';
import { VTU_2022_RULE_SET_ID } from '@gradtools/academic-rules';
import { SemestersPage } from '../src/features/semesters/SemestersPage.js';
import { DashboardPage } from '../src/features/dashboard/DashboardPage.js';
import { asStudentProfileId } from '../src/domain/identity.js';
import type {
  BacklogRecord,
  SemesterRecord,
  SemesterResult,
  SemesterStatus,
} from '../src/domain/types.js';
import { createMemoryRepositories, renderWith } from './helpers.js';

const profileId = asStudentProfileId('11111111-1111-1111-1111-111111111111');

function result(semester: number, subjects: readonly [string, number, string][]): SemesterResult {
  return {
    id: `r${String(semester)}`,
    profileId,
    semester,
    schemeId: 'vtu-2022',
    ruleSetId: VTU_2022_RULE_SET_ID,
    sgpaAsserted: null,
    subjects: subjects.map(([subjectCode, credits, gradeLetter], index) => ({
      id: `${String(semester)}-${String(index)}`,
      subjectCode,
      subjectTitle: subjectCode,
      credits,
      gradeLetter,
    })),
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  };
}

function semester(number: number, status: SemesterStatus): SemesterRecord {
  return {
    id: `s${String(number)}`,
    profileId,
    number,
    status,
    startedOn: null,
    completedOn: null,
    updatedAt: '2026-01-01T00:00:00Z',
  };
}

afterEach(cleanup);

/* -------------------------------------------------------------------------- */
/* The eight semesters                                                        */
/* -------------------------------------------------------------------------- */

describe('the degree screen', () => {
  it('shows all eight semesters to a student with nothing entered', async () => {
    renderWith(<SemestersPage />);

    // Queried as headings: "Semester 1" is also a backlog select option.
    expect(await screen.findByRole('heading', { name: 'Semester 1' })).toBeTruthy();
    for (const number of [2, 3, 4, 5, 6, 7, 8]) {
      expect(screen.getByRole('heading', { name: `Semester ${String(number)}` })).toBeTruthy();
    }
  });

  /* THE PILOT SHAPE (M6 §3): four behind, one running, three ahead. */
  it('shows a third-year student their history, their present and what is ahead', async () => {
    const { bundle } = createMemoryRepositories({
      semesters: [
        semester(1, 'completed'),
        semester(2, 'completed'),
        semester(3, 'completed'),
        semester(4, 'completed'),
        semester(5, 'in_progress'),
      ],
      results: [
        result(1, [['BMATS101', 4, 'A']]),
        result(2, [['BMATS201', 4, 'A']]),
        result(3, [['BCS301', 4, 'O']]),
        result(4, [['BCS401', 4, 'O']]),
      ],
    });
    renderWith(<SemestersPage />, { repositories: bundle });

    /*
     * Scoped to the Semesters panel. M10A added a Semester history panel above
     * it that also names the semester in progress, and counting "In progress"
     * across the whole page would now count that too — which would make the
     * assertion about how many panels mention the present rather than about how
     * many semesters ARE the present. The invariant under test is unchanged:
     * exactly one semester carries each lifecycle state.
     */
    await screen.findAllByRole('heading', { name: 'Semester 1' });
    const panel = screen.getByRole('heading', { name: 'Semesters' }).closest('section');
    expect(panel).not.toBeNull();

    const pills = (label: string) =>
      within(panel as HTMLElement)
        .getAllByText(label)
        .filter((node) => node.tagName === 'SPAN');

    expect(pills('In progress').length).toBe(1);
    expect(pills('Completed').length).toBe(4);
    expect(pills('Planned').length).toBe(3);
  });

  it('records a lifecycle change', async () => {
    const { bundle, peek } = createMemoryRepositories();
    renderWith(<SemestersPage />, { repositories: bundle });

    const select = await screen.findByLabelText('Semester 5 status');
    await userEvent.selectOptions(select, 'in_progress');

    await waitFor(() => {
      expect(peek.semesters().find((s) => s.number === 5)?.status).toBe('in_progress');
    });
  });

  /* At most one semester runs at a time, without the student tidying up. */
  it('stands down a previous in-progress semester', async () => {
    const { bundle, peek } = createMemoryRepositories({ semesters: [semester(4, 'in_progress')] });
    renderWith(<SemestersPage />, { repositories: bundle });

    await userEvent.selectOptions(await screen.findByLabelText('Semester 5 status'), 'in_progress');

    await waitFor(() => {
      expect(peek.semesters().find((s) => s.number === 4)?.status).toBe('planned');
      expect(peek.semesters().find((s) => s.number === 5)?.status).toBe('in_progress');
    });
  });

  it('shows CGPA and percentage from completed semesters', async () => {
    const { bundle } = createMemoryRepositories({
      results: [result(1, [['BMATS101', 4, 'O']]), result(2, [['BMATS201', 4, 'O']])],
    });
    renderWith(<SemestersPage />, { repositories: bundle });

    // Scoped to the standing panel: 10.00 is also each semester's SGPA.
    const heading = await screen.findByRole('heading', { name: 'Where you stand' });
    const panel = heading.closest('section') as HTMLElement;

    expect(within(panel).getByText('10.00')).toBeTruthy();
    expect(within(panel).getByText('100.0%')).toBeTruthy();
  });

  /*
   * NO INVENTED DENOMINATOR (M6 §13). Credits earned is real; credits remaining
   * is not knowable from this build, and the screen says which is which.
   */
  it('says credits remaining cannot be shown rather than inventing a total', async () => {
    const { bundle } = createMemoryRepositories({ results: [result(1, [['BMATS101', 4, 'O']])] });
    renderWith(<SemestersPage />, { repositories: bundle });

    expect(await screen.findByText(/not established in verified reference data/)).toBeTruthy();
  });
});

/* -------------------------------------------------------------------------- */
/* Subjects and strengths                                                     */
/* -------------------------------------------------------------------------- */

describe('subject insights', () => {
  /* "Not enough history yet" is an acceptable answer (M6 §9). */
  it('refuses to name strengths for a first-semester student', async () => {
    const { bundle } = createMemoryRepositories({
      results: [
        result(1, [
          ['BMATS101', 4, 'A'],
          ['BPHYS102', 4, 'B'],
        ]),
      ],
    });
    renderWith(<SemestersPage />, { repositories: bundle });

    expect(await screen.findByText(/Not enough history yet/)).toBeTruthy();
    expect(screen.queryByText('Strong')).toBeNull();
    expect(screen.queryByText('Weak')).toBeNull();
  });

  /* THE RULE IS PRINTED ON THE SCREEN, so a student can check it by hand. */
  it('states the rule it used when it does classify', async () => {
    const { bundle } = createMemoryRepositories({
      results: [
        result(1, [
          ['BCS301', 4, 'O'],
          ['BCS302', 4, 'A+'],
          ['BCS303', 4, 'A'],
          ['BCS304', 4, 'B+'],
          ['BCS305', 4, 'B'],
        ]),
      ],
    });
    renderWith(<SemestersPage />, { repositories: bundle });

    expect(await screen.findByText(/measured against your own average/)).toBeTruthy();
    expect(screen.getByText(/full grade point above it is strong/)).toBeTruthy();
    expect(screen.getAllByText('Strong').length).toBe(2);
    expect(screen.getAllByText('Weak').length).toBe(2);
  });

  /* A direction is words as well as an arrow — never a glyph alone. */
  it('describes a subject taken once as taken once, not as flat', async () => {
    const { bundle } = createMemoryRepositories({
      results: [result(1, [['BMATS101', 4, 'A']])],
    });
    renderWith(<SemestersPage />, { repositories: bundle });

    expect(await screen.findByText('Taken once')).toBeTruthy();
    expect(screen.queryByText('Unchanged')).toBeNull();
  });

  it('shows a direction for a subject that was re-sat', async () => {
    const { bundle } = createMemoryRepositories({
      results: [result(1, [['BCS301', 4, 'C']]), result(3, [['BCS301', 4, 'A']])],
    });
    renderWith(<SemestersPage />, { repositories: bundle });

    expect(await screen.findByText('Improved')).toBeTruthy();
    expect(screen.getByText(/2 attempts/)).toBeTruthy();
  });
});

/* -------------------------------------------------------------------------- */
/* Backlogs                                                                   */
/* -------------------------------------------------------------------------- */

describe('backlogs', () => {
  it('adds a backlog and keeps it', async () => {
    const { bundle, peek } = createMemoryRepositories();
    renderWith(<SemestersPage />, { repositories: bundle });

    await userEvent.type(await screen.findByLabelText('Subject code'), 'BCS301');
    await userEvent.click(screen.getByRole('button', { name: /Add backlog/ }));

    await waitFor(() => {
      expect(peek.backlogs()[0]?.subjectCode).toBe('BCS301');
      expect(peek.backlogs()[0]?.status).toBe('active');
    });
  });

  /* Sitting the exam is not clearing it: the result is not known yet. */
  it('counts an attempt without calling the subject cleared', async () => {
    const backlog: BacklogRecord = {
      id: 'b1',
      profileId,
      subjectCode: 'BCS301',
      subjectTitle: 'BCS301',
      originSemester: 3,
      status: 'active',
      attempts: 0,
      clearedInSemester: null,
      updatedAt: '2026-01-01T00:00:00Z',
    };
    const { bundle, peek } = createMemoryRepositories({ backlogs: [backlog] });
    renderWith(<SemestersPage />, { repositories: bundle });

    await userEvent.selectOptions(await screen.findByLabelText('Status for BCS301'), 'attempted');

    await waitFor(() => {
      expect(peek.backlogs()[0]?.status).toBe('attempted');
      expect(peek.backlogs()[0]?.attempts).toBe(1);
    });
  });

  it('refuses an empty subject code', async () => {
    const { bundle, peek } = createMemoryRepositories();
    renderWith(<SemestersPage />, { repositories: bundle });

    await userEvent.click(await screen.findByRole('button', { name: /Add backlog/ }));
    await waitFor(() => {
      expect(peek.backlogs().length).toBe(0);
    });
  });

  /* No exam-date field exists, and none may be added (M6 §10). */
  it('offers no exam date to enter', async () => {
    renderWith(<SemestersPage />);
    await screen.findByRole('heading', { name: 'Backlogs' });
    expect(screen.queryByLabelText(/exam date/i)).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* Semester subjects                                                          */
/* -------------------------------------------------------------------------- */

describe('semester subjects', () => {
  it('adds a subject to a semester', async () => {
    const { bundle, peek } = createMemoryRepositories();
    renderWith(<SemestersPage />, { repositories: bundle });

    const rows = await screen.findAllByRole('button', { name: 'Subjects' });
    await userEvent.click(rows[4] as HTMLElement); // Semester 5

    await userEvent.type(screen.getByLabelText('Code'), 'BCS501');
    await userEvent.click(screen.getByRole('button', { name: /Add subject/ }));

    await waitFor(() => {
      expect(peek.semesterSubjects()[0]?.code).toBe('BCS501');
      expect(peek.semesterSubjects()[0]?.semester).toBe(5);
    });
  });

  /* Student-entered text is TEXT. It came from a keyboard, not from a parser. */
  it('renders a hostile subject name as text', async () => {
    const { bundle } = createMemoryRepositories({
      semesterSubjects: [
        {
          id: 'ss1',
          profileId,
          semester: 5,
          code: 'BCS501',
          title: '<img src=x onerror=alert(1)>',
          credits: 4,
          notes: null,
          updatedAt: '2026-01-01T00:00:00Z',
        },
      ],
    });
    renderWith(<SemestersPage />, { repositories: bundle });

    const rows = await screen.findAllByRole('button', { name: 'Subjects' });
    await userEvent.click(rows[4] as HTMLElement);

    expect(await screen.findByText('<img src=x onerror=alert(1)>')).toBeTruthy();
    expect(document.querySelector('img')).toBeNull();
  });

  it('survives a very long subject name without breaking the row', async () => {
    const { bundle } = createMemoryRepositories({
      semesterSubjects: [
        {
          id: 'ss1',
          profileId,
          semester: 5,
          code: 'BCS501',
          title: 'Design and Analysis of Algorithms with Advanced Data Structures '.repeat(3),
          credits: 4,
          notes: null,
          updatedAt: '2026-01-01T00:00:00Z',
        },
      ],
    });
    renderWith(<SemestersPage />, { repositories: bundle });

    const rows = await screen.findAllByRole('button', { name: 'Subjects' });
    await userEvent.click(rows[4] as HTMLElement);
    expect(await screen.findByText(/Design and Analysis of Algorithms/)).toBeTruthy();
  });
});

/* -------------------------------------------------------------------------- */
/* Persistence and isolation                                                  */
/* -------------------------------------------------------------------------- */

describe('persistence', () => {
  /* What a reload actually is: the same repository, a fresh component tree. */
  it('keeps what was entered when the screen is remounted', async () => {
    const { bundle, peek } = createMemoryRepositories();
    const first = renderWith(<SemestersPage />, { repositories: bundle });

    await userEvent.selectOptions(await screen.findByLabelText('Semester 5 status'), 'in_progress');
    await waitFor(() => {
      expect(peek.semesters().length).toBe(1);
    });

    first.unmount();
    renderWith(<SemestersPage />, { repositories: bundle });

    await screen.findAllByRole('heading', { name: 'Semester 5' });
    expect(
      screen.getAllByText('In progress').filter((node) => node.tagName === 'SPAN').length,
    ).toBe(1);
  });

  /*
   * TWO STUDENTS, TWO BUNDLES, NOTHING SHARED. The repository boundary is what
   * a future signed-in mode swaps; one student's data must never be reachable
   * through another's bundle (M6 §23).
   */
  it('keeps two students separate at the repository boundary', async () => {
    const a = createMemoryRepositories({ backlogs: [] });
    const b = createMemoryRepositories({
      backlogs: [
        {
          id: 'b1',
          profileId: asStudentProfileId('22222222-2222-2222-2222-222222222222'),
          subjectCode: 'BCS999',
          subjectTitle: 'BCS999',
          originSemester: 3,
          status: 'active',
          attempts: 0,
          clearedInSemester: null,
          updatedAt: '2026-01-01T00:00:00Z',
        },
      ],
    });

    const first = renderWith(<SemestersPage />, { repositories: a.bundle });
    await screen.findByRole('heading', { name: 'Backlogs' });
    expect(screen.queryByText('BCS999')).toBeNull();
    first.unmount();

    renderWith(<SemestersPage />, { repositories: b.bundle });
    expect(await screen.findByText('BCS999')).toBeTruthy();
    expect(a.peek.backlogs().length).toBe(0);
  });
});

/* -------------------------------------------------------------------------- */
/* The dashboard's current-semester context                                   */
/* -------------------------------------------------------------------------- */

describe('current semester on the dashboard', () => {
  it('leads with the semester the student is in', async () => {
    const { bundle } = createMemoryRepositories({
      semesters: [semester(5, 'in_progress')],
      semesterSubjects: [
        {
          id: 'ss1',
          profileId,
          semester: 5,
          code: 'BCS501',
          title: 'Software Engineering',
          credits: 4,
          notes: null,
          updatedAt: '2026-01-01T00:00:00Z',
        },
      ],
      attendance: [
        {
          id: 'a1',
          profileId,
          semester: 5,
          subjectCode: 'BCS501',
          subjectTitle: 'Software Engineering',
          attended: 43,
          conducted: 50,
          updatedAt: '2026-01-01T00:00:00Z',
        },
      ],
    });
    renderWith(<DashboardPage />, { repositories: bundle });

    await screen.findByRole('heading', { name: /Semester 5/ });
    /*
     * Scoped to the snapshot strip: the attendance list further down shows the
     * same figure per subject, so an unscoped match would prove nothing.
     */
    const strip = document.querySelector('dl') as HTMLElement;
    expect(within(strip).getByText('86.0%')).toBeTruthy();
    expect(within(strip).getByText('Subjects')).toBeTruthy();
  });

  /*
   * AN SGPA DOES NOT EXIST UNTIL THE SEMESTER ENDS. Showing a projection here
   * would be the most quietly misleading number on the screen.
   */
  it('never estimates an SGPA for a semester still running', async () => {
    const { bundle } = createMemoryRepositories({ semesters: [semester(5, 'in_progress')] });
    renderWith(<DashboardPage />, { repositories: bundle });

    await screen.findByRole('heading', { name: /Semester 5/ });
    const strip = document.querySelector('dl') as HTMLElement;

    /*
     * The only SGPA on the snapshot is labelled as a PAST semester's. With no
     * results saved there is none, so it reads as an em dash — never as a
     * figure for the semester still running.
     */
    expect(within(strip).getByText('Last SGPA')).toBeTruthy();
    expect(within(strip).queryByText('Current SGPA')).toBeNull();
    expect(within(strip).getAllByText('—').length).toBeGreaterThan(0);
  });

  it('shows no semester panel until one is marked in progress', async () => {
    renderWith(<DashboardPage />);
    await waitFor(() => {
      // No semester is in progress, so no status label appears beside the title.
      expect(screen.queryByText('In progress')).toBeNull();
    });
  });
});

/* -------------------------------------------------------------------------- */
/* An unavailable historical rule set                                         */
/* -------------------------------------------------------------------------- */

describe('a semester whose rules this build does not have', () => {
  function pinnedToMissing(): SemesterResult {
    return {
      ...result(2, [['BMATS201', 4, 'O']]),
      // A valid scheme, so the current rules ARE available. They must not be used.
      ruleSetId: 'vtu-2029-imaginary',
    };
  }

  /*
   * D. THE SCREEN SAYS SO. Silence here would be the worst outcome: a blank
   * SGPA that looks like an entry the student forgot, beside semesters that
   * worked.
   */
  it('says which rules are missing rather than leaving a silent blank', async () => {
    const { bundle } = createMemoryRepositories({ results: [pinnedToMissing()] });
    renderWith(<SemestersPage />, { repositories: bundle });

    expect(await screen.findByText(/rules this version of GradTools does not have/)).toBeTruthy();
    expect(screen.getByText(/vtu-2029-imaginary/)).toBeTruthy();
  });

  it('does not show an SGPA worked out under the current rules', async () => {
    const { bundle } = createMemoryRepositories({ results: [pinnedToMissing()] });
    renderWith(<SemestersPage />, { repositories: bundle });

    await screen.findByText(/rules this version of GradTools does not have/);
    // 'O' on 4 credits is 10.00 under the current rules. It must not appear.
    expect(screen.queryByText('10.00')).toBeNull();
  });

  /* The fallback wording belongs to a record with NO pin, and only that. */
  it('does not claim it was read under the current rules', async () => {
    const { bundle } = createMemoryRepositories({ results: [pinnedToMissing()] });
    renderWith(<SemestersPage />, { repositories: bundle });

    await screen.findByText(/rules this version of GradTools does not have/);
    expect(screen.queryByText(/read under the current rules/)).toBeNull();
  });

  it('still says so for a record saved before rule versions were recorded', async () => {
    const { bundle } = createMemoryRepositories({
      results: [{ ...result(2, [['BMATS201', 4, 'O']]), ruleSetId: null }],
    });
    renderWith(<SemestersPage />, { repositories: bundle });

    expect(await screen.findByText(/read under the current rules/)).toBeTruthy();
  });
});
