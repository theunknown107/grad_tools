/**
 * Clerk at the root: `ClerkProvider` with the PUBLISHABLE key, and the adapter
 * that lets AuthContext speak Clerk without any screen knowing it.
 * Mounted only when `VITE_CLERK_PUBLISHABLE_KEY` is set (main.tsx).
 */

import { useMemo, type ReactNode } from 'react';
import { AuthenticateWithRedirectCallback, ClerkProvider, useClerk } from '@clerk/react';
import { useNavigate } from 'react-router-dom';
import { createClerkAdapter } from '../../repositories/cloud/clerk.js';
import { AuthProvider } from './AuthContext.js';

function Bridge({ children }: { readonly children: ReactNode }) {
  const clerk = useClerk();
  const adapter = useMemo(() => createClerkAdapter(clerk), [clerk]);
  return <AuthProvider adapter={adapter}>{children}</AuthProvider>;
}

export function ClerkAuth({
  publishableKey,
  children,
}: {
  readonly publishableKey: string;
  readonly children: ReactNode;
}) {
  const navigate = useNavigate();
  return (
    <ClerkProvider
      publishableKey={publishableKey}
      routerPush={(to) => navigate(to)}
      routerReplace={(to) => navigate(to, { replace: true })}
      afterSignOutUrl="/"
    >
      <Bridge>{children}</Bridge>
    </ClerkProvider>
  );
}

/** `/sso-callback`: Clerk finishes the Google redirect here, then sends the student to /account. */
export function SsoCallbackPage() {
  return (
    <AuthenticateWithRedirectCallback
      signInFallbackRedirectUrl="/account"
      signUpFallbackRedirectUrl="/account"
    />
  );
}
