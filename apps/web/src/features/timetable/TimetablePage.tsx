/**
 * Timetable — the design's week grid and day focus.
 *
 * On today's view each class can be marked attended or missed; the mark moves
 * that course's attendance counters (and can be undone). Holidays from an
 * imported academic calendar replace the day. Classes are added, edited and
 * removed here, or imported from Add document.
 */

import {
  Ban,
  Check,
  Coffee,
  Eraser,
  MapPin,
  MoreHorizontal,
  Pencil,
  Plus,
  Trash2,
  X,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Badge } from '../../components/ui/badge.js';
import { Button, IconButton } from '../../components/ui/button.js';
import { Card, CardHeader, CardRows } from '../../components/ui/card.js';
import { Dialog, DialogBody, DialogContent } from '../../components/ui/dialog.js';
import { Callout, EmptyState, toast } from '../../components/ui/feedback.js';
import { Field, Input, Select } from '../../components/ui/field.js';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../../components/ui/menu.js';
import { PageHeader } from '../../components/ui/page.js';
import { ChipGroup, Segmented } from '../../components/ui/segmented.js';
import { PageSkeleton } from '../../components/ui/skeleton.js';
import { activeCalendars, holidayOn, type CalendarEvent } from '../../domain/calendar-import.js';
import { weekdayOf } from '../../domain/day-schedule.js';
import { slotClassId } from '../../domain/timetable-identity.js';
import { asStudentProfileId } from '../../domain/identity.js';
import { displayTitle, resolveSubject } from '../../domain/subjects.js';
import { timetableEntry, type TimetableEntry } from '../../domain/timetable-import.js';
import { WEEKDAYS, type TimetableSlot, type Weekday } from '../../domain/types.js';
import {
  useCalendars,
  useProfile,
  useSemesterSubjects,
  useTimetable,
  useTimetableImports,
} from '../../hooks/useCollection.js';
import { useMarkClass, type MarkState } from '../../hooks/useMarkClass.js';
import { useNow } from '../../hooks/useNow.js';
import { useSubjectIndex } from '../../hooks/useSubjectIndex.js';
import { cn } from '../../lib/cn.js';
import { branchCode, formatCount, formatDay, formatTime } from '../../lib/format.js';
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

/*
 * In the week grid a session is a TINT OF THE GRID, not a card placed on it.
 *
 * The grid's hour rules and the today column carry the structure; a session
 * only has to say what occupies that span. So it is a tonal fill with a 2px
 * kind edge and no border, radius or shadow. Both tints are the design
 * system's own `-weak` tokens, which are defined for light and dark, so
 * nothing here invents a colour.
 *
 * THE EDGE IS A FILL, NOT A BORDER. `styles/index.css` sets `border-color`
 * on every element in an UNLAYERED rule, deliberately, so that coloured
 * border utilities render as the neutral hairline: the design carries state
 * with fills, rings and text. A `border-l-2 border-chart-1` edge therefore
 * paints in the hairline colour and is invisible — measured, not assumed. The
 * edge is a 2px span painted with `KIND_BAR`, the same fills the legend uses.
 */
const KIND_TINT: Record<Kind, string> = {
  course: 'bg-accent-weak',
  activity: 'bg-warning-weak',
  break: 'bg-sunken',
};

/**
 * How much a session can show, decided by its drawn height.
 *
 * THE CONTENT ALWAYS FITS. The previous chip stacked time, a two-line title
 * and the room: 83px of content in a 72px one-hour cell, so `overflow-hidden`
 * silently cut the room off whenever a title wrapped. Budgets at 6px per five
 * minutes, with 12px of vertical padding:
 *
 *   tall   >= 60 min (>= 72px)  two-line title + time and room   58px
 *   medium 40-59 min (48-70px)  one-line title + time and room   43px
 *   short  <  40 min (< 48px)   one line, vertically centred     ~13px
 *
 * Anything that still does not fit horizontally ends in a visible ellipsis,
 * and the article's accessible name always carries all four facts.
 *
 * ponytail: a session under ~11 minutes cannot hold even one line; its text
 * is lost visually (never to assistive tech). VTU timetables do not schedule
 * classes that short. Upgrade path: hide the text and rely on the day view.
 */
type Density = 'tall' | 'medium' | 'short';
function densityFor(minutes: number): Density {
  if (minutes >= 60) return 'tall';
  if (minutes >= 40) return 'medium';
  return 'short';
}

function sortSlots(slots: readonly TimetableSlot[]): TimetableSlot[] {
  return [...slots].sort((a, b) => a.startTime.localeCompare(b.startTime));
}

/** "09:30" -> 570. Returns null for anything that is not a stored time. */
function minutesOf(value: string): number | null {
  const [hour, minute] = value.split(':');
  const hours = Number(hour);
  const minutes = Number(minute);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  return hours * 60 + minutes;
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
  const { items: calendars } = useCalendars();
  const { items: imports } = useTimetableImports();
  const { items: semesterSubjects } = useSemesterSubjects();

  /*
   * THE DATE COMES FROM THE CLOCK, NOT FROM THIS RENDER.
   *
   * This used to read `localDay()` once, when the page rendered. A student who
   * left the app open across midnight went on seeing yesterday — and a mark
   * made after midnight was written against yesterday's date, silently
   * attributing it to the wrong class (hooks/useNow).
   */
  const now = useNow();
  const today = now.today;
  const todayName = weekdayOf(today);
  const holiday = holidayOn(activeCalendars(calendars), today);
  const [view, setView] = useState<View>('week');
  const [activeDay, setActiveDay] = useState<Weekday>(todayWeekday);
  const [editing, setEditing] = useState<TimetableSlot | 'new' | null>(null);

  /*
   * ONE WRITE PATH. Marking used to be implemented here as well as on the
   * attendance screen, each adjusting the counters in its own way, so the same
   * class could be counted twice. Both now go through `useMarkClass`, which
   * writes one ledger row per class per date and re-derives the figures.
   */
  const marking = useMarkClass();

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

  const outcomeOf = (slot: TimetableSlot): MarkState => marking.stateOf(today, slotClassId(slot));

  const setOutcome = (slot: TimetableSlot, next: MarkState): void => {
    const before = outcomeOf(slot);
    if (before === next) return;
    const entry = timetableEntry(slot, null);
    const code = entry.attendanceCode;
    if (code === null) return;
    const klass = {
      classId: slotClassId(slot),
      date: today,
      subjectCode: code,
      subjectTitle: displayTitle(resolveSubject(index, code), 'timetable') || code,
      startTime: slot.startTime,
      endTime: slot.endTime,
    };
    void marking.set(klass, next);
    if (next === 'unmarked') return;
    toast(
      next === 'cancelled'
        ? `${entry.shortName} is marked cancelled for today.`
        : `Recorded ${entry.shortName} ${next}.`,
      {
        tone: next === 'attended' ? 'success' : next === 'missed' ? 'warning' : 'neutral',
        action: { label: 'Undo', onClick: () => void marking.set(klass, before) },
      },
    );
  };

  const eyebrow =
    [
      profile?.branch ? branchCode(profile.branch) : null,
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
                  toast('Class removed from every week', {
                    description: 'Classes you already recorded for it are kept.',
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
    <>
      <WeekTimeGrid byDay={byDay} titleFor={titleFor} todayName={todayName} onPick={onPick} />
      <WeekStack byDay={byDay} titleFor={titleFor} todayName={todayName} onPick={onPick} />
    </>
  );
}

/*
 * THE NARROW LAYOUT. Six day columns cannot hold a proportional time axis at
 * phone width without a horizontal scroll, so below `lg` the week is a list of
 * days — each one a heading and its sessions in order. `display: none` keeps
 * whichever layout is not in use out of the accessibility tree as well, so a
 * screen reader hears the week once.
 */
function WeekStack({
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
    <ol className="grid gap-4 lg:hidden" data-testid="timetable-week-list">
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

/* ------------------------------------------------------- Week · time grid */

/**
 * The week as a proportional time axis: one shared vertical scale, six day
 * columns, every session placed where it really is and as long as it really
 * is.
 *
 * The previous layout stacked equal-height cards per day, so a 50-minute
 * lecture and a three-hour lab looked the same, 9 am on Monday sat level with
 * 2 pm on Tuesday, and a free morning was invisible. None of that is a styling
 * problem — a column of cards cannot express duration or alignment at all.
 *
 * GEOMETRY. The grid has one row per `STEP` minutes between the week's
 * earliest start and latest end, rounded out to whole hours. A session spans
 * `(start … end)` rows, so its height *is* its duration. Nothing is invented:
 * the bounds come from the stored times, and a day with nothing in it is
 * genuinely empty space.
 */
const STEP = 5;
/** Height of one `STEP`. 6px ⇒ an hour is 72px, a 50-minute class is 60px. */
const STEP_PX = 6;
/**
 * The span given to a row that HAS no duration — `end <= start`, which no
 * writer can produce and which storage therefore only holds as corruption
 * (domain/day-schedule `degenerate`). It gets a visible height here so the
 * student can see and fix it, rather than a zero-height sliver.
 *
 * It is NOT a floor on real classes. Flooring those would either inflate the
 * end used for overlap — splitting two back-to-back twenty-minute classes into
 * separate lanes for a collision they do not have — or inflate the drawn
 * height alone, so the two would be drawn on top of each other. A real class
 * is exactly as tall as it is long.
 */
const DEGENERATE_SPAN_MINUTES = 30;
const GRID_COLUMNS = '3.25rem repeat(6, minmax(0, 1fr))';

interface Placement {
  readonly slot: TimetableSlot;
  readonly start: number;
  readonly end: number;
  /** Which sub-column of its day, when sessions overlap. */
  readonly lane: number;
  readonly lanes: number;
}

/**
 * Where each of one day's sessions goes, and how it shares the width with
 * anything it collides with.
 *
 * Overlaps are real in imported timetables (an elective against a lab) and are
 * never auto-resolved — the product warns and leaves them. They are packed
 * into lanes so both stay readable and neither is hidden behind the other.
 */
function placeDay(slots: readonly TimetableSlot[]): readonly Placement[] {
  const timed = slots
    .map((slot) => {
      const start = minutesOf(slot.startTime);
      const end = minutesOf(slot.endTime);
      if (start === null) return null;
      return {
        slot,
        start,
        end: end === null || end <= start ? start + DEGENERATE_SPAN_MINUTES : end,
      };
    })
    .filter(
      (placed): placed is { slot: TimetableSlot; start: number; end: number } => placed !== null,
    )
    .sort((a, b) => a.start - b.start || a.end - b.end);

  /* Greedy lane packing: the first lane free at this start time takes it. */
  const laneEnds: number[] = [];
  const lanes = timed.map((placed) => {
    const free = laneEnds.findIndex((end) => end <= placed.start);
    const lane = free === -1 ? laneEnds.length : free;
    laneEnds[lane] = placed.end;
    return lane;
  });
  const width = Math.max(1, ...lanes.map((lane) => lane + 1));
  return timed.map((placed, at) => ({ ...placed, lane: lanes[at] ?? 0, lanes: width }));
}

function WeekTimeGrid({
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
  const placed = WEEKDAYS.map((weekday) => placeDay(byDay.get(weekday) ?? []));
  const all = placed.flat();
  if (all.length === 0) return null;

  const from = Math.floor(Math.min(...all.map((one) => one.start)) / 60) * 60;
  const to = Math.ceil(Math.max(...all.map((one) => one.end)) / 60) * 60;
  const rows = Math.max(1, (to - from) / STEP);
  const rowOf = (minute: number): number => (minute - from) / STEP + 1;
  const hours = Array.from({ length: (to - from) / 60 + 1 }, (_, at) => from + at * 60);

  const todayColumn = todayName === null ? -1 : WEEKDAYS.indexOf(todayName);

  return (
    /*
     * `data-testid` is a test-only structural hook. The probes used to find this
     * grid by a Tailwind utility class, which any other element may carry — and
     * after the navigation gained a `lg:block` brand lockup, one did.
     */
    <div className="hidden lg:block" data-testid="timetable-time-grid">
      <div className="grid gap-x-2" style={{ gridTemplateColumns: GRID_COLUMNS }}>
        <span aria-hidden="true" />
        {WEEKDAYS.map((weekday) => {
          const sessions = (byDay.get(weekday) ?? []).filter(
            (slot) => slot.subjectCode !== null,
          ).length;
          return (
            <button
              key={weekday}
              type="button"
              onClick={() => onPick(weekday)}
              aria-label={`Open ${DAY_NAME[weekday]}${weekday === todayName ? ' (today)' : ''}`}
              className={cn(
                'group flex min-w-0 flex-col items-start rounded-t-md px-1 pb-2 text-left',
                /* Continues straight into the column tint below, so "today" is a column. */
                weekday === todayName && 'bg-sunken/60',
              )}
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
          );
        })}
      </div>

      <div
        className="grid gap-x-2 border-t border-line"
        style={{
          gridTemplateColumns: GRID_COLUMNS,
          gridTemplateRows: `repeat(${String(rows)}, ${String(STEP_PX)}px)`,
        }}
      >
        {/* Today, carried from the header to the last hour. Painted first, so it sits behind. */}
        {todayColumn >= 0 && (
          <div
            aria-hidden="true"
            className="pointer-events-none bg-sunken/60"
            style={{ gridColumn: String(todayColumn + 2), gridRow: `1 / ${String(rows + 1)}` }}
          />
        )}
        {/*
          The scale itself: one rule and one label an hour. Full strength, because
          the rules — not the sessions — are what carry the structure now.
        */}
        {hours.map((minute) => (
          <div
            key={minute}
            aria-hidden="true"
            className="pointer-events-none border-t border-line"
            style={{ gridColumn: '2 / -1', gridRow: `${String(rowOf(minute))} / span 1` }}
          />
        ))}
        {hours.slice(0, -1).map((minute) => (
          <span
            key={minute}
            className="pr-2 text-right font-mono text-[10px] text-ink-3 tabular-nums"
            style={{
              gridColumn: '1',
              gridRow: `${String(rowOf(minute))} / span ${String(60 / STEP)}`,
            }}
          >
            {formatTime(`${String(Math.floor(minute / 60)).padStart(2, '0')}:00`)}
          </span>
        ))}

        {WEEKDAYS.map((_weekday, day) =>
          (placed[day] ?? []).map((one) => (
            <div
              key={one.slot.id}
              className="min-w-0"
              style={{
                gridColumn: String(day + 2),
                gridRow: `${String(rowOf(one.start))} / ${String(rowOf(one.end))}`,
                marginLeft: `${String((one.lane / one.lanes) * 100)}%`,
                width: `${String(100 / one.lanes)}%`,
              }}
            >
              <SessionChip
                slot={one.slot}
                entry={timetableEntry(
                  one.slot,
                  one.slot.subjectCode === null ? null : titleFor(one.slot.subjectCode),
                )}
                fill
                minutes={one.end - one.start}
              />
            </div>
          )),
        )}
      </div>
    </div>
  );
}

/**
 * A session as it sits in the week grid: a tint of the cell, not a card on it.
 *
 * The list layout below `lg` keeps the Card, because there a session IS a
 * discrete item in a stack. Here the grid is the structure and this only
 * fills a span of it.
 */
function GridSession({
  slot,
  entry,
  kind,
  minutes,
}: {
  readonly slot: TimetableSlot;
  readonly entry: TimetableEntry;
  readonly kind: Kind;
  readonly minutes: number;
}) {
  const time = `${slot.startTime}–${slot.endTime}`;
  const name = entry.isCourse ? entry.shortName : entry.name;
  const where = slot.room ?? (entry.isCourse ? entry.name : null);
  /* Everything, always: whatever the density hides visually, this still says. */
  const label = [KIND_LABEL[kind], entry.name, time, slot.room].filter(Boolean).join(', ');
  const density = densityFor(minutes);
  const surface = cn('relative flex h-full min-w-0 overflow-hidden pr-1.5 pl-2.5', KIND_TINT[kind]);
  /*
   * Secondary text here is `ink-2`, not `ink-3`: on the tint, `ink-3` measures
   * 4.17:1 light and 4.24:1 dark, under the 4.5:1 floor (axe, qa:app).
   */
  /* A break is quieter than a class: its tint alone says so, with no edge. */
  const edge =
    kind === 'break' ? null : (
      <span aria-hidden="true" className={cn('absolute inset-y-0 left-0 w-0.5', KIND_BAR[kind])} />
    );

  if (kind === 'break') {
    return (
      <article
        aria-label={label}
        className={cn(surface, 'items-center gap-1.5 text-[11px] text-ink-2')}
      >
        <Coffee className="size-3.5 shrink-0" aria-hidden="true" />
        {/* The time is the row it sits on; dropping it is what lets the name fit. */}
        <span className="truncate" title={entry.name}>
          {entry.name}
        </span>
      </article>
    );
  }

  if (density === 'short') {
    return (
      <article aria-label={label} className={cn(surface, 'items-center gap-1.5')}>
        {edge}
        <span className="truncate text-[11px] font-medium" title={entry.name}>
          {name}
        </span>
        <span className="shrink-0 font-mono text-[10px] text-ink-2">{slot.startTime}</span>
      </article>
    );
  }

  return (
    <article aria-label={label} className={cn(surface, 'flex-col gap-0.5 py-1.5')}>
      {edge}
      <span
        className={cn(
          'text-[12px] leading-tight font-medium',
          density === 'tall' ? 'line-clamp-2' : 'truncate',
        )}
        title={entry.name}
      >
        {name}
      </span>
      <span className="truncate font-mono text-[10px] text-ink-2">
        {time}
        {where === null || where === '' ? null : ` · ${where}`}
      </span>
    </article>
  );
}

function SessionChip({
  slot,
  entry,
  fill = false,
  minutes = 60,
}: {
  readonly slot: TimetableSlot;
  readonly entry: TimetableEntry;
  /** True in the time grid, where the chip must be exactly as tall as its row span. */
  readonly fill?: boolean;
  /** The drawn span, which decides how much of the session can be shown. */
  readonly minutes?: number;
}) {
  const kind = kindOf(entry);
  if (fill) return <GridSession slot={slot} entry={entry} kind={kind} minutes={minutes} />;
  if (kind === 'break') {
    return (
      /*
       * A break is the same surface at lower emphasis: the dashed border and
       * the panel background are the only overrides, so it cannot drift away
       * from the class block it sits between.
       */
      <Card
        className={cn(
          'flex items-center gap-2 overflow-hidden rounded-lg border-dashed bg-panel px-2.5 text-[11px] text-ink-3',
          fill ? 'h-full py-1' : 'py-1.5',
        )}
      >
        <Coffee className="size-3.5 shrink-0" aria-hidden="true" />
        <span className="font-mono">{slot.startTime}</span>
        <span className="truncate">{entry.name}</span>
      </Card>
    );
  }
  return (
    /*
     * THE CLASS BLOCK IS A CARD, NOT A HAND-ROLLED BOX.
     *
     * This was `rounded-lg border border-line bg-raised` written out by hand —
     * character for character what `ui/card.tsx` already is, which is how a
     * timetable ends up looking like arbitrary rounded rectangles rather than
     * the rest of the product. `asChild` keeps the `<article>` element, so the
     * semantics are unchanged and only the surface comes from the primitive.
     *
     * `rounded-lg` overrides the Card's `rounded-xl` through `cn`'s
     * tailwind-merge: a grid cell this dense needs the tighter radius, and the
     * override is the design system's own mechanism rather than a fork.
     */
    <Card
      asChild
      className={cn(
        'relative overflow-hidden rounded-lg p-2.5 transition-colors hover:border-line-strong',
        fill && 'h-full',
      )}
    >
      <article>
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
          <div
            className="mt-1 line-clamp-2 text-[12px] leading-tight font-medium"
            title={entry.name}
          >
            {entry.isCourse ? entry.shortName : entry.name}
          </div>
          <div className="truncate text-[11px] text-ink-3">
            {slot.room ?? (entry.isCourse ? entry.name : '')}
          </div>
        </div>
      </article>
    </Card>
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
  readonly outcomeOf?: ((slot: TimetableSlot) => MarkState) | undefined;
  readonly holiday?: CalendarEvent | null | undefined;
  readonly onMark?: ((slot: TimetableSlot, outcome: MarkState) => void) | undefined;
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
            const outcome = outcomeOf?.(slot) ?? 'unmarked';
            const isNow = isToday && slot.startTime <= clock && clock < slot.endTime;
            const muted = kind === 'break';
            const label = `${entry.shortName} on ${slot.day} at ${formatTime(slot.startTime)}`;
            return (
              <div
                key={slot.id}
                aria-current={isNow ? 'time' : undefined}
                className={cn(
                  'flex items-center gap-3 px-4 py-3.5 sm:gap-4 sm:px-5',
                  muted && 'bg-panel',
                  slot.id === next?.id && !muted && 'bg-accent-weak/30',
                )}
              >
                {/* The design's time column: one mono line, as the timetable prints it. */}
                <div className="w-[4.75rem] shrink-0 font-mono text-[11px] whitespace-nowrap text-ink-3 tabular-nums sm:w-24">
                  <time dateTime={slot.startTime}>{slot.startTime}</time>–
                  <time dateTime={slot.endTime}>{slot.endTime}</time>
                  {isNow && (
                    <div className="mt-1">
                      <Badge tone="accent">Now</Badge>
                    </div>
                  )}
                </div>
                <span
                  aria-hidden="true"
                  className={cn('h-10 w-[3px] shrink-0 rounded-full', KIND_BAR[kind])}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className={cn('truncate text-[14px] font-medium', muted && 'text-ink-3')}>
                      {entry.name}
                    </span>
                    {!muted && <Badge className="shrink-0 max-sm:hidden">{KIND_LABEL[kind]}</Badge>}
                    {outcome !== 'unmarked' && (
                      <Badge
                        tone={
                          outcome === 'attended'
                            ? 'success'
                            : outcome === 'missed'
                              ? 'warning'
                              : 'neutral'
                        }
                        className="shrink-0 max-sm:hidden"
                      >
                        {outcome === 'attended'
                          ? 'Attended'
                          : outcome === 'missed'
                            ? 'Missed'
                            : 'Cancelled'}
                      </Badge>
                    )}
                  </div>
                  <div className="mt-0.5 flex min-w-0 items-center gap-1 truncate text-[12px] text-ink-3">
                    {entry.detail !== null && <span className="font-mono">{entry.detail}</span>}
                    {slot.room !== null && (
                      <>
                        {entry.detail !== null && <span aria-hidden="true">·</span>}
                        <MapPin className="size-3 shrink-0" aria-hidden="true" />
                        <span className="truncate">{slot.room}</span>
                      </>
                    )}
                    {slot.faculty !== null && (
                      <span className="truncate max-sm:hidden">· {slot.faculty}</span>
                    )}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {onMark !== undefined && entry.isCourse && (
                    <>
                      <Button
                        size="sm"
                        icon={<Check />}
                        aria-pressed={outcome === 'attended'}
                        aria-label={`Mark ${entry.shortName} attended`}
                        className={cn(
                          'max-sm:w-8 max-sm:px-0',
                          outcome === 'attended' &&
                            'border-success/40 bg-success-weak text-success',
                        )}
                        onClick={() => onMark(slot, 'attended')}
                      >
                        <span className="max-sm:hidden">Attended</span>
                      </Button>
                      <Button
                        size="sm"
                        icon={<X />}
                        aria-pressed={outcome === 'missed'}
                        aria-label={`Mark ${entry.shortName} missed`}
                        className={cn(
                          'max-sm:w-8 max-sm:px-0',
                          outcome === 'missed' && 'border-warning/40 bg-warning-weak text-warning',
                        )}
                        onClick={() => onMark(slot, 'missed')}
                      >
                        <span className="max-sm:hidden">Missed</span>
                      </Button>
                    </>
                  )}
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <IconButton size="sm" label={`More actions for ${label}`}>
                        <MoreHorizontal />
                      </IconButton>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent>
                      {/*
                        WHICH ONE AM I CHANGING?
                        Every item names its scope. "Today" was ambiguous — it
                        reads as a time, not as which occurrence is affected —
                        and a student who cancels one Tuesday must not find they
                        have cancelled every Tuesday.
                      */}
                      {onMark !== undefined && entry.isCourse && (
                        <>
                          <DropdownMenuLabel>This date only</DropdownMenuLabel>
                          <DropdownMenuItem
                            icon={<Ban />}
                            label={
                              outcome === 'cancelled'
                                ? `Restore ${label} for today`
                                : `Cancel ${label} for today only`
                            }
                            onSelect={() =>
                              onMark(slot, outcome === 'cancelled' ? 'unmarked' : 'cancelled')
                            }
                          >
                            {outcome === 'cancelled'
                              ? 'Class was held after all'
                              : 'Cancel this class'}
                          </DropdownMenuItem>
                          {outcome !== 'unmarked' && outcome !== 'cancelled' && (
                            <DropdownMenuItem
                              icon={<Eraser />}
                              label={`Clear the mark on ${label}`}
                              onSelect={() => onMark(slot, 'unmarked')}
                            >
                              Clear this mark
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuSeparator />
                        </>
                      )}
                      <DropdownMenuLabel>Every week</DropdownMenuLabel>
                      <DropdownMenuItem
                        icon={<Pencil />}
                        label={`Edit ${label} in every week`}
                        onSelect={() => onEdit(slot)}
                      >
                        Edit this class
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        icon={<Trash2 />}
                        destructive
                        label={`Remove ${label} from every week`}
                        onSelect={() => onRemove(slot)}
                      >
                        Remove from every week
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
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
