/**
 * Sign in, create an account, recover one.
 *
 * Authority: docs/28 §28.13 · M9 §10, §23, §51, §52, §57
 *
 * ---------------------------------------------------------------------------
 * THE SCREEN EXPLAINS WHAT AN ACCOUNT IS FOR
 * ---------------------------------------------------------------------------
 *
 * GradTools works completely without one. So the honest thing to put at the top
 * of a sign-in page is the reason to bother — syncing between devices — and not
 * marketing copy about security (M9 §57). There are no trust badges here, no
 * "bank-level encryption", and no claim the app cannot back up.
 *
 * ---------------------------------------------------------------------------
 * SIGNING IN UPLOADS NOTHING
 * ---------------------------------------------------------------------------
 *
 * The page says so before the student acts, because the alternative — finding
 * out afterwards that four years of records went to a server — is exactly the
 * dark pattern §52 forbids. What happens to local data is a separate, explicit
 * choice made after sign-in.
 */

import { useState, type FormEvent } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { PageHeader } from '../../components/AppShell.js';
import { Button, Notice, Panel, TextField } from '../../components/ui/index.js';
import { useAuth } from './AuthContext.js';
import styles from './auth.module.css';

type Mode = 'sign_in' | 'create' | 'recover';

const HEADING: Record<Mode, string> = {
  sign_in: 'Sign in',
  create: 'Create an account',
  recover: 'Recover your account',
};

export function SignInPage() {
  const { adapter, state } = useAuth();
  const [mode, setMode] = useState<Mode>('sign_in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  if (state.status === 'signed_in') return <Navigate to="/account" replace />;

  /*
   * A build with no provider configured says so plainly instead of showing a
   * form that cannot work (M9 §68).
   */
  if (adapter === null) {
    return (
      <div className={styles.page}>
        <PageHeader
          title="Accounts"
          subtitle="GradTools works fully without one. Your data is on this device."
        />
        <Notice tone="info">
          Accounts are not available in this build. Everything you enter stays on this device, and
          nothing is sent anywhere.
        </Notice>
      </div>
    );
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (adapter === null) return;
    setBusy(true);
    setError(null);
    setNotice(null);

    try {
      if (mode === 'recover') {
        const { error: failure } = await adapter.sendRecovery(email);
        setError(failure);
        /*
         * THE SAME MESSAGE WHETHER OR NOT THE ADDRESS IS REGISTERED (M9 §23,
         * §48). Anything else turns this box into an account-enumeration
         * oracle.
         */
        if (failure === null) {
          setNotice('If that address has an account, a recovery link is on its way.');
        }
      } else if (mode === 'create') {
        const result = await adapter.signUpWithPassword(email, password);
        setError(result.error);
        if (result.error === null && result.needsConfirmation) {
          setNotice('Check your email to confirm your address, then sign in.');
        }
      } else {
        const { error: failure } = await adapter.signInWithPassword(email, password);
        setError(failure);
      }
    } finally {
      setBusy(false);
    }
  }

  async function withProvider(provider: 'google' | 'apple') {
    if (adapter === null) return;
    setBusy(true);
    setError(null);
    const { error: failure } = await adapter.signInWithProvider(provider);
    setError(failure);
    setBusy(false);
  }

  return (
    <div className={styles.page}>
      <PageHeader
        title={HEADING[mode]}
        subtitle="An account syncs your records between devices. GradTools works without one."
      />

      <Panel>
        {/*
          WHAT AN ACCOUNT DOES, BEFORE THEY MAKE ONE (M9 §52). Stated as fact,
          including the part about local data staying put.
        */}
        <p className={styles.explainer}>
          Signing in does <strong>not</strong> upload anything on its own. Afterwards you choose
          what happens to the records already on this device, and you can keep them here.
        </p>

        <div className={styles.providers}>
          <Button
            variant="secondary"
            type="button"
            disabled={busy}
            onClick={() => void withProvider('google')}
          >
            Continue with Google
          </Button>
          <Button
            variant="secondary"
            type="button"
            disabled={busy}
            onClick={() => void withProvider('apple')}
          >
            Continue with Apple
          </Button>
        </div>

        <p className={styles.divider}>or use an email address</p>

        <form className={styles.form} onSubmit={(event) => void submit(event)}>
          <TextField
            label="Email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(event) => {
              setEmail(event.target.value);
            }}
          />

          {mode !== 'recover' && (
            <TextField
              label="Password"
              type="password"
              /*
               * The browser's own password manager is the right place for this.
               * GradTools never sees, stores or transmits a password itself —
               * the identity provider owns that entirely (M9 §6, §66).
               */
              autoComplete={mode === 'create' ? 'new-password' : 'current-password'}
              required
              minLength={8}
              value={password}
              onChange={(event) => {
                setPassword(event.target.value);
              }}
              {...(mode === 'create' ? { hint: 'At least eight characters.' } : {})}
            />
          )}

          {error !== null && <Notice tone="warning">{error}</Notice>}
          {notice !== null && <Notice tone="info">{notice}</Notice>}

          <Button variant="primary" type="submit" disabled={busy}>
            {busy ? 'Working…' : HEADING[mode]}
          </Button>
        </form>

        <div className={styles.switches}>
          {mode !== 'sign_in' && (
            <button
              type="button"
              className={styles.linkButton}
              onClick={() => {
                setMode('sign_in');
              }}
            >
              Already have an account? Sign in
            </button>
          )}
          {mode !== 'create' && (
            <button
              type="button"
              className={styles.linkButton}
              onClick={() => {
                setMode('create');
              }}
            >
              Create an account
            </button>
          )}
          {mode !== 'recover' && (
            <button
              type="button"
              className={styles.linkButton}
              onClick={() => {
                setMode('recover');
              }}
            >
              Forgotten your password?
            </button>
          )}
        </div>
      </Panel>

      <p className={styles.note}>
        Prefer to stay local? <Link to="/">Keep using GradTools without an account.</Link> Nothing
        you have entered will be sent anywhere.
      </p>
    </div>
  );
}
