/**
 * Which semester an attendance record is filed under.
 *
 * The record's semester is required (types, cloud NOT NULL CHECK 1..8), so an
 * unset one cannot be stored — and must not be invented. It resolves the
 * Dashboard's way: the semester marked in progress first, the profile second.
 */

import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { screen, within } from '@testing-library/dom';
import { cleanup } from '@testing-library/react';
import { AttendancePage } from '../src/features/attendance/AttendancePage.js';
import { TimetablePage } from '../src/features/timetable/TimetablePage.js';
import { asStudentProfileId } from '../src/domain/identity.js';
import type {
  AttendanceRecord,
  SemesterRecord,
  StudentProfile,
  TimetableSlot,
} from '../src/domain/types.js';
import { choose, createMemoryRepositories, renderWith } from './helpers.js';

afterEach(cleanup);

/* A fixed Monday, as in attendance-workflow: "today" must have classes. */
vi.useFakeTimers({ toFake: ['Date'] });
vi.setSystemTime(new Date('2026-09-07T10:30:00'));
afterAll(() => {
  vi.useRealTimers();
});

const profileId = asStudentProfileId('p1');

function profile(currentSemester: number | null): StudentProfile {
  return {
    id: profileId,
    authUserId: null,
    displayName: null,
    usn: null,
    collegeName: null,
    programme: null,
    schemeId: 'vtu-2022',
    branch: null,
    currentSemester,
    createdAt: '',
    updatedAt: '',
  };
}

function inProgress(number: number): SemesterRecord {
  return {
    id: `s${String(number)}`,
    profileId,
    number,
    status: 'in_progress',
    startedOn: null,
    completedOn: null,
    updatedAt: '',
  };
}

const today = new Date().toLocaleDateString('en-GB', { weekday: 'short' }) as TimetableSlot['day'];

function slot(subjectCode: string): TimetableSlot {
  return {
    id: `t-${subjectCode}`,
    profileId,
    day: today,
    startTime: '09:00',
    endTime: '10:00',
    subjectCode,
    activity: null,
    room: null,
    faculty: null,
  };
}

async function addCourse(pickSemester?: RegExp): Promise<void> {
  const user = userEvent.setup();
  await user.click((await screen.findAllByRole('button', { name: /add a course/i }))[0]!);
  await screen.findByRole('dialog', { name: /add a course/i });
  await user.type(screen.getByLabelText(/^subject code$/i), 'BCS304');
  if (pickSemester !== undefined) await choose(/^semester$/i, pickSemester);
  await user.type(screen.getByLabelText(/^attended$/i), '45');
  await user.type(screen.getByLabelText(/^conducted$/i), '50');
  await user.click(screen.getByRole('button', { name: /^add$/i }));
}

describe('adding a course', () => {
  it.each([1, 2])('files it under the profile semester %i', async (number) => {
    const { bundle, peek } = createMemoryRepositories({ profile: profile(number) });
    renderWith(<AttendancePage />, { repositories: bundle });
    await addCourse();
    expect(peek.attendance()).toHaveLength(1);
    expect(peek.attendance()[0]?.semester).toBe(number);
  });

  it('prefers the semester marked in progress, and the header says so', async () => {
    const { bundle, peek } = createMemoryRepositories({
      profile: profile(null),
      semesters: [inProgress(5)],
    });
    renderWith(<AttendancePage />, { repositories: bundle });
    expect(await screen.findByText('Semester 5')).toBeTruthy();
    await addCourse();
    expect(peek.attendance()[0]?.semester).toBe(5);
  });

  it('asks rather than guessing when no semester is set, and writes nothing until answered', async () => {
    const { bundle, peek } = createMemoryRepositories({ profile: profile(null) });
    renderWith(<AttendancePage />, { repositories: bundle });
    await addCourse();

    expect(await screen.findByText(/choose the semester this course is in/i)).toBeTruthy();
    expect(screen.getByText(/cannot be guessed/i)).toBeTruthy();
    expect(peek.attendance()).toHaveLength(0);
    expect(peek.attendanceLedger()).toHaveLength(0);

    await choose(/^semester$/i, /^semester 3$/i);
    await userEvent.click(screen.getByRole('button', { name: /^add$/i }));
    expect(peek.attendance()).toHaveLength(1);
    expect(peek.attendance()[0]?.semester).toBe(3);
  });
});

describe('marking a class', () => {
  async function markToday(code: string): Promise<void> {
    const user = userEvent.setup();
    await user.click(await screen.findByRole('radio', { name: /^day$/i }));
    await user.click(
      await screen.findByRole('button', { name: new RegExp(`mark ${code} attended`, 'i') }),
    );
  }

  it('starts a new record under an explicit profile semester 1', async () => {
    const { bundle, peek } = createMemoryRepositories({
      profile: profile(1),
      timetable: [slot('BCS502')],
    });
    renderWith(<TimetablePage />, { repositories: bundle });
    await markToday('BCS502');
    expect(peek.attendance()[0]).toMatchObject({ subjectCode: 'BCS502', semester: 1 });
    expect(await screen.findByText(/^recorded/i)).toBeTruthy();
  });

  it('starts a new record under the semester marked in progress', async () => {
    const { bundle, peek } = createMemoryRepositories({
      profile: profile(3),
      semesters: [inProgress(5)],
      timetable: [slot('BCS502')],
    });
    renderWith(<TimetablePage />, { repositories: bundle });
    await markToday('BCS502');
    expect(peek.attendance()[0]).toMatchObject({ subjectCode: 'BCS502', semester: 5 });
  });

  it('refuses a new course from the timetable when no semester is set, writing nothing', async () => {
    const { bundle, peek } = createMemoryRepositories({
      profile: profile(null),
      timetable: [slot('BCS502')],
    });
    renderWith(<TimetablePage />, { repositories: bundle });
    await markToday('BCS502');

    expect(await screen.findByText(/set your current semester/i)).toBeTruthy();
    expect(screen.queryByText(/^recorded/i)).toBeNull();
    expect(peek.attendance()).toHaveLength(0);
    expect(peek.attendanceLedger()).toHaveLength(0);
    expect(peek.timetableOverrides()).toHaveLength(0);
  });

  it('refuses it on the attendance Today tab too, and marks normally once a semester is set', async () => {
    const user = userEvent.setup();
    const unset = createMemoryRepositories({
      profile: profile(null),
      timetable: [slot('BCS502')],
    });
    const first = renderWith(<AttendancePage />, { repositories: unset.bundle });
    const control = await screen.findByRole('radiogroup', { name: /attendance for BCS502/i });
    await user.click(within(control).getByRole('radio', { name: /attended/i }));

    expect(await screen.findByText(/set your current semester/i)).toBeTruthy();
    expect(screen.queryByText(/^recorded/i)).toBeNull();
    expect(unset.peek.attendance()).toHaveLength(0);
    expect(unset.peek.attendanceLedger()).toHaveLength(0);
    first.unmount();

    const set = createMemoryRepositories({ profile: profile(4), timetable: [slot('BCS502')] });
    renderWith(<AttendancePage />, { repositories: set.bundle });
    const again = await screen.findByRole('radiogroup', { name: /attendance for BCS502/i });
    await user.click(within(again).getByRole('radio', { name: /attended/i }));

    expect(await screen.findByText(/^recorded/i)).toBeTruthy();
    expect(screen.queryByText(/set your current semester/i)).toBeNull();
    expect(set.peek.attendance()[0]).toMatchObject({ semester: 4, attended: 1, conducted: 1 });
  });

  it('leaves an existing record in its own semester', async () => {
    const existing: AttendanceRecord = {
      id: 'a1',
      profileId,
      semester: 5,
      subjectCode: 'BCS501',
      subjectTitle: 'Software Engineering',
      attended: 30,
      conducted: 40,
      updatedAt: '',
    };
    const { bundle, peek } = createMemoryRepositories({
      profile: profile(null),
      attendance: [existing],
      timetable: [slot('BCS501')],
    });
    renderWith(<TimetablePage />, { repositories: bundle });
    await markToday('BCS501');
    expect(peek.attendance()[0]).toMatchObject({ semester: 5, attended: 31, conducted: 41 });
  });
});
