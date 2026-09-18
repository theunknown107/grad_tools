/**
 * One day's classes, with the control that records them.
 *
 * This is the screen the product is opened for: what is on, what has already
 * happened, and one tap per class. Today is this view with the date the clock
 * says; any other date is the same view, which is how a student catches up on
 * a class they forgot to mark.
 *
 * Only a teaching hour gets a control. Breaks, activities, explicitly
 * unscheduled hours and corrupt rows say what they are and offer nothing —
 * marking one would put an hour nobody taught into the denominator.
 */

import { Ban, CalendarOff, Coffee, CircleAlert, Clock } from 'lucide-react';
import { Badge, type Tone } from '../../components/ui/badge.js';
import { Card, CardHeader, CardRows } from '../../components/ui/card.js';
import { Callout, EmptyState, toast } from '../../components/ui/feedback.js';
import { Row } from '../../components/ui/page.js';
import { effectiveDay, type EffectiveClass } from '../../domain/day-schedule.js';
import { timetableEntry } from '../../domain/timetable-import.js';
import type { DayOverride, SlotKind, TimetableSlot } from '../../domain/types.js';
import { timingOf, type ClassTiming } from '../../hooks/useNow.js';
import { useMarkClass, type MarkState } from '../../hooks/useMarkClass.js';
import { cn } from '../../lib/cn.js';
import { AttendanceControl } from './AttendanceControl.js';

const KIND_LABEL: Record<SlotKind, string> = {
  course: 'Course',
  activity: 'Activity',
  break: 'Break',
  unscheduled: 'No class',
};

const TIMING_LABEL: Record<ClassTiming, string> = {
  past: 'Earlier today',
  now: 'On now',
  upcoming: 'Still to come',
};

const STATE_TONE: Record<Exclude<MarkState, 'unmarked'>, Tone> = {
  attended: 'success',
  missed: 'danger',
  cancelled: 'neutral',
};

export function DayView({
  date,
  time,
  slots,
  overrides,
  titleFor,
  /** Today's list groups itself around the clock; another date does not. */
  showTiming = false,
  emptyTitle = 'Nothing scheduled',
  emptyDescription = 'There are no classes on your timetable for this day.',
}: {
  readonly date: string;
  readonly time: string;
  readonly slots: readonly TimetableSlot[];
  readonly overrides: readonly DayOverride[];
  readonly titleFor: (code: string) => string | null;
  readonly showTiming?: boolean;
  readonly emptyTitle?: string;
  readonly emptyDescription?: string;
}) {
  const classes = effectiveDay(date, slots, overrides);

  if (classes.length === 0) {
    return (
      <Card className="p-5">
        <EmptyState
          compact
          icon={<CalendarOff />}
          title={emptyTitle}
          description={emptyDescription}
        />
      </Card>
    );
  }

  const groups: readonly { timing: ClassTiming; classes: readonly EffectiveClass[] }[] = showTiming
    ? (['now', 'upcoming', 'past'] as const)
        .map((timing) => ({
          timing,
          classes: classes.filter((entry) => timingOf(entry, time) === timing),
        }))
        .filter((group) => group.classes.length > 0)
    : [{ timing: 'now' as const, classes }];

  return (
    <div className="flex flex-col gap-4">
      {groups.map((group) => (
        <Card key={group.timing} className="overflow-hidden">
          {showTiming && <CardHeader title={TIMING_LABEL[group.timing]} />}
          <CardRows>
            {group.classes.map((entry) => (
              <ClassRow key={entry.classId} entry={entry} date={date} titleFor={titleFor} />
            ))}
          </CardRows>
        </Card>
      ))}
    </div>
  );
}

function ClassRow({
  entry,
  date,
  titleFor,
}: {
  readonly entry: EffectiveClass;
  readonly date: string;
  readonly titleFor: (code: string) => string | null;
}) {
  const { stateOf, set } = useMarkClass();
  const state = stateOf(date, entry.classId);
  const named = timetableEntry(
    entry,
    entry.subjectCode === null ? null : titleFor(entry.subjectCode),
  );
  const title = named.name === '' ? KIND_LABEL[entry.kind] : named.name;

  const record = (next: MarkState): void => {
    const previous = state;
    void set(
      {
        classId: entry.classId,
        date,
        subjectCode: entry.subjectCode ?? '',
        subjectTitle: named.isCourse ? named.name : null,
        startTime: entry.startTime,
        endTime: entry.endTime,
      },
      next,
    );
    toast(
      next === 'cancelled'
        ? `${named.shortName} is marked cancelled for this date.`
        : `Recorded ${named.shortName} as ${next}.`,
      {
        tone: next === 'attended' ? 'success' : next === 'missed' ? 'warning' : 'neutral',
        ...(next === 'cancelled'
          ? { description: 'A cancelled class is not counted either way.' }
          : {}),
        action: {
          label: 'Undo',
          onClick: () => {
            void set(
              {
                classId: entry.classId,
                date,
                subjectCode: entry.subjectCode ?? '',
                subjectTitle: named.isCourse ? named.name : null,
                startTime: entry.startTime,
                endTime: entry.endTime,
              },
              previous,
            );
          },
        },
      },
    );
  };

  return (
    <Row className="flex-wrap items-start gap-x-3 gap-y-2 sm:flex-nowrap sm:items-center">
      <time
        dateTime={`${date}T${entry.startTime}`}
        className="w-[5.5rem] shrink-0 font-mono text-[12px] text-ink-3 tabular-nums"
      >
        {entry.startTime}–{entry.endTime}
      </time>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={cn(
              'truncate text-[13px] font-medium text-ink',
              entry.status !== 'scheduled' && 'text-ink-2 line-through decoration-line-strong',
            )}
          >
            {title}
          </span>
          {entry.kind !== 'course' && (
            <Badge tone="neutral" icon={entry.kind === 'break' ? <Coffee /> : undefined}>
              {KIND_LABEL[entry.kind]}
            </Badge>
          )}
          {entry.oneOff && <Badge tone="schedule">This date only</Badge>}
          {entry.status === 'cancelled' && (
            <Badge tone="neutral" icon={<Ban />}>
              Cancelled
            </Badge>
          )}
          {entry.status === 'replaced' && <Badge tone="warning">Replaced</Badge>}
          {state !== 'unmarked' && entry.status === 'scheduled' && (
            <Badge tone={STATE_TONE[state]}>
              {state === 'attended' ? 'Attended' : state === 'missed' ? 'Missed' : 'Cancelled'}
            </Badge>
          )}
        </div>
        {(entry.room !== null || entry.faculty !== null) && (
          <div className="mt-0.5 truncate text-[11px] text-ink-3">
            {[entry.room, entry.faculty].filter((part) => part !== null).join(' · ')}
          </div>
        )}
      </div>

      {entry.degenerate ? (
        <Callout tone="warning" className="w-full sm:w-auto">
          <span className="flex items-center gap-1.5 text-[12px]">
            <CircleAlert className="size-3.5 shrink-0" aria-hidden="true" />
            This class has no valid time and cannot be marked. Edit it to fix the hours.
          </span>
        </Callout>
      ) : entry.kind !== 'course' || entry.subjectCode === null ? (
        <span className="text-[11px] text-ink-3">Not counted</span>
      ) : (
        <div className="w-full sm:w-auto">
          <AttendanceControl value={state} onChange={record} name={named.shortName} />
        </div>
      )}
    </Row>
  );
}

/** The design's live clock line above Today. */
export function NowLine({ date, clock }: { readonly date: string; readonly clock: string }) {
  return (
    <p className="flex items-center gap-2 text-[13px] text-ink-2">
      <Clock className="size-3.5 text-ink-3" aria-hidden="true" />
      <span>{date}</span>
      <span aria-hidden="true">·</span>
      <span className="font-mono tabular-nums" aria-label={`The time is ${clock}`}>
        {clock}
      </span>
    </p>
  );
}
