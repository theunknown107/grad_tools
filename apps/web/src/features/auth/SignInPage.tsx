/**
 * Sign in — email/password or Google through the configured adapter.
 * Signing in uploads nothing by itself; First sync asks what to do next.
 *
 * With a code-based provider (Clerk) two extra steps appear on this card:
 * `code` (confirm a new account or a new device with the emailed code) and
 * `reset` (the emailed recovery code plus a new password).
 */

import { Capacitor } from '@capacitor/core';
import { useState, type FormEvent } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { Button } from '../../components/ui/button.js';
import { Callout } from '../../components/ui/feedback.js';
import { Field, Input, PasswordInput } from '../../components/ui/field.js';
import { PreLoginReport } from '../support/PreLoginReport.js';
import { useAuth } from './AuthContext.js';
import { AuthUnreachable } from './AuthUnreachable.js';
import { AuthFrame, BrowserWaitNote, EmailDivider, GoogleButton } from './AuthFrame.js';
import { markFirstRunDone } from '../../lib/first-run.js';

type Mode = 'sign_in' | 'recover';
type Step = 'form' | 'code' | 'reset';

export function SignInPage() {
  const { adapter, state } = useAuth();
  const [mode, setMode] = useState<Mode>('sign_in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [step, setStep] = useState<Step>('form');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [googleBusy, setGoogleBusy] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  if (state.status === 'signed_in') return <Navigate to="/account" replace />;

  if (adapter === null) {
    return (
      <AuthFrame
        title="Accounts"
        lead="GradTools works fully without one. Your data is on this device."
      >
        <Callout>
          Accounts are not available in this build. Everything you enter stays on this device, and
          nothing is sent anywhere.
        </Callout>
        <Button asChild variant="primary" className="mt-4 w-full">
          <Link to="/" onClick={markFirstRunDone}>
            Continue to GradTools
          </Link>
        </Button>
      </AuthFrame>
    );
  }

  // On the reset step the field takes a NEW password, so it autocompletes as one
  // rather than the current credential. It carries no length rule — the provider
  // owns the policy (an existing password may predate any later minimum).
  const settingNewPassword = step === 'reset';
  const recovering = mode === 'recover';

  const restart = (next: Mode): void => {
    setMode(next);
    setStep('form');
    setCode('');
    setError(null);
    setNotice(null);
  };

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setError(null);
    setNotice(null);
    // No app-imposed length rule, on sign-in OR on a reset. The field is
    // `required` (never empty); the provider enforces its own policy and returns
    // a real error if a new password is rejected. An existing password that
    // predates any policy is never blocked.
    setBusy(true);
    try {
      if (step === 'code') {
        setError((await adapter.verifyCode!(code.trim())).error);
      } else if (step === 'reset') {
        setError((await adapter.resetWithCode!(code.trim(), password)).error);
      } else if (recovering) {
        const { error: failure } = await adapter.sendRecovery(email);
        setError(failure);
        if (failure === null && adapter.resetWithCode !== undefined) {
          setPassword('');
          setStep('reset');
          setNotice('If that address has an account, a reset code is on its way.');
        } else if (failure === null)
          setNotice('If that address has an account, a recovery link is on its way.');
      } else {
        const result = await adapter.signInWithPassword(email, password);
        setError(result.error);
        if (result.error === null && result.needsCode === true) {
          setStep('code');
          setNotice(`This looks like a new device. We emailed a code to ${email}.`);
        }
      }
    } finally {
      setBusy(false);
    }
  };

  const withProvider = async (provider: 'google'): Promise<void> => {
    setGoogleBusy(true);
    setError(null);
    const { error: failure } = await adapter.signInWithProvider(provider);
    setError(failure);
    setWaiting(failure === null && Capacitor.isNativePlatform());
    setGoogleBusy(false);
  };

  return (
    <AuthFrame
      tab="sign-in"
      title={recovering ? 'Reset your password' : 'Sign in to GradTools'}
      lead={
        recovering
          ? 'We email you a code, then you choose a new password.'
          : 'Sync your results, attendance and timetable across your devices.'
      }
    >
      <AuthUnreachable className="mb-4" />
      {step === 'form' && !recovering && adapter.providerUnavailable === undefined && (
        <>
          <GoogleButton busy={googleBusy} onClick={() => void withProvider('google')}>
            Continue with Google
          </GoogleButton>
          {waiting && <BrowserWaitNote />}
          <EmailDivider />
        </>
      )}
      {step === 'form' && !recovering && adapter.providerUnavailable !== undefined && (
        <p className="mb-5 text-[12px] text-ink-3">{adapter.providerUnavailable}</p>
      )}
      <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-4">
        {step !== 'form' && (
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
        )}
        {step === 'form' && (
          <Field label="Email">
            <Input
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </Field>
        )}
        {((step === 'form' && !recovering) || step === 'reset') && (
          <div className="flex flex-col gap-1.5">
            <Field label={step === 'reset' ? 'New password' : 'Password'}>
              <PasswordInput
                autoComplete={settingNewPassword ? 'new-password' : 'current-password'}
                required
                // No `minLength`: the HTML attribute fires a native validation
                // bubble that blocks a submit the provider should decide on. The
                // app imposes no length rule on sign-in or on a reset.
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </Field>
            {step === 'form' && (
              <Button
                variant="link"
                size="text"
                className="self-end"
                onClick={() => restart('recover')}
              >
                Forgot password?
              </Button>
            )}
          </div>
        )}
        {error !== null && (
          <Callout tone="warning" role="alert">
            {error}
          </Callout>
        )}
        {notice !== null && <Callout role="status">{notice}</Callout>}
        <Button type="submit" variant="primary" size="lg" loading={busy} className="w-full">
          {busy
            ? 'Working…'
            : step === 'code'
              ? 'Confirm code'
              : step === 'reset'
                ? 'Set new password'
                : recovering
                  ? 'Send reset code'
                  : 'Sign in'}
        </Button>
        {(step !== 'form' || recovering) && (
          <Button variant="ghost" className="w-full" onClick={() => restart('sign_in')}>
            Back to sign in
          </Button>
        )}
      </form>
      {!recovering && step === 'form' && (
        <p className="mt-4 text-[12px] text-ink-3">
          Signing in uploads nothing by itself. You choose what happens to the records already on
          this device.
        </p>
      )}
      {/*
        Local-first: an account is optional. A signed-out student can always keep
        using GradTools on this device, so the way back to the app stays here —
        signing in is a choice, never a gate that locks them out of their data.
      */}
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
      <PreLoginReport />
    </AuthFrame>
  );
}
