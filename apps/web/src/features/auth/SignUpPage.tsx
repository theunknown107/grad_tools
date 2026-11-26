/**
 * Sign up — the NEW-user journey, separate from Sign in.
 *
 * Email/password (with an emailed-code confirmation under a code-based provider
 * like Clerk) or "Sign up with Google". Creating an account here continues
 * through the existing required onboarding (Terms, then profile) — a signed-in
 * user with no accepted Terms is routed there by the onboarding gate.
 *
 * HONEST on the Google flow: the provider runs ONE OAuth per provider and
 * transfers between sign-up and sign-in automatically, so a returning user who
 * taps "Sign up with Google" is simply signed in. The button states intent; it
 * does not force a brand-new account. See `signUpWithProvider`.
 */

import { Capacitor } from '@capacitor/core';
import { useState, type FormEvent } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { Button } from '../../components/ui/button.js';
import { Callout } from '../../components/ui/feedback.js';
import { Field, Input, PasswordInput } from '../../components/ui/field.js';
import { useAuth } from './AuthContext.js';
import { AuthFrame, BrowserWaitNote, EmailDivider, GoogleButton } from './AuthFrame.js';
import { markFirstRunDone } from '../../lib/first-run.js';

export function SignUpPage() {
  const { adapter, state } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [step, setStep] = useState<'form' | 'code'>('form');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [googleBusy, setGoogleBusy] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  if (state.status === 'signed_in') return <Navigate to="/account" replace />;

  if (adapter === null) {
    return (
      <AuthFrame title="Create an account" lead="GradTools works fully without one.">
        <Callout>
          Accounts are not available in this build. Everything you enter stays on this device.
        </Callout>
        <Button asChild variant="primary" className="mt-4 w-full">
          <Link to="/" onClick={markFirstRunDone}>
            Continue to GradTools
          </Link>
        </Button>
      </AuthFrame>
    );
  }

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setError(null);
    setNotice(null);
    // No app-imposed length rule: the field is `required` (never empty), and the
    // authentication provider enforces its own policy and returns a real error if
    // the password is not accepted. The app does not block or guess a minimum.
    setBusy(true);
    try {
      if (step === 'code') {
        setError((await adapter.verifyCode!(code.trim())).error);
      } else {
        const result = await adapter.signUpWithPassword(email, password);
        setError(result.error);
        if (result.error === null && result.needsConfirmation && adapter.verifyCode !== undefined) {
          setStep('code');
          setNotice(`We emailed a code to ${email}. Enter it to confirm your address.`);
        } else if (result.error === null && result.needsConfirmation) {
          setNotice('Check your email to confirm your address, then sign in.');
        }
      }
    } finally {
      setBusy(false);
    }
  };

  const withGoogle = async (): Promise<void> => {
    setGoogleBusy(true);
    setError(null);
    const { error: failure } = await adapter.signUpWithProvider('google');
    setError(failure);
    setWaiting(failure === null && Capacitor.isNativePlatform());
    setGoogleBusy(false);
  };

  return (
    <AuthFrame
      tab="sign-up"
      title="Create your GradTools account"
      lead="Keep your results, attendance and timetable safe and in sync on every device."
    >
      {step === 'form' && adapter.providerUnavailable === undefined && (
        <>
          <GoogleButton busy={googleBusy} onClick={() => void withGoogle()}>
            Sign up with Google
          </GoogleButton>
          {waiting && <BrowserWaitNote />}
          <EmailDivider />
        </>
      )}
      {step === 'form' && adapter.providerUnavailable !== undefined && (
        <p className="mb-5 text-[12px] text-ink-3">{adapter.providerUnavailable}</p>
      )}

      <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-4">
        {step === 'code' ? (
          <Field label="Code from your email">
            <Input
              inputMode="numeric"
              autoComplete="one-time-code"
              required
              pattern="[0-9]{6}"
              maxLength={6}
              value={code}
              onChange={(event) => setCode(event.target.value)}
            />
          </Field>
        ) : (
          <>
            <Field label="Email">
              <Input
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </Field>
            <Field label="Password">
              <PasswordInput
                autoComplete="new-password"
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </Field>
          </>
        )}
        {error !== null && (
          <Callout tone="warning" role="alert">
            {error}
          </Callout>
        )}
        {notice !== null && <Callout role="status">{notice}</Callout>}
        <Button type="submit" variant="primary" size="lg" loading={busy} className="w-full">
          {busy ? 'Working…' : step === 'code' ? 'Confirm code' : 'Create an account'}
        </Button>
        {step === 'code' && (
          <Button
            variant="ghost"
            className="w-full"
            onClick={() => {
              setStep('form');
              setCode('');
              setError(null);
              setNotice(null);
            }}
          >
            Start again
          </Button>
        )}
      </form>

      <div className="mt-5 border-t border-line pt-4 text-[13px] text-ink-2">
        <Link
          to="/"
          onClick={markFirstRunDone}
          className="font-medium text-accent-ink underline-offset-4 hover:underline"
        >
          Keep using GradTools without an account
        </Link>
        <span className="text-ink-3"> · nothing you enter is sent anywhere.</span>
      </div>
    </AuthFrame>
  );
}
