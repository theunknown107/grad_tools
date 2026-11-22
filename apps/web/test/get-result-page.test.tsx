/**
 * Get VTU Result — the archive of session cards, the session detail and the
 * status lists. The catalogue package is mocked with a small fixture.
 */

import { screen, within } from '@testing-library/dom';
import userEvent from '@testing-library/user-event';
import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { asStudentProfileId } from '../src/domain/identity.js';
import type { SemesterResult, StudentProfile } from '../src/domain/types.js';
import { createMemoryRepositories, renderWith } from './helpers.js';

const session = (
  id: string,
  resultType: 'Regular' | 'Revaluation',
  label: string,
  programme: 'UG' | 'PG' | null = null,
  anomaly: 'label-url-mismatch' | null = null,
) => ({
  id,
  url: `https://results.vtu.ac.in/${id}/index.php`,
  resultType,
  variant: label === 'Link' ? null : label,
  label,
  programme,
  note:
    anomaly === null ? null : 'ANOMALY: developer note. Year printed as a range; year left null.',
  anomaly,
});

const cards = [
  {
    title: 'May – June 2026 Exam',
    yearLabel: '2026',
    sections: [
      {
        resultType: 'Regular',
        sessions: [
          session('MJ26EXAM', 'Regular', 'Main Page'),
          session('MJ26CBCS', 'Regular', 'CBCS'),
        ],
      },
      { resultType: 'Revaluation', sessions: [session('MJ26RVCBCS', 'Revaluation', 'CBCS')] },
    ],
  },
  {
    title: 'Makeup Exam 2025 (UG / PG)',
    yearLabel: null,
    sections: [{ resultType: 'Regular', sessions: [session('MK25CBCS', 'Regular', 'CBCS', 'UG')] }],
  },
  {
    title: 'Ph.D. / M.S (Research) Nov / Dec 2024 Course Work',
    yearLabel: '2024',
    sections: [{ resultType: 'Regular', sessions: [session('PHD24', 'Regular', 'Link')] }],
  },
  {
    title: 'B.E Special Exam Dec 2024 / Jan 2025 Exam',
    yearLabel: null,
    sections: [
      {
        resultType: 'Regular',
        sessions: [session('SplJcbcs25', 'Regular', 'Non-CBCS', null, 'label-url-mismatch')],
      },
    ],
  },
];

vi.mock('@gradtools/vtu-catalogue', () => ({
  vtuResultCatalog: () => ({
    source: {
      name: 'VTU result archive page',
      url: 'https://results.vtu.ac.in/',
      pageUpdated: null,
      retrievedAt: '2026-09-20T10:00:00Z',
      method: 'manual',
    },
    cards,
  }),
  findVtuResultSession: () => null,
}));

const { GetResultPage } = await import('../src/features/vtu-results/GetResultPage.js');

const profileId = asStudentProfileId('p1');
const profile = (usn: string | null): StudentProfile => ({
  id: profileId,
  authUserId: null,
  displayName: null,
  usn,
  collegeName: null,
  programme: null,
  schemeId: 'vtu-2022',
  branch: null,
  currentSemester: 4,
  createdAt: '',
  updatedAt: '',
});

const semesterOne = {
  id: 'r1',
  profileId,
  semester: 1,
  schemeId: 'vtu-2022',
  ruleSetId: null,
  sgpaAsserted: null,
  subjects: [],
  createdAt: '2026-01-01',
  updatedAt: '2026-01-01',
  source: { sessionId: 'MJ26CBCS' },
} as unknown as SemesterResult;

function setup(usn: string | null = '1AB22CS001') {
  const repos = createMemoryRepositories({ profile: profile(usn), results: [semesterOne] });
  renderWith(<GetResultPage />, { repositories: repos.bundle, route: '/results/get' });
  return repos;
}

beforeEach(() => window.localStorage.clear());
afterEach(cleanup);

describe('Get VTU Result', () => {
  it('renders session cards in page order with sections and variant buttons from the data', () => {
    setup();
    expect(screen.getByRole('heading', { level: 1, name: 'Get VTU Result' })).toBeTruthy();
    const titles = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent);
    expect(titles).toEqual(cards.map((card) => card.title));

    const first = screen.getByRole('heading', { name: 'May – June 2026 Exam' }).closest('li')!;
    expect(within(first).getByText('Recent')).toBeTruthy();
    expect(within(first).getByText('2026')).toBeTruthy();
    expect(
      within(first)
        .getAllByRole('heading', { level: 4 })
        .map((h) => h.textContent),
    ).toEqual(['Regular', 'Revaluation']);
    expect(
      screen.getByRole('button', { name: 'May – June 2026 Exam, Revaluation, CBCS' }),
    ).toBeTruthy();

    const makeup = screen.getByRole('heading', { name: /Makeup Exam/ }).closest('li')!;
    expect(within(makeup).queryByRole('heading', { name: 'Revaluation' })).toBeNull();
    expect(
      screen.getByRole('button', {
        name: 'Ph.D. / M.S (Research) Nov / Dec 2024 Course Work, Regular, Link',
      }),
    ).toBeTruthy();
  });

  it('filter narrows the cards as the student types', async () => {
    const user = userEvent.setup();
    setup();
    await user.type(screen.getByRole('searchbox', { name: 'Filter sessions' }), 'makeup');
    expect(screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual([
      'Makeup Exam 2025 (UG / PG)',
    ]);
    await user.clear(screen.getByRole('searchbox', { name: 'Filter sessions' }));
    await user.type(screen.getByRole('searchbox', { name: 'Filter sessions' }), 'revaluation');
    expect(screen.getAllByRole('button', { name: /, Revaluation, / })).toHaveLength(1);
    expect(screen.queryByRole('button', { name: /, Regular, / })).toBeNull();
  });

  it('session detail shows the stored USN, a clean new-tab link and the import link', async () => {
    const user = userEvent.setup();
    const repos = setup();
    await user.click(screen.getByRole('button', { name: 'May – June 2026 Exam, Regular, CBCS' }));
    const dialog = await screen.findByRole('dialog', {
      name: 'May – June 2026 Exam — Regular (CBCS)',
    });
    expect(within(dialog).getByText('1AB22CS001')).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: 'Copy' })).toBeTruthy();
    expect(within(dialog).queryByRole('textbox')).toBeNull();
    expect(within(dialog).queryByText(/captcha/i, { selector: 'label' })).toBeNull();
    expect(within(dialog).getByText(/does not enter the CAPTCHA or fetch the result/)).toBeTruthy();

    const official = within(dialog).getByRole('link', { name: /Open official result page/ });
    expect(official.getAttribute('href')).toBe('https://results.vtu.ac.in/MJ26CBCS/index.php');
    expect(official.getAttribute('target')).toBe('_blank');
    expect(official.getAttribute('rel')).toBe('noopener noreferrer');
    expect(official.getAttribute('href')).not.toContain('1AB22CS001');
    expect(document.querySelector('iframe')).toBeNull();

    expect(
      within(dialog).getByRole('link', { name: 'Import saved result' }).getAttribute('href'),
    ).toBe('/import?session=MJ26CBCS');
    expect(repos.peek.results()).toHaveLength(1);
  });

  it('marks a session whose label disagrees with its link, and hides developer notes', async () => {
    const user = userEvent.setup();
    setup();
    const flagged = screen.getByRole('button', {
      name: 'B.E Special Exam Dec 2024 / Jan 2025 Exam, Regular, Non-CBCS, Check',
    });
    expect(within(flagged).getByText('Check')).toBeTruthy();
    /* Unflagged buttons carry no Check badge. */
    const clean = screen.getByRole('button', { name: 'May – June 2026 Exam, Regular, CBCS' });
    expect(within(clean).queryByText('Check')).toBeNull();

    await user.click(flagged);
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Check')).toBeTruthy();
    expect(within(dialog).getByText('Non-CBCS')).toBeTruthy();
    expect(
      within(dialog).getByText(
        "The source lists this link as Non-CBCS, but its address suggests CBCS. Check the scheme shown on VTU's page before importing.",
      ),
    ).toBeTruthy();
    expect(within(dialog).queryByText(/ANOMALY|year left null/)).toBeNull();
  });

  it('shows no caution on a session without an anomaly', async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByRole('button', { name: 'May – June 2026 Exam, Regular, CBCS' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).queryByText(/address suggests CBCS/)).toBeNull();
    expect(within(dialog).queryByText('Check')).toBeNull();
  });

  it('without a USN, points to the profile instead of asking for one', async () => {
    const user = userEvent.setup();
    setup(null);
    await user.click(
      screen.getByRole('button', { name: 'May – June 2026 Exam, Regular, Main Page' }),
    );
    const dialog = await screen.findByRole('dialog');
    expect(
      within(dialog)
        .getByRole('link', { name: 'Add your USN in your profile' })
        .getAttribute('href'),
    ).toBe('/account?section=academic');
    expect(within(dialog).queryByRole('textbox')).toBeNull();
    expect(within(dialog).getByRole('link', { name: /Open official result page/ })).toBeTruthy();
  });

  it('lists opened sessions as imported or not yet imported', async () => {
    window.localStorage.setItem(
      'gradtools.vtu-results.opened',
      JSON.stringify(['MJ26CBCS', 'MK25CBCS', 'GONE']),
    );
    setup();
    const list = screen.getByRole('heading', { name: 'Your result sessions' }).closest('section')!;
    expect(await within(list).findByText('Imported')).toBeTruthy();
    expect(within(list).getByText('Opened — not imported yet')).toBeTruthy();
  });

  it('offers an upload for earlier semesters with no result, and creates none', async () => {
    const repos = setup();
    const upload = await screen.findByRole('link', { name: 'Upload Semester 2 Result' });
    expect(upload.getAttribute('href')).toBe('/import?semester=2');
    expect(screen.getByText('Semester 3 has no result in GradTools yet.')).toBeTruthy();
    expect(screen.queryByText(/Semester 1 has no result/)).toBeNull();
    expect(screen.queryByText(/Semester 4 has no result/)).toBeNull();
    expect(screen.queryByText(/failed|unavailable/i)).toBeNull();
    expect(repos.peek.results()).toHaveLength(1);
    expect(screen.getByText(/Links go to results\.vtu\.ac\.in/)).toBeTruthy();
  });
});
