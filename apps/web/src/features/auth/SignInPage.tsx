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
import { ThemeControl } from '../../components/ThemeControl.js';
import { Button, Notice, TextField } from '../../components/ui/index.js';
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
    /*
     * M9.6G: the unavailable state gets the SAME STAGE as the form.
     *
     * It used to be a bare notice on a plain page, so a build without a
     * provider looked like a different product from one with it. The message is
     * unchanged and still honest — no form is shown that cannot work — but it
     * now sits on the same lit surface, because "accounts are off" is a normal
     * state of this screen rather than an error page.
     */
    return (
      <div className={styles.stage}>
        <div className={styles.stageSky} aria-hidden="true">
          <span className={styles.stageGlow} />
        </div>

        <div className={styles.authCard}>
          <div className={styles.authTop}>
            <span className={styles.authMark} aria-hidden="true">
              G
            </span>
            <ThemeControl />
          </div>

          <h1 className={styles.authTitle}>Accounts</h1>
          <p className={styles.authLead}>
            GradTools works fully without one. Your data is on this device.
          </p>

          <Notice tone="info">
            Accounts are not available in this build. Everything you enter stays on this device, and
            nothing is sent anywhere.
          </Notice>

          <p className={styles.note}>
            <Link to="/">Continue to GradTools</Link>
          </p>
        </div>
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
    /*
     * M9.6B References 11 + 12, as ONE design (M9.6 §21).
     *
     * Reference 12 brings the atmosphere: a lit stage behind a floating panel.
     * Reference 11 brings the restraint: a single centred column, dark, with
     * the form as the only object on screen. Taken together — Ref 12's light,
     * Ref 11's discipline.
     *
     * Explicitly NOT taken from Reference 12: the neural-network pattern, the
     * floating particles and the animated gradient orbs. Three simultaneous
     * background animations behind a password field is decoration competing
     * with the one thing the person came to do.
     *
     * Nothing about the authentication flow changed here. Supabase Auth, PKCE,
     * the provider chain and the session logic are exactly as they were; this
     * is a container and a stylesheet.
     */
    <div className={styles.stage}>
      <div className={styles.stageSky} aria-hidden="true">
        <span className={styles.stageGlow} />
      </div>

      <div className={styles.authCard}>
        {/*
          M9.6G: ONE CARD, NOT A PAGE HEADER PLUS A PANEL.
          The screen carried the application's PageHeader above a generic
          Panel, so it read as an app page that happened to contain a form. An
          auth screen has exactly one job and should be one object: mark,
          heading, lead, form. The theme control sits with the mark, because a
          person arriving in the wrong appearance should not have to sign in to
          fix it.
        */}
        <div className={styles.authTop}>
          <span className={styles.authMark} aria-hidden="true">
            G
          </span>
          <ThemeControl />
        </div>

        <h1 className={styles.authTitle}>{HEADING[mode]}</h1>
        <p className={styles.authLead}>
          An account syncs your records between devices. GradTools works without one.
        </p>

        <div className={styles.authBody}>
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
        </div>

        <p className={styles.note}>
          Prefer to stay local? <Link to="/">Keep using GradTools without an account.</Link> Nothing
          you have entered will be sent anywhere.
        </p>
      </div>
    </div>
  );
}
