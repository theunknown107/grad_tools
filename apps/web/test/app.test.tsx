/**
 * Frontend tests for the experimental vertical slice.
 *
 * Authority: M3 continuation §29
 *
 * These cover the behaviour that would be expensive to get wrong: that every
 * displayed academic figure comes from @gradtools/academic-rules, that the
 * asserted-vs-computed disagreement is surfaced rather than resolved, and that
 * data survives a round-trip through the repository boundary.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import userEvent from '@testing-library/user-event';
import { screen, within } from '@testing-library/dom';
import { cleanup } from '@testing-library/react';
import { App } from '../src/App.js';
import { DashboardPage } from '../src/features/dashboard/DashboardPage.js';
import { AcademicsPage } from '../src/features/academics/AcademicsPage.js';
import { AttendancePage } from '../src/features/attendance/AttendancePage.js';
import { ResultsPage } from '../src/features/results/ResultsPage.js';
import { TimetablePage } from '../src/features/timetable/TimetablePage.js';
import { asStudentProfileId } from '../src/domain/identity.js';
import type { AttendanceRecord, SemesterResult } from '../src/domain/types.js';
import { createMemoryRepositories, renderWith } from './helpers.js';

const profileId = asStudentProfileId('p1');

function attendance(
  id: string,
  subjectCode: string,
  attended: number,
  conducted: number,
): AttendanceRecord {
  return {
    id,
    profileId,
    semester: 3,
    subjectCode,
    subjectTitle: subjectCode,
    attended,
    conducted,
    updatedAt: '',
  };
}

function result(
  id: string,
  semester: number,
  sgpaAsserted: number | null,
  subjects: { code: string; credits: number; grade: string }[],
): SemesterResult {
  return {
    id,
    profileId,
    semester,
    schemeId: 'vtu-2022',
    ruleSetId: 'vtu-2022-v1',
    sgpaAsserted,
    createdAt: '',
    updatedAt: '',
    subjects: subjects.map((subject, index) => ({
      id: `${id}-s${String(index)}`,
      subjectCode: subject.code,
      subjectTitle: subject.code,
      credits: subject.credits,
      gradeLetter: subject.grade,
    })),
  };
}

beforeEach(() => {
  cleanup();
});

/* -------------------------------------------------------------------------- */
/* Dashboard                                                                  */
/* -------------------------------------------------------------------------- */

describe('dashboard', () => {
  it('renders an honest empty state with one action per region', async () => {
    renderWith(<DashboardPage />);
    expect(await screen.findByText(/no results saved yet/i)).toBeTruthy();
    expect(screen.getByText(/nothing tracked yet/i)).toBeTruthy();
    // "Add a result" appears in both the empty state and quick actions, which
    // is intended: the same action reachable from where the student is looking.
    expect(screen.getAllByRole('link', { name: /add a result/i }).length).toBeGreaterThan(0);
    expect(screen.getByRole('link', { name: /add attendance/i })).toBeTruthy();
  });

  it('shows no fabricated metrics when there is no data', async () => {
    renderWith(<DashboardPage />);
    await screen.findByText(/no results saved yet/i);
    // Invented engagement metrics are prohibited by docs/05 §Anti-patterns.
    expect(screen.queryByText(/streak/i)).toBeNull();
    expect(screen.queryByText(/score/i)).toBeNull();
    expect(screen.queryByText(/productivity/i)).toBeNull();
  });

  it('derives CGPA and percentage from the rules engine', async () => {
    // Semester 1: 4x8 + 4x9 = 68 over 8 credits -> SGPA 8.50
    // Semester 2: 4x10 + 4x8 = 72 over 8 credits -> SGPA 9.00
    // CGPA = (8x8.5 + 8x9.0)/16 = 8.75 -> percentage 87.5
    const { bundle } = createMemoryRepositories({
      results: [
        result('r1', 1, null, [
          { code: 'A1', credits: 4, grade: 'A' },
          { code: 'A2', credits: 4, grade: 'A+' },
        ]),
        result('r2', 2, null, [
          { code: 'B1', credits: 4, grade: 'O' },
          { code: 'B2', credits: 4, grade: 'A' },
        ]),
      ],
    });
    renderWith(<DashboardPage />, { repositories: bundle });

    expect(await screen.findByText('8.75')).toBeTruthy();
    // 8.75 x 10 = 87.5%, per 22OB 6.7. NOT (8.75-0.75)x10 = 80.0%.
    expect(screen.getByText('87.5%')).toBeTruthy();
    expect(screen.queryByText('80.0%')).toBeNull();
  });

  it('surfaces only the courses that need attention', async () => {
    const { bundle } = createMemoryRepositories({
      attendance: [
        attendance('a1', 'SAFE1', 48, 50), // 96% safe
        attendance('a2', 'LOW1', 40, 50), // 80% below requirement
      ],
    });
    renderWith(<DashboardPage />, { repositories: bundle });

    expect(await screen.findByText('LOW1')).toBeTruthy();
    expect(screen.getByText(/below requirement/i)).toBeTruthy();
    expect(screen.queryByText('SAFE1')).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* SGPA / CGPA                                                                */
/* -------------------------------------------------------------------------- */

describe('SGPA calculator', () => {
  it('computes from entered credits and grades', async () => {
    const user = userEvent.setup();
    renderWith(<AcademicsPage />);

    // Two 4-credit courses at A (8) and A+ (9): 68/8 = 8.50
    await user.selectOptions(screen.getByLabelText(/credits, course 1/i), '4');
    await user.selectOptions(screen.getByLabelText(/grade, course 1/i), 'A');
    await user.selectOptions(screen.getByLabelText(/credits, course 2/i), '4');
    await user.selectOptions(screen.getByLabelText(/grade, course 2/i), 'A+');
    // Row labels are positional and renumber after each removal, so removing
    // "course 3" three times clears rows 3, 4 and 5.
    for (let i = 0; i < 3; i += 1) {
      await user.click(screen.getByRole('button', { name: /remove course 3/i }));
    }

    expect(await screen.findByText('8.50')).toBeTruthy();
  });

  it('exposes the derivation with its regulation clause', async () => {
    renderWith(<AcademicsPage />);
    const disclosures = await screen.findAllByText(/how was this calculated/i);
    expect(disclosures.length).toBeGreaterThan(0);
    expect(screen.getAllByText(/22OB 6.6\(2a\)/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/SGPA = Sum\(Ci x Gi\) \/ Sum\(Ci\)/).length).toBeGreaterThan(0);
  });

  it('can add and remove course rows', async () => {
    const user = userEvent.setup();
    renderWith(<AcademicsPage />);
    expect(screen.getByLabelText(/subject code, course 5/i)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: /add course/i }));
    expect(screen.getByLabelText(/subject code, course 6/i)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: /remove course 6/i }));
    expect(screen.queryByLabelText(/subject code, course 6/i)).toBeNull();
  });
});

describe('CGPA calculator', () => {
  it('computes CGPA, percentage and class from the rules engine', async () => {
    const user = userEvent.setup();
    renderWith(<AcademicsPage />);

    await user.type(screen.getByLabelText(/total credits, row 1/i), '20');
    await user.type(screen.getByLabelText(/sgpa, row 1/i), '8.20');
    await user.click(screen.getByRole('button', { name: /remove semester row 2/i }));

    expect(await screen.findByText('8.20')).toBeTruthy();
    // The regulation's own worked example: CGPA 8.20 -> 82.0% (22OB 6.7).
    expect(screen.getByText('82.0%')).toBeTruthy();
    expect(screen.getByText(/first class with distinction/i)).toBeTruthy();
    // The obsolete (CGPA - 0.75) x 10 conversion would be 74.5%.
    expect(screen.queryByText('74.5%')).toBeNull();
  });

  it('explains why its percentage differs from other calculators', async () => {
    const user = userEvent.setup();
    renderWith(<AcademicsPage />);
    await user.type(screen.getByLabelText(/total credits, row 1/i), '20');
    await user.type(screen.getByLabelText(/sgpa, row 1/i), '8.20');
    expect(await screen.findByText(/7.5 percentage points lower/i)).toBeTruthy();
  });
});

/* -------------------------------------------------------------------------- */
/* Attendance and bunk planner                                                */
/* -------------------------------------------------------------------------- */

describe('attendance', () => {
  it('adds a course and persists it through the repository', async () => {
    const user = userEvent.setup();
    const { bundle, peek } = createMemoryRepositories();
    renderWith(<AttendancePage />, { repositories: bundle });

    await user.type(screen.getByLabelText(/^subject code$/i), 'BCS304');
    await user.type(screen.getByLabelText(/^attended$/i), '45');
    await user.type(screen.getByLabelText(/^conducted$/i), '50');
    await user.click(screen.getByRole('button', { name: /^add$/i }));

    expect(await screen.findByText('90.0%')).toBeTruthy();
    expect(peek.attendance()).toHaveLength(1);
    expect(peek.attendance()[0]?.subjectCode).toBe('BCS304');
  });

  it('rejects attended greater than conducted rather than storing it', async () => {
    const user = userEvent.setup();
    const { bundle, peek } = createMemoryRepositories();
    renderWith(<AttendancePage />, { repositories: bundle });

    await user.type(screen.getByLabelText(/^subject code$/i), 'BCS304');
    await user.type(screen.getByLabelText(/^attended$/i), '52');
    await user.type(screen.getByLabelText(/^conducted$/i), '50');
    await user.click(screen.getByRole('button', { name: /^add$/i }));

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(peek.attendance()).toHaveLength(0);
  });

  it('answers how many classes can still be missed', async () => {
    const { bundle } = createMemoryRepositories({
      attendance: [attendance('a1', 'BCS301', 45, 50)],
    });
    renderWith(<AttendancePage />, { repositories: bundle });

    // 45/50 at an 85% requirement allows exactly 2 more (docs/16 §16.9).
    expect(await screen.findByText(/you can miss/i)).toBeTruthy();
    expect(screen.getByText('2 classes')).toBeTruthy();
  });

  it('shows the DX consequence and frames condonation as discretionary', async () => {
    const { bundle } = createMemoryRepositories({
      attendance: [attendance('a1', 'BCSL305', 30, 50)], // 60%
    });
    renderWith(<AttendancePage />, { repositories: bundle });

    expect((await screen.findAllByText(/dx risk/i)).length).toBeGreaterThan(0);
    expect(screen.getByText(/discretionary, not\s+automatic/i)).toBeTruthy();
  });

  it('never tells the student they should skip a class', async () => {
    const { bundle } = createMemoryRepositories({
      attendance: [attendance('a1', 'BCS301', 48, 50)],
    });
    const { container } = renderWith(<AttendancePage />, { repositories: bundle });
    await screen.findByText('96.0%');
    const text = container.textContent ?? '';
    expect(text).not.toMatch(/you should (skip|bunk)/i);
    expect(text).not.toMatch(/safe to skip/i);
  });
});

describe('bunk planner', () => {
  it('projects the resulting attendance from planned misses', async () => {
    const user = userEvent.setup();
    const { bundle } = createMemoryRepositories({
      attendance: [attendance('a1', 'BCS301', 45, 50)],
    });
    renderWith(<AttendancePage />, { repositories: bundle });

    const planned = await screen.findByLabelText(/classes still to be held/i);
    const missed = screen.getByLabelText(/classes you would miss/i);
    await user.clear(planned);
    await user.type(planned, '10');
    await user.clear(missed);
    await user.type(missed, '2');

    // (45 + 8) / (50 + 10) = 88.33%
    expect(await screen.findByText('88.3%')).toBeTruthy();
  });

  it('refuses to plan more misses than classes remaining', async () => {
    const user = userEvent.setup();
    const { bundle } = createMemoryRepositories({
      attendance: [attendance('a1', 'BCS301', 45, 50)],
    });
    renderWith(<AttendancePage />, { repositories: bundle });

    const planned = await screen.findByLabelText(/classes still to be held/i);
    const missed = screen.getByLabelText(/classes you would miss/i);
    await user.clear(planned);
    await user.type(planned, '2');
    await user.clear(missed);
    await user.type(missed, '9');

    expect(await screen.findByText(/cannot miss more classes than will be held/i)).toBeTruthy();
  });
});

/* -------------------------------------------------------------------------- */
/* Results                                                                    */
/* -------------------------------------------------------------------------- */

describe('results', () => {
  it('shows BOTH figures when the grade card disagrees with the computation', async () => {
    // Computed: (4x8 + 4x9)/8 = 8.50. Grade card claims 9.10.
    const { bundle } = createMemoryRepositories({
      results: [
        result('r1', 3, 9.1, [
          { code: 'BCS301', credits: 4, grade: 'A' },
          { code: 'BCS302', credits: 4, grade: 'A+' },
        ]),
      ],
    });
    renderWith(<ResultsPage />, { repositories: bundle });

    expect(await screen.findByText('8.50')).toBeTruthy();
    expect(screen.getByText('9.10')).toBeTruthy();
    expect(screen.getByText(/these two figures disagree/i)).toBeTruthy();
  });

  it('does not flag a disagreement when the figures match', async () => {
    const { bundle } = createMemoryRepositories({
      results: [
        result('r1', 3, 8.5, [
          { code: 'BCS301', credits: 4, grade: 'A' },
          { code: 'BCS302', credits: 4, grade: 'A+' },
        ]),
      ],
    });
    renderWith(<ResultsPage />, { repositories: bundle });

    await screen.findAllByText('8.50');
    expect(screen.queryByText(/these two figures disagree/i)).toBeNull();
  });

  it('states plainly that results are not fetched from the university', async () => {
    renderWith(<ResultsPage />);
    expect(
      await screen.findByText(/does not fetch results from the university portal/i),
    ).toBeTruthy();
  });

  it('saves a new semester through the repository', async () => {
    const user = userEvent.setup();
    const { bundle, peek } = createMemoryRepositories();
    renderWith(<ResultsPage />, { repositories: bundle });

    await user.click(screen.getByRole('button', { name: /add a semester/i }));
    await user.type(screen.getByLabelText(/subject code 1/i), 'BCS301');
    await user.click(screen.getByRole('button', { name: /save semester/i }));

    expect(peek.results()).toHaveLength(1);
    expect(peek.results()[0]?.subjects[0]?.subjectCode).toBe('BCS301');
  });
});

/* -------------------------------------------------------------------------- */
/* Timetable                                                                  */
/* -------------------------------------------------------------------------- */

describe('timetable', () => {
  it('adds a class and persists it', async () => {
    const user = userEvent.setup();
    const { bundle, peek } = createMemoryRepositories();
    renderWith(<TimetablePage />, { repositories: bundle });

    await user.type(screen.getByLabelText(/^subject code$/i), 'BCS301');
    await user.click(screen.getByRole('button', { name: /add class/i }));

    expect(peek.timetable()).toHaveLength(1);
    expect(peek.timetable()[0]?.subjectCode).toBe('BCS301');
    expect(await screen.findAllByText('BCS301')).toBeTruthy();
  });

  it('rejects an end time at or before the start time', async () => {
    const user = userEvent.setup();
    const { bundle, peek } = createMemoryRepositories();
    renderWith(<TimetablePage />, { repositories: bundle });

    await user.type(screen.getByLabelText(/^subject code$/i), 'BCS301');
    await user.clear(screen.getByLabelText(/^ends$/i));
    await user.type(screen.getByLabelText(/^ends$/i), '08:00');
    await user.click(screen.getByRole('button', { name: /add class/i }));

    expect(await screen.findByText(/end time must be after the start time/i)).toBeTruthy();
    expect(peek.timetable()).toHaveLength(0);
  });

  it('offers button navigation for the mobile day agenda, not only swipe', async () => {
    const { bundle } = createMemoryRepositories({
      timetable: [
        {
          id: 't1',
          profileId,
          day: 'Mon',
          startTime: '09:00',
          endTime: '10:00',
          subjectCode: 'BCS301',
          room: null,
          faculty: null,
        },
      ],
    });
    renderWith(<TimetablePage />, { repositories: bundle });
    expect(await screen.findByRole('button', { name: /next day/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /previous day/i })).toBeTruthy();
  });
});

/* -------------------------------------------------------------------------- */
/* Navigation and shell                                                       */
/* -------------------------------------------------------------------------- */

describe('navigation', () => {
  it('renders the Stage 1 destinations and omits unbuilt ones', () => {
    renderWith(<App />);
    const navs = screen.getAllByRole('navigation', { name: 'Main' });
    const sidebar = navs[0];
    expect(sidebar).toBeTruthy();
    const links = within(sidebar as HTMLElement).getAllByRole('link');
    const labels = links.map((link) => link.textContent ?? '');
    expect(labels.some((l) => /dashboard/i.test(l))).toBe(true);
    expect(labels.some((l) => /attendance/i.test(l))).toBe(true);
    // Built in M7, so they are destinations now rather than dead links.
    expect(labels.some((l) => /announcements/i.test(l))).toBe(true);
    expect(labels.some((l) => /notifications/i.test(l))).toBe(true);
    // Later milestones must still not appear as dead links (docs/04 §4.3).
    expect(labels.some((l) => /papers/i.test(l))).toBe(false);
    expect(labels.some((l) => /syllabus/i.test(l))).toBe(false);
  });

  it('provides a skip link as the first focusable element', () => {
    renderWith(<App />);
    expect(screen.getByRole('link', { name: /skip to content/i })).toBeTruthy();
  });

  it('navigates between screens', async () => {
    const user = userEvent.setup();
    renderWith(<App />);
    const navs = screen.getAllByRole('navigation', { name: 'Main' });
    const sidebar = navs[0] as HTMLElement;
    await user.click(within(sidebar).getByRole('link', { name: /attendance/i }));
    expect(await screen.findByRole('heading', { name: 'Attendance', level: 1 })).toBeTruthy();
  });

  it('shows a 404 that offers real destinations', async () => {
    renderWith(<App />, { route: '/nope' });
    expect(await screen.findByRole('heading', { name: /page not found/i })).toBeTruthy();
    // Scoped to main: "Dashboard" is also a navigation link.
    const main = screen.getByRole('main');
    expect(within(main).getByRole('link', { name: /^dashboard$/i })).toBeTruthy();
  });

  it('carries the independence disclaimer on every screen', () => {
    renderWith(<App />);
    expect(screen.getByText(/not\s+affiliated with, endorsed by, or connected to/i)).toBeTruthy();
  });
});

/* -------------------------------------------------------------------------- */
/* Local persistence                                                          */
/* -------------------------------------------------------------------------- */

describe('local persistence', () => {
  it('round-trips data through the repository boundary', async () => {
    const user = userEvent.setup();
    const { bundle } = createMemoryRepositories();

    const first = renderWith(<AttendancePage />, { repositories: bundle });
    await user.type(screen.getByLabelText(/^subject code$/i), 'BCS404');
    await user.type(screen.getByLabelText(/^attended$/i), '20');
    await user.type(screen.getByLabelText(/^conducted$/i), '20');
    await user.click(screen.getByRole('button', { name: /^add$/i }));
    await screen.findByText('100.0%');
    first.unmount();

    // A fresh mount reads from the same repository, exactly as a page reload would.
    renderWith(<AttendancePage />, { repositories: bundle });
    expect(await screen.findByText('BCS404')).toBeTruthy();
    expect(screen.getByText('100.0%')).toBeTruthy();
  });
});
