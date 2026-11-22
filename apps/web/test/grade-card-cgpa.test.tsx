/**
 * CGPA from grade-card SGPAs (docs/53).
 *
 * Expected values are worked by hand from 22OB 6.6(2)(b) — Σ(Ci × Si) / Σ Ci —
 * and checked here as literals, not recomputed with the production formula.
 * The regulation's own worked example (Annexure-I (a)) has F grades, which is
 * exactly where the clause and the example disagree (6.07 vs 7.15): it appears
 * below as the case the reconstruction must REFUSE.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  firstSemesterOf,
  gradeCardCgpa,
  gradeCardIssues,
  type GradeCardDraft,
} from '../src/domain/grade-card-cgpa.js';
import { asStudentProfileId } from '../src/domain/identity.js';
import type { GradeCardSemester } from '../src/domain/types.js';
import { AcademicsPage } from '../src/features/academics/AcademicsPage.js';
import { createMemoryRepositories, emptyProfile, renderWith } from './helpers.js';

const card = (
  semester: number,
  sgpa: number,
  registered: number,
  earned = registered,
): GradeCardSemester => ({
  id: `g${String(semester)}`,
  profileId: asStudentProfileId('local'),
  semester,
  sgpa,
  creditsRegistered: registered,
  creditsEarned: earned,
  updatedAt: '2026-10-23T00:00:00Z',
});

const REGULAR = { firstSemester: 1, schemeId: 'vtu-2022' };
const LATERAL = { firstSemester: 3, schemeId: 'vtu-2022' };

afterEach(cleanup);

describe('gradeCardCgpa', () => {
  it('weights each semester by its credits: (8.00×20 + 7.50×22) / 42 = 7.738… → 7.74', () => {
    const got = gradeCardCgpa([card(1, 8, 20), card(2, 7.5, 22)], REGULAR);
    expect(got).toMatchObject({
      status: 'available',
      cgpa: 7.74,
      semesters: [1, 2],
      totalCredits: 42,
    });
    expect(got.status === 'available' && got.percentage).toBe(77.4); // 22OB 6.7: CGPA × 10
  });

  it('is not an average of SGPAs: (9.00×20 + 6.00×25 + 8.50×21) / 66 = 7.704… → 7.70', () => {
    // The plain mean of 9.00, 6.00, 8.50 would be 7.83.
    expect(
      gradeCardCgpa([card(1, 9, 20), card(2, 6, 25), card(3, 8.5, 21)], REGULAR),
    ).toMatchObject({
      status: 'available',
      cgpa: 7.7,
    });
  });

  it('refuses the regulation’s own worked example, where F credits change the denominator', () => {
    // Annexure-I (a): sem I SGPA 5.05 on 20 credits (14 not under F), sem II 6.85 on 26 (25).
    const got = gradeCardCgpa([card(1, 5.05, 20, 14), card(2, 6.85, 26, 25)], REGULAR);
    expect(got.status).toBe('unavailable');
    const text = got.status === 'unavailable' ? got.reasons.join(' ') : '';
    expect(text).toMatch(/Semesters 1, 2 have credits not earned/);
    expect(text).toMatch(/6\.6\(2\)\(b\)/);
    expect(text).toMatch(/Annexure-I/);
    expect(text).toMatch(/does not choose/);
  });

  it('starts a diploma-entry student in semester 3 (22OB 2.2)', () => {
    expect(gradeCardCgpa([card(3, 8, 22), card(4, 9, 22)], LATERAL)).toMatchObject({
      status: 'available',
      cgpa: 8.5,
      semesters: [3, 4],
    });
    const early = gradeCardCgpa([card(2, 8, 20), card(3, 8, 22), card(4, 9, 22)], LATERAL);
    expect(early.status === 'unavailable' && early.reasons.join(' ')).toMatch(
      /before your first semester/,
    );
  });

  it('needs every semester from the first, and at least two (22OB 2.16)', () => {
    const gap = gradeCardCgpa([card(1, 8, 20), card(3, 8, 20)], REGULAR);
    expect(gap.status === 'unavailable' && gap.reasons.join(' ')).toMatch(/Add semester 2/);
    const one = gradeCardCgpa([card(1, 8, 20)], REGULAR);
    expect(one.status === 'unavailable' && one.reasons.join(' ')).toMatch(/second semester/);
    const none = gradeCardCgpa([], REGULAR);
    expect(none.status).toBe('unavailable');
  });

  it('refuses a semester entered twice, and a scheme it is not set up for', () => {
    const twice = gradeCardCgpa(
      [card(1, 8, 20), { ...card(1, 7, 20), id: 'other' }, card(2, 8, 20)],
      REGULAR,
    );
    expect(twice.status === 'unavailable' && twice.reasons.join(' ')).toMatch(/entered twice/);
    const other = gradeCardCgpa([card(1, 8, 20), card(2, 8, 20)], {
      firstSemester: 1,
      schemeId: 'vtu-2021',
    });
    expect(other.status === 'unavailable' && other.reasons.join(' ')).toMatch(/2022 scheme only/);
  });
});

describe('gradeCardIssues', () => {
  const ok: GradeCardDraft = {
    semester: '3',
    sgpa: '8.43',
    creditsRegistered: '22',
    creditsEarned: '22',
  };
  const fields = (draft: Partial<GradeCardDraft>, first = 1) =>
    gradeCardIssues({ ...ok, ...draft }, first).map((issue) => issue.field);

  it('accepts what a grade card prints', () => {
    expect(fields({})).toEqual([]);
  });

  it.each<[string, Partial<GradeCardDraft>, string]>([
    ['a non-numeric SGPA', { sgpa: 'abc' }, 'sgpa'],
    ['an SGPA above 10', { sgpa: '10.5' }, 'sgpa'],
    ['an SGPA with three decimals', { sgpa: '8.437' }, 'sgpa'],
    ['missing registered credits', { creditsRegistered: '' }, 'creditsRegistered'],
    ['fractional credits', { creditsRegistered: '21.5' }, 'creditsRegistered'],
    ['more credits earned than registered', { creditsEarned: '23' }, 'creditsEarned'],
    ['an invalid semester', { semester: '9' }, 'semester'],
  ])('flags %s', (_label, draft, field) => {
    expect(fields(draft)).toContain(field);
  });

  it('flags a semester before a diploma student’s first', () => {
    expect(fields({ semester: '2' }, 3)).toEqual(['semester']);
    expect(firstSemesterOf({ entryRoute: 'diploma' })).toBe(3);
    expect(firstSemesterOf({ entryRoute: 'puc' })).toBe(1);
    expect(firstSemesterOf(null)).toBe(1);
  });
});

describe('the grade-card CGPA calculator', () => {
  async function open(seed: Parameters<typeof createMemoryRepositories>[0]) {
    const repos = createMemoryRepositories(seed);
    renderWith(<AcademicsPage />, {
      repositories: repos.bundle,
      route: '/academics?tab=calculator',
    });
    await userEvent.click(await screen.findByRole('radio', { name: 'CGPA' }));
    return repos;
  }

  it('saves typed semesters and shows a labelled reconstruction', async () => {
    const repos = await open({ profile: emptyProfile() });
    const fill = async (semester: string, sgpa: string, credits: string) => {
      await userEvent.click(screen.getByRole('combobox', { name: 'Semester' }));
      await userEvent.click(
        await screen.findByRole('option', { name: new RegExp(`^Semester ${semester}$`) }),
      );
      for (const [label, value] of [
        ['SGPA on the card', sgpa],
        ['Credits registered', credits],
        ['Credits earned', credits],
      ] as const) {
        const input = screen.getByLabelText(label);
        await userEvent.clear(input);
        await userEvent.type(input, value);
      }
      await userEvent.click(screen.getByRole('button', { name: /save semester/i }));
    };
    await fill('1', '8.00', '20');
    await fill('2', '7.50', '22');

    expect(await screen.findByText('7.74')).toBeTruthy();
    expect(screen.getByText(/reconstructed from your grade cards/i)).toBeTruthy();
    expect(repos.peek.gradeCards()).toHaveLength(2);
  });

  it('explains what is missing instead of guessing, and keeps the entry', async () => {
    const repos = await open({ profile: emptyProfile() });
    await userEvent.type(screen.getByLabelText('SGPA on the card'), '8.437');
    await userEvent.click(screen.getByRole('button', { name: /save semester/i }));
    expect(await screen.findByText(/two decimals/)).toBeTruthy();
    expect((screen.getByLabelText('SGPA on the card') as HTMLInputElement).value).toBe('8.437');
    expect(repos.peek.gradeCards()).toHaveLength(0);
  });

  it('shows the regulation conflict for a semester with F credits', async () => {
    await open({
      profile: emptyProfile(),
      gradeCards: [card(1, 5.05, 20, 14), card(2, 6.85, 26, 25)],
    });
    const block = (await screen.findByText(/reconstructed from your grade cards/i)).closest(
      'div[aria-live]',
    ) as HTMLElement;
    expect(within(block).getByText(/does not choose between them/)).toBeTruthy();
    expect(within(block).queryByText('7.15')).toBeNull();
    expect(within(block).queryByText('6.07')).toBeNull();
  });
});
