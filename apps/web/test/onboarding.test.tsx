/**
 * First-run setup: guided, skippable, local-first (UF-01, DEC-001, DEC-002).
 *
 * Nothing is required; the confirm step records a confirmation only when the
 * student presses Confirm; the passout year is a suggestion they can change;
 * the entry route changes no academic figure (OQ-055); and there is no date of
 * birth anywhere (DEC-008).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { cloudProfileSchema, profileInputSchema } from '@gradtools/shared-types';
import { asStudentProfileId } from '../src/domain/identity.js';
import type { SemesterResult, StudentProfile } from '../src/domain/types.js';
import { choose, createMemoryRepositories, renderWith } from './helpers.js';

const ready = <T,>(data: T) => ({
  state: { status: 'ready' as const, data },
  retry: () => undefined,
});

vi.mock('../src/hooks/useReference.js', async (original) => ({
  ...(await original<object>()),
  useColleges: () => ({
    items: [
      {
        id: 'c1',
        catalogueId: 'vtu-synthetic-1xx',
        name: 'Synthetic Institute of Technology',
        code: '1XX',
        region: null,
        reviewed: true,
      },
      {
        id: 'vtu-mysuru-nocode-synthetic-college',
        catalogueId: 'vtu-mysuru-nocode-synthetic-college',
        name: 'SYNTHETIC COLLEGE OF ENGINEERING',
        code: null,
        region: 'MYSURU',
        reviewed: false,
      },
    ],
    loading: false,
    error: null,
  }),
  useBranches: () => ready([{ id: 'cse', name: 'Computer Science and Engineering' }]),
  useSchemes: () => ready([]),
}));

const { SetupPage } = await import('../src/features/onboarding/SetupPage.js');
const { CollegeField } = await import('../src/features/onboarding/AcademicFields.js');

const RESULT = {
  id: 'r1',
  profileId: asStudentProfileId('p0'),
  semester: 3,
  schemeId: 'vtu-2022',
  ruleSetId: null,
  sgpaAsserted: 8.1,
  subjects: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
} as SemesterResult;

function renderSetup(seed: { profile?: StudentProfile | null; results?: SemesterResult[] } = {}) {
  const memory = createMemoryRepositories(seed);
  renderWith(
    <Routes>
      <Route path="/setup" element={<SetupPage />} />
      <Route path="/" element={<p>Home</p>} />
    </Routes>,
    { repositories: memory.bundle, route: '/setup' },
  );
  return memory;
}

const fetchSpy = vi.fn();
beforeEach(() => {
  fetchSpy.mockReset();
  vi.stubGlobal('fetch', fetchSpy);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const click = (name: RegExp) => userEvent.click(screen.getByRole('button', { name }));

describe('first-run setup', () => {
  it('walks a new student through every step and stores what they stated', async () => {
    const memory = renderSetup({ results: [RESULT] });
    const user = userEvent.setup();

    await user.type(await screen.findByLabelText(/your name/i), '  Asha Rao  ');
    await click(/^next$/i);
    expect(screen.getByText(/this is how gradtools will show your name/i)).toBeTruthy();
    expect(screen.getByText('Asha Rao')).toBeTruthy();
    await click(/^confirm$/i);

    await user.type(screen.getByLabelText(/^usn/i), ' 1xx22cs001 ');
    await choose(/college/i, 'Synthetic Institute of Technology (verified)');
    await choose(/branch/i, 'Computer Science and Engineering');
    await user.type(screen.getByLabelText(/admission year/i), '2022');
    await user.click(screen.getByRole('radio', { name: 'PUC' }));
    /* The suggestion is prefilled, labelled, and not final. */
    const passout = screen.getByLabelText<HTMLInputElement>(/expected passout year/i);
    expect(passout.value).toBe('2026');
    expect(screen.getByText(/suggested from your admission year/i)).toBeTruthy();
    await user.clear(passout);
    await user.type(passout, '2027');
    /* A route changed after the student typed their year changes nothing. */
    await user.click(screen.getByRole('radio', { name: 'Diploma' }));
    expect(passout.value).toBe('2027');

    await click(/^save$/i);
    await screen.findByText('Home');

    const saved = memory.peek.profile();
    expect(saved).toMatchObject({
      displayName: 'Asha Rao',
      usn: '1XX22CS001',
      collegeName: 'Synthetic Institute of Technology',
      branch: 'Computer Science and Engineering',
      admissionYear: 2022,
      expectedPassoutYear: 2027,
      entryRoute: 'diploma',
      currentSemester: null,
    });
    expect(typeof saved?.identityConfirmedAt).toBe('string');
    /* Entry route and identity touch no academic record. */
    expect(memory.peek.results()).toEqual([RESULT]);
    /* Local-first: setup made no network request. */
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('can be skipped end to end, and then writes nothing', async () => {
    const memory = renderSetup();
    await screen.findByLabelText(/your name/i);
    await click(/^skip$/i);
    await click(/^skip$/i);
    await screen.findByText('Home');
    expect(memory.peek.profile()).toBeNull();
  });

  it('records a confirmation only when the student presses Confirm', async () => {
    const memory = renderSetup();
    await userEvent.type(await screen.findByLabelText(/your name/i), 'Asha');
    await click(/^next$/i);
    await click(/^skip$/i); // the confirm step
    await click(/^skip$/i); // the academic step
    await screen.findByText('Home');
    expect(memory.peek.profile()).toMatchObject({
      displayName: 'Asha',
      identityConfirmedAt: null,
      usn: null,
    });
  });

  it('asks for no date of birth anywhere', async () => {
    renderSetup();
    const seen: string[] = [];
    await screen.findByLabelText(/your name/i);
    seen.push(document.body.textContent ?? '');
    await click(/^skip$/i);
    await waitFor(() => expect(screen.getByLabelText(/admission year/i)).toBeTruthy());
    seen.push(document.body.innerHTML);
    for (const page of seen) expect(page).not.toMatch(/\bdob\b|date of birth|birth/i);
  });
});

describe('the profile contract carries no date of birth (DEC-008)', () => {
  it('has no dob key in the local type or either schema', () => {
    type NoDob = 'dob' extends keyof StudentProfile ? false : true;
    const noDob: NoDob = true;
    expect(noDob).toBe(true);
    for (const keys of [
      Object.keys(cloudProfileSchema.shape),
      Object.keys(profileInputSchema.shape),
    ]) {
      expect(keys.filter((key) => /dob|birth/i.test(key))).toEqual([]);
    }
  });

  it('bounds the stated years and keeps passout on or after admission', () => {
    const base = { schemeId: 'vtu-2022' };
    expect(
      profileInputSchema.safeParse({
        ...base,
        admissionYear: 2022,
        expectedPassoutYear: 2026,
        entryRoute: 'puc',
      }).success,
    ).toBe(true);
    expect(profileInputSchema.safeParse({ ...base, admissionYear: 1999 }).success).toBe(false);
    expect(profileInputSchema.safeParse({ ...base, expectedPassoutYear: 2101 }).success).toBe(
      false,
    );
    expect(profileInputSchema.safeParse({ ...base, admissionYear: 2022.5 }).success).toBe(false);
    expect(profileInputSchema.safeParse({ ...base, entryRoute: 'lateral' }).success).toBe(false);
    expect(
      profileInputSchema.safeParse({ ...base, admissionYear: 2024, expectedPassoutYear: 2023 })
        .success,
    ).toBe(false);
  });
});

describe('college review state', () => {
  function renderCollege() {
    const changes: string[] = [];
    function Harness() {
      const [value, setValue] = useState('');
      return (
        <CollegeField
          value={value}
          onChange={(next) => {
            changes.push(next);
            setValue(next);
          }}
        />
      );
    }
    render(<Harness />);
    return changes;
  }
  const NOT_CHECKED = /not yet checked by gradtools/i;

  it('does not present an unreviewed college as verified', async () => {
    const changes = renderCollege();
    expect(screen.getByText(NOT_CHECKED)).toBeTruthy();
    await choose(/college/i, 'SYNTHETIC COLLEGE OF ENGINEERING');
    expect(changes).toEqual(['SYNTHETIC COLLEGE OF ENGINEERING']);
    expect(screen.getByRole('combobox', { name: /college/i }).textContent).not.toMatch(/verified/i);
    expect(screen.getByText(NOT_CHECKED)).toBeTruthy();
  });

  it('lets a published college be chosen, shows it verified, and stores only its name', async () => {
    const changes = renderCollege();
    await choose(/college/i, 'Synthetic Institute of Technology (verified)');
    expect(changes).toEqual(['Synthetic Institute of Technology']);
    expect(screen.getByRole('combobox', { name: /college/i }).textContent).toMatch(/\(verified\)/);
    expect(screen.getByText(/verified by gradtools/i)).toBeTruthy();
    expect(screen.queryByText(NOT_CHECKED)).toBeNull();
  });
});
