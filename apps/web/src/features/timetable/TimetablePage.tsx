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
import { ChevronRight, Plus, Trash2 } from '../../components/icons.js';
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
import { useProfile, useSemesterSubjects, useTimetable } from '../../hooks/useCollection.js';
import styles from './timetable.module.css';

function sortSlots(slots: readonly TimetableSlot[]): TimetableSlot[] {
  return [...slots].sort((a, b) => a.startTime.localeCompare(b.startTime));
}

export function TimetablePage() {
  const { items, loading, save, remove } = useTimetable();
  const { profile } = useProfile();

  const [day, setDay] = useState<Weekday>('Mon');
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
        <Panel title="Add a class" flush>
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
              <Plus size={16} aria-hidden="true" />
              Add class
            </Button>
          </div>
        </Panel>

        {loading ? null : items.length === 0 ? (
          <Panel title="Your week" flush>
            <EmptyState>
              No classes added yet. Add your weekly classes above and they appear here as a grid on
              a wide screen and a day-by-day agenda on a phone.
            </EmptyState>
          </Panel>
        ) : (
          <>
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
                        <SlotItem key={slot.id} slot={slot} onRemove={() => void remove(slot.id)} />
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
                  <ChevronRight size={16} aria-hidden="true" className={styles.flip} />
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
                  <ChevronRight size={16} aria-hidden="true" />
                </Button>
              </div>
              {(byDay.get(activeDay) ?? []).length === 0 ? (
                <p className={styles.dayEmpty}>No classes on {activeDay}.</p>
              ) : (
                <ul className={styles.slotList}>
                  {(byDay.get(activeDay) ?? []).map((slot) => (
                    <SlotItem key={slot.id} slot={slot} onRemove={() => void remove(slot.id)} />
                  ))}
                </ul>
              )}
            </section>
          </>
        )}
      </div>
    </>
  );
}

function SlotItem({ slot, onRemove }: { slot: TimetableSlot; onRemove: () => void }) {
  return (
    <li className={styles.slot}>
      <div className={styles.slotTime}>
        <span>{formatTime(slot.startTime)}</span>
        <span className={styles.slotTimeEnd}>{formatTime(slot.endTime)}</span>
      </div>
      <div className={styles.slotBody}>
        <span className={styles.slotSubject}>{slot.subjectCode}</span>
        {(slot.room !== null || slot.faculty !== null) && (
          <span className={styles.slotMeta}>
            {[slot.room, slot.faculty].filter(Boolean).join(' · ')}
          </span>
        )}
      </div>
      <Button
        variant="danger"
        iconOnly
        small
        aria-label={`Remove ${slot.subjectCode} on ${slot.day} at ${formatTime(slot.startTime)}`}
        onClick={onRemove}
      >
        <Trash2 size={15} aria-hidden="true" />
      </Button>
    </li>
  );
}
