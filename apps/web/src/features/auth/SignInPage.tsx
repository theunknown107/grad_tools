/**
 * Sign in — email/password, Google or Apple through the configured adapter.
 * Signing in uploads nothing by itself; First sync asks what to do next.
 */

import { GraduationCap } from 'lucide-react';
import { useState, type FormEvent, type ReactNode } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { Button } from '../../components/ui/button.js';
import { Card } from '../../components/ui/card.js';
import { Callout } from '../../components/ui/feedback.js';
import { Field, Input } from '../../components/ui/field.js';
import { IconTile } from '../../components/ui/page.js';
import { Segmented } from '../../components/ui/segmented.js';
import { useAuth } from './AuthContext.js';

type Mode = 'sign_in' | 'create' | 'recover';
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
        <IconTile tone="solid" size="lg">
          <GraduationCap />
        </IconTile>
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
      if (mode === 'recover') {
        const { error: failure } = await adapter.sendRecovery(email);
        setError(failure);
        if (failure === null)
          setNotice('If that address has an account, a recovery link is on its way.');
      } else if (mode === 'create') {
        const result = await adapter.signUpWithPassword(email, password);
        setError(result.error);
        if (result.error === null && result.needsConfirmation)
          setNotice('Check your email to confirm your address, then sign in.');
      } else {
        const { error: failure } = await adapter.signInWithPassword(email, password);
        setError(failure);
      }
    } finally {
      setBusy(false);
    }
  };

  const withProvider = async (provider: 'google' | 'apple'): Promise<void> => {
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
      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        <Button disabled={busy} onClick={() => void withProvider('google')}>
          Continue with Google
        </Button>
        <Button disabled={busy} onClick={() => void withProvider('apple')}>
          Continue with Apple
        </Button>
      </div>
      <div className="my-5 flex items-center gap-3 text-[12px] text-ink-3" aria-hidden="true">
        <span className="h-px flex-1 bg-line" /> or use an email address{' '}
        <span className="h-px flex-1 bg-line" />
      </div>
      <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-4">
        <Field label="Email">
          <Input
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </Field>
        {mode !== 'recover' && (
          <Field
            label="Password"
            {...(mode === 'create' ? { hint: 'At least eight characters.' } : {})}
          >
            <Input
              type="password"
              autoComplete={mode === 'create' ? 'new-password' : 'current-password'}
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
          {busy ? 'Working…' : HEADING[mode]}
        </Button>
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
