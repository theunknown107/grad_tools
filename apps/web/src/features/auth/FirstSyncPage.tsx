/**
 * The first sign-in, and what happens to the data already on this device.
 *
 * Authority: docs/12 §12.14 · docs/28 §28.13 · M9 §27, §51, §52, §54
 *
 * ---------------------------------------------------------------------------
 * THE SCREEN THAT EXISTS SO NOTHING IS DECIDED FOR THE STUDENT
 * ---------------------------------------------------------------------------
 *
 * A student can arrive here with four years of records on this device and an
 * account they made ten seconds ago — or with an empty device and a full
 * account. Guessing which way the data should flow is how people lose a
 * semester (M9 §27).
 *
 * So: the counts are shown, the options are described in terms of what happens
 * to the records, **nothing is preselected that could delete anything**, and
 * one of the choices is always "do nothing yet" (M9 §54).
 *
 * There is no dark pattern here. "Keep this device only" is a real option
 * presented as an equal, not a greyed-out afterthought (M9 §52).
 */

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PageHeader } from '../../components/AppShell.js';
import { MetaPill } from '../../components/ui/tone.js';
import { formatCount } from '../../lib/format.js';
import { Notice, Panel } from '../../components/ui/index.js';
import { useAuth } from './AuthContext.js';
import { useSync } from './useSync.js';
import { MERGE_LABEL, mergeOptionsFor, type MergeChoice } from '../../domain/auth.js';
import { scopeHasData } from '../../repositories/local/store.js';
import { createLocalRepositories } from '../../repositories/local/index.js';
import styles from './auth.module.css';

/** How many records a scope holds, for the counts the student is shown. */
async function countIn(scope: string | null): Promise<number> {
  const repositories = createLocalRepositories(scope);
  const lists = await Promise.all([
    repositories.semesters.list(),
    repositories.semesterSubjects.list(),
    repositories.results.list(),
    repositories.attendance.list(),
    repositories.timetable.list(),
    repositories.backlogs.list(),
  ]);
  return lists.reduce((total, list) => total + list.length, 0);
}

export function FirstSyncPage() {
  const { state } = useAuth();
  const sync = useSync();
  const navigate = useNavigate();

  const [localCount, setLocalCount] = useState<number | null>(null);
  const [cloudCount, setCloudCount] = useState<number>(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const userId = state.status === 'signed_in' ? state.identity.userId : null;

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const anonymous = await countIn(null);
      const mine = userId === null ? 0 : await countIn(userId);
      if (cancelled) return;
      setLocalCount(anonymous);
      setCloudCount(mine);
    })();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  if (state.status !== 'signed_in') {
    return <Notice tone="info">Sign in first to choose what happens to your records.</Notice>;
  }
  if (localCount === null) return <p className={styles.note}>Looking at what is on this device…</p>;

  const options = mergeOptionsFor({ localCount, cloudCount });

  async function choose(choice: MergeChoice) {
    if (userId === null) return;
    setBusy(true);
    setError(null);

    try {
      if (choice === 'stay_local') {
        void navigate('/');
        return;
      }

      /*
       * `merge` and `upload_local` both copy the anonymous scope's records into
       * the account's scope before syncing. `merge` keeps whatever the account
       * already had; `upload_local` is the same operation on an account that
       * had nothing, which is why they share a path.
       *
       * THE ANONYMOUS COPY IS NOT DELETED (M9 §27, §68). If the student later
       * signs out, their pre-account records are still there.
       */
      if (choice === 'merge' || choice === 'upload_local') {
        const source = createLocalRepositories(null);
        const target = createLocalRepositories(userId);
        for (const key of [
          'semesters',
          'semesterSubjects',
          'results',
          'attendance',
          'timetable',
          'backlogs',
        ] as const) {
          for (const record of await source[key].list()) {
            await target[key].upsert(record as never);
          }
        }
        const profile = await source.profile.get();
        if (profile !== null && (await target.profile.get()) === null) {
          await target.profile.save(profile);
        }
      }

      await sync.syncNow();
      void navigate('/account');
    } catch {
      setError('Could not finish. Nothing was deleted — your records are still on this device.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.page}>
      <PageHeader
        title="Your records"
        subtitle="You are signed in. Choose what happens to the records already on this device."
        /* The two real counts, stated before the choice that depends on them.
           No progress bar: there is no progress here, only a decision. */
        pills={
          <>
            <MetaPill>{formatCount(localCount, 'record')} on this device</MetaPill>
            <MetaPill>{formatCount(cloudCount, 'record')} in your account</MetaPill>
          </>
        }
      />

      <Panel>
        <p className={styles.counts}>
          <span className={styles.count}>
            <strong>{localCount}</strong> on this device
          </span>
          <span className={styles.count}>
            <strong>{cloudCount}</strong> in your account
          </span>
        </p>

        <p className={styles.explainer}>
          Nothing has been uploaded yet. Whatever you choose, the copy on this device is kept.
        </p>

        {error !== null && <Notice tone="warning">{error}</Notice>}

        <ul className={styles.choices}>
          {options.available.map((choice) => (
            <li key={choice}>
              <button
                type="button"
                className={styles.choice}
                data-recommended={choice === options.recommended}
                disabled={busy}
                onClick={() => void choose(choice)}
              >
                <span className={styles.choiceTitle}>
                  {MERGE_LABEL[choice].title}
                  {choice === options.recommended && ' · suggested'}
                </span>
                <span className={styles.choiceDetail}>{MERGE_LABEL[choice].detail}</span>
              </button>
            </li>
          ))}
        </ul>
      </Panel>

      <p className={styles.note}>
        You can change this later from Account settings. Deleting your account removes the cloud
        copy and leaves this device&rsquo;s records alone.
      </p>
    </div>
  );
}

/** True when the anonymous scope holds anything worth offering to merge. */
export async function hasLocalDataToOffer(): Promise<boolean> {
  return scopeHasData(null);
}
