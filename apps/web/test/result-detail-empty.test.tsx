/**
 * A saved semester with no courses has nothing checked, so the detail page
 * must not call it a pass — zero backlogs out of zero courses is not PASS.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/dom';
import { cleanup } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import { VTU_2022_RULE_SET_ID } from '@gradtools/academic-rules';
import { ResultDetailPage } from '../src/features/results/ResultDetailPage.js';
import { asStudentProfileId } from '../src/domain/identity.js';
import { normalizeResultSubject } from '../src/domain/results.js';
import type { SemesterResult } from '../src/domain/types.js';
import { createMemoryRepositories, renderWith } from './helpers.js';

afterEach(cleanup);

/* [code, internal /50, external /50] — marks, so pass or backlog is worked out. */
function saved(rows: readonly [string, number, number][]): SemesterResult {
  return {
    id: 'r1',
    profileId: asStudentProfileId('p1'),
    semester: 3,
    schemeId: 'vtu-2022',
    ruleSetId: VTU_2022_RULE_SET_ID,
    sgpaAsserted: null,
    subjects: rows.map(([code, internal, external]) =>
      normalizeResultSubject({
        id: `r1-${code}`,
        subjectCode: code,
        subjectTitle: code,
        credits: 4,
        internal,
        external,
        hasSee: true,
      }),
    ),
    createdAt: '2026-07-24T00:00:00Z',
    updatedAt: '2026-07-24T00:00:00Z',
  };
}

async function resultFigure(result: SemesterResult) {
  const { bundle } = createMemoryRepositories({ results: [result] });
  renderWith(
    <Routes>
      <Route path="/results/:semester" element={<ResultDetailPage />} />
    </Routes>,
    { repositories: bundle, route: '/results/3' },
  );
  return screen.findByRole('group', { name: 'Result' });
}

describe('the Result figure on a semester record', () => {
  it('says Unavailable, not PASS, when the semester has no courses', async () => {
    const figure = await resultFigure(saved([]));
    expect(figure.getAttribute('data-state')).toBe('unavailable');
    expect(within(figure).getByText('Unavailable')).toBeTruthy();
    expect(within(figure).getByText(/no courses are recorded/i)).toBeTruthy();
    expect(screen.queryByText('PASS')).toBeNull();
    expect(screen.queryByText('Completed')).toBeNull();
  });

  it('still says PASS when every course passed', async () => {
    const figure = await resultFigure(
      saved([
        ['BCS301', 45, 40],
        ['BCS302', 40, 35],
      ]),
    );
    expect(within(figure).getByText('PASS')).toBeTruthy();
    expect(screen.getByText('Completed')).toBeTruthy();
  });

  it('still counts a backlog', async () => {
    const figure = await resultFigure(
      saved([
        ['BCS301', 45, 40],
        ['BCS302', 40, 5],
      ]),
    );
    expect(within(figure).getByText('1 backlog')).toBeTruthy();
    expect(screen.queryByText('PASS')).toBeNull();
  });
});
