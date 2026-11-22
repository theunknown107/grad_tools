/**
 * Quick attendance: a round button at the bottom right (above the bottom bar
 * on a phone) that opens today's classes with Attended / Missed.
 *
 * ONE WRITE PATH. It marks through `useMarkClass`, exactly as the timetable's
 * day view does, so a quick mark and a day-view mark are the same ledger row,
 * with the same toast and Undo. It appears only when a timetable is saved.
 */
import { CalendarCheck2, Check, X } from 'lucide-react';
import { useState } from 'react';
import { toast } from '../../components/ui/feedback.js';
import { BottomSheet } from '../../components/ui/sheet.js';
import { weekdayOf } from '../../domain/day-schedule.js';
import { displayTitle, resolveSubject } from '../../domain/subjects.js';
import { timetableEntry } from '../../domain/timetable-import.js';
import { slotClassId } from '../../domain/timetable-identity.js';
import type { TimetableSlot } from '../../domain/types.js';
import { useTimetable } from '../../hooks/useCollection.js';
import { useMarkClass, type MarkState } from '../../hooks/useMarkClass.js';
import { useNow } from '../../hooks/useNow.js';
import { useSubjectIndex } from '../../hooks/useSubjectIndex.js';
import { cn } from '../../lib/cn.js';

export function QuickAttendance() {
  const { items } = useTimetable();
  const { index } = useSubjectIndex();
  const marking = useMarkClass();
  const today = useNow().today;
  const [open, setOpen] = useState(false);

  if (items.length === 0) return null;

  const weekday = weekdayOf(today);
  const classes = items
    .filter((slot) => slot.day === weekday && slot.subjectCode !== null)
    .sort((a, b) => a.startTime.localeCompare(b.startTime));
  const titleOf = (code: string): string =>
    displayTitle(resolveSubject(index, code), 'timetable') || code;
  const stateOf = (slot: TimetableSlot): MarkState => marking.stateOf(today, slotClassId(slot));
  const unmarked = classes.filter((slot) => stateOf(slot) === 'unmarked').length;

  const mark = (slot: TimetableSlot, outcome: 'attended' | 'missed'): void => {
    const before = stateOf(slot);
    const next: MarkState = before === outcome ? 'unmarked' : outcome;
    const code = timetableEntry(slot, null).attendanceCode;
    if (code === null) return;
    const klass = {
      classId: slotClassId(slot),
      date: today,
      subjectCode: code,
      subjectTitle: titleOf(code),
      startTime: slot.startTime,
      endTime: slot.endTime,
    };
    void marking.set(klass, next).then((result) => {
      if (!result.ok) {
        toast(result.reason, { tone: 'warning' });
        return;
      }
      if (next === 'unmarked') return;
      toast(`Recorded ${code} ${next}.`, {
        tone: next === 'attended' ? 'success' : 'warning',
        action: { label: 'Undo', onClick: () => void marking.set(klass, before) },
      });
    });
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`Log today's attendance${unmarked > 0 ? `, ${String(unmarked)} not marked` : ''}`}
        className="gt-primary fixed right-4 bottom-[calc(5.5rem+var(--gt-safe-bottom))] z-30 grid size-14 place-items-center rounded-full active:scale-[0.96] md:right-6 md:bottom-6"
      >
        <CalendarCheck2 className="size-6" aria-hidden="true" />
        {unmarked > 0 && (
          <span
            aria-hidden="true"
            className="absolute -top-1 -right-1 grid min-w-5 place-items-center rounded-full bg-danger px-1 text-[12px] leading-5 font-semibold text-white"
          >
            {unmarked}
          </span>
        )}
      </button>

      <BottomSheet open={open} onOpenChange={setOpen} title="Today's attendance">
        <div className="flex flex-col gap-3 px-4 pt-2 pb-[calc(1rem+var(--gt-safe-bottom))]">
          <h2 className="text-[17px] font-semibold text-ink">Today&apos;s attendance</h2>
          {classes.length === 0 ? (
            <p className="text-[13px] text-ink-2">No classes on your timetable today.</p>
          ) : (
            <ul className="gt-surface flex flex-col divide-y divide-line overflow-hidden rounded-xl border border-line">
              {classes.map((slot) => {
                const state = stateOf(slot);
                const code = slot.subjectCode ?? '';
                return (
                  <li key={slot.id} className="flex min-h-14 items-center gap-3 px-3 py-2.5">
                    <span className="w-12 shrink-0 text-[12px] text-ink-2 tabular-nums">
                      {slot.startTime}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[14px] leading-snug font-medium text-ink">
                        {titleOf(code)}
                      </span>
                      <span className="block text-[12px] text-ink-2">
                        {[code, slot.room].filter(Boolean).join(' · ')}
                      </span>
                    </span>
                    <span className="flex shrink-0 gap-1.5">
                      {(['attended', 'missed'] as const).map((outcome) => (
                        <button
                          key={outcome}
                          type="button"
                          aria-pressed={state === outcome}
                          aria-label={`Mark ${code} ${outcome}`}
                          onClick={() => mark(slot, outcome)}
                          className={cn(
                            'gt-control grid size-11 place-items-center rounded-lg border border-line',
                            state === outcome &&
                              (outcome === 'attended'
                                ? 'bg-success-weak text-success'
                                : 'bg-warning-weak text-warning'),
                          )}
                        >
                          {outcome === 'attended' ? (
                            <Check className="size-5" aria-hidden="true" />
                          ) : (
                            <X className="size-5" aria-hidden="true" />
                          )}
                        </button>
                      ))}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </BottomSheet>
    </>
  );
}
