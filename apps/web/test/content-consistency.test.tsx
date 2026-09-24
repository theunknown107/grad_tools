/**
 * One figure, one wording, on every screen that shows it.
 *
 * SYNTHETIC STUDENTS ONLY.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup } from '@testing-library/react';
import { screen, within } from '@testing-library/dom';
import { VTU_2022_RULE_SET_ID } from '@gradtools/academic-rules';
import { AcademicsPage } from '../src/features/academics/AcademicsPage.js';
import { ProfilePage } from '../src/features/profile/ProfilePage.js';
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

describe('Profile semester figure', () => {
  /*
   * The denominator is the degree's semester views (statistics.views), the
   * same count the dashboard and Semesters page use. buildSemesterViews always
   * yields the eight semesters, so this is the ordinary case: a record beyond
   * the eighth does not stretch the degree.
   */
  it('counts graded semesters against the degree the views describe', async () => {
    const { bundle } = createMemoryRepositories({
      semesters: [completed(1), completed(2)],
      results: [result(1), result(2)],
    });
    renderWith(<ProfilePage />, { repositories: bundle, route: '/profile' });

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
