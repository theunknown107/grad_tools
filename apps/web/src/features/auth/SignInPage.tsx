/**
 * Sign in — email/password or Google through the configured adapter.
 * Signing in uploads nothing by itself; First sync asks what to do next.
 *
 * With a code-based provider (Clerk) two extra steps appear on this card:
 * `code` (confirm a new account or a new device with the emailed code) and
 * `reset` (the emailed recovery code plus a new password).
 */

import { useState, type FormEvent, type ReactNode } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { GradToolsLogo } from '../../brand/GradToolsLogo.js';
import { Button } from '../../components/ui/button.js';
import { Card } from '../../components/ui/card.js';
import { Callout } from '../../components/ui/feedback.js';
import { Field, Input, PasswordInput } from '../../components/ui/field.js';
import { Segmented } from '../../components/ui/segmented.js';
import { useAuth } from './AuthContext.js';

type Mode = 'sign_in' | 'create' | 'recover';
type Step = 'form' | 'code' | 'reset';
const HEADING: Record<Mode, string> = {
  sign_in: 'Sign in',
  create: 'Create an account',
  recover: 'Recover your account',
};

function Frame({
  title,
  lead,
  children,
}: {
  readonly title: string;
  readonly lead: string;
  readonly children: ReactNode;
}) {
  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-4 py-4">
      <Card className="p-6 sm:p-8">
        <GradToolsLogo size={40} />
        <h1 className="mt-5 font-display text-[26px] leading-tight font-semibold tracking-[-0.02em]">
          {title}
        </h1>
        <p className="mt-1.5 text-sm text-ink-2">{lead}</p>
        <div className="mt-6">{children}</div>
      </Card>
    </div>
  );
}

export function SignInPage() {
  const { adapter, state } = useAuth();
  const [mode, setMode] = useState<Mode>('sign_in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [step, setStep] = useState<Step>('form');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  if (state.status === 'signed_in') return <Navigate to="/account" replace />;

  if (adapter === null) {
    return (
      <Frame
        title="Accounts"
        lead="GradTools works fully without one. Your data is on this device."
      >
        <Callout>
          Accounts are not available in this build. Everything you enter stays on this device, and
          nothing is sent anywhere.
        </Callout>
        <Button asChild variant="primary" className="mt-4 w-full">
          <Link to="/">Continue to GradTools</Link>
        </Button>
      </Frame>
    );
  }

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      if (step === 'code') {
        setError((await adapter.verifyCode!(code.trim())).error);
      } else if (step === 'reset') {
        setError((await adapter.resetWithCode!(code.trim(), password)).error);
      } else if (mode === 'recover') {
        const { error: failure } = await adapter.sendRecovery(email);
        setError(failure);
        if (failure === null && adapter.resetWithCode !== undefined) {
          setPassword('');
          setStep('reset');
          setNotice('If that address has an account, a reset code is on its way.');
        } else if (failure === null)
          setNotice('If that address has an account, a recovery link is on its way.');
      } else if (mode === 'create') {
        const result = await adapter.signUpWithPassword(email, password);
        setError(result.error);
        if (result.error === null && result.needsConfirmation && adapter.verifyCode !== undefined) {
          setStep('code');
          setNotice(`We emailed a code to ${email}. Enter it to confirm your address.`);
        } else if (result.error === null && result.needsConfirmation)
          setNotice('Check your email to confirm your address, then sign in.');
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
    setBusy(true);
    setError(null);
    const { error: failure } = await adapter.signInWithProvider(provider);
    setError(failure);
    setBusy(false);
  };

  return (
    <Frame
      title={HEADING[mode]}
      lead="An account syncs your records between devices. GradTools works without one."
    >
      <Segmented<Mode>
        label="Account action"
        value={mode}
        onChange={(next) => {
          setMode(next);
          setStep('form');
          setCode('');
          setError(null);
          setNotice(null);
        }}
        options={[
          { value: 'sign_in', label: 'Sign in' },
          { value: 'create', label: 'Create' },
          { value: 'recover', label: 'Recover' },
        ]}
        className="w-full [&>*]:flex-1 [&>*]:justify-center"
      />
      <p className="mt-4 text-[13px] text-ink-2">
        Signing in does <strong className="font-semibold text-ink">not</strong> upload anything on
        its own. Afterwards you choose what happens to the records already on this device, and you
        can keep them here.
      </p>
      {step === 'form' && adapter.providerUnavailable === undefined && (
        <>
          <div className="mt-4">
            <Button disabled={busy} className="w-full" onClick={() => void withProvider('google')}>
              Continue with Google
            </Button>
          </div>
          <div className="my-5 flex items-center gap-3 text-[12px] text-ink-3" aria-hidden="true">
            <span className="h-px flex-1 bg-line" /> or use an email address{' '}
            <span className="h-px flex-1 bg-line" />
          </div>
        </>
      )}
      {step === 'form' && adapter.providerUnavailable !== undefined && (
        <p className="mt-4 mb-5 text-[12px] text-ink-3">{adapter.providerUnavailable}</p>
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
        {((step === 'form' && mode !== 'recover') || step === 'reset') && (
          <Field
            label={step === 'reset' ? 'New password' : 'Password'}
            {...(mode === 'create' || step === 'reset'
              ? { hint: 'At least eight characters.' }
              : {})}
          >
            <PasswordInput
              autoComplete={
                mode === 'create' || step === 'reset' ? 'new-password' : 'current-password'
              }
              required
              minLength={8}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </Field>
        )}
        {error !== null && (
          <Callout tone="warning" role="alert">
            {error}
          </Callout>
        )}
        {notice !== null && <Callout role="status">{notice}</Callout>}
        <Button type="submit" variant="primary" loading={busy} className="w-full">
          {busy
            ? 'Working…'
            : step === 'code'
              ? 'Confirm code'
              : step === 'reset'
                ? 'Set new password'
                : HEADING[mode]}
        </Button>
        {step !== 'form' && (
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
      <p className="mt-5 text-[12px] text-ink-3">
        Prefer to stay local?{' '}
        <Link to="/" className="font-medium text-accent-ink underline-offset-4 hover:underline">
          Keep using GradTools without an account.
        </Link>{' '}
        Nothing you have entered will be sent anywhere.
      </p>
    </Frame>
  );
}
