/**
 * Authentication Diagnostics: "Restored across reload" claims only what the
 * evidence supports. A deliberate sign-out is never a lost session; a missing
 * client session is never proof of server-side revocation.
 */

import { describe, expect, it } from 'vitest';
import { restoreVerdict } from '../src/features/diagnostics/diagnostics.js';

const at = '2026-10-16T16:00:00.000Z';
const verdict = (
  previous: string | null,
  current: string,
  signedOutAt: string | null = null,
  signOutPending = false,
) => restoreVerdict({ previous, current, signedOutAt, signOutPending });

describe('restoreVerdict', () => {
  it('a deliberate sign-out is reported as one, never as a lost session', () => {
    const v = verdict('signed_in', 'signed_out', at);
    expect(v.value).toMatch(/Signed out on purpose/);
    expect(v.value).not.toMatch(/lost|NO/);
    expect(v.tone).toBe('neutral');
  });

  it('says the server side is still pending — and does not claim it was revoked', () => {
    const v = verdict('signed_in', 'signed_out', at, true);
    expect(v.value).toMatch(/server-side sign-out pending/);
    expect(v.tone).toBe('warning');
    expect(verdict('signed_in', 'signed_out', at).value).not.toMatch(/revoked|server/i);
  });

  it('a session that came back is a confirmed restore', () => {
    expect(verdict('signed_in', 'signed_in')).toEqual({
      value: 'Yes — session restored',
      tone: 'success',
    });
  });

  it('a session that vanished with no sign-out here is the one real failure', () => {
    const v = verdict('signed_in', 'signed_out');
    expect(v.value).toMatch(/^NO — the session was not restored/);
    expect(v.tone).toBe('danger');
  });

  it('an unverifiable session (expired / unreachable) is unknown, not lost', () => {
    const v = verdict('signed_in', 'expired');
    expect(v.value).toMatch(/^Unknown/);
    expect(v.tone).toBe('warning');
  });

  it('still loading, a first run, and plain signed-out are stated as such', () => {
    expect(verdict('signed_in', 'restoring').value).toBe('Checking…');
    expect(verdict(null, 'signed_out').value).toMatch(/^Unknown — no earlier load/);
    expect(verdict('signed_out', 'signed_out').value).toMatch(/^n\/a — no session/);
    expect(verdict('signed_out', 'signed_in').value).toMatch(/^n\/a — signed in during/);
  });
});
