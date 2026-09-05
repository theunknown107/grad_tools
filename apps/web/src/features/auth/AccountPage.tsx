/**
 * Account settings.
 *
 * Authority: docs/28 §28.13 · M9 §34, §35, §36, §56
 *
 * Four things a student must be able to do with an account, and this screen is
 * where all four live: see who they are signed in as, sign out, take their data
 * away, and delete the account entirely (M9 §56).
 *
 * WHAT IS DELIBERATELY NOT SHOWN: provider ids, token expiry, refresh state,
 * internal user metadata. None of it helps a student and some of it is a
 * credential (M9 §21, §56).
 */

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { PageHeader } from '../../components/AppShell.js';
import { MetaPill } from '../../components/ui/tone.js';
import { SectionedForm } from '../../components/ui/SectionedForm.js';
import { ThemeControl } from '../../components/ThemeControl.js';
import { Icon } from '../../components/icons.js';
import { Button, Notice, Panel, StatusPill } from '../../components/ui/index.js';
import { useAuth } from './AuthContext.js';
import { SYNC_LABEL } from '../../domain/auth.js';
import { useSync } from './useSync.js';
import styles from './auth.module.css';

/** One version of a conflicting record, short enough to compare at a glance. */
function summarise(data: Record<string, unknown> | null): string {
  if (data === null) return 'deleted';
  const parts = Object.entries(data)
    .filter(([key]) => key !== 'profileId' && key !== 'updatedAt')
    .slice(0, 4)
    .map(([key, value]) => `${key} ${String(value)}`);
  return parts.length === 0 ? 'no details' : parts.join(', ');
}

const PROVIDER_LABEL: Record<string, string> = {
  google: 'Google',
  apple: 'Apple',
  email: 'Email and password',
};

export function AccountPage() {
  const { state, signOut } = useAuth();
  const sync = useSync();
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  if (state.status === 'restoring') {
    return <p className={styles.note}>Checking your session…</p>;
  }

  if (state.status !== 'signed_in') {
    return (
      <div className={styles.page}>
        <PageHeader
          title="Account"
          subtitle="You are not signed in. Everything you enter stays on this device."
        />
        {state.status === 'expired' && (
          /* Told, not silently logged out (M9 §39, §68). */
          <Notice tone="warning">Your session has expired. Sign in again to resume syncing.</Notice>
        )}
        <Panel>
          <p className={styles.explainer}>
            An account syncs your records between devices. Without one, GradTools works exactly the
            same on this device.
          </p>
          <Link className={styles.primaryLink} to="/sign-in">
            Sign in or create an account
          </Link>
        </Panel>
      </div>
    );
  }

  const { identity } = state;

  return (
    <div className={`${styles.page ?? ''} ${styles.settingsPage ?? ''}`}>
      <PageHeader
        title="Account"
        subtitle="Who you are signed in as, and what you can do."
        /* The one fact this page is about: which account, if any. */
        pills={
          identity?.email !== undefined && identity.email !== null && identity.email !== '' ? (
            <MetaPill>{identity.email}</MetaPill>
          ) : (
            <MetaPill>Signed in</MetaPill>
          )
        }
      />

      {/*
        -------------------------------------------------------------------
        M9.6F: ONE CONCERN PER SCREEN
        -------------------------------------------------------------------

        This was five stacked panels, so "change my theme" and "delete my
        account" shared one scroll and the destructive one was passed on the
        way to everything else.

        SectionedForm (Reference 13, adapted) puts a rail beside them: one
        concern on screen at a time, and Delete is marked destructive IN THE
        RAIL, so its nature is known before it is opened rather than after.

        Appearance is new here. The theme control was only reachable from the
        header popover, which is right for a quick switch and wrong as the only
        home for a preference somebody might go looking for.
      */}
      <SectionedForm
        label="Account settings"
        sections={[
          {
            id: 'signed-in',
            label: 'Signed in',
            icon: 'account',
            children: (
              <>
                <Panel title="Signed in">
                  <dl className={styles.facts}>
                    <div>
                      <dt>Signed in with</dt>
                      <dd>
                        {identity.provider === null
                          ? 'An email address'
                          : (PROVIDER_LABEL[identity.provider] ?? identity.provider)}
                      </dd>
                    </div>
                    {identity.email !== null && (
                      <div>
                        <dt>Email</dt>
                        {/*
                      DISPLAY ONLY. Changing this does not change the sign-in address,
                      and the screen never implies it would (M9 §47).
                    */}
                        <dd>{identity.email}</dd>
                      </div>
                    )}
                    <div>
                      <dt>Sync</dt>
                      <dd>
                        <StatusPill tone={sync.state.status === 'failed' ? 'warning' : 'neutral'}>
                          {SYNC_LABEL[sync.state.status]}
                        </StatusPill>
                      </dd>
                    </div>
                  </dl>

                  {identity.email !== null && identity.provider === 'apple' && (
                    <p className={styles.note}>
                      Apple may give apps a private relay address rather than your real one.
                      GradTools only uses it to show you which account this is.
                    </p>
                  )}
                </Panel>
              </>
            ),
          },
          {
            id: 'appearance',
            label: 'Appearance',
            icon: 'sun',
            children: (
              <>
                <p className={styles.explainer}>
                  Light, dark or whatever this device is set to, and the accent used for selected
                  items and highlights. Saved on this device only &mdash; it is never synced and
                  never affects an academic figure.
                </p>
                <div className={styles.actions}>
                  <ThemeControl />
                </div>
              </>
            ),
          },
          {
            id: 'conflicts',
            label: 'Needs attention',
            icon: 'warning',
            children: (
              <>
                {sync.state.conflicts.length > 0 && (
                  <Panel title="Needs your attention">
                    {/*
                  CONFLICTS ARE SHOWN, NOT RESOLVED FOR THE STUDENT (M9 §28, §54).
                  Both versions are printed side by side because for a grade or an
                  attendance count there is no arithmetic that is right — the person
                  who knows which is true is the one reading this.
                */}
                    <p className={styles.explainer}>
                      These records changed in two places. Nothing has been overwritten, and both
                      versions are still here.
                    </p>
                    <ul className={styles.choices}>
                      {sync.state.conflicts.map((conflict) => (
                        <li key={`${conflict.collection}:${conflict.id}`} className={styles.choice}>
                          <span className={styles.choiceTitle}>{conflict.collection}</span>
                          <span className={styles.choiceDetail}>{conflict.reason}</span>
                          <span className={styles.choiceDetail}>
                            On this device: {summarise(conflict.local)}
                          </span>
                          <span className={styles.choiceDetail}>
                            In your account: {summarise(conflict.server)}
                          </span>
                        </li>
                      ))}
                    </ul>
                    <p className={styles.note}>
                      Edit the record on the device you want to keep, then sync again.
                    </p>
                  </Panel>
                )}
              </>
            ),
          },
          {
            id: 'data',
            label: 'Your data',
            icon: 'shield',
            children: (
              <>
                <Panel title="Your data">
                  <p className={styles.explainer}>
                    Everything GradTools holds for you, as a JSON file. It contains your records and
                    nobody else&rsquo;s.
                  </p>
                  <div className={styles.actions}>
                    <Button
                      variant="secondary"
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        setBusy(true);
                        void sync
                          .exportData()
                          .then((ok) => {
                            setMessage(ok ? null : 'Could not build your export. Try again.');
                          })
                          .finally(() => {
                            setBusy(false);
                          });
                      }}
                    >
                      Download my data
                    </Button>
                    <Button
                      variant="secondary"
                      type="button"
                      disabled={busy || sync.state.status === 'syncing'}
                      onClick={() => void sync.syncNow()}
                    >
                      Sync now
                    </Button>
                  </div>
                  {message !== null && <Notice tone="warning">{message}</Notice>}
                </Panel>
              </>
            ),
          },
          {
            id: 'sign-out',
            /*
             * "Session", not "Sign out": the rail item and the action button
             * inside it would otherwise carry the same accessible name on the
             * same screen, which is ambiguous to anyone navigating by name.
             */
            label: 'Session',
            icon: 'signOut',
            children: (
              <>
                <Panel title="Sign out">
                  {/*
                THE ONE THING STUDENTS ASSUME AND SHOULD NOT HAVE TO (M9 §36). Signing
                out does not delete local data; that is a separate, deliberate act.
              */}
                  <p className={styles.explainer}>
                    Signing out stops syncing. The records saved on this device stay here, and are
                    yours again when you sign back in.
                  </p>
                  <Button variant="secondary" type="button" onClick={() => void signOut()}>
                    <Icon name="signOut" size="small" />
                    Sign out
                  </Button>
                </Panel>
              </>
            ),
          },
          {
            id: 'delete',
            label: 'Delete account',
            icon: 'trash',
            tone: 'danger',
            children: (
              <>
                <Panel title="Delete account">
                  <p className={styles.explainer}>
                    Deleting your account removes your profile, semesters, subjects, results,
                    attendance, timetable and backlogs from GradTools&rsquo; servers. This cannot be
                    undone.
                  </p>
                  <p className={styles.note}>
                    The copy on this device is not deleted by this. Clear it separately if you want
                    it gone.
                  </p>

                  {confirmingDelete ? (
                    <div className={styles.actions}>
                      {/*
                    A DESTRUCTIVE ACTION IS NEVER THE DEFAULT (M9 §54). Cancel comes
                    first and is the ordinary button; delete is marked as danger.
                  */}
                      <Button
                        variant="secondary"
                        type="button"
                        onClick={() => {
                          setConfirmingDelete(false);
                        }}
                      >
                        Cancel
                      </Button>
                      <Button
                        variant="danger"
                        type="button"
                        disabled={busy}
                        onClick={() => {
                          setBusy(true);
                          void sync
                            .deleteAccount()
                            .then((result) => {
                              setMessage(result.error);
                              if (result.error === null) void signOut();
                            })
                            .finally(() => {
                              setBusy(false);
                              setConfirmingDelete(false);
                            });
                        }}
                      >
                        Delete my account permanently
                      </Button>
                    </div>
                  ) : (
                    <Button
                      variant="secondary"
                      type="button"
                      onClick={() => {
                        setConfirmingDelete(true);
                      }}
                    >
                      Delete my account
                    </Button>
                  )}
                </Panel>
              </>
            ),
          },
        ]}
      />
    </div>
  );
}
