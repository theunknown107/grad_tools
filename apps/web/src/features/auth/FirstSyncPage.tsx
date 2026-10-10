/**
 * First sync — after signing in, the student chooses what happens to the
 * records already on this device. Nothing is uploaded until they choose, and
 * the local copy is kept whatever they choose.
 */

import { ArrowRight, CloudUpload, HardDrive } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Badge } from '../../components/ui/badge.js';
import { Button } from '../../components/ui/button.js';
import { Card } from '../../components/ui/card.js';
import { Callout } from '../../components/ui/feedback.js';
import { MiniStat } from '../../components/ui/metric.js';
import { PageHeader } from '../../components/ui/page.js';
import { PageSkeleton } from '../../components/ui/skeleton.js';
import { MERGE_LABEL, mergeOptionsFor, type MergeChoice } from '../../domain/auth.js';
import { createLocalRepositories } from '../../repositories/local/index.js';
import { scopeHasData } from '../../repositories/local/store.js';
import { cn } from '../../lib/cn.js';
import { useAuth } from './AuthContext.js';
import { useSync } from './useSync.js';

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
  const [cloudCount, setCloudCount] = useState(0);
  const [busy, setBusy] = useState<MergeChoice | null>(null);
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
    return (
      <div className="flex flex-col gap-6">
        <PageHeader
          eyebrow="Sync"
          title="Your records"
          description="Where you choose what happens to the records on this device when an account is added."
        />
        <Card className="p-6">
          <p className="text-[13px] text-ink-2">
            Nothing has been uploaded, and nothing will be until you sign in and choose. The records
            already on this device are untouched either way.
          </p>
          <Callout className="mt-4">Sign in first to choose what happens to your records.</Callout>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button asChild variant="primary">
              <Link to="/sign-in">Go to sign in</Link>
            </Button>
            <Button asChild>
              <Link to="/">Continue without an account</Link>
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  if (localCount === null) return <PageSkeleton label="Looking at what is on this device" />;

  const options = mergeOptionsFor({ localCount, cloudCount });

  const choose = async (choice: MergeChoice): Promise<void> => {
    if (userId === null) return;
    setBusy(choice);
    setError(null);
    try {
      if (choice === 'stay_local') {
        void navigate('/');
        return;
      }
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
        if (profile !== null && (await target.profile.get()) === null)
          await target.profile.save(profile);
      }
      await sync.syncNow();
      void navigate('/account');
    } catch {
      setError('Could not finish. Nothing was deleted — your records are still on this device.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Sync"
        title="Your records"
        description="You are signed in. Choose what happens to the records already on this device."
      />
      <div className="grid grid-cols-2 gap-3 sm:max-w-md">
        <MiniStat label="On this device" value={localCount} />
        <MiniStat label="In your account" value={cloudCount} />
      </div>
      <p className="text-[13px] text-ink-2">
        Nothing has been uploaded yet. Whatever you choose, the copy on this device is kept.
      </p>
      {error !== null && (
        <Callout tone="warning" role="alert">
          {error}
        </Callout>
      )}
      <ul className="grid gap-3 md:grid-cols-2">
        {options.available.map((choice) => {
          const recommended = choice === options.recommended;
          return (
            <li key={choice}>
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => void choose(choice)}
                className={cn(
                  'group flex h-full w-full items-start gap-3 rounded-xl border bg-raised p-4 text-left transition-[border-color,box-shadow,transform] duration-150 hover:-translate-y-0.5 hover:shadow-e2 disabled:opacity-60',
                  recommended ? 'ring-2 ring-accent/20' : 'border-line hover:border-line-strong',
                )}
              >
                <span
                  aria-hidden="true"
                  className="grid size-9 shrink-0 place-items-center rounded-lg bg-sunken text-ink-2"
                >
                  {choice === 'stay_local' ? (
                    <HardDrive className="size-4.5" />
                  ) : (
                    <CloudUpload className="size-4.5" />
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2 text-[14px] font-semibold">
                    {MERGE_LABEL[choice].title}
                    {recommended && <Badge tone="accent">Suggested</Badge>}
                  </span>
                  <span className="mt-1 block text-[13px] text-ink-2">
                    {MERGE_LABEL[choice].detail}
                  </span>
                </span>
                <ArrowRight
                  aria-hidden="true"
                  className="mt-1 size-4 shrink-0 text-ink-3 transition-transform group-hover:translate-x-0.5"
                />
              </button>
            </li>
          );
        })}
      </ul>
      <p className="text-[12px] text-ink-3">
        You can change this later from Account settings. Deleting your account removes the cloud
        copy and leaves this device&rsquo;s records alone.
      </p>
    </div>
  );
}

export async function hasLocalDataToOffer(): Promise<boolean> {
  return scopeHasData(null);
}
