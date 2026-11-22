/**
 * First run on a new device: Terms, then Sign in / Sign up (Google or email),
 * then the app. Asked once per device (`lib/first-run`).
 *
 * It still never LOCKS a student out, which is what the earlier no-op version
 * protected against: the sign-in screen always offers "Keep using GradTools
 * without an account", a session that is already signed in finishes the step,
 * and unreadable storage skips the gate entirely. Syncing still requires a
 * session and server-recorded Terms at the cloud boundary (`useSync`).
 */

import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { firstRunStep, markFirstRunDone } from '../../lib/first-run.js';
import { useAuth } from '../auth/AuthContext.js';

export function OnboardingGate({ children }: { readonly children: ReactNode }) {
  const { state } = useAuth();
  const step = firstRunStep();
  if (step === 'terms') return <Navigate to="/terms" replace />;
  if (step === 'sign-in') {
    if (state.status !== 'signed_in') return <Navigate to="/sign-in" replace />;
    markFirstRunDone();
  }
  return <>{children}</>;
}
