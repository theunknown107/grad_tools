/**
 * Records from a previous (Supabase-era) account, offered to the new one.
 *
 * After the Clerk cutover a returning student signs in under a NEW id, so the
 * records this device saved under their old id are still here but unread. This
 * card finds them and, only on an explicit confirmation, COPIES them into the
 * new account (repositories/local/store.ts `copyLegacyScope`). Nothing moves
 * without a choice, and the old copy stays until it is removed on purpose.
 *
 * A shared device can hold more than one former account, so each is shown
 * with its own name, USN and record count, and the student confirms that the
 * records are theirs.
 */

import { History } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '../../components/ui/button.js';
import { Card } from '../../components/ui/card.js';
import { ConfirmDialog } from '../../components/ui/dialog.js';
import { toast } from '../../components/ui/feedback.js';
import { IconTile } from '../../components/ui/page.js';
import { createLocalRepositories } from '../../repositories/local/index.js';
import {
  clearScope,
  copyLegacyScope,
  legacyScopesWithRecords,
  scopeHoldsRecords,
} from '../../repositories/local/store.js';
import { useIdentity } from './AuthContext.js';

interface Candidate {
  readonly id: string;
  readonly name: string | null;
  readonly usn: string | null;
  readonly records: number;
}

async function describe(id: string): Promise<Candidate> {
  const repositories = createLocalRepositories(id);
  const [profile, ...lists] = await Promise.all([
    repositories.profile.get(),
    repositories.semesters.list(),
    repositories.results.list(),
    repositories.attendanceLedger.list(),
    repositories.timetable.list(),
    repositories.backlogs.list(),
  ]);
  return {
    id,
    name: profile?.displayName ?? null,
    usn: profile?.usn ?? null,
    records: lists.reduce((total, list) => total + list.length, 0),
  };
}

export function LegacyDataOffer() {
  const identity = useIdentity();
  const userId = identity?.userId ?? null;
  const [candidates, setCandidates] = useState<readonly Candidate[]>([]);
  const [confirming, setConfirming] = useState<Candidate | null>(null);
  const [copied, setCopied] = useState<Candidate | null>(null);
  const [removing, setRemoving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (userId === null) return;
    let cancelled = false;
    void (async () => {
      if (await scopeHoldsRecords(userId)) return;
      const found = await Promise.all((await legacyScopesWithRecords(userId)).map(describe));
      if (!cancelled) setCandidates(found);
    })();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  if (userId === null || (candidates.length === 0 && copied === null)) return null;

  const label = (c: Candidate) =>
    [c.name, c.usn].filter((part) => part !== null).join(' · ') || 'An earlier account';

  return (
    <Card className="p-6">
      <div className="flex items-start gap-3">
        <IconTile tone="accent" size="lg">
          <History />
        </IconTile>
        <div className="min-w-0 flex-1">
          {copied === null ? (
            <>
              <h2 className="text-[15px] font-semibold">Records from your previous account</h2>
              <p className="mt-1 max-w-xl text-[13px] text-ink-2">
                Sign-in has moved to a new system, so this account starts empty. This device still
                has records saved under an earlier GradTools account. If they are yours, bring them
                into this account. Nothing is moved until you choose.
              </p>
              <ul className="mt-4 flex flex-col gap-2">
                {candidates.map((candidate) => (
                  <li
                    key={candidate.id}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line p-3"
                  >
                    <span className="min-w-0 text-[13px]">
                      <span className="font-medium">{label(candidate)}</span>
                      <span className="text-ink-3"> · {candidate.records} records</span>
                    </span>
                    <Button variant="primary" onClick={() => setConfirming(candidate)}>
                      Bring into this account
                    </Button>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <>
              <h2 className="text-[15px] font-semibold">Your records are in this account</h2>
              <p className="mt-1 max-w-xl text-[13px] text-ink-2">
                They upload the next time you sync. The earlier copy is still on this device; remove
                it once you have checked everything is here.
              </p>
              <Button className="mt-4" onClick={() => setRemoving(true)}>
                Remove the earlier copy
              </Button>
            </>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={confirming !== null}
        onOpenChange={(open) => {
          if (!open) {
            setConfirming(null);
            setError(null);
          }
        }}
        busy={busy}
        error={error}
        pendingStatus="Copying records…"
        title="Bring these records into this account?"
        description={
          confirming === null
            ? ''
            : `${label(confirming)} — ${confirming.records} records. Only continue if these are yours. They are copied, not moved: the earlier copy stays on this device.`
        }
        confirmLabel="Yes, these are mine"
        onConfirm={() => {
          if (confirming === null) return;
          const chosen = confirming;
          setBusy(true);
          setError(null);
          void copyLegacyScope(chosen.id, userId)
            .then(() => {
              setCopied(chosen);
              setConfirming(null);
              toast('Records copied into this account', { tone: 'neutral' });
            })
            .catch(() => setError('Could not copy the records. Nothing was changed. Try again.'))
            .finally(() => setBusy(false));
        }}
      />

      <ConfirmDialog
        open={removing}
        onOpenChange={setRemoving}
        destructive
        busy={busy}
        title="Remove the earlier copy from this device?"
        description="Only the earlier account's copy is removed. The records in this account stay."
        confirmLabel="Remove the earlier copy"
        onConfirm={() => {
          if (copied === null) return;
          setBusy(true);
          void clearScope(copied.id).finally(() => {
            setBusy(false);
            setRemoving(false);
            setCopied(null);
            setCandidates([]);
          });
        }}
      />
    </Card>
  );
}
