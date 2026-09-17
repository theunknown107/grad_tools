/**
 * Timetable — the design's week grid and day focus.
 *
 * On today's view each class can be marked attended or missed; the mark moves
 * that course's attendance counters (and can be undone). Holidays from an
 * imported academic calendar replace the day. Classes are added, edited and
 * removed here, or imported from Add document.
 */

import { Coffee, MapPin, Pencil, Plus, Trash2 } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Badge } from '../../components/ui/badge.js';
import { Button, IconButton } from '../../components/ui/button.js';
import { Card, CardHeader, CardRows } from '../../components/ui/card.js';
import { Dialog, DialogBody, DialogContent } from '../../components/ui/dialog.js';
import { Callout, EmptyState, toast } from '../../components/ui/feedback.js';
import { Field, Input, Select } from '../../components/ui/field.js';
import { PageHeader } from '../../components/ui/page.js';
import { ChipGroup, Segmented } from '../../components/ui/segmented.js';
import { PageSkeleton } from '../../components/ui/skeleton.js';
import {
  applyDelta,
  countDelta,
  markFor,
  markId,
  staleMarks,
  startRecord,
  type ClassOutcome,
} from '../../domain/attendance.js';
import { activeCalendars, holidayOn, type CalendarEvent } from '../../domain/calendar-import.js';
import { asStudentProfileId } from '../../domain/identity.js';
import { displayTitle, resolveSubject } from '../../domain/subjects.js';
import { timetableEntry, type TimetableEntry } from '../../domain/timetable-import.js';
import {
  WEEKDAYS,
  type AttendanceRecord,
  type TimetableSlot,
  type Weekday,
} from '../../domain/types.js';
import {
  useAttendance,
  useCalendars,
  useClassMarks,
  useProfile,
  useSemesterSubjects,
  useTimetable,
  useTimetableImports,
} from '../../hooks/useCollection.js';
import { useSubjectIndex } from '../../hooks/useSubjectIndex.js';
import { cn } from '../../lib/cn.js';
import { formatCount, formatDay, formatTime, localDay } from '../../lib/format.js';
import { newId } from '../../lib/id.js';

const DAY_NAME: Record<Weekday, string> = {
  Mon: 'Monday',
  Tue: 'Tuesday',
  Wed: 'Wednesday',
  Thu: 'Thursday',
  Fri: 'Friday',
  Sat: 'Saturday',
};

type Kind = 'course' | 'activity' | 'break';

function kindOf(entry: TimetableEntry): Kind {
  if (entry.isCourse) return 'course';
  return /\b(break|lunch|recess|interval)\b/i.test(entry.name) ? 'break' : 'activity';
}

const KIND_BAR: Record<Kind, string> = {
  course: 'bg-chart-1',
  activity: 'bg-warning',
  break: 'bg-line-strong',
};
const KIND_LABEL: Record<Kind, string> = { course: 'Course', activity: 'Activity', break: 'Break' };

function sortSlots(slots: readonly TimetableSlot[]): TimetableSlot[] {
  return [...slots].sort((a, b) => a.startTime.localeCompare(b.startTime));
}

function todayWeekday(): Weekday {
  const index = new Date().getDay();
  return WEEKDAYS[index === 0 ? 0 : index - 1] ?? 'Mon';
}

type View = 'week' | 'day';

export function TimetablePage() {
  const { items, loading, save, remove } = useTimetable();
  const { profile } = useProfile();
  const { index } = useSubjectIndex();
  const { items: attendance, save: saveAttendance } = useAttendance();
  const { items: marks, save: saveMark, remove: removeMark } = useClassMarks();
  const { items: calendars } = useCalendars();
  const { items: imports } = useTimetableImports();
  const { items: semesterSubjects } = useSemesterSubjects();

  const today = localDay();
  const todayName = new Date().getDay() === 0 ? null : todayWeekday();
  const holiday = holidayOn(activeCalendars(calendars), today);
  const [view, setView] = useState<View>('week');
  const [activeDay, setActiveDay] = useState<Weekday>(todayWeekday);
  const [editing, setEditing] = useState<TimetableSlot | 'new' | null>(null);

  /*
   * Marks decided in this session, ahead of the repository catching up, so a
   * quick second tap reads the first tap's outcome rather than a stale one.
   */
  const decided = useRef(new Map<string, ClassOutcome | null>());
  const counted = useRef(new Map<string, AttendanceRecord>());

  const byDay = useMemo(() => {
    const map = new Map<Weekday, TimetableSlot[]>();
    for (const weekday of WEEKDAYS)
      map.set(weekday, sortSlots(items.filter((slot) => slot.day === weekday)));
    return map;
  }, [items]);

  const source = useMemo(() => {
    const sorted = [...imports].sort((a, b) => b.importedAt.localeCompare(a.importedAt));
    const active = sorted[0];
    if (active === undefined) return null;
    const later =
      sorted.find(
        (candidate) =>
          candidate.id !== active.id &&
          candidate.effectiveFrom !== null &&
          (active.effectiveFrom === null || candidate.effectiveFrom > active.effectiveFrom),
      ) ?? null;
    return { active, later };
  }, [imports]);

  if (loading) return <PageSkeleton label="Loading your timetable" />;

  const titleFor = (code: string): string => displayTitle(resolveSubject(index, code), 'timetable');
  const profileId = profile?.id ?? asStudentProfileId('local');

  const outcomeOf = (slotId: string): ClassOutcome | null => {
    const pending = decided.current.get(markId(today, slotId));
    return pending !== undefined ? pending : (markFor(marks, today, slotId)?.outcome ?? null);
  };
  const recordFor = (code: string): AttendanceRecord | undefined =>
    counted.current.get(code) ??
    attendance.find((record) => record.subjectCode.replace(/\s+/g, '').toUpperCase() === code);

  const setOutcome = (slot: TimetableSlot, next: ClassOutcome | null): void => {
    const before = outcomeOf(slot.id);
    if (before === next) return;
    const id = markId(today, slot.id);
    decided.current.set(id, next);
    const entry = timetableEntry(slot, null);
    const code = entry.attendanceCode?.replace(/\s+/g, '').toUpperCase() ?? null;
    const existing = code === null ? undefined : recordFor(code);
    const delta = countDelta(before, next);
    if (code !== null && existing !== undefined) {
      const updated = applyDelta(existing, delta);
      counted.current.set(code, updated);
      void saveAttendance(updated);
    } else if (code !== null && next !== null) {
      const created = startRecord(
        {
          id: newId(),
          profileId,
          semester: profile?.currentSemester ?? 1,
          subjectCode: code,
          subjectTitle: displayTitle(resolveSubject(index, code), 'timetable') || code,
        },
        next,
      );
      counted.current.set(code, created);
      void saveAttendance(created);
    }
    if (next === null) {
      void removeMark(id);
      return;
    }
    void saveMark({
      id,
      profileId,
      date: today,
      slotId: slot.id,
      subjectCode: code ?? entry.name,
      outcome: next,
      markedAt: new Date().toISOString(),
    });
    for (const stale of staleMarks(marks, today)) void removeMark(stale.id);
    toast(`Recorded ${entry.shortName} ${next}.`, {
      tone: next === 'attended' ? 'success' : 'warning',
      action: { label: 'Undo', onClick: () => setOutcome(slot, null) },
    });
  };

  const eyebrow =
    [
      profile?.branch ?? null,
      source?.active.semester !== null && source?.active.semester !== undefined
        ? `Semester ${String(source.active.semester)}`
        : profile?.currentSemester !== null && profile?.currentSemester !== undefined
          ? `Semester ${String(profile.currentSemester)}`
          : null,
      source?.active.className ?? null,
    ]
      .filter((part): part is string => part !== null && part !== '')
      .join(' · ') || 'Weekly schedule';
  const emptyDays = WEEKDAYS.filter((weekday) => (byDay.get(weekday) ?? []).length === 0);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow={eyebrow}
        title="Timetable"
        description="Your weekly schedule, stored on this device. Mark today's classes as they happen and attendance follows."
        actions={
          <>
            {items.length > 0 && (
              <Segmented<View>
                label="Timetable view"
                value={view}
                onChange={setView}
                options={[
                  { value: 'week', label: 'Week' },
                  { value: 'day', label: 'Day' },
                ]}
              />
            )}
            <Button variant="primary" icon={<Plus />} onClick={() => setEditing('new')}>
              Add class
            </Button>
          </>
        }
      />

      {source !== null && items.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          {source.active.className !== null && <Badge>{source.active.className}</Badge>}
          {source.active.revision !== null && <Badge>{source.active.revision}</Badge>}
          {source.active.effectiveFrom !== null && (
            <Badge>from {formatDay(source.active.effectiveFrom)}</Badge>
          )}
          {source.active.batch !== null && <Badge tone="accent">Batch {source.active.batch}</Badge>}
        </div>
      )}
      {source?.active.effectiveFrom !== null &&
        source !== null &&
        source.active.effectiveFrom > today && (
          <Callout>These classes take effect on {formatDay(source.active.effectiveFrom)}.</Callout>
        )}
      {source !== null && source.later !== null && (
        <Callout tone="warning">
          A timetable effective {formatDay(source.later.effectiveFrom ?? '')} was also imported.
          These classes came from the one imported most recently
          {source.active.revision !== null ? ` (${source.active.revision})` : ''}.
        </Callout>
      )}

      {items.length === 0 ? (
        <EmptyState
          icon={<Plus />}
          title="No classes yet"
          description="Add your weekly classes, or import a timetable, and your week appears here day by day."
          actions={
            <>
              <Button variant="primary" icon={<Plus />} onClick={() => setEditing('new')}>
                Add a class
              </Button>
              <Button asChild>
                <Link to="/import">Import a timetable</Link>
              </Button>
            </>
          }
        />
      ) : (
        <>
          <div
            className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[12px] text-ink-2"
            aria-label="Legend"
          >
            {(['course', 'activity', 'break'] as const).map((kind) => (
              <span key={kind} className="inline-flex items-center gap-1.5">
                <span aria-hidden="true" className={cn('size-2.5 rounded-sm', KIND_BAR[kind])} />{' '}
                {KIND_LABEL[kind]}
              </span>
            ))}
          </div>

          {emptyDays.length > 0 && emptyDays.length < WEEKDAYS.length && (
            <p className="text-[12px] text-ink-3">
              {emptyDays.length === 1
                ? `${DAY_NAME[emptyDays[0] as Weekday]} has no classes in this record.`
                : `${emptyDays
                    .slice(0, -1)
                    .map((weekday) => DAY_NAME[weekday])
                    .join(
                      ', ',
                    )} and ${DAY_NAME[emptyDays[emptyDays.length - 1] as Weekday]} have no classes in this record.`}{' '}
              A day with nothing on it and a day the importer could not read look the same here —
              check it against your printed timetable.
            </p>
          )}

          {view === 'week' ? (
            <WeekGrid
              byDay={byDay}
              titleFor={titleFor}
              todayName={todayName}
              onPick={(weekday) => {
                setActiveDay(weekday);
                setView('day');
              }}
            />
          ) : (
            <>
              <ChipGroup<Weekday>
                label="Day"
                shape="tile"
                value={activeDay}
                onChange={setActiveDay}
                options={WEEKDAYS.map((weekday) => ({
                  value: weekday,
                  label: weekday === todayName ? `${weekday} · today` : weekday,
                }))}
              />
              <DayFocus
                day={activeDay}
                slots={byDay.get(activeDay) ?? []}
                titleFor={titleFor}
                {...(activeDay === todayName ? { outcomeOf, onMark: setOutcome, holiday } : {})}
                onEdit={(slot) => setEditing(slot)}
                onRemove={(slot) => {
                  void remove(slot.id);
                  toast('Class removed', {
                    action: { label: 'Undo', onClick: () => void save(slot) },
                  });
                }}
              />
            </>
          )}
        </>
      )}

      <ClassDialog
        editing={editing}
        subjects={semesterSubjects}
        profileId={profileId}
        onClose={() => setEditing(null)}
        onSave={(slot, isNew) => {
          void save(slot);
          toast(isNew ? 'Class added' : 'Class updated', { tone: 'success' });
          setEditing(null);
        }}
      />
    </div>
  );
}

/* ---------------------------------------------------------------- Week */

function WeekGrid({
  byDay,
  titleFor,
  todayName,
  onPick,
}: {
  readonly byDay: ReadonlyMap<Weekday, readonly TimetableSlot[]>;
  readonly titleFor: (code: string) => string;
  readonly todayName: Weekday | null;
  readonly onPick: (day: Weekday) => void;
}) {
  return (
    <ol className="grid gap-4 lg:grid-cols-6 lg:gap-3">
      {WEEKDAYS.map((weekday) => {
        const slots = byDay.get(weekday) ?? [];
        const sessions = slots.filter((slot) => slot.subjectCode !== null).length;
        return (
          <li key={weekday} className="flex min-w-0 flex-col gap-2">
            <button
              type="button"
              onClick={() => onPick(weekday)}
              className="group flex items-center justify-between rounded-md text-left lg:flex-col lg:items-start"
              aria-label={`Open ${DAY_NAME[weekday]}${weekday === todayName ? ' (today)' : ''}`}
            >
              <span
                className={cn(
                  'text-[13px] font-semibold transition-colors group-hover:text-accent-ink',
                  weekday === todayName && 'text-accent-ink',
                )}
              >
                {DAY_NAME[weekday]}
                {weekday === todayName && (
                  <span className="ml-1.5 align-middle font-mono text-[10px] text-ink-3 uppercase">
                    today
                  </span>
                )}
              </span>
              <span className="font-mono text-[10px] tracking-wide text-ink-3 uppercase">
                {sessions === 0 ? 'None' : formatCount(sessions, 'session')}
              </span>
            </button>
            <div className="flex flex-col gap-1.5">
              {slots.length === 0 ? (
                <p className="rounded-lg border border-dashed border-line px-2.5 py-2 text-[11px] text-ink-3">
                  Nothing recorded.
                </p>
              ) : (
                slots.map((slot) => (
                  <SessionChip
                    key={slot.id}
                    slot={slot}
                    entry={timetableEntry(
                      slot,
                      slot.subjectCode === null ? null : titleFor(slot.subjectCode),
                    )}
                  />
                ))
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function SessionChip({
  slot,
  entry,
}: {
  readonly slot: TimetableSlot;
  readonly entry: TimetableEntry;
}) {
  const kind = kindOf(entry);
  if (kind === 'break') {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-dashed border-line bg-panel px-2.5 py-1.5 text-[11px] text-ink-3">
        <Coffee className="size-3.5 shrink-0" aria-hidden="true" />
        <span className="font-mono">{slot.startTime}</span>
        <span className="truncate">{entry.name}</span>
      </div>
    );
  }
  return (
    <article className="relative overflow-hidden rounded-lg border border-line bg-raised p-2.5 transition-colors hover:border-line-strong">
      <span
        aria-hidden="true"
        className={cn('absolute top-2 bottom-2 left-0 w-[3px] rounded-full', KIND_BAR[kind])}
      />
      <div className="pl-2">
        <div className="flex items-center justify-between gap-1">
          <span className="font-mono text-[10px] text-ink-3">
            {slot.startTime}–{slot.endTime}
          </span>
        </div>
        <div className="mt-1 line-clamp-2 text-[12px] leading-tight font-medium" title={entry.name}>
          {entry.isCourse ? entry.shortName : entry.name}
        </div>
        <div className="truncate text-[11px] text-ink-3">
          {slot.room ?? (entry.isCourse ? entry.name : '')}
        </div>
      </div>
    </article>
  );
}

/* ----------------------------------------------------------------- Day */

function DayFocus({
  day,
  slots,
  titleFor,
  outcomeOf,
  holiday,
  onMark,
  onEdit,
  onRemove,
}: {
  readonly day: Weekday;
  readonly slots: readonly TimetableSlot[];
  readonly titleFor: (code: string) => string;
  readonly outcomeOf?: ((slotId: string) => ClassOutcome | null) | undefined;
  readonly holiday?: CalendarEvent | null | undefined;
  readonly onMark?: ((slot: TimetableSlot, outcome: ClassOutcome | null) => void) | undefined;
  readonly onEdit: (slot: TimetableSlot) => void;
  readonly onRemove: (slot: TimetableSlot) => void;
}) {
  const now = new Date();
  const clock = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const isToday = onMark !== undefined;
  const next = isToday ? slots.find((slot) => slot.endTime > clock) : undefined;

  if (holiday !== null && holiday !== undefined) {
    return (
      <Card>
        <EmptyState
          compact
          icon={<Coffee />}
          title="No classes today"
          description={`${holiday.title} — from your academic calendar.`}
        />
      </Card>
    );
  }

  return (
    <Card className="overflow-hidden">
      <CardHeader
        title={`${DAY_NAME[day]}${isToday ? ' · today' : ''}`}
        action={
          <span className="font-mono text-[11px] text-ink-3">
            {slots.length === 0 ? 'No sessions' : formatCount(slots.length, 'session')}
          </span>
        }
      />
      {slots.length === 0 ? (
        <EmptyState
          compact
          icon={<Plus />}
          title={`Nothing recorded for ${DAY_NAME[day]}`}
          description={
            isToday
              ? 'Classes you add for today appear here.'
              : 'Either there are no classes on this day, or the imported timetable did not include them.'
          }
        />
      ) : (
        <CardRows>
          {slots.map((slot) => {
            const entry = timetableEntry(
              slot,
              slot.subjectCode === null ? null : titleFor(slot.subjectCode),
            );
            const kind = kindOf(entry);
            const outcome = outcomeOf?.(slot.id) ?? null;
            const isNow = isToday && slot.startTime <= clock && clock < slot.endTime;
            const muted = kind === 'break';
            const label = `${entry.shortName} on ${slot.day} at ${formatTime(slot.startTime)}`;
            return (
              <div
                key={slot.id}
                aria-current={isNow ? 'time' : undefined}
                className={cn(
                  'flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3.5',
                  muted && 'bg-panel',
                  slot.id === next?.id && !muted && 'bg-accent-weak/30',
                )}
              >
                <div className="w-24 shrink-0 font-mono text-[11px] text-ink-3 tabular-nums">
                  {formatTime(slot.startTime)}–{formatTime(slot.endTime)}
                  {isNow && (
                    <Badge tone="accent" className="mt-1">
                      Now
                    </Badge>
                  )}
                </div>
                <span
                  aria-hidden="true"
                  className={cn('h-10 w-[3px] shrink-0 rounded-full', KIND_BAR[kind])}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={cn('truncate text-[14px] font-medium', muted && 'text-ink-3')}>
                      {entry.name}
                    </span>
                    {!muted && <Badge>{KIND_LABEL[kind]}</Badge>}
                    {outcome !== null && (
                      <Badge tone={outcome === 'attended' ? 'success' : 'warning'}>
                        {outcome === 'attended' ? 'Attended' : 'Missed'}
                      </Badge>
                    )}
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-1 text-[12px] text-ink-3">
                    {entry.detail !== null && <span className="font-mono">{entry.detail}</span>}
                    {slot.room !== null && (
                      <>
                        {entry.detail !== null && <span aria-hidden="true">·</span>}
                        <MapPin className="size-3" aria-hidden="true" /> {slot.room}
                      </>
                    )}
                    {slot.faculty !== null && <span>· {slot.faculty}</span>}
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  {onMark !== undefined && entry.isCourse && (
                    <>
                      <Button
                        size="sm"
                        aria-pressed={outcome === 'attended'}
                        aria-label={`Mark ${entry.shortName} attended`}
                        className={cn(
                          outcome === 'attended' &&
                            'border-success/40 bg-success-weak text-success',
                        )}
                        onClick={() => onMark(slot, 'attended')}
                      >
                        Attended
                      </Button>
                      <Button
                        size="sm"
                        aria-pressed={outcome === 'missed'}
                        aria-label={`Mark ${entry.shortName} missed`}
                        className={cn(
                          outcome === 'missed' && 'border-warning/40 bg-warning-weak text-warning',
                        )}
                        onClick={() => onMark(slot, 'missed')}
                      >
                        Missed
                      </Button>
                    </>
                  )}
                  <IconButton size="sm" label={`Edit ${label}`} onClick={() => onEdit(slot)}>
                    <Pencil />
                  </IconButton>
                  <IconButton
                    size="sm"
                    label={`Remove ${label}`}
                    className="hover:text-danger"
                    onClick={() => onRemove(slot)}
                  >
                    <Trash2 />
                  </IconButton>
                </div>
              </div>
            );
          })}
        </CardRows>
      )}
    </Card>
  );
}

/* ------------------------------------------------------------ Add / edit */

function ClassDialog({
  editing,
  subjects,
  profileId,
  onClose,
  onSave,
}: {
  readonly editing: TimetableSlot | 'new' | null;
  readonly subjects: readonly {
    readonly id: string;
    readonly code: string;
    readonly title: string;
  }[];
  readonly profileId: ReturnType<typeof asStudentProfileId>;
  readonly onClose: () => void;
  readonly onSave: (slot: TimetableSlot, isNew: boolean) => void;
}) {
  const open = editing !== null;
  const existing = editing === 'new' ? null : editing;
  return (
    <Dialog open={open} onOpenChange={(value) => !value && onClose()}>
      {open && (
        <DialogContent
          title={existing === null ? 'Add a class' : 'Edit class'}
          description="A coded course, or a scheduled hour that is not one (placement training, a break)."
        >
          <DialogBody>
            <ClassForm
              key={existing?.id ?? 'new'}
              existing={existing}
              subjects={subjects}
              profileId={profileId}
              onCancel={onClose}
              onSave={onSave}
            />
          </DialogBody>
        </DialogContent>
      )}
    </Dialog>
  );
}

function ClassForm({
  existing,
  subjects,
  profileId,
  onCancel,
  onSave,
}: {
  readonly existing: TimetableSlot | null;
  readonly subjects: readonly {
    readonly id: string;
    readonly code: string;
    readonly title: string;
  }[];
  readonly profileId: ReturnType<typeof asStudentProfileId>;
  readonly onCancel: () => void;
  readonly onSave: (slot: TimetableSlot, isNew: boolean) => void;
}) {
  const [day, setDay] = useState<Weekday>(existing?.day ?? todayWeekday());
  const [startTime, setStartTime] = useState(existing?.startTime ?? '09:00');
  const [endTime, setEndTime] = useState(existing?.endTime ?? '10:00');
  const [subjectCode, setSubjectCode] = useState(existing?.subjectCode ?? '');
  const [activityName, setActivityName] = useState(existing?.activity ?? '');
  const [room, setRoom] = useState(existing?.room ?? '');
  const [faculty, setFaculty] = useState(existing?.faculty ?? '');
  const [error, setError] = useState<string | null>(null);

  const submit = (): void => {
    const code = subjectCode.trim().toUpperCase();
    const named = activityName.trim();
    if (code === '' && named === '')
      return setError('Enter a subject code, or a name for the activity.');
    if (code !== '' && named !== '')
      return setError('Give a subject code or an activity name, not both.');
    if (endTime <= startTime) return setError('The end time must be after the start time.');
    setError(null);
    onSave(
      {
        id: existing?.id ?? newId(),
        profileId: existing?.profileId ?? profileId,
        day,
        startTime,
        endTime,
        subjectCode: code === '' ? null : code,
        activity: code === '' ? named : null,
        room: room.trim() === '' ? null : room.trim(),
        faculty: faculty.trim() === '' ? null : faculty.trim(),
      },
      existing === null,
    );
  };

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
      className="flex flex-col gap-4"
    >
      <div className="grid grid-cols-3 gap-3">
        <Field label="Day">
          <Select
            value={day}
            onValueChange={(value) => setDay(value as Weekday)}
            options={WEEKDAYS.map((weekday) => ({ value: weekday, label: DAY_NAME[weekday] }))}
          />
        </Field>
        <Field label="Starts">
          <Input
            type="time"
            value={startTime}
            onChange={(event) => setStartTime(event.target.value)}
          />
        </Field>
        <Field label="Ends">
          <Input type="time" value={endTime} onChange={(event) => setEndTime(event.target.value)} />
        </Field>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Subject code">
          <Input
            className="font-mono"
            placeholder="BCS304"
            list="timetable-subject-codes"
            value={subjectCode}
            onChange={(event) => setSubjectCode(event.target.value)}
          />
        </Field>
        <datalist id="timetable-subject-codes">
          {subjects.map((subject) => (
            <option key={subject.id} value={subject.code}>
              {subject.title}
            </option>
          ))}
        </datalist>
        <Field
          label="Or an activity"
          hint="For an hour that is scheduled but is not a coded course."
        >
          <Input
            placeholder="Placement & Training"
            value={activityName}
            onChange={(event) => setActivityName(event.target.value)}
          />
        </Field>
        <Field label="Room" optional>
          <Input
            placeholder="A-204"
            value={room}
            onChange={(event) => setRoom(event.target.value)}
          />
        </Field>
        <Field label="Faculty" optional>
          <Input
            placeholder="Prof. Kulkarni"
            value={faculty}
            onChange={(event) => setFaculty(event.target.value)}
          />
        </Field>
      </div>
      {error !== null && (
        <Callout tone="danger" role="alert">
          {error}
        </Callout>
      )}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" icon={existing === null ? <Plus /> : <Pencil />}>
          {existing === null ? 'Add class' : 'Save changes'}
        </Button>
      </div>
    </form>
  );
}
