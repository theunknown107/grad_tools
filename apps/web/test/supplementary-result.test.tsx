/**
 * A legacy second result for one semester, as the result screens read it.
 *
 * One result per semester is the invariant, but storage written before the
 * chosen-semester check can hold two. Which one the screens read is a DATA
 * tie-break — the earliest created — and not an academic rule about which
 * attempt counts, which the repository does not establish (research C10).
 */

import { afterEach, describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/dom';
import { cleanup } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import { VTU_2022_RULE_SET_ID } from '@gradtools/academic-rules';
import { ResultDetailPage } from '../src/features/results/ResultDetailPage.js';
import { ResultsPage } from '../src/features/results/ResultsPage.js';
import { asStudentProfileId } from '../src/domain/identity.js';
import { normalizeResultSubject } from '../src/domain/results.js';
import type { SemesterResult } from '../src/domain/types.js';
import { createMemoryRepositories, renderWith } from './helpers.js';

afterEach(cleanup);

function saved(
  id: string,
  createdAt: string,
  rows: readonly [string, number, string][],
): SemesterResult {
  return {
    id,
    profileId: asStudentProfileId('p1'),
    semester: 4,
    schemeId: 'vtu-2022',
    ruleSetId: VTU_2022_RULE_SET_ID,
    sgpaAsserted: null,
    subjects: rows.map(([code, credits, gradeLetter]) =>
      normalizeResultSubject({
        id: `${id}-${code}`,
        subjectCode: code,
        subjectTitle: code,
        credits,
        gradeLetter,
        hasSee: true,
      }),
    ),
    createdAt,
    updatedAt: createdAt,
  };
}

const FULL = saved('full', '2026-07-24T00:00:00Z', [
  ['BCS401', 4, 'O'],
  ['BCS402', 4, 'F'],
  ['BCS403', 3, 'A'],
]);
/* Later, updated more recently, and held FIRST in storage. */
const RESIT = {
  ...saved('resit', '2027-02-12T00:00:00Z', [['BCS402', 4, 'B']]),
  updatedAt: '2027-03-01T00:00:00Z',
};

function renderAt(route: string) {
  const { bundle, peek } = createMemoryRepositories({ results: [RESIT, FULL] });
  renderWith(
    <Routes>
      <Route path="/results" element={<ResultsPage />} />
      <Route path="/results/:semester" element={<ResultDetailPage />} />
    </Routes>,
    { repositories: bundle, route },
  );
  return peek;
}

describe('a semester with a legacy second record', () => {
  it('opens the earliest-created result, with every subject', async () => {
    const peek = renderAt('/results/4');

    const list = await screen.findByRole('list', { name: /courses in semester/i });
    const rows = within(list).getAllByRole('listitem');
    expect(rows).toHaveLength(3);
    expect(list.querySelector('[aria-controls="course-full-BCS401"]')).not.toBeNull();
    expect(list.querySelector('[aria-controls="course-full-BCS403"]')).not.toBeNull();
    // Neither record is hidden from storage or removed.
    expect(peek.results().map((result) => result.id)).toEqual(['resit', 'full']);
  });

  it('lists both records, each reading the semester figures of the original', async () => {
    /*
     * What a student sees today, pinned rather than redesigned: two
     * "Semester 4" entries that both open the original and carry its SGPA.
     */
    renderAt('/results');

    const links = await screen.findAllByRole('link', { name: /semester 4.*open the full record/i });
    expect(links).toHaveLength(2);
    for (const link of links) expect(link.getAttribute('href')).toBe('/results/4');
  });
});
