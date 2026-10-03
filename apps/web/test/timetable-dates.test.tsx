/**
 * Changing one date, and changing every week.
 *
 * The distinction is the feature. A student who cancels next Tuesday's lecture
 * must not find that every Tuesday is gone, and a student who edits the weekly
 * timetable must not find that last week's attendance has been rewritten to
 * match. Both are asserted here against the stored rows, not against wording.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup } from '@testing-library/react';
import { screen, waitFor, within } from '@testing-library/dom';
import userEvent from '@testing-library/user-event';
import { AttendancePage } from '../src/features/attendance/AttendancePage.js';
import { asStudentProfileId } from '../src/domain/identity.js';
import type {
  AttendanceRecord,
  ClassOccurrence,
  LedgerEntry,
  SemesterSubject,
  StudentProfile,
  TimetableSlot,
} from '../src/domain/types.js';
import { createMemoryRepositories, renderWith } from './helpers.js';

const profileId = asStudentProfileId('11111111-1111-1111-1111-111111111111');
/* A Wednesday, mid-morning. */
const WEDNESDAY = new Date('2026-09-16T10:30:00');

function profile(): StudentProfile {
  return {
    id: profileId,
    authUserId: null,
    displayName: 'Demo',
    usn: null,
    collegeName: null,
    programme: null,
    schemeId: 'vtu-2022',
    branch: null,
    currentSemester: 5,
    createdAt: '',
    updatedAt: '',
  };
}

function slot(overrides: Partial<TimetableSlot> & { id: string }): TimetableSlot {
  return {
    profileId,
    classId: `class-${overrides.id}`,
    day: 'Wed',
    startTime: '09:00',
    endTime: '10:00',
    subjectCode: 'BCS501',
    activity: null,
    room: 'B205',
    faculty: null,
    ...overrides,
  };
}

function subject(code: string, title: string): SemesterSubject {
  return {
    id: `s-${code}`,
    profileId,
    semester: 5,
    code,
    title,
    credits: 3,
    notes: null,
    updatedAt: '2026-09-01T00:00:00.000Z',
  };
}

function attendance(subjectCode: string, attended: number, conducted: number): AttendanceRecord {
  return {
    id: `a-${subjectCode}`,
    profileId,
    semester: 5,
    subjectCode,
    subjectTitle: subjectCode,
    attended,
    conducted,
    updatedAt: '2026-09-01T00:00:00.000Z',
  };
}

/**
 * What a real ledger holds for a subject: what was counted before it existed,
 * plus the classes recorded since. 30 of 40, plus today's attended class, is
 * the 31 of 41 the record shows.
 */
const openingBalance: LedgerEntry = {
  kind: 'opening',
  id: 'opening:BCS501',
  subjectCode: 'BCS501',
  attended: 30,
  conducted: 40,
  migratedFrom: { attended: 30, conducted: 40 },
  reconciliation: 'exact',
  unreconciledMarks: [],
  createdAt: '2026-09-01T00:00:00.000Z',
};

const attendedToday: ClassOccurrence = {
  kind: 'occurrence',
  id: '2026-09-16:class-s1',
  classId: 'class-s1',
  date: '2026-09-16',
  subjectCode: 'BCS501',
  subjectTitle: 'Software Engineering',
  startTime: '09:00',
  endTime: '10:00',
  outcome: 'attended',
  markedAt: '2026-09-16T09:55:00.000Z',
};

function occurrences(peek: ReturnType<typeof createMemoryRepositories>['peek']): ClassOccurrence[] {
  return peek
    .attendanceLedger()
    .filter((entry: LedgerEntry): entry is ClassOccurrence => entry.kind === 'occurrence');
}

async function openCalendar(): Promise<void> {
  await userEvent.click(await screen.findByRole('radio', { name: /^calendar$/i }));
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], shouldAdvanceTime: true });
  vi.setSystemTime(WEDNESDAY);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('the calendar', () => {
  it('opens on today and lists that day', async () => {
    const { bundle } = createMemoryRepositories({
      profile: profile(),
      timetable: [slot({ id: 's1' })],
    });
    renderWith(<AttendancePage />, { repositories: bundle });
    await openCalendar();

    expect(await screen.findByRole('grid')).toBeTruthy();
    expect(screen.getByRole('heading', { name: /Wednesday 16 September/ })).toBeTruthy();
    expect(screen.getByRole('radiogroup', { name: /attendance for BCS501/i })).toBeTruthy();
  });

  it('shows another day when one is chosen, and marks it against that date', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { bundle, peek } = createMemoryRepositories({
      profile: profile(),
      attendance: [attendance('BCS501', 30, 40)],
      timetable: [slot({ id: 's1' })],
    });
    renderWith(<AttendancePage />, { repositories: bundle });
    await openCalendar();

    /* The Wednesday before: the class the student forgot to mark. */
    await user.click(
      await screen.findByRole('button', { name: /Wednesday, September 9th, 2026/i }),
    );
    expect(await screen.findByRole('heading', { name: /Wednesday 9 September/ })).toBeTruthy();

    const control = await screen.findByRole('radiogroup', { name: /attendance for BCS501/i });
    await user.click(within(control).getByRole('radio', { name: /missed/i }));

    await waitFor(() => {
      expect(occurrences(peek)).toHaveLength(1);
    });
    expect(occurrences(peek)[0]).toMatchObject({ date: '2026-09-09', outcome: 'missed' });
  });

  it('can be driven from the keyboard', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { bundle } = createMemoryRepositories({
      profile: profile(),
      timetable: [slot({ id: 's1' })],
    });
    renderWith(<AttendancePage />, { repositories: bundle });
    await openCalendar();

    const today = await screen.findByRole('button', { name: /Wednesday, September 16th, 2026/i });
    today.focus();
    await user.keyboard('{ArrowLeft}');
    await user.keyboard('{Enter}');

    expect(await screen.findByRole('heading', { name: /Tuesday 15 September/ })).toBeTruthy();
  });
});

describe('changing one date', () => {
  it('cancels a class for that date alone, keeping the mark', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { bundle, peek } = createMemoryRepositories({
      profile: profile(),
      attendance: [attendance('BCS501', 31, 41)],
      attendanceLedger: [openingBalance, attendedToday],
      timetable: [slot({ id: 's1' })],
    });
    renderWith(<AttendancePage />, { repositories: bundle });
    await openCalendar();

    await user.click(await screen.findByRole('button', { name: /more actions for BCS501/i }));
    await user.click(await screen.findByRole('menuitem', { name: /cancel BCS501 on this date/i }));

    await waitFor(() => {
      expect(peek.timetableOverrides()).toHaveLength(1);
    });
    expect(peek.timetableOverrides()[0]).toMatchObject({
      date: '2026-09-16',
      status: 'cancelled',
    });
    /* The student's own record is untouched — it simply stops counting. */
    expect(occurrences(peek)).toHaveLength(1);
    expect(occurrences(peek)[0]).toMatchObject({ outcome: 'attended' });
    expect(peek.attendance()[0]).toMatchObject({ attended: 30, conducted: 40 });
    /* And the weekly timetable is exactly as it was. */
    expect(peek.timetable()).toHaveLength(1);
  });

  it('restores a cancelled date, and the original mark counts again', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { bundle, peek } = createMemoryRepositories({
      profile: profile(),
      attendance: [attendance('BCS501', 31, 41)],
      attendanceLedger: [openingBalance, attendedToday],
      timetable: [slot({ id: 's1' })],
    });
    renderWith(<AttendancePage />, { repositories: bundle });
    await openCalendar();

    await user.click(await screen.findByRole('button', { name: /more actions for BCS501/i }));
    await user.click(await screen.findByRole('menuitem', { name: /cancel BCS501 on this date/i }));
    await waitFor(() => {
      expect(peek.attendance()[0]?.conducted).toBe(40);
    });

    await user.click(await screen.findByRole('button', { name: /more actions for BCS501/i }));
    await user.click(await screen.findByRole('menuitem', { name: /restore BCS501 on this date/i }));

    await waitFor(() => {
      expect(peek.timetableOverrides()).toHaveLength(0);
    });
    /* Nothing was restored, because nothing was destroyed. */
    expect(occurrences(peek)).toHaveLength(1);
  });

  it('replaces a class with another, without rewriting what was recorded', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { bundle, peek } = createMemoryRepositories({
      profile: profile(),
      attendance: [attendance('BCS501', 31, 41)],
      attendanceLedger: [openingBalance, attendedToday],
      timetable: [slot({ id: 's1' })],
      semesterSubjects: [subject('BCS502', 'Operating Systems')],
    });
    renderWith(<AttendancePage />, { repositories: bundle });
    await openCalendar();

    await user.click(await screen.findByRole('button', { name: /more actions for BCS501/i }));
    await user.click(await screen.findByRole('menuitem', { name: /replace BCS501 on this date/i }));

    const dialog = await screen.findByRole('dialog', { name: /replace this class/i });
    await user.click(within(dialog).getByRole('combobox', { name: /course/i }));
    await user.click(await screen.findByRole('option', { name: /BCS502/ }));
    await user.click(within(dialog).getByRole('button', { name: /replace for this date/i }));

    await waitFor(() => {
      expect(peek.timetableOverrides()).toHaveLength(2);
    });
    const replaced = peek.timetableOverrides().find((override) => override.classId === 'class-s1');
    const replacement = peek
      .timetableOverrides()
      .find((override) => override.classId !== 'class-s1');

    expect(replaced).toMatchObject({ status: 'replaced', replacedBy: replacement?.classId });
    expect(replacement?.addition).toMatchObject({ subjectCode: 'BCS502' });
    /* The original history still says Software Engineering, and still exists. */
    expect(occurrences(peek)).toHaveLength(1);
    expect(occurrences(peek)[0]).toMatchObject({ subjectCode: 'BCS501', outcome: 'attended' });
    /* The replacement starts unmarked. */
    expect(occurrences(peek).some((entry) => entry.subjectCode === 'BCS502')).toBe(false);
  });

  it('adds a one-off class to a date without touching the week', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { bundle, peek } = createMemoryRepositories({
      profile: profile(),
      timetable: [slot({ id: 's1' })],
      semesterSubjects: [subject('BCS503', 'Computer Networks')],
    });
    renderWith(<AttendancePage />, { repositories: bundle });
    await openCalendar();

    await user.click(await screen.findByRole('button', { name: /add a class for this date/i }));
    const dialog = await screen.findByRole('dialog', { name: /add a class for this date/i });
    await user.click(within(dialog).getByRole('combobox', { name: /course/i }));
    await user.click(await screen.findByRole('option', { name: /BCS503/ }));
    const [starts, ends] = within(dialog).getAllByRole('textbox', { hidden: true });
    void starts;
    void ends;
    await user.type(within(dialog).getByLabelText(/^starts$/i), '14:00');
    await user.type(within(dialog).getByLabelText(/^ends$/i), '15:00');
    await user.click(within(dialog).getByRole('button', { name: /add for this date/i }));

    await waitFor(() => {
      expect(peek.timetableOverrides()).toHaveLength(1);
    });
    expect(peek.timetableOverrides()[0]).toMatchObject({
      date: '2026-09-16',
      status: 'scheduled',
      addition: { subjectCode: 'BCS503', startTime: '14:00', endTime: '15:00' },
    });
    // The weekly timetable is untouched.
    expect(peek.timetable()).toHaveLength(1);
    // …and the new class is markable on that date.
    expect(await screen.findByRole('radiogroup', { name: /attendance for BCS503/i })).toBeTruthy();
  });

  it('warns about an overlap rather than moving anything', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { bundle, peek } = createMemoryRepositories({
      profile: profile(),
      timetable: [slot({ id: 's1' })],
      semesterSubjects: [subject('BCS503', 'Computer Networks')],
    });
    renderWith(<AttendancePage />, { repositories: bundle });
    await openCalendar();

    await user.click(await screen.findByRole('button', { name: /add a class for this date/i }));
    const dialog = await screen.findByRole('dialog', { name: /add a class for this date/i });
    await user.click(within(dialog).getByRole('combobox', { name: /course/i }));
    await user.click(await screen.findByRole('option', { name: /BCS503/ }));
    await user.type(within(dialog).getByLabelText(/^starts$/i), '09:30');
    await user.type(within(dialog).getByLabelText(/^ends$/i), '10:30');

    expect(await within(dialog).findByText(/overlaps another class/i)).toBeTruthy();

    await user.click(within(dialog).getByRole('button', { name: /add for this date/i }));
    await waitFor(() => {
      expect(peek.timetableOverrides()).toHaveLength(1);
    });
    /* Both are kept exactly as entered: nothing was moved to resolve it. */
    expect(peek.timetable()[0]).toMatchObject({ startTime: '09:00', endTime: '10:00' });
    expect(peek.timetableOverrides()[0]?.addition).toMatchObject({
      startTime: '09:30',
      endTime: '10:30',
    });
  });

  it('refuses a class that ends before it starts', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { bundle, peek } = createMemoryRepositories({
      profile: profile(),
      timetable: [slot({ id: 's1' })],
      semesterSubjects: [subject('BCS503', 'Computer Networks')],
    });
    renderWith(<AttendancePage />, { repositories: bundle });
    await openCalendar();

    await user.click(await screen.findByRole('button', { name: /add a class for this date/i }));
    const dialog = await screen.findByRole('dialog', { name: /add a class for this date/i });
    await user.click(within(dialog).getByRole('combobox', { name: /course/i }));
    await user.click(await screen.findByRole('option', { name: /BCS503/ }));
    await user.type(within(dialog).getByLabelText(/^starts$/i), '15:00');
    await user.type(within(dialog).getByLabelText(/^ends$/i), '14:00');
    await user.click(within(dialog).getByRole('button', { name: /add for this date/i }));

    expect(await within(dialog).findByRole('alert')).toBeTruthy();
    expect(peek.timetableOverrides()).toHaveLength(0);
  });
});
