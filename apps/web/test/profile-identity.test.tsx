/**
 * Who the profile says you are.
 *
 * ---------------------------------------------------------------------------
 * TWO SEPARATE FACTS, AND A DECORATION THAT WAS NEITHER
 * ---------------------------------------------------------------------------
 *
 * The page opened with a coloured cover strip and an avatar hung over it — a
 * social-profile motif with nothing behind it. It occupied the first quarter
 * of the screen and told a student nothing, while the address their account is
 * actually keyed to appeared nowhere on the page at all.
 *
 * The two identities stay separate and neither is invented:
 *
 *   displayName   what the student typed. Absent means "Name not set".
 *   email         the verified address on the session, shown verbatim.
 *
 * THE LOCAL PART OF AN ADDRESS IS NOT A NAME. Deriving "Test Student" — or
 * "a.student", or anything else — from `a.student@example.test` is the product
 * asserting a person's name from a string that was never one. The last test
 * is the one that would catch it coming back.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen } from '@testing-library/react';
import type { AuthState } from '../src/domain/auth.js';
import { asStudentProfileId } from '../src/domain/identity.js';
import type { StudentProfile } from '../src/domain/types.js';
import { createMemoryRepositories, renderWith } from './helpers.js';

/* The page reads the session through this hook and nothing else. */
const authState = vi.hoisted(() => ({ current: { status: 'signed_out' } as AuthState }));

vi.mock('../src/features/auth/AuthContext.js', () => ({
  useAuth: () => ({
    state: authState.current,
    adapter: null,
    signOut: async () => undefined,
    refresh: async () => undefined,
  }),
}));

const { ProfilePage } = await import('../src/features/profile/ProfilePage.js');

const EMAIL = 'a.student@example.test';

function signedIn(email: string | null): void {
  authState.current = {
    status: 'signed_in',
    identity: { userId: 'u-1', email, provider: 'email' },
  };
}

function profile(over: Partial<StudentProfile> = {}): StudentProfile {
  return {
    id: asStudentProfileId('p1'),
    displayName: null,
    usn: '1AB22CS001',
    collegeName: null,
    branch: null,
    programme: null,
    schemeId: 'vtu-2022',
    currentSemester: 4,
    updatedAt: '',
    ...over,
  } as StudentProfile;
}

function render(seeded: StudentProfile | null) {
  return renderWith(<ProfilePage />, {
    repositories: createMemoryRepositories({ profile: seeded }).bundle,
    route: '/profile',
  });
}

/* `globals: false`, so testing-library's auto-cleanup is not installed. */
afterEach(cleanup);

describe('the profile header', () => {
  it('has no decorative cover banner left on it', async () => {
    authState.current = { status: 'signed_out' };
    const { container } = render(profile());
    await screen.findAllByText('1AB22CS001');

    /*
     * The gradient strip and the negative margin that pulled the avatar over
     * it. Asserted on the class because that is what it was — a coloured
     * rectangle with `aria-hidden`, invisible to every other kind of query.
     */
    expect(container.querySelector('[class*="bg-linear-to-r"]')).toBeNull();
    expect(container.querySelector('[class*="-mt-9"]')).toBeNull();
  });

  it('shows the verified address when there is an account', async () => {
    signedIn(EMAIL);
    render(profile());
    expect((await screen.findAllByText(EMAIL)).length).toBeGreaterThan(0);
  });

  it('shows no address when nobody is signed in', async () => {
    authState.current = { status: 'signed_out' };
    render(profile());
    await screen.findAllByText('1AB22CS001');
    expect(screen.queryAllByText(EMAIL)).toEqual([]);
  });

  it('shows no address when the session carries none', async () => {
    /* Apple's private relay, and any provider that returns no address. */
    signedIn(null);
    render(profile());
    await screen.findAllByText('1AB22CS001');
    expect(screen.queryAllByText(/@/)).toEqual([]);
  });

  it('never makes a name out of the address', async () => {
    signedIn(EMAIL);
    render(profile({ displayName: null }));

    /*
     * No name was recorded, so the page says so. It does not say "J Kadalgi",
     * and the avatar's initials come from the USN rather than from the two
     * letters at the front of an email address.
     */
    const heading = await screen.findByRole('heading', { name: /name/i });
    expect(heading.textContent).toBe('Name not set');

    /*
     * The address is on the page — that is the point of it — but it is never
     * the heading, never the initials, and never taken apart to make either.
     */
    expect((await screen.findAllByText(EMAIL)).length).toBeGreaterThan(0);
    expect(screen.queryAllByText(/^J\.?\s*K/)).toEqual([]);
  });

  it('shows the name the student typed, unchanged', async () => {
    signedIn(EMAIL);
    render(profile({ displayName: 'Test Student K' }));
    expect((await screen.findAllByText('Test Student K')).length).toBeGreaterThan(0);
  });
});
