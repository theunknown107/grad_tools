/**
 * A signed-in student, for tests that need one and nothing else about auth.
 *
 * Authority: Phase 7B.3.1 §118
 *
 * THE REAL PROVIDER, WITH A FAKE ADAPTER. `AuthProvider` already accepts an
 * injected adapter precisely so a test need not reach a real identity service,
 * so this supplies one rather than mocking the module. The state machine under
 * test is therefore the shipped one, and a change to how the provider derives
 * `signed_in` from an identity would be caught here rather than mocked past.
 *
 * The token is a fixed string. Nothing verifies it: these tests are about what
 * the browser does once it HAS one, and the API's own suite covers what the
 * server does with it.
 */

import type { ReactNode } from 'react';
import { AuthProvider } from '../../src/features/auth/AuthContext.js';
import type { AuthAdapter } from '../../src/repositories/cloud/supabase.js';
import type { Identity } from '../../src/domain/auth.js';

const IDENTITY: Identity = {
  userId: 'aaaaaaaa-4444-4000-8000-00000000000a',
  email: 'synthetic@example.test',
  provider: 'email',
};

function build(signedIn: boolean): AuthAdapter {
  return {
    current: async () => (signedIn ? IDENTITY : null),
    accessToken: async () => (signedIn ? 'synthetic-token' : null),
    signInWithPassword: async () => ({ error: null }),
    signUpWithPassword: async () => ({ error: null, needsConfirmation: false }),
    signInWithProvider: async () => ({ error: null }),
    sendRecovery: async () => ({ error: null }),
    signOut: async () => {
      /* Nothing to sign out of. */
    },
    onChange: () => () => {
      /* No cross-tab events in a test. */
    },
  };
}

/*
 * STABLE IDENTITIES, ONE PER STATE.
 *
 * `AuthProvider` memoises on the adapter it is given, so handing it a freshly
 * built object on every render invalidates that memo every render — the effects
 * re-run, the callbacks change, and a test that waits for state to settle waits
 * forever. Two constants, built once.
 */
const SIGNED_IN = build(true);
const SIGNED_OUT = build(false);

export function fakeAdapter(signedIn: boolean): AuthAdapter {
  return signedIn ? SIGNED_IN : SIGNED_OUT;
}

export function AuthContextValueProvider({
  signedIn,
  children,
}: {
  readonly signedIn: boolean;
  readonly children: ReactNode;
}) {
  return <AuthProvider adapter={fakeAdapter(signedIn)}>{children}</AuthProvider>;
}
