/**
 * Adding or replacing a class for ONE date.
 *
 * ---------------------------------------------------------------------------
 * THIS DATE, NOT EVERY WEEK
 * ---------------------------------------------------------------------------
 *
 * The distinction is the whole point of the dialog, so it is in the title, in
 * the description and in the button — a student must never have to infer which
 * of the two they are about to change. Editing the recurring week is the
 * timetable's own job and says so there.
 *
 * A replacement is a NEW class with its own identity. The class it replaces
 * keeps whatever the student recorded against it, stops counting, and can be
 * restored; nothing about "attended Mathematics" is rewritten into "attended
 * Programming".
 */

import { useState } from 'react';
import { Button } from '../../components/ui/button.js';
import { Dialog, DialogBody, DialogContent, DialogFooter } from '../../components/ui/dialog.js';
import { Callout } from '../../components/ui/feedback.js';
import { Field, Input, Select } from '../../components/ui/field.js';
import { overlaps, type EffectiveClass } from '../../domain/day-schedule.js';
import type { OneOffClass, SemesterSubject } from '../../domain/types.js';

export interface ClassForDateIntent {
  readonly kind: 'add' | 'replace';
  /** The class being replaced, where that is what this is. */
  readonly replacing: EffectiveClass | null;
}

function longDate(date: string): string {
  return new Date(`${date}T00:00:00`).toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
}

export function ClassForDateDialog({
  intent,
  date,
  subjects,
  onDate,
  onClose,
  onSave,
}: {
  readonly intent: ClassForDateIntent | null;
  readonly date: string;
  readonly subjects: readonly SemesterSubject[];
  /** What is already on that date, for the overlap warning. */
  readonly onDate: readonly EffectiveClass[];
  readonly onClose: () => void;
  readonly onSave: (addition: OneOffClass, intent: ClassForDateIntent) => void;
}) {
  const replacing = intent?.replacing ?? null;
  const [code, setCode] = useState('');
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [room, setRoom] = useState('');
  const [error, setError] = useState<string | null>(null);

  const open = intent !== null;
  const start = startTime === '' ? (replacing?.startTime ?? '') : startTime;
  const end = endTime === '' ? (replacing?.endTime ?? '') : endTime;

  /*
   * A clash is REPORTED, never resolved. Two classes at one hour is a real
   * thing — a lab split, a rescheduled hour the college has not sorted out —
   * and quietly moving one of them would lose what the student meant.
   */
  const clashes =
    start === '' || end === ''
      ? []
      : onDate.filter(
          (entry) =>
            entry.classId !== replacing?.classId &&
            entry.status === 'scheduled' &&
            overlaps({ startTime: start, endTime: end }, entry),
        );

  const reset = (): void => {
    setCode('');
    setStartTime('');
    setEndTime('');
    setRoom('');
    setError(null);
  };

  const submit = (): void => {
    const cleaned = code.trim().toUpperCase();
    if (cleaned === '') return setError('Choose the course this class teaches.');
    if (start === '' || end === '') return setError('Enter when the class starts and ends.');
    if (end <= start) return setError('The class must end after it starts.');
    setError(null);
    onSave(
      {
        startTime: start,
        endTime: end,
        subjectCode: cleaned,
        activity: null,
        room: room.trim() === '' ? null : room.trim(),
        faculty: null,
        kind: 'course',
      },
      intent as ClassForDateIntent,
    );
    reset();
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          reset();
          onClose();
        }
      }}
    >
      <DialogContent
        title={replacing === null ? 'Add a class for this date' : 'Replace this class'}
        description={
          replacing === null
            ? `This adds one class to ${longDate(date)} only. Your weekly timetable is not changed.`
            : `${longDate(date)} only. The class being replaced keeps anything you already recorded against it, and stops counting.`
        }
      >
        <DialogBody className="flex flex-col gap-4">
          <Field label="Course" hint="The course this hour teaches.">
            <Select
              value={code}
              onValueChange={setCode}
              placeholder="Choose a course…"
              options={subjects.map((subject) => ({
                value: subject.code,
                label: `${subject.code} · ${subject.title}`,
              }))}
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Starts">
              <Input
                type="time"
                value={start}
                onChange={(event) => setStartTime(event.target.value)}
              />
            </Field>
            <Field label="Ends">
              <Input type="time" value={end} onChange={(event) => setEndTime(event.target.value)} />
            </Field>
          </div>
          <Field label="Room" hint="Optional.">
            <Input value={room} onChange={(event) => setRoom(event.target.value)} />
          </Field>

          {clashes.length > 0 && (
            <Callout tone="warning" title="This overlaps another class on this date.">
              {clashes
                .map((entry) => `${entry.startTime}–${entry.endTime} ${entry.subjectCode ?? ''}`)
                .join(', ')}
              . Both are kept as you entered them — nothing is moved for you.
            </Callout>
          )}
          {error !== null && (
            <Callout tone="danger" role="alert">
              {error}
            </Callout>
          )}
        </DialogBody>
        <DialogFooter>
          <Button
            onClick={() => {
              reset();
              onClose();
            }}
          >
            Cancel
          </Button>
          <Button variant="primary" onClick={submit}>
            {replacing === null ? 'Add for this date' : 'Replace for this date'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
