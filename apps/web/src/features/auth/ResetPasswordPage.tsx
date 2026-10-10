/**
 * Reset password — the completion half of recovery.
 *
 * `sendRecovery` emails a link back to this route. Opening it lets the Supabase
 * SDK consume the recovery token and enter a short-lived recovery session; this
 * screen then takes a new password and calls `updatePassword`. The old password
 * is never shown, read, or needed — recovery is a reset, not a reveal.
 */

import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { GradToolsLogo } from '../../brand/GradToolsLogo.js';
import { Button } from '../../components/ui/button.js';
import { Card } from '../../components/ui/card.js';
import { Callout } from '../../components/ui/feedback.js';
import { Field, PasswordInput } from '../../components/ui/field.js';
import { PageSkeleton } from '../../components/ui/skeleton.js';
import { useAuth } from './AuthContext.js';

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

export function ResetPasswordPage() {
  const { adapter, state } = useAuth();
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  // `ready` once a recovery (or any live) session exists; `checked` once the
  // initial session read has resolved, so we don't flash "invalid" first.
  const [ready, setReady] = useState(false);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    if (adapter === null) {
      setChecked(true);
      return;
    }
    let active = true;
    // The SDK may consume the link before or after this mounts: subscribe for
    // the PASSWORD_RECOVERY event AND read the current session once.
    const unsubscribe = adapter.onPasswordRecovery(() => {
      if (active) setReady(true);
    });
    void adapter
      .current()
      .then((identity) => {
        if (active && identity !== null) setReady(true);
      })
      .finally(() => {
        if (active) setChecked(true);
      });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [adapter]);

  // A sign-in that lands here (e.g. cross-tab) is also a valid session to set from.
  const sessionReady = ready || state.status === 'signed_in';

  if (adapter === null) {
    return (
      <Frame title="Reset password" lead="Accounts are not available in this build.">
        <Button asChild variant="primary" className="w-full">
          <Link to="/">Continue to GradTools</Link>
        </Button>
      </Frame>
    );
  }

  // Code-based providers (Clerk) reset on the sign-in card; there is no link session here.
  if (adapter.resetWithCode !== undefined) {
    return (
      <Frame
        title="Reset password"
        lead="Choose Recover on the sign-in screen and we'll email you a code."
      >
        <Button asChild variant="primary" className="w-full">
          <Link to="/sign-in">Go to sign in</Link>
        </Button>
      </Frame>
    );
  }

  if (!checked && !sessionReady) return <PageSkeleton label="Opening your reset link" />;

  if (done) {
    return (
      <Frame title="Password updated" lead="You can sign in with your new password now.">
        <Callout role="status">Your password has been changed.</Callout>
        <Button asChild variant="primary" className="mt-4 w-full">
          <Link to="/sign-in">Go to sign in</Link>
        </Button>
      </Frame>
    );
  }

  if (!sessionReady) {
    return (
      <Frame
        title="Reset link expired"
        lead="This password reset link is invalid or has already been used."
      >
        <Callout tone="warning">Request a new link and open it from the same device.</Callout>
        <Button asChild variant="primary" className="mt-4 w-full">
          <Link to="/sign-in">Back to sign in</Link>
        </Button>
      </Frame>
    );
  }

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { error: failure } = await adapter.updatePassword(password);
      if (failure === null) setDone(true);
      else setError(failure);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Frame title="Choose a new password" lead="Enter the password you'd like to use from now on.">
      <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-4">
        <Field label="New password" hint="At least eight characters.">
          <PasswordInput
            autoComplete="new-password"
            required
            minLength={8}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </Field>
        {error !== null && (
          <Callout tone="warning" role="alert">
            {error}
          </Callout>
        )}
        <Button type="submit" variant="primary" loading={busy} className="w-full">
          {busy ? 'Saving…' : 'Update password'}
        </Button>
      </form>
    </Frame>
  );
}
