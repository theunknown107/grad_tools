/**
 * Full-screen frame for the auth gate (sign in, terms, onboarding, recovery).
 *
 * These screens stand ALONE — no sidebar, no top bar, no bottom bar. A visitor
 * who has not signed in sees only what they can act on: the sign-in itself,
 * never the app chrome behind a lock. It carries the providers the shell would
 * otherwise supply (tooltips, toasts) and the page background, and centres a
 * single column.
 */

import type { ReactNode } from 'react';
import { Toaster } from '../ui/feedback.js';
import { TooltipProvider } from '../ui/tooltip.js';

export function AuthLayout({ children }: { readonly children: ReactNode }) {
  return (
    <TooltipProvider>
      <div className="flex min-h-dvh items-start justify-center bg-canvas px-4 py-8 text-ink sm:items-center">
        <div className="w-full">{children}</div>
      </div>
      <Toaster />
    </TooltipProvider>
  );
}
