/**
 * OQ-055: the programme list stays (it matches VTU notices), but the academic
 * figures follow B.E./B.Tech 2022 only. Picking another programme must not
 * read as if the calculations followed it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup } from '@testing-library/react';
import { screen } from '@testing-library/dom';
import { AcademicSettings } from '../src/features/profile/ProfilePage.js';
import { SemestersPage } from '../src/features/semesters/SemestersPage.js';
import type { StudentProfile } from '../src/domain/types.js';
import { asStudentProfileId } from '../src/domain/identity.js';
import { createMemoryRepositories, renderWith } from './helpers.js';

const SCOPE = /academic figures follow the VTU 2022 scheme \(22OB\) for B\.E\.\/B\.Tech/i;

function profileWith(programme: string): StudentProfile {
  return {
    id: asStudentProfileId('p-1'),
    authUserId: null,
    displayName: null,
    usn: null,
    collegeName: null,
    schemeId: 'vtu-2022',
    programme,
    branch: null,
    currentSemester: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

function renderWithProgramme(programme: string): void {
  const repositories = createMemoryRepositories({ profile: profileWith(programme) }).bundle;
  renderWith(<AcademicSettings />, { repositories });
}

describe('programme scope', () => {
  beforeEach(() => {
    // Reference data is not what is under test; the server is simply unreachable.
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new Error('offline'))),
    );
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('says the figures follow B.E./B.Tech when another programme is chosen', async () => {
    renderWithProgramme('MCA');
    const field = await screen.findByRole('combobox', { name: /^programme$/i, description: SCOPE });
    expect(field.textContent).toContain('MCA');
  });

  it('adds nothing for B.E.', async () => {
    renderWithProgramme('B.E.');
    const field = await screen.findByRole('combobox', {
      name: /^programme$/i,
      description: 'Helps GradTools show you VTU notices meant for your programme.',
    });
    expect(field.textContent).toContain('B.E.');
    expect(screen.queryByText(SCOPE)).toBeNull();
  });

  it('asks My Degree for the missing BRANCH, where the branch is set', async () => {
    /*
     * The prompt appears when the branch is missing. It used to read "Set your
     * programme" and point at /profile, where neither field is edited.
     */
    const repositories = createMemoryRepositories({ profile: profileWith('B.E.') }).bundle;
    renderWith(<SemestersPage />, { repositories });
    const link = await screen.findByRole('link', { name: 'Set your branch' });
    expect(link.getAttribute('href')).toBe('/account?section=academic');
    expect(screen.getByText('Branch not set')).toBeTruthy();
    expect(screen.queryByText('Set your programme')).toBeNull();
  });
});
