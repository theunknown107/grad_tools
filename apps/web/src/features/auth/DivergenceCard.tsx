/**
 * "A synced record says something else."
 *
 * ---------------------------------------------------------------------------
 * THE STUDENT DECIDES, AND NOTHING DECIDES FOR THEM
 * ---------------------------------------------------------------------------
 *
 * A synced attendance aggregate cannot carry a cancelled class, so a device
 * that records one legitimately disagrees with the figure in the account. The
 * old behaviour was to take whichever value arrived last, which quietly erased
 * whichever device had more information.
 *
 * So a difference is an OBSERVATION, shown here with both figures and two
 * buttons. Keep dismisses it. Adopt records an explicit, auditable adjustment
 * that lands the subject exactly on the synced figure — and never runs by
 * itself, however many times the same row is synced.
 *
 * The wording says "a synced record", not "another device": sync carries no
 * device attribution at all, and the value may even be this device's own, from
 * before it upgraded. The product does not claim what it cannot prove.
 */

import { CloudAlert } from 'lucide-react';
import { Button } from '../../components/ui/button.js';
import { Card } from '../../components/ui/card.js';
import { toast } from '../../components/ui/feedback.js';
import { SectionTitle } from '../../components/ui/page.js';
import {
  adoptSnapshot,
  decideSnapshot,
  deriveCounts,
  openSnapshots,
} from '../../domain/attendance.js';
import type { RemoteSnapshot } from '../../domain/types.js';
import {
  useAttendanceLedger,
  useRemoteSnapshots,
  useTimetableOverrides,
} from '../../hooks/useCollection.js';
import { newId } from '../../lib/id.js';

function seenOn(snapshot: RemoteSnapshot): string {
  return new Date(snapshot.lastSeenAt).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
  });
}

export function DivergenceCard() {
  const { items: entries, save: saveEntry, remove: removeEntry } = useAttendanceLedger();
  const { items: overrides } = useTimetableOverrides();
  const { items: snapshots, save: saveSnapshot } = useRemoteSnapshots();

  const open = openSnapshots(snapshots);
  if (open.length === 0) return null;

  const derived = deriveCounts(entries, overrides);

  const adopt = (snapshot: RemoteSnapshot): void => {
    const here = derived.get(snapshot.subjectCode) ?? { attended: 0, conducted: 0 };
    const adjustment = adoptSnapshot(snapshot, here, newId());

    if (adjustment === null) {
      /* An impossible figure is refused and never offered again. */
      void saveSnapshot(decideSnapshot(snapshot, 'rejected'));
      toast(
        `A synced record reported ${snapshot.attended} of ${snapshot.conducted}, which is not a possible figure.`,
        {
          tone: 'warning',
          description: 'It was not adopted, and will not be offered again.',
        },
      );
      return;
    }

    void saveEntry(adjustment);
    void saveSnapshot(decideSnapshot(snapshot, 'adopted', adjustment.id));
    toast(`${snapshot.subjectCode} now reads ${snapshot.attended} of ${snapshot.conducted}.`, {
      tone: 'success',
      description: 'Recorded as an adjustment you can see in this subject’s history.',
      action: {
        label: 'Undo',
        /*
         * A ROLLBACK, not an edit: inside the window the whole adoption is
         * taken back. Afterwards the repository refuses to touch it, and a
         * correction is a new adjustment.
         */
        onClick: () => {
          void removeEntry(adjustment.id).then(
            () => {
              void saveSnapshot(decideSnapshot(snapshot, 'kept'));
            },
            () => {
              toast('That adjustment has already been committed.', { tone: 'warning' });
            },
          );
        },
      },
    });
  };

  return (
    <Card className="p-6">
      <SectionTitle>A synced record says something else</SectionTitle>
      <p className="text-[13px] text-ink-2">
        Nothing has been changed. A synced total cannot say that a class was cancelled, so a device
        that recorded one will legitimately hold a different figure.
      </p>
      <ul className="mt-4 flex flex-col gap-3">
        {open.map((snapshot) => {
          const here = derived.get(snapshot.subjectCode);
          return (
            <li
              key={snapshot.id}
              className="rounded-xl border border-line bg-sunken/60 p-4 text-[13px]"
            >
              <div className="flex items-start gap-3">
                <CloudAlert className="mt-0.5 size-4 shrink-0 text-ink-3" aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <div className="font-semibold">{snapshot.subjectCode}</div>
                  <p className="mt-1 text-ink-2">
                    A synced attendance record was last reported as {snapshot.attended} of{' '}
                    {snapshot.conducted} on {seenOn(snapshot)}. This device has{' '}
                    {here?.attended ?? 0} of {here?.conducted ?? 0}, from the classes recorded here.
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      onClick={() => void saveSnapshot(decideSnapshot(snapshot, 'kept'))}
                    >
                      Keep this device&rsquo;s record
                    </Button>
                    <Button size="sm" variant="primary" onClick={() => adopt(snapshot)}>
                      Adopt the synced counts
                    </Button>
                  </div>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
