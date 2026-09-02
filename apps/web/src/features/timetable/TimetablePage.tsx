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

import { useMemo, useState } from 'react';
import { WEEKDAYS, type TimetableSlot, type Weekday } from '../../domain/types.js';
import { asStudentProfileId } from '../../domain/identity.js';
import { PageHeader } from '../../components/AppShell.js';
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
import { formatTime } from '../../lib/format.js';
import { newId } from '../../lib/id.js';
import {
  useAttendance,
  useProfile,
  useSemesterSubjects,
  useTimetable,
} from '../../hooks/useCollection.js';
import { markClass, startRecord, type ClassOutcome } from '../../domain/attendance.js';
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

  const markToday = (subjectCode: string, outcome: ClassOutcome) => {
    const code = subjectCode.replace(/\s+/g, '').toUpperCase();
    const existing = attendance.find(
      (record) => record.subjectCode.replace(/\s+/g, '').toUpperCase() === code,
    );
    if (existing !== undefined) {
      void saveAttendance(markClass(existing, outcome));
      return;
    }
    /*
     * No record yet: the first class of a subject the student has never opened
     * the attendance screen for. The title is resolved through the subject
     * index rather than typed again (M10A.1) — and falls back to the code,
     * which is honest rather than blank.
     */
    void saveAttendance(
      startRecord(
        {
          id: newId(),
          profileId: profile?.id ?? asStudentProfileId('local'),
          semester: profile?.currentSemester ?? 1,
          subjectCode: code,
          subjectTitle: displayTitle(resolveSubject(index, code), 'timetable') || code,
        },
        outcome,
      ),
    );
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

  return (
    <>
      <PageHeader title="Timetable" subtitle="Your weekly schedule, stored on this device." />

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
                  onMark={markToday}
                  onRemove={remove}
                />
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
              No classes added yet. Add your weekly classes above and they appear here as a grid on
              a wide screen and a day-by-day agenda on a phone.
            </EmptyState>
          </Panel>
        ) : (
          <div hidden={view !== 'week'}>
            {/* Desktop: week grid */}
            <div className={styles.weekGrid}>
              {WEEKDAYS.map((weekday) => (
                <section className={styles.dayColumn} key={weekday}>
                  <h2 className={styles.dayHeading}>{weekday}</h2>
                  {(byDay.get(weekday) ?? []).length === 0 ? (
                    <p className={styles.dayEmpty}>No classes</p>
                  ) : (
                    <ul className={styles.slotList}>
                      {(byDay.get(weekday) ?? []).map((slot) => (
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
              ))}
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
 * The primary view (M9.6F §10). Marks the class that has not finished yet as
 * NEXT, which is the single most useful thing this page can say and was
 * previously only on the dashboard.
 *
 * Times are compared as "HH:MM" strings, which sort correctly because the
 * format is zero-padded and 24-hour — no date arithmetic and no timezone to
 * get wrong.
 */
function TodayAgenda({
  slots,
  titleFor,
  onMark,
  onRemove,
}: {
  readonly slots: readonly TimetableSlot[];
  readonly titleFor: (code: string) => string;
  readonly onMark: (subjectCode: string, outcome: ClassOutcome) => void;
  readonly onRemove: (id: string) => Promise<void> | void;
}) {
  const now = new Date();
  const clock = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const next = slots.find((slot) => slot.endTime > clock);

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
          onMark={(outcome) => {
            onMark(slot.subjectCode, outcome);
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
  isNext = false,
}: {
  slot: TimetableSlot;
  /** Resolved by code from the student's own records. '' when nothing names it. */
  title: string;
  /** Only today's agenda offers this: marking a class in next week's grid is a guess. */
  onMark?: ((outcome: ClassOutcome) => void) | undefined;
  onRemove: () => void;
  isNext?: boolean;
}) {
  /*
   * The code leads when it is all there is, and the name leads when one is
   * known — with the code kept underneath, because the code is the identity and
   * the thing a student matches against a printed timetable.
   */
  const named = title !== '' && title !== slot.subjectCode;
  return (
    <li className={styles.slot} data-next={isNext}>
      <div className={styles.slotTime}>
        <span>{formatTime(slot.startTime)}</span>
        <span className={styles.slotTimeEnd}>{formatTime(slot.endTime)}</span>
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
          <Button
            small
            aria-label={`Mark ${slot.subjectCode} attended`}
            onClick={() => {
              onMark('attended');
            }}
          >
            Attended
          </Button>
          <Button
            small
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
