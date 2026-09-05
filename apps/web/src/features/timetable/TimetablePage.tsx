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
import { MetaPill, ToneAccordion } from '../../components/ui/tone.js';
import { IslandTabs, IslandTabPanel } from '../../components/ui/IslandTabs.js';
import { Icon } from '../../components/icons.js';
import {
  Button,
  EmptyState,
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
import {
  activeCalendars,
  holidayOn,
  type CalendarEvent,
} from '../../domain/calendar-import.js';
import { useSubjectIndex } from '../../hooks/useSubjectIndex.js';
import { displayTitle, resolveSubject } from '../../domain/subjects.js';
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

    const code = slot.subjectCode.replace(/\s+/g, '').toUpperCase();
    const existing = recordFor(code);
    const delta = countDelta(before, next);
    if (existing !== undefined) {
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
      subjectCode: code,
      outcome: next,
      markedAt: new Date().toISOString(),
    });
    /* A mark's job is done in a fortnight; nothing reads it after that (§44). */
    for (const stale of staleMarks(marks, today)) void removeMark(stale.id);
    setUndo({ slot, label: `${code} ${next}` });
  };

  const [day, setDay] = useState<Weekday>('Mon');
  const [view, setView] = useState('today');

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

  const addSlot = () => {
    if (subjectCode.trim() === '') {
      setError('Enter a subject code.');
      return;
    }
    if (endTime <= startTime) {
      setError('The end time must be after the start time.');
      return;
    }
    setError(undefined);
    void save({
      id: newId(),
      profileId: profile?.id ?? asStudentProfileId('local'),
      day,
      startTime,
      endTime,
      subjectCode: subjectCode.trim().toUpperCase(),
      room: room.trim() === '' ? null : room.trim(),
      faculty: faculty.trim() === '' ? null : faculty.trim(),
    });
    setSubjectCode('');
    setRoom('');
    setFaculty('');
  };

  const activeIndex = WEEKDAYS.indexOf(activeDay);

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

  return (
    <>
      <PageHeader
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

      <div className={styles.stack}>
        {/*
          -------------------------------------------------------------------
          M9.6F: TODAY IS THE PAGE; THE WEEK IS THE SECOND TAB
          -------------------------------------------------------------------

          The page opened on "Add a class" and then showed all five days at
          once. But a timetable is consulted far more often than it is edited,
          and the question is almost always "what do I have now" — not "what
          does Thursday look like".

          So Today leads, the week is a tab away, and adding a class moves to a
          disclosure at the end. Entry happens once a semester; consultation
          happens every morning.
        */}
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

        {/* A timetable that is active but not yet in effect is not a mistake -
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
            <IslandTabs
              label="Timetable view"
              value={view}
              onChange={setView}
              tabs={[
                { id: 'today', label: 'Today', count: (byDay.get(todayName) ?? []).length },
                { id: 'week', label: 'Week', count: items.length },
              ]}
            />

            {view === 'today' ? (
              <IslandTabPanel id="today">
                <TodayAgenda
                  slots={byDay.get(todayName) ?? []}
                  titleFor={(code) => displayTitle(resolveSubject(index, code), 'timetable')}
                  outcomeOf={outcomeOf}
                  holiday={holiday}
                  onMark={setOutcome}
                  onRemove={remove}
                />
                {/*
                  ONE STEP OF UNDO, WHICH IS THE STEP THAT GETS USED (§14, §29).
                  A tap on the wrong row, or a class that turned out not to have
                  happened, is taken back by reversing exactly what was applied
                  — the same arithmetic backwards, so nothing has to remember a
                  copy of the record it replaced.
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
            ) : null}
          </>
        ) : null}

        <details className={styles.addClass} data-hidden={view === 'today' && items.length > 0}>
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
              <Icon name="plus" size="nav" />
              Add class
            </Button>
          </div>
        </details>

        {loading ? null : items.length === 0 ? (
          <Panel title="Your week" flush>
            <EmptyState>
              No classes added yet. Add your weekly classes above, or import a timetable, and your
              week appears here day by day.
            </EmptyState>
          </Panel>
        ) : (
          <div hidden={view !== 'week'}>
            {/*
              THE REFERENCE'S LESSON LIST, and a week is the same shape: a
              small number of named groups, each holding a handful of timed
              items. A six-column grid said "spreadsheet"; six pastel sections
              that open say "your week", and the day you want is one click
              rather than a column to find.
            */}
            <div className={styles.weekStack}>
              <ToneAccordion
                label="Week"
                expanded
                items={WEEKDAYS.map((weekday) => {
                  const slots = byDay.get(weekday) ?? [];
                  return {
                    id: weekday,
                    title: weekday,
                    meta:
                      slots.length === 0 ? 'No classes' : formatCount(slots.length, 'class', 'classes'),
                    body:
                      slots.length === 0 ? (
                        <p className={styles.dayEmpty}>Nothing scheduled.</p>
                      ) : (
                        <ul className={styles.slotList}>
                          {slots.map((slot) => (
                            <SlotItem
                              key={slot.id}
                              slot={slot}
                              title={displayTitle(
                                resolveSubject(index, slot.subjectCode),
                                'timetable',
                              )}
                              onRemove={() => void remove(slot.id)}
                            />
                          ))}
                        </ul>
                      ),
                  };
                })}
              />
            </div>

            {/* Mobile: day agenda with explicit prev/next buttons */}
            <section className={styles.agenda}>
              <div className={styles.agendaNav}>
                <Button
                  iconOnly
                  aria-label="Previous day"
                  disabled={activeIndex === 0}
                  onClick={() => {
                    setActiveDay(WEEKDAYS[Math.max(0, activeIndex - 1)] ?? 'Mon');
                  }}
                >
                  <Icon name="chevronRight" size="nav" className={styles.flip} />
                </Button>
                <h2 className={styles.agendaTitle}>{activeDay}</h2>
                <Button
                  iconOnly
                  aria-label="Next day"
                  disabled={activeIndex === WEEKDAYS.length - 1}
                  onClick={() => {
                    setActiveDay(WEEKDAYS[Math.min(WEEKDAYS.length - 1, activeIndex + 1)] ?? 'Sat');
                  }}
                >
                  <Icon name="chevronRight" size="nav" />
                </Button>
              </div>
              {(byDay.get(activeDay) ?? []).length === 0 ? (
                <p className={styles.dayEmpty}>No classes on {activeDay}.</p>
              ) : (
                <ul className={styles.slotList}>
                  {(byDay.get(activeDay) ?? []).map((slot) => (
                    <SlotItem
                      key={slot.id}
                      slot={slot}
                      title={displayTitle(resolveSubject(index, slot.subjectCode), 'timetable')}
                      onRemove={() => void remove(slot.id)}
                    />
                  ))}
                </ul>
              )}
            </section>
          </div>
        )}
      </div>
    </>
  );
}

/**
 * Today, as an agenda.
 *
 * The primary view (M9.6F §10) and, since M10A.11, the place the daily loop
 * actually happens: the class is in front of the student, so the answer to
 * "did you go" is one tap rather than a trip to another screen to find the
 * same subject.
 *
 * NOW and NEXT are DERIVED, never stored (§17). Times are compared as "HH:MM"
 * strings, which sort correctly because the format is zero-padded and 24-hour —
 * no date arithmetic and no timezone to get wrong.
 */
function TodayAgenda({
  slots,
  titleFor,
  outcomeOf,
  holiday,
  onMark,
  onRemove,
}: {
  readonly slots: readonly TimetableSlot[];
  readonly titleFor: (code: string) => string;
  readonly outcomeOf: (slotId: string) => ClassOutcome | null;
  /** The calendar's own holiday covering today, where it printed one (§19). */
  readonly holiday: CalendarEvent | null;
  readonly onMark: (slot: TimetableSlot, outcome: ClassOutcome | null) => void;
  readonly onRemove: (id: string) => Promise<void> | void;
}) {
  const now = new Date();
  const clock = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const next = slots.find((slot) => slot.endTime > clock);

  /*
   * THE CALENDAR OUTRANKS THE TIMETABLE ON A DAY THE COLLEGE IS SHUT (§19,
   * §20). A timetable says what a Monday contains; the calendar says whether
   * this Monday is one. Showing the classes anyway would invite a student to
   * record attendance for a class that could not have happened.
   */
  if (holiday !== null) {
    return (
      <EmptyState title="No classes today" icons={['info']}>
        {holiday.title} — from your academic calendar.
      </EmptyState>
    );
  }

  if (slots.length === 0) {
    return (
      <EmptyState title="Nothing scheduled today" icons={['timetable']}>
        Classes you add for today appear here.
      </EmptyState>
    );
  }

  return (
    <ul className={styles.slotList}>
      {slots.map((slot) => (
        <SlotItem
          key={slot.id}
          slot={slot}
          title={titleFor(slot.subjectCode)}
          isNext={slot.id === next?.id}
          isNow={slot.startTime <= clock && clock < slot.endTime}
          outcome={outcomeOf(slot.id)}
          onMark={(outcome) => {
            onMark(slot, outcome);
          }}
          onRemove={() => void onRemove(slot.id)}
        />
      ))}
    </ul>
  );
}

function SlotItem({
  slot,
  title,
  onMark,
  onRemove,
  outcome = null,
  isNext = false,
  isNow = false,
}: {
  slot: TimetableSlot;
  /** Resolved by code from the student's own records. '' when nothing names it. */
  title: string;
  /** Only today's agenda offers this: marking a class in next week's grid is a guess. */
  onMark?: ((outcome: ClassOutcome | null) => void) | undefined;
  onRemove: () => void;
  /** What the student has already said about this class today, if anything. */
  outcome?: ClassOutcome | null;
  isNext?: boolean;
  isNow?: boolean;
}) {
  /*
   * The code leads when it is all there is, and the name leads when one is
   * known — with the code kept underneath, because the code is the identity and
   * the thing a student matches against a printed timetable.
   */
  const named = title !== '' && title !== slot.subjectCode;
  return (
    <li className={styles.slot} data-next={isNext} data-now={isNow} data-marked={outcome ?? undefined}>
      <div className={styles.slotTime}>
        <span>{formatTime(slot.startTime)}</span>
        <span className={styles.slotTimeEnd}>{formatTime(slot.endTime)}</span>
        {/* DERIVED, never stored (§17). It stops being true a minute later. */}
        {isNow && <span className={styles.nowTag}>Now</span>}
      </div>
      <div className={styles.slotBody}>
        <span className={styles.slotSubject}>{named ? title : slot.subjectCode}</span>
        <span className={styles.slotMeta}>
          {[named ? slot.subjectCode : null, slot.room, slot.faculty].filter(Boolean).join(' · ')}
        </span>
      </div>
      {/*
        ONLY ON TODAY'S AGENDA. The week grid shows classes that have not
        happened yet, and a button there would invite recording attendance for
        a Thursday on a Monday.
      */}
      {onMark !== undefined && (
        <span className={styles.slotActions}>
          {/*
            `aria-pressed` IS THE MARKED STATE (§28). A student must not have to
            remember what they tapped, and a screen reader must not have to
            guess it from a colour. Pressing the button that is already pressed
            is a no-op upstream, so a double tap cannot become a second class.
          */}
          <Button
            small
            aria-pressed={outcome === 'attended'}
            aria-label={`Mark ${slot.subjectCode} attended`}
            onClick={() => {
              onMark('attended');
            }}
          >
            Attended
          </Button>
          <Button
            small
            aria-pressed={outcome === 'missed'}
            aria-label={`Mark ${slot.subjectCode} missed`}
            onClick={() => {
              onMark('missed');
            }}
          >
            Missed
          </Button>
        </span>
      )}
      <Button
        variant="danger"
        iconOnly
        small
        aria-label={`Remove ${slot.subjectCode} on ${slot.day} at ${formatTime(slot.startTime)}`}
        onClick={onRemove}
      >
        <Icon name="trash" size="nav" />
      </Button>
    </li>
  );
}
