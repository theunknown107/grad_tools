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

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { normalizeResultSubject } from '../src/domain/results.js';
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
    subjects: subjects.map((subject, index) =>
      normalizeResultSubject({
        id: `${id}-s${String(index)}`,
        subjectCode: subject.code,
        subjectTitle: subject.code,
        credits: subject.credits,
        gradeLetter: subject.grade,
      }),
    ),
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
    /*
     * A sentence and one link, not a bordered card with a paragraph and a
     * large button (M9.3 §19).
     */
    expect(await screen.findByText(/no results yet/i)).toBeTruthy();
    expect(screen.getByText(/nothing scheduled today/i)).toBeTruthy();
    expect(screen.getAllByRole('link', { name: /add a result/i }).length).toBeGreaterThan(0);
    expect(screen.getByRole('link', { name: /add your timetable/i })).toBeTruthy();
  });

  it('shows no fabricated metrics when there is no data', async () => {
    renderWith(<DashboardPage />);
    await screen.findByText(/no results yet/i);
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

    /*
     * The attention section carries the short course and NOT the safe one — a
     * section that lists everything is not an attention section (M9.3 §14).
     * The subject name falls back to the code when no subject record exists.
     */
    expect(await screen.findByText('LOW1')).toBeTruthy();
    expect(screen.getByText(/40 of 50 classes|40\/50 classes/)).toBeTruthy();
    expect(screen.getByText('80.0%')).toBeTruthy();
    expect(screen.queryByText('SAFE1')).toBeNull();
  });

  /*
   * The next class is marked, and ONLY the next one (M9.4 §16). An accent on
   * three rows is a palette, not a pointer, and a highlight that survives past
   * the end of the day is a lie about where the student is supposed to be.
   */
  describe("today's next class", () => {
    const monday = (id: string, startTime: string, endTime: string, subjectCode: string) => ({
      id,
      profileId,
      day: 'Mon' as const,
      startTime,
      endTime,
      subjectCode,
      room: null,
      faculty: null,
    });

    const schedule = [
      monday('t1', '09:00', '10:00', 'EARLY'),
      monday('t2', '11:00', '12:00', 'NEXTUP'),
      monday('t3', '14:00', '16:00', 'LATER'),
    ];

    afterEach(() => {
      vi.useRealTimers();
    });

    /**
     * A Monday, so the day has classes in it at all.
     *
     * `shouldAdvanceTime` matters: the clock has to be controllable AND still
     * tick, because Testing Library's async queries wait on real timers. A
     * frozen clock makes every `findBy*` in the test hang until it times out.
     */
    const atMondayTime = (time: string) => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      vi.setSystemTime(new Date(`2026-09-07T${time}:00`));
    };

    it('marks exactly one class, the first that has not finished', async () => {
      atMondayTime('10:30');
      const { bundle } = createMemoryRepositories({ timetable: schedule });
      renderWith(<DashboardPage />, { repositories: bundle });

      const marks = await screen.findAllByText('Next');
      expect(marks).toHaveLength(1);
      // The 11:00 class, not the 09:00 one that is already over.
      expect(marks[0]?.closest('li')?.textContent).toContain('NEXTUP');
    });

    it('marks the class in progress rather than skipping to the one after it', async () => {
      atMondayTime('11:30');
      const { bundle } = createMemoryRepositories({ timetable: schedule });
      renderWith(<DashboardPage />, { repositories: bundle });

      const marks = await screen.findAllByText('Next');
      expect(marks[0]?.closest('li')?.textContent).toContain('NEXTUP');
    });

    it('marks nothing once the day is over', async () => {
      atMondayTime('21:00');
      const { bundle } = createMemoryRepositories({ timetable: schedule });
      renderWith(<DashboardPage />, { repositories: bundle });

      // The classes are still listed; none of them is still ahead.
      expect(await screen.findByText('LATER')).toBeTruthy();
      expect(screen.queryByText('Next')).toBeNull();
    });
  });
});

/* -------------------------------------------------------------------------- */
/* SGPA / CGPA                                                                */
/* -------------------------------------------------------------------------- */

/*
 * M9.6F put the student's OWN figures first on the SGPA/CGPA page and moved the
 * blank calculators to a second tab — the page is named after two figures and
 * used to make you re-type everything to see one. These tests open the
 * calculator tab; their assertions are unchanged.
 */
async function openCalculator(): Promise<void> {
  await userEvent.click(await screen.findByRole('tab', { name: /calculator/i }));
}

describe('SGPA calculator', () => {
  it('computes from entered credits and grades', async () => {
    const user = userEvent.setup();
    renderWith(<AcademicsPage />);
    await openCalculator();

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
    await openCalculator();
    const disclosures = await screen.findAllByText(/how was this calculated/i);
    expect(disclosures.length).toBeGreaterThan(0);
    expect(screen.getAllByText(/22OB 6.6\(2a\)/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/SGPA = Sum\(Ci x Gi\) \/ Sum\(Ci\)/).length).toBeGreaterThan(0);
  });

  it('can add and remove course rows', async () => {
    const user = userEvent.setup();
    renderWith(<AcademicsPage />);
    await openCalculator();
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
    await openCalculator();

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
    await openCalculator();
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

    /*
     * M9.6F added an OVERALL standing figure above the subject rows, so a
     * single-subject fixture now shows the same percentage twice — once
     * pooled, once per subject. `findAllByText` keeps the assertion (the
     * figure is rendered) without asserting it appears exactly once, which
     * was never the point.
     */
    expect((await screen.findAllByText('90.0%')).length).toBeGreaterThan(0);
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

    // 45/50 at an 85% requirement allows exactly 2 more (docs/16 §16.9). The
    // answer is on the row itself now, not inside a sub-panel (M9.3 §13).
    const meta = await screen.findByText(/can miss 2 classes/i);
    // The row carries the ratio and the answer together, so both are read in
    // one glance rather than found in two places.
    expect(meta.textContent).toMatch(/45 of 50 classes/);
    expect(screen.getAllByText('90.0%').length).toBeGreaterThan(0);
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
    await screen.findAllByText('96.0%');
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
  /*
   * SUBJECT COUNT IS DATA, NOT LAYOUT.
   *
   * Real VTU semesters do not carry a fixed load: a first semester runs to
   * eight subjects and a fourth to nine, and a curriculum with a different
   * elective pattern will differ again. Nothing in the app assumes a count —
   * every result renders from `result.subjects` — and these two cases exist so
   * that a future layout cannot quietly introduce one by padding to a grid.
   */
  it.each([
    { count: 8, semester: 1 },
    { count: 9, semester: 4 },
  ])('renders all $count subjects of a $count-subject semester', async ({ count, semester }) => {
    const subjects = Array.from({ length: count }, (_, index) => ({
      code: `BXX${String(semester)}0${String(index)}`,
      credits: 3,
      grade: 'A',
    }));
    const { bundle } = createMemoryRepositories({
      results: [result('r1', semester, null, subjects)],
    });
    const user = userEvent.setup();
    renderWith(<ResultsPage />, { repositories: bundle });

    /*
     * M9.6E split this page into Overview and Semesters tabs, so the per
     * subject rows now live behind the second tab. The ASSERTIONS below are
     * unchanged — every subject renders, and no padding row is invented — the
     * test just navigates the way a person does to reach them.
     */
    await user.click(await screen.findByRole('tab', { name: /semesters/i }));

    await screen.findAllByText(subjects[0]?.code as string);
    for (const subject of subjects) {
      // The code appears in both the wide table and the narrow row list; only
      // one is visible at a time, but jsdom renders both.
      expect(screen.getAllByText(new RegExp(subject.code)).length).toBeGreaterThan(0);
    }
    // No padding rows invented to fill a layout.
    expect(screen.queryByText(`BXX${String(semester)}0${String(count)}`)).toBeNull();
  });

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
    const user = userEvent.setup();
    renderWith(<ResultsPage />, { repositories: bundle });

    await user.click(await screen.findByRole('tab', { name: /semesters/i }));

    // The computed figure now also appears in the Overview ledger, so both
    // views can show it; what matters is that BOTH figures are present.
    expect((await screen.findAllByText('8.50')).length).toBeGreaterThan(0);
    expect(screen.getByText('9.10')).toBeTruthy();
    /*
     * BOTH figures are still shown and the disagreement is still flagged; the
     * flag is now one line per semester with the reason stated once on the page
     * (M9.3 §24).
     */
    expect(screen.getByText(/these disagree/i)).toBeTruthy();
    expect(screen.getByText(/shows both rather than picking one/i)).toBeTruthy();
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
    expect(screen.queryByText(/these disagree/i)).toBeNull();
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
    /*
     * M9.6F made Today the primary view and moved the week — including the
     * mobile day agenda — behind a tab. The assertion is unchanged: the
     * agenda must offer BUTTON navigation, not swipe only.
     */
    await userEvent.click(await screen.findByRole('tab', { name: /week/i }));
    expect(await screen.findByRole('button', { name: /next day/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /previous day/i })).toBeTruthy();
  });
});

/* -------------------------------------------------------------------------- */
/* Navigation and shell                                                       */
/* -------------------------------------------------------------------------- */

describe('navigation', () => {
  /*
   * M9.5 replaced the sidebar with a horizontal bar in two tiers, so this reads
   * the whole shell rather than one <nav>. The property under test has not
   * changed: every built destination is reachable from the shell, and nothing
   * unbuilt appears as a dead link (docs/04 §4.3).
   */
  it('reaches every built destination and omits unbuilt ones', async () => {
    const user = userEvent.setup();
    renderWith(<App />);

    const shellLabels = () =>
      screen
        .getAllByRole('navigation')
        .flatMap((nav) => within(nav).queryAllByRole('link'))
        .map((link) => link.textContent ?? '');

    /*
     * EVERY destination, with no navigation first. The two-tier shell showed
     * one area's destinations at a time and this test had to open Academics to
     * see the rest; the sidebar lists them all, so the assertion got stronger
     * rather than weaker — nothing is behind a click any more.
     */
    expect(shellLabels().some((l) => /dashboard/i.test(l))).toBe(true);
    expect(shellLabels().some((l) => /announcements/i.test(l))).toBe(true);
    expect(shellLabels().some((l) => /notifications/i.test(l))).toBe(true);
    expect(shellLabels().some((l) => /attendance/i.test(l))).toBe(true);
    /*
     * Adding a document replaced question papers here. Handing GradTools a
     * result card, a calendar or a timetable is how information gets in;
     * question papers are not part of the product and no longer occupy a
     * navigation slot (M10A.9 §2, §6).
     */
    expect(shellLabels().some((l) => /add document/i.test(l))).toBe(true);
    expect(shellLabels().some((l) => /question papers/i.test(l))).toBe(false);
    expect(shellLabels().some((l) => /my degree/i.test(l))).toBe(true);

    // Later milestones must still not appear as dead links anywhere.
    expect(shellLabels().some((l) => /syllabus/i.test(l))).toBe(false);
  });

  it('marks the open area and the current destination', () => {
    renderWith(<App />);
    /*
     * ONE TIER NOW. The reference rebuild replaced the area row plus its
     * destination row with a single sidebar list, so there is no longer an
     * "open area" to mark — asserting one would be asserting a tier the
     * product does not have. What still has to be true, and is what this test
     * was really for, is that the destination you are on says so.
     */
    const current = screen
      .getAllByRole('navigation')
      .flatMap((nav) => within(nav).queryAllByRole('link'))
      .filter((link) => link.getAttribute('aria-current') !== null);
    const labels = current.map((link) => link.textContent ?? '');
    expect(labels.length).toBeGreaterThan(0);
    expect(labels.some((l) => /dashboard|home/i.test(l))).toBe(true);
    // And no marker for an area, because areas are no longer a tier.
    expect(labels.some((l) => /^overview$|^academics$|^account$/i.test(l.trim()))).toBe(false);
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
    await screen.findAllByText('100.0%');
    first.unmount();

    // A fresh mount reads from the same repository, exactly as a page reload would.
    renderWith(<AttendancePage />, { repositories: bundle });
    expect(await screen.findByText('BCS404')).toBeTruthy();
    expect(screen.getAllByText('100.0%').length).toBeGreaterThan(0);
  });
});
