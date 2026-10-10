/**
 * Any date: what was on, what was recorded, and what to change about it.
 *
 * The calendar is here because attendance is a question about dates and the
 * product could not answer one. Picking a day shows exactly what Today shows,
 * for that day — which is how a student catches up on the class they forgot to
 * mark on Thursday, and how they cancel next Tuesday's lecture the moment the
 * department says so.
 *
 * Every change made here is scoped to THE DATE. The recurring week is edited on
 * the timetable, and both say which they are.
 */

import { CalendarPlus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Button } from '../../components/ui/button.js';
import { Calendar } from '../../components/ui/calendar.js';
import { Card } from '../../components/ui/card.js';
import { Callout, toast } from '../../components/ui/feedback.js';
import { SectionTitle } from '../../components/ui/page.js';
import { effectiveDay, overrideId } from '../../domain/day-schedule.js';
import { asStudentProfileId } from '../../domain/identity.js';
import type {
  ClassOccurrence,
  DayOverride,
  LedgerEntry,
  OneOffClass,
  SemesterSubject,
  StudentProfile,
  TimetableSlot,
} from '../../domain/types.js';
import { useTimetableOverrides } from '../../hooks/useCollection.js';
import { localDay } from '../../hooks/useNow.js';
import { newId } from '../../lib/id.js';
import { ClassForDateDialog, type ClassForDateIntent } from './ClassForDateDialog.js';
import { DayView } from './DayView.js';

/** 'YYYY-MM-DD' without going through UTC, which would shift the day. */
function toDate(date: string): Date {
  return new Date(`${date}T00:00:00`);
}

export function DateView({
  today,
  time,
  slots,
  entries,
  profile,
  subjects,
  titleFor,
}: {
  readonly today: string;
  readonly time: string;
  readonly slots: readonly TimetableSlot[];
  readonly entries: readonly LedgerEntry[];
  readonly profile: StudentProfile | null;
  readonly subjects: readonly SemesterSubject[];
  readonly titleFor: (code: string) => string | null;
}) {
  const { items: overrides, save: saveOverride, remove: removeOverride } = useTimetableOverrides();
  const [selected, setSelected] = useState(today);
  const [intent, setIntent] = useState<ClassForDateIntent | null>(null);

  const profileId = profile?.id ?? asStudentProfileId('local');
  const onDate = effectiveDay(selected, slots, overrides);

  /* Days that already carry something, so the month says where to look. */
  const marked = useMemo(() => {
    const recorded = new Set(
      entries
        .filter((entry): entry is ClassOccurrence => entry.kind === 'occurrence')
        .map((entry) => entry.date),
    );
    const changed = new Set(overrides.map((override) => override.date));
    return {
      recorded: [...recorded].map(toDate),
      changed: [...changed].filter((date) => !recorded.has(date)).map(toDate),
    };
  }, [entries, overrides]);

  const changed = overrides.filter((override) => override.date === selected);

  const putOverride = async (override: DayOverride): Promise<void> => {
    await saveOverride(override);
  };

  const addForDate = (addition: OneOffClass, decided: ClassForDateIntent): void => {
    const classId = newId();
    const created: DayOverride = {
      id: overrideId(selected, classId),
      profileId,
      date: selected,
      classId,
      status: 'scheduled',
      addition,
      replacedBy: null,
      createdAt: new Date().toISOString(),
    };
    void putOverride(created);

    if (decided.replacing !== null) {
      /*
       * The class being replaced is marked `replaced` — it stops counting and
       * keeps whatever the student recorded against it. The replacement is a
       * DIFFERENT class with its own identity, starting unmarked.
       */
      void putOverride({
        id: overrideId(selected, decided.replacing.classId),
        profileId,
        date: selected,
        classId: decided.replacing.classId,
        status: 'replaced',
        addition: null,
        replacedBy: classId,
        createdAt: new Date().toISOString(),
      });
    }

    setIntent(null);
    toast(
      decided.replacing === null ? 'Class added for this date.' : 'Class replaced for this date.',
      {
        tone: 'success',
        description: 'Your weekly timetable is unchanged.',
      },
    );
  };

  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
      <Card className="shrink-0 p-4">
        <Calendar
          mode="single"
          required
          selected={toDate(selected)}
          onSelect={(date) => {
            if (date !== undefined) setSelected(localDay(date));
          }}
          defaultMonth={toDate(selected)}
          modifiers={{ recorded: marked.recorded, changed: marked.changed }}
          modifiersClassNames={{
            recorded:
              'after:absolute after:bottom-1 after:left-1/2 after:size-1 after:-translate-x-1/2 after:rounded-full after:bg-accent',
            changed:
              'after:absolute after:bottom-1 after:left-1/2 after:size-1 after:-translate-x-1/2 after:rounded-full after:bg-warning',
          }}
        />
        <p className="mt-2 max-w-[17rem] text-[11px] leading-relaxed text-ink-3">
          A dot marks a day you have recorded classes on; an amber dot marks a day whose schedule
          you changed.
        </p>
      </Card>

      <div className="flex min-w-0 flex-1 flex-col gap-4">
        <SectionTitle
          action={
            <Button
              size="sm"
              icon={<CalendarPlus />}
              onClick={() => setIntent({ kind: 'add', replacing: null })}
            >
              Add a class for this date
            </Button>
          }
        >
          {toDate(selected).toLocaleDateString('en-GB', {
            weekday: 'long',
            day: 'numeric',
            month: 'long',
          })}
        </SectionTitle>

        {changed.length > 0 && (
          <Callout>
            This date&rsquo;s schedule has been changed on this device. Date-specific changes stay
            here — they are not synced to your other devices.
          </Callout>
        )}

        <DayView
          date={selected}
          time={selected === today ? time : '23:59'}
          slots={slots}
          overrides={overrides}
          titleFor={titleFor}
          onReplace={(entry) => setIntent({ kind: 'replace', replacing: entry })}
          onRestore={(entry) => {
            void removeOverride(overrideId(selected, entry.classId));
            toast('This date follows your weekly timetable again.');
          }}
          onRemoveForDate={(entry) => {
            void putOverride({
              id: overrideId(selected, entry.classId),
              profileId,
              date: selected,
              classId: entry.classId,
              status: 'removed',
              addition: null,
              replacedBy: null,
              createdAt: new Date().toISOString(),
            });
            toast('Class removed from this date.', {
              description: 'Anything you recorded against it is kept and stops counting.',
            });
          }}
          emptyTitle={slots.length === 0 ? 'No timetable yet' : 'Nothing scheduled'}
          emptyDescription={
            slots.length === 0
              ? 'Import or enter your weekly timetable, and each day’s classes appear here.'
              : 'Your weekly timetable has no classes on this day. You can still add one for this date.'
          }
        />
      </div>

      <ClassForDateDialog
        intent={intent}
        date={selected}
        subjects={subjects}
        onDate={onDate}
        onClose={() => setIntent(null)}
        onSave={addForDate}
      />
    </div>
  );
}
