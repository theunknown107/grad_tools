/**
 * A student on another VTU scheme can say so — and GradTools calculates
 * nothing it has no verified rules for.
 *
 * Existing profiles are all `vtu-2022`; they must read, save and sync exactly
 * as before. SYNTHETIC CONTENT ONLY.
 */

import { cleanup, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { profileInputSchema } from '@gradtools/shared-types';
import { asStudentProfileId } from '../src/domain/identity.js';
import type { StudentProfile } from '../src/domain/types.js';
import { AcademicsPage } from '../src/features/academics/AcademicsPage.js';
import { AttendancePage } from '../src/features/attendance/AttendancePage.js';
import { SchemeField } from '../src/features/onboarding/AcademicFields.js';
import { withChanges } from '../src/features/profile/ProfilePage.js';
import { schemeRulesFor } from '../src/hooks/useSchemeRules.js';
import { createMemoryRepositories, renderWith } from './helpers.js';

afterEach(cleanup);

function profile(schemeId: string): StudentProfile {
  return {
    id: asStudentProfileId('p1'),
    authUserId: null,
    displayName: 'Test Student',
    usn: null,
    collegeName: null,
    programme: null,
    schemeId,
    branch: null,
    currentSemester: 5,
    createdAt: '',
    updatedAt: '',
  };
}

describe('the recorded scheme', () => {
  it('survives every other edit, instead of being reset to 2022', () => {
    const saved = withChanges(profile('vtu-2018'), { branch: 'Civil engineering' });
    expect(saved.schemeId).toBe('vtu-2018');
    expect(withChanges(profile('vtu-2018'), { schemeId: 'vtu-2021' }).schemeId).toBe('vtu-2021');
  });

  it('starts at 2022 only for a profile that has none, as every profile always did', () => {
    expect(withChanges(null, {}).schemeId).toBe('vtu-2022');
    expect(withChanges(profile('vtu-2022'), {}).schemeId).toBe('vtu-2022');
  });

  it('syncs as stated: the cloud accepts any recorded scheme id', () => {
    for (const schemeId of ['vtu-2022', 'vtu-2018', 'vtu-2010']) {
      expect(profileInputSchema.safeParse({ schemeId }).success).toBe(true);
    }
  });
});

describe('which rules apply', () => {
  it('reads an empty scheme as 2022, with the built-in rules', () => {
    for (const id of [null, undefined, '']) {
      expect(schemeRulesFor(id)).toMatchObject({ schemeId: 'vtu-2022', builtIn: true });
    }
  });

  it('holds no rules for a recognised scheme, and never borrows 2022’s', () => {
    const rules = schemeRulesFor('vtu-2018');
    expect(rules.ruleSet).toBeUndefined();
    expect(rules.builtIn).toBe(false);
    expect(rules.scheme?.regulationCode).toBe('18OB');
  });
});

describe('the scheme field', () => {
  it('offers every VTU scheme, and says which are recorded only', () => {
    renderWith(<SchemeField value="vtu-2018" onChange={() => undefined} />);
    expect(screen.getByText(/no verified rules for this scheme yet/i)).toBeTruthy();
    const trigger = screen.getByRole('combobox', { name: /scheme/i });
    expect(trigger.textContent).toMatch(/2018 scheme \(CBCS\) \(18OB\) — recorded only/);
  });
});

describe('calculating screens on a scheme without rules', () => {
  it('Attendance says so, and judges nothing by the 2022 thresholds', async () => {
    const { bundle } = createMemoryRepositories({ profile: profile('vtu-2018') });
    renderWith(<AttendancePage />, { repositories: bundle });
    const notice = await screen.findByText(/not calculated for the 2018 scheme/i);
    expect(notice).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/85%/);
    expect(
      within(document.body).getByRole('link', { name: /2018 scheme \(CBCS\) regulation/i }),
    ).toBeTruthy();
  });

  it('SGPA & CGPA says so, instead of calculating under 2022 rules', async () => {
    const { bundle } = createMemoryRepositories({ profile: profile('vtu-2021') });
    renderWith(<AcademicsPage />, { repositories: bundle });
    expect(await screen.findByText(/not calculated for the 2021 scheme/i)).toBeTruthy();
  });

  it('a 2022 profile is unchanged', async () => {
    const { bundle } = createMemoryRepositories({ profile: profile('vtu-2022') });
    renderWith(<AttendancePage />, { repositories: bundle });
    expect(await screen.findByRole('heading', { name: 'Attendance' })).toBeTruthy();
    expect(screen.queryByText(/not calculated for/i)).toBeNull();
  });
});
