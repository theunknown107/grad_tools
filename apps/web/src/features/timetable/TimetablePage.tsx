/**
 * Weekly timetable.
 *
 * Authority: docs/03 UF-16, M3 continuation §20.
 *
 * Desktop renders a week grid; mobile renders a day agenda with BUTTON
 * navigation as well as any swipe, because a gesture must never be the only
 * way to reach content (docs/27 §27.8).
 *
 * No institutional synchronisation exists — slots are entered by the student.
 */

import { useMemo, useRef, useState } from 'react';
import {
  WEEKDAYS,
  type AttendanceRecord,
  type TimetableSlot,
  type Weekday,
} from '../../domain/types.js';
import { asStudentProfileId } from '../../domain/identity.js';
import { PageHeader } from '../../components/AppShell.js';
import { MetaPill } from '../../components/ui/tone.js';
import { IslandTabs, IslandTabGroup, IslandTabPanel } from '../../components/ui/IslandTabs.js';
import { Icon } from '../../components/icons.js';
import {
  Button,
  EmptyState,
  monoClass,
  Notice,
  Panel,
  SelectField,
  TextField,
} from '../../components/ui/index.js';
import { formatCount, formatDay, formatTime, localDay } from '../../lib/format.js';
import { newId } from '../../lib/id.js';
import {
  useAttendance,
  useCalendars,
  useClassMarks,
  useProfile,
  useSemesterSubjects,
  useTimetable,
  useTimetableImports,
} from '../../hooks/useCollection.js';
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
import { useSubjectIndex } from '../../hooks/useSubjectIndex.js';
import { displayTitle, resolveSubject } from '../../domain/subjects.js';
import { timetableEntry, type TimetableEntry } from '../../domain/timetable-import.js';
import styles from './timetable.module.css';

function sortSlots(slots: readonly TimetableSlot[]): TimetableSlot[] {
  return [...slots].sort((a, b) => a.startTime.localeCompare(b.startTime));
}

export function TimetablePage() {
  const { items, loading, save, remove } = useTimetable();
  const { profile } = useProfile();
  /*
   * A TIMETABLE SLOT STORES A CODE AND NO TITLE, so this screen showed a bare
   * `BMATS101` where every other screen showed a name (OQ-051). The name is
   * resolved from the student's own records by code — nothing is stored here,
   * and no schema changed.
   */
  const { index } = useSubjectIndex();
  /*
   * TODAY'S CLASSES ARE WHERE ATTENDANCE ACTUALLY GETS RECORDED (§12, §32).
   * The student is already looking at the class that just happened; sending
   * them to another screen to find the same subject and press the same button
   * is the errand this removes.
   */
  const { items: attendance, save: saveAttendance } = useAttendance();
  const { items: marks, save: saveMark, remove: removeMark } = useClassMarks();
  const { items: calendars } = useCalendars();
  const { items: imports } = useTimetableImports();

  /* The day the student is standing in, not the day UTC is having (§13, §19). */
  const today = localDay();

  /*
   * CALENDAR SAYS WHEN, TIMETABLE SAYS WHAT (§20). Only the calendar in force
   * for its term is consulted, so a superseded one cannot cancel a Monday
   * (M10A.10 §7).
   */
  const holiday = holidayOn(activeCalendars(calendars), today);

  /*
   * -----------------------------------------------------------------------
   * WHAT HAS ALREADY BEEN ANSWERED, READ WITHOUT WAITING FOR A RENDER (§13)
   * -----------------------------------------------------------------------
   *
   * Two taps on Attended are one class. A tap, a walk to the dashboard and a
   * tap on the way back is also one class. The stored mark settles both, but
   * only once it has been read back - and a second click can arrive before
   * React has re-rendered with the first one in it.
   *
   * So the intent is recorded synchronously in a ref the moment it is
   * expressed, and every decision is read from there first. The ref is a
   * write-through cache of the marks, not a second source: it is empty on
   * mount and the stored marks answer everything it has not seen.
   */
  const decided = useRef(new Map<string, ClassOutcome | null>());
  const outcomeOf = (slotId: string): ClassOutcome | null => {
    const id = markId(today, slotId);
    const pending = decided.current.get(id);
    return pending !== undefined ? pending : (markFor(marks, today, slotId)?.outcome ?? null);
  };

  /* The same protection for the counts: two classes of one subject in a row. */
  const counted = useRef(new Map<string, AttendanceRecord>());
  const recordFor = (code: string): AttendanceRecord | undefined =>
    counted.current.get(code) ??
    attendance.find((record) => record.subjectCode.replace(/\s+/g, '').toUpperCase() === code);

  const [undo, setUndo] = useState<{ readonly slot: TimetableSlot; readonly label: string } | null>(
    null,
  );

  /**
   * Move one scheduled class to a decision, or back out of one.
   *
   * `null` is "the student has not said", which is where a class starts and
   * where Undo returns it to. Nothing here is automatic: a class the student
   * never touches produces no mark and changes no count (§8, §10, §30).
   */
  const setOutcome = (slot: TimetableSlot, next: ClassOutcome | null) => {
    const before = outcomeOf(slot.id);
    /* Already there. A repeated tap is a repeated tap, not a second class. */
    if (before === next) return;

    const id = markId(today, slot.id);
    decided.current.set(id, next);

    /*
     * AN ACTIVITY IS MARKABLE, AND IS NOT AN ATTENDANCE SUBJECT (§26).
     *
     * The mark below belongs to the SLOT and is written either way — the
     * student said what happened, and that answer is theirs. What an hour with
     * no course cannot do is open or move a subject's attendance record: those
     * are counted per subject code, and "Placement & Training" has none. A
     * record keyed by its printed name would be a subject we invented.
     */
    const entry = timetableEntry(slot, null);
    const code = entry.attendanceCode?.replace(/\s+/g, '').toUpperCase() ?? null;
    const existing = code === null ? undefined : recordFor(code);
    const delta = countDelta(before, next);
    if (code === null) {
      /* No counter to move. The mark below still records what happened. */
    } else if (existing !== undefined) {
      const updated = applyDelta(existing, delta);
      counted.current.set(code, updated);
      void saveAttendance(updated);
    } else if (next !== null) {
      /*
       * The first class of a subject the student has never opened the
       * attendance screen for. The title is resolved through the subject index
       * rather than typed again (M10A.1) - and falls back to the code, which is
       * honest rather than blank.
       */
      const created = startRecord(
        {
          id: newId(),
          profileId: profile?.id ?? asStudentProfileId('local'),
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
      setUndo(null);
      return;
    }
    void saveMark({
      id,
      profileId: profile?.id ?? asStudentProfileId('local'),
      date: today,
      slotId: slot.id,
      /*
       * Denormalised so the mark stays readable if the slot is edited away —
       * the code for a course, and for an activity the name the timetable
       * printed. Nothing joins on this; the mark is found by date and slot.
       */
      subjectCode: code ?? entry.name,
      outcome: next,
      markedAt: new Date().toISOString(),
    });
    /* A mark's job is done in a fortnight; nothing reads it after that (§44). */
    for (const stale of staleMarks(marks, today)) void removeMark(stale.id);
    setUndo({ slot, label: `${entry.shortName} ${next}` });
  };

  const [day, setDay] = useState<Weekday>('Mon');
  const [view, setView] = useState('week');

  /*
   * Today's weekday name, in the same three-letter form the records use.
   * `toLocaleDateString` with an explicit locale rather than the device's, so
   * a phone set to another language still matches the stored 'Mon'..'Sat'.
   */
  const todayName = new Date().toLocaleDateString('en-GB', { weekday: 'short' }) as Weekday;
  const [startTime, setStartTime] = useState('09:00');
  const [endTime, setEndTime] = useState('10:00');
  const { items: semesterSubjects } = useSemesterSubjects();
  const [subjectCode, setSubjectCode] = useState('');
  /* An hour that is scheduled but is not a coded course (domain/types). */
  const [activityName, setActivityName] = useState('');
  /*
   * THE FORM EDITS AS WELL AS ADDS.
   *
   * There was no way to change an hour once saved — only delete it and type it
   * again, which loses the room and the faculty with it. Rather than a second
   * form with its own copy of the same validation, the one that exists loads
   * the record: same fields, same rules, same message when they are not met.
   */
  const [editingId, setEditingId] = useState<string | null>(null);
  const [room, setRoom] = useState('');
  const [faculty, setFaculty] = useState('');
  const [error, setError] = useState<string | undefined>(undefined);

  /* Mobile agenda starts on today where today is a teaching day. */
  const [activeDay, setActiveDay] = useState<Weekday>(() => {
    const index = new Date().getDay();
    return WEEKDAYS[index === 0 ? 0 : index - 1] ?? 'Mon';
  });

  const byDay = useMemo(() => {
    const map = new Map<Weekday, TimetableSlot[]>();
    for (const weekday of WEEKDAYS) {
      map.set(weekday, sortSlots(items.filter((slot) => slot.day === weekday)));
    }
    return map;
  }, [items]);

  /** Load one saved hour back into the form. */
  const editSlot = (slot: TimetableSlot) => {
    setEditingId(slot.id);
    setDay(slot.day);
    setStartTime(slot.startTime);
    setEndTime(slot.endTime);
    setSubjectCode(slot.subjectCode ?? '');
    setActivityName(slot.activity ?? '');
    setRoom(slot.room ?? '');
    setFaculty(slot.faculty ?? '');
    setError(undefined);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setSubjectCode('');
    setActivityName('');
    setRoom('');
    setFaculty('');
    setError(undefined);
  };

  const addSlot = () => {
    /*
     * A CODE OR A NAME, NOT A CODE ONLY.
     *
     * An imported timetable can already hold an hour that names no course —
     * "Placement & Training" — and a student adding one by hand could not,
     * because this form demanded a code. They had to invent one, and an
     * invented code reads exactly like a real VTU code and is offered for
     * attendance beside them. So whichever field is filled decides which kind
     * of hour this is, and the slot's own invariant does the rest.
     */
    const code = subjectCode.trim().toUpperCase();
    const named = activityName.trim();
    if (code === '' && named === '') {
      setError('Enter a subject code, or a name for the activity.');
      return;
    }
    if (code !== '' && named !== '') {
      setError('Give a subject code or an activity name, not both.');
      return;
    }
    if (endTime <= startTime) {
      setError('The end time must be after the start time.');
      return;
    }
    setError(undefined);
    void save({
      /* Editing writes back to the same record rather than making a second. */
      id: editingId ?? newId(),
      profileId: profile?.id ?? asStudentProfileId('local'),
      day,
      startTime,
      endTime,
      subjectCode: code === '' ? null : code,
      activity: code === '' ? named : null,
      room: room.trim() === '' ? null : room.trim(),
      faculty: faculty.trim() === '' ? null : faculty.trim(),
    });
    setEditingId(null);
    setSubjectCode('');
    setActivityName('');
    setRoom('');
    setFaculty('');
  };


  /*
   * -----------------------------------------------------------------------
   * WHICH TIMETABLE AM I LOOKING AT? (§23, §24)
   * -----------------------------------------------------------------------
   *
   * The revision label and the printed effective date were read at import and
   * stored, and then shown nowhere - so a student holding a printed R2 had no
   * way to tell whether the screen was R1 or R2 (M10A.10 §43).
   *
   * The classes on screen came from the most recent confirmed import, because
   * confirming REPLACES the week rather than merging into it. That is the one
   * whose provenance is true, and any stored import with a later effective date
   * is a fact the student should see rather than one the screen settles quietly.
   */
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

  /*
   * The class this timetable belongs to, from the record rather than assumed:
   * the programme is the student's, the semester and the division are the
   * imported timetable's own header. A part nobody recorded is left out.
   */
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
      .join(' · ') || null;

  /*
   * DAYS THE RECORD HAS NOTHING FOR. Said once, above the week, because a day
   * that is genuinely free and a day the importer could not read look exactly
   * the same on a grid — and only the student can tell them apart (§6).
   */
  const emptyDays = WEEKDAYS.filter((weekday) => (byDay.get(weekday) ?? []).length === 0);

  return (
    <>
      <PageHeader
        /*
          The design names the class this timetable belongs to. Every part comes
          from the record — the programme from the profile, the semester and the
          division from the imported timetable itself — and a part nobody has
          recorded is left out rather than filled in.
        */
        {...(eyebrow === null ? {} : { eyebrow })}
        title="Timetable"
        subtitle="Your weekly schedule, stored on this device."
        pills={
          items.length === 0 ? undefined : (
            <>
              <MetaPill>{formatCount(items.length, 'class', 'classes')}</MetaPill>
              {source !== null && source.active.revision !== null && (
                <MetaPill>{source.active.revision}</MetaPill>
              )}
              {source !== null && source.active.effectiveFrom !== null && (
                <MetaPill>from {formatDay(source.active.effectiveFrom)}</MetaPill>
              )}
            </>
          )
        }
      />

      {/*
        ONE RADIX ROOT over the tab list and BOTH its panels. Week and Day were
        previously a ternary and a `hidden` div two hundred lines apart, so the
        tab that claimed to control the week panel was pointing at an element
        that did not exist whenever the other was showing.
      */}
      <IslandTabGroup value={view} onChange={setView}>
        <div className={styles.stack}>
          {/*
            COMPACT, AND NOT THE POINT OF THE SCREEN (§23). The student mainly
            needs to know which timetable this is; one line answers it.
          */}
          {source !== null && items.length > 0 && (
            <p className={styles.provenance}>
              {[
                source.active.className,
                source.active.revision,
                source.active.effectiveFrom !== null
                  ? `from ${formatDay(source.active.effectiveFrom)}`
                  : null,
              ]
                .filter((part): part is string => part !== null && part !== '')
                .join(' · ')}
            </p>
          )}

          {/* A timetable that is active but not yet in effect is not a mistake —
              it is a fact the student is entitled to (§24). */}
          {source?.active.effectiveFrom !== null &&
            source !== null &&
            source.active.effectiveFrom > today && (
              <Notice tone="info">
                These classes take effect on {formatDay(source.active.effectiveFrom)}.
              </Notice>
            )}

          {source !== null && source.later !== null && (
            <Notice tone="warning">
              A timetable effective {formatDay(source.later.effectiveFrom as string)} was also
              imported. These classes came from the one imported most recently
              {source.active.revision !== null ? ` (${source.active.revision})` : ''}.
            </Notice>
          )}

          {items.length > 0 ? (
            <>
              <div className={styles.controls}>
                <IslandTabs
                  label="Timetable view"
                  value={view}
                  onChange={setView}
                  tabs={[
                    { id: 'week', label: 'Week', count: items.length },
                    { id: 'day', label: 'Day', count: (byDay.get(activeDay) ?? []).length },
                  ]}
                />
              </div>

              {/*
                WHAT THE RECORD DOES NOT CONTAIN, SAID ONCE.

                The approved design draws a legend of session types — theory,
                lab, project, special — and marks each session with the one it
                is. A GradTools timetable slot has no such field: the importer
                records a time, a code, a room and a member of staff, and
                nothing about what KIND of session it is.

                So there is no legend, because a legend for a distinction the
                data never makes would be labelling nothing. This line says so
                instead, and the day that changes upstream the legend has a
                real field to read (§6).
              */}
              {emptyDays.length > 0 && (
                <p className={styles.gap}>
                  {emptyDays.length === 1
                    ? `${emptyDays[0] as string} has no classes in this record.`
                    : `${emptyDays.slice(0, -1).join(', ')} and ${emptyDays[emptyDays.length - 1] as string} have no classes in this record.`}{' '}
                  A day with nothing on it and a day the importer could not read look the same here
                  — check it against your printed timetable.
                </p>
              )}

              <IslandTabPanel id="week">
                <WeekGrid
                  byDay={byDay}
                  titleFor={(code) => displayTitle(resolveSubject(index, code), 'timetable')}
                  todayName={todayName}
                  onPick={(weekday) => {
                    setActiveDay(weekday);
                    setView('day');
                  }}
                />
              </IslandTabPanel>

              <IslandTabPanel id="day">
                <div className={styles.dayPicker}>
                  {WEEKDAYS.map((weekday) => (
                    <button
                      key={weekday}
                      type="button"
                      className={styles.dayPick}
                      data-selected={weekday === activeDay ? 'true' : undefined}
                      aria-pressed={weekday === activeDay}
                      onClick={() => {
                        setActiveDay(weekday);
                      }}
                    >
                      {weekday}
                    </button>
                  ))}
                </div>

                <DayFocus
                  day={activeDay}
                  slots={byDay.get(activeDay) ?? []}
                  titleFor={(code) => displayTitle(resolveSubject(index, code), 'timetable')}
                  /*
                    MARKING BELONGS TO TODAY AND ONLY TODAY. The day view can
                    show any day of the week, and a button on Thursday's row
                    while it is Monday invites recording attendance for a class
                    that has not happened (§10, §30).
                  */
                  {...(activeDay === todayName
                    ? { outcomeOf, onMark: setOutcome, holiday }
                    : {})}
                  onEdit={editSlot}
                  onRemove={remove}
                />

                {/*
                  ONE STEP OF UNDO, WHICH IS THE STEP THAT GETS USED (§14, §29).
                  A tap on the wrong row is taken back by reversing exactly what
                  was applied — the same arithmetic backwards.
                */}
                {undo !== null && (
                  <div className={styles.undoBar}>
                    <span>Recorded {undo.label}.</span>
                    <Button
                      small
                      onClick={() => {
                        setOutcome(undo.slot, null);
                      }}
                    >
                      Undo
                    </Button>
                  </div>
                )}
              </IslandTabPanel>
            </>
          ) : null}

          {loading ? null : items.length === 0 ? (
            <Panel title="Your week" flush>
              <EmptyState title="No classes yet" icons={['timetable']}>
                Add your weekly classes below, or import a timetable, and your week appears here day
                by day.
              </EmptyState>
            </Panel>
          ) : null}

          {/* `open` while editing, so choosing Edit on a row reveals the form. */}
          <details className={styles.addClass} open={editingId !== null || undefined}>
            <summary className={styles.addSummary}>
              <Icon name="plus" size="nav" />
              Add a class
            </summary>
            <div className={styles.addGrid}>
              <SelectField
                label="Day"
                value={day}
                onChange={(event) => {
                  setDay(event.target.value as Weekday);
                }}
              >
                {WEEKDAYS.map((weekday) => (
                  <option key={weekday} value={weekday}>
                    {weekday}
                  </option>
                ))}
              </SelectField>
              <TextField
                label="Starts"
                type="time"
                value={startTime}
                onChange={(event) => {
                  setStartTime(event.target.value);
                }}
              />
              <TextField
                label="Ends"
                type="time"
                value={endTime}
                onChange={(event) => {
                  setEndTime(event.target.value);
                }}
              />
              {/* Suggested from the semester's subject list (M6 §16). */}
              <TextField
                label="Subject code"
                placeholder="BCS304"
                mono
                list="semester-subject-codes"
                value={subjectCode}
                onChange={(event) => {
                  setSubjectCode(event.target.value);
                }}
              />
              <datalist id="semester-subject-codes">
                {semesterSubjects.map((subject) => (
                  <option key={subject.id} value={subject.code}>
                    {subject.title}
                  </option>
                ))}
              </datalist>
              {/*
                The other kind of hour. Named rather than coded, and filled in
                INSTEAD of the code above — the helper text says so rather
                than leaving the student to discover it from an error.
              */}
              <TextField
                label="Or an activity"
                placeholder="Placement & Training"
                hint="For an hour that is scheduled but is not a coded course."
                value={activityName}
                onChange={(event) => {
                  setActivityName(event.target.value);
                }}
              />
              <TextField
                label="Room"
                hint="Optional"
                placeholder="A-204"
                value={room}
                onChange={(event) => {
                  setRoom(event.target.value);
                }}
              />
              <TextField
                label="Faculty"
                hint="Optional"
                placeholder="Prof. Kulkarni"
                value={faculty}
                onChange={(event) => {
                  setFaculty(event.target.value);
                }}
              />
            </div>
            <div className={styles.addActions}>
              {error !== undefined && (
                <div role="alert" className={styles.addError}>
                  <Notice tone="danger">{error}</Notice>
                </div>
              )}
              <Button variant="primary" onClick={addSlot}>
                <Icon name={editingId === null ? 'plus' : 'edit'} size="nav" />
                {editingId === null ? 'Add class' : 'Save changes'}
              </Button>
              {editingId !== null && <Button onClick={cancelEdit}>Cancel</Button>}
            </div>
          </details>
        </div>
      </IslandTabGroup>
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* The week                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Six days across, as the approved design lays them out.
 *
 * A column per day on a wide screen; the same columns stacked on a phone,
 * which is the design's own mobile composition rather than a shrunk grid. The
 * day heading is the control that opens that day.
 */
function WeekGrid({
  byDay,
  titleFor,
  todayName,
  onPick,
}: {
  readonly byDay: ReadonlyMap<Weekday, readonly TimetableSlot[]>;
  readonly titleFor: (code: string) => string;
  readonly todayName: Weekday;
  readonly onPick: (day: Weekday) => void;
}) {
  return (
    <ol className={styles.week}>
      {WEEKDAYS.map((weekday) => {
        const slots = byDay.get(weekday) ?? [];
        return (
          <li key={weekday} className={styles.weekDay} data-today={weekday === todayName}>
            <button
              type="button"
              className={styles.weekHead}
              onClick={() => {
                onPick(weekday);
              }}
            >
              <span className={styles.weekDayName}>{weekday}</span>
              <span className={styles.weekCount}>
                {slots.length === 0 ? 'None' : formatCount(slots.length, 'session')}
              </span>
            </button>
            <div className={styles.weekBody}>
              {slots.length === 0 ? (
                <p className={styles.dayEmpty}>Nothing recorded.</p>
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

/** One class in the week grid, to the design's chip geometry. */
function SessionChip({
  slot,
  entry,
}: {
  readonly slot: TimetableSlot;
  readonly entry: TimetableEntry;
}) {
  const meta = [entry.detail, slot.room].filter(Boolean).join(' · ');
  return (
    <article className={styles.chip}>
      <span className={styles.chipRule} aria-hidden="true" />
      <span className={styles.chipBody}>
        <span className={styles.chipTime}>
          {formatTime(slot.startTime)}–{formatTime(slot.endTime)}
        </span>
        <span className={styles.chipName}>{entry.name}</span>
        {/* Omitted rather than kept as an empty line: this record's importer
            captured no rooms, and a blank row is not a placeholder. */}
        {meta !== '' && <span className={styles.chipMeta}>{meta}</span>}
      </span>
    </article>
  );
}

/* -------------------------------------------------------------------------- */
/* One day                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * One day, as the approved design's focus card: the time on the left, a rule,
 * then the class and where it is.
 *
 * Attendance marking appears only when the day being shown IS today — see the
 * note at the call site.
 */
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
  /** The calendar's own holiday covering today, where it printed one (§19). */
  readonly holiday?: CalendarEvent | null | undefined;
  readonly onMark?: ((slot: TimetableSlot, outcome: ClassOutcome | null) => void) | undefined;
  /** Loads the hour back into the form that created it. */
  readonly onEdit?: ((slot: TimetableSlot) => void) | undefined;
  readonly onRemove: (id: string) => Promise<void> | void;
}) {
  const now = new Date();
  const clock = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const isToday = onMark !== undefined;
  const next = isToday ? slots.find((slot) => slot.endTime > clock) : undefined;

  /*
   * THE CALENDAR OUTRANKS THE TIMETABLE ON A DAY THE COLLEGE IS SHUT (§19,
   * §20). A timetable says what a Monday contains; the calendar says whether
   * this Monday is one. Showing the classes anyway would invite a student to
   * record attendance for a class that could not have happened.
   */
  if (holiday !== null && holiday !== undefined) {
    return (
      <Panel title={day} flush>
        <EmptyState title="No classes today" icons={['info']}>
          {holiday.title} — from your academic calendar.
        </EmptyState>
      </Panel>
    );
  }

  return (
    <Panel
      title={day}
      flush
      action={
        <span className={styles.dayCount}>
          {slots.length === 0 ? 'No sessions' : formatCount(slots.length, 'session')}
        </span>
      }
    >
      {slots.length === 0 ? (
        <EmptyState title={`Nothing recorded for ${day}`} icons={['timetable']}>
          {isToday
            ? 'Classes you add for today appear here.'
            : 'Either there are no classes on this day, or the imported timetable did not include them.'}
        </EmptyState>
      ) : (
        <ul className={styles.dayList}>
          {slots.map((slot) => {
            const entry = timetableEntry(
              slot,
              slot.subjectCode === null ? null : titleFor(slot.subjectCode),
            );
            const outcome = outcomeOf?.(slot.id) ?? null;
            const isNow = isToday && slot.startTime <= clock && clock < slot.endTime;
            return (
              <li
                key={slot.id}
                className={styles.dayRow}
                data-next={slot.id === next?.id}
                data-now={isNow}
                data-marked={outcome ?? undefined}
              >
                <span className={styles.rowTime}>
                  <span>{formatTime(slot.startTime)}</span>
                  <span className={styles.rowTimeEnd}>{formatTime(slot.endTime)}</span>
                  {/* DERIVED, never stored (§17). It stops being true a minute later. */}
                  {isNow && <span className={styles.nowTag}>Now</span>}
                </span>

                <span className={styles.rowRule} aria-hidden="true" />

                <span className={styles.rowBody}>
                  <span className={styles.rowName}>{entry.name}</span>
                  <span className={styles.rowMeta}>
                    {/*
                      The code, where there is one. An hour the timetable
                      schedules without a course has nothing to print here, and
                      prints nothing — not a dash, and not its own name twice.
                    */}
                    {entry.detail !== null && <span className={monoClass}>{entry.detail}</span>}
                    {slot.room !== null && (
                      <>
                        {' · '}
                        <Icon name="compass" size="micro" />
                        {slot.room}
                      </>
                    )}
                    {slot.faculty !== null && ` · ${slot.faculty}`}
                  </span>
                </span>

                {onMark !== undefined && (
                  <span className={styles.rowActions}>
                    {/*
                      `aria-pressed` IS THE MARKED STATE (§28). A student must
                      not have to remember what they tapped, and a screen reader
                      must not have to guess it from a colour.
                    */}
                    <Button
                      small
                      aria-pressed={outcome === 'attended'}
                      aria-label={`Mark ${entry.shortName} attended`}
                      onClick={() => {
                        onMark(slot, 'attended');
                      }}
                    >
                      Attended
                    </Button>
                    <Button
                      small
                      aria-pressed={outcome === 'missed'}
                      aria-label={`Mark ${entry.shortName} missed`}
                      onClick={() => {
                        onMark(slot, 'missed');
                      }}
                    >
                      Missed
                    </Button>
                  </span>
                )}

                {onEdit !== undefined && (
                  <Button
                    iconOnly
                    small
                    aria-label={`Edit ${entry.shortName} on ${slot.day} at ${formatTime(slot.startTime)}`}
                    onClick={() => {
                      onEdit(slot);
                    }}
                  >
                    <Icon name="edit" size="nav" />
                  </Button>
                )}
                <Button
                  variant="danger"
                  iconOnly
                  small
                  aria-label={`Remove ${entry.shortName} on ${slot.day} at ${formatTime(slot.startTime)}`}
                  onClick={() => void onRemove(slot.id)}
                >
                  <Icon name="trash" size="nav" />
                </Button>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}
