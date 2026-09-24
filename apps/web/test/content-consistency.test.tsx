/**
 * One figure, one wording, on every screen that shows it.
 *
 * SYNTHETIC STUDENTS ONLY.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup } from '@testing-library/react';
import { screen, waitFor, within } from '@testing-library/dom';
import { VTU_2022_RULE_SET_ID } from '@gradtools/academic-rules';
import { AcademicsPage } from '../src/features/academics/AcademicsPage.js';
import { DashboardPage } from '../src/features/dashboard/DashboardPage.js';
import { ProfilePage } from '../src/features/profile/ProfilePage.js';
import { SemestersPage } from '../src/features/semesters/SemestersPage.js';
import { normalizeResultSubject } from '../src/domain/results.js';
import { asStudentProfileId } from '../src/domain/identity.js';
import type { SemesterRecord, SemesterResult } from '../src/domain/types.js';
import { createMemoryRepositories, renderWith } from './helpers.js';

const profileId = asStudentProfileId('11111111-1111-1111-1111-111111111111');

function result(semester: number): SemesterResult {
  return {
    id: `r${String(semester)}`,
    profileId,
    semester,
    schemeId: 'vtu-2022',
    ruleSetId: VTU_2022_RULE_SET_ID,
    sgpaAsserted: null,
    subjects: [
      normalizeResultSubject({
        id: `${String(semester)}-0`,
        subjectCode: `BCS${String(semester)}01`,
        subjectTitle: `BCS${String(semester)}01`,
        credits: 4,
        gradeLetter: 'A',
      }),
    ],
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  };
}

function completed(number: number): SemesterRecord {
  return {
    id: `s${String(number)}`,
    profileId,
    number,
    status: 'completed',
    startedOn: null,
    completedOn: null,
    updatedAt: '',
  };
}

afterEach(cleanup);

describe('semesters graded, on every screen that counts them', () => {
  /*
   * THREE SEMESTERS COMPLETED, TWO GRADED. The figure is semesters GRADED, so
   * every screen reads 2 — a screen that counted completed semesters, or had a
   * rule of its own, would read 3 and disagree with the others.
   *
   * THE DENOMINATOR IS NOT VARIED, BECAUSE IT CANNOT BE. The degree is modelled
   * as exactly the eight SEMESTER_NUMBERS (ED-71): buildSemesterViews yields
   * those eight whatever is stored, and a result for a ninth semester adds no
   * view (academics.test.ts). A test that made the total anything but 8 would
   * have to invent a state the app cannot reach. What this pins instead is that
   * the three screens state the same numerator over the same total.
   */
  it('reads the same graded count, over the same total, on all three screens', async () => {
    const seed = {
      semesters: [completed(1), completed(2), completed(3)],
      results: [result(1), result(2)],
    };

    renderWith(<DashboardPage />, { repositories: createMemoryRepositories(seed).bundle });
    await waitFor(() => {
      const bar = screen.getByRole('progressbar', { name: 'Semesters graded' });
      expect(bar.getAttribute('aria-valuetext')).toBe('2 of 8');
    });
    cleanup();

    renderWith(<SemestersPage />, { repositories: createMemoryRepositories(seed).bundle });
    await waitFor(() => {
      const bar = screen.getByRole('progressbar', { name: 'Semesters graded' });
      expect(bar.getAttribute('aria-valuetext')).toBe('2 of 8');
    });
    cleanup();

    renderWith(<ProfilePage />, {
      repositories: createMemoryRepositories(seed).bundle,
      route: '/profile',
    });
    const group = await screen.findByRole('group', { name: 'Semesters' });
    expect(await within(group).findByText('2/8')).toBeTruthy();
  });
});

describe('Academics figures', () => {
  /*
   * A result exists but no semester grades (an unusable letter), so the page
   * shows its figures with no latest SGPA. Credits and backlogs always carry a
   * number once any result exists; they must not fall back to a dash either.
   */
  it('says an unavailable figure is unavailable instead of showing a dash', async () => {
    const ungraded = result(1);
    const { bundle } = createMemoryRepositories({
      semesters: [completed(1)],
      results: [
        {
          ...ungraded,
          subjects: ungraded.subjects.map((subject) => ({ ...subject, gradeLetter: 'Q' })),
        },
      ],
    });
    renderWith(<AcademicsPage />, { repositories: bundle });

    const latest = await screen.findByRole('group', { name: 'Latest SGPA' });
    expect(within(latest).getByText('Unavailable')).toBeTruthy();
    for (const name of ['Latest SGPA', 'Credits', 'Backlogs']) {
      expect(screen.getByRole('group', { name }).textContent).not.toContain('—');
    }
  });
});
