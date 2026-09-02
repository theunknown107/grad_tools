/**
 * The daily loop: a class happens, and the student records it.
 *
 * Authority: docs/22 §22.47 · core product §12, §32
 *
 * Before this the attendance screen offered exactly two operations — add a
 * subject with both totals typed in, or delete it — so recording a day of five
 * lectures meant retyping five subject codes and ten numbers. These tests pin
 * the action that replaced that, and the undo that makes it safe to tap.
 */

import { afterEach, describe, expect, it } from 'vitest';
import userEvent from '@testing-library/user-event';
import { screen } from '@testing-library/dom';
import { cleanup } from '@testing-library/react';
import { AttendancePage } from '../src/features/attendance/AttendancePage.js';
import { TimetablePage } from '../src/features/timetable/TimetablePage.js';
import { asStudentProfileId } from '../src/domain/identity.js';
import type { AttendanceRecord, StudentProfile, TimetableSlot } from '../src/domain/types.js';
import { createMemoryRepositories, renderWith } from './helpers.js';

afterEach(cleanup);

const profileId = asStudentProfileId('p1');

function attendance(subjectCode: string, attended: number, conducted: number): AttendanceRecord {
  return {
    id: `a-${subjectCode}`,
    profileId,
    semester: 5,
    subjectCode,
    subjectTitle: 'Software Engineering',
    attended,
    conducted,
    updatedAt: '',
  };
}

function profile(): StudentProfile {
  return {
    id: profileId,
    authUserId: null,
    displayName: 'Demo',
    usn: null,
    collegeName: null,
    schemeId: 'vtu-2022',
    branch: null,
    currentSemester: 5,
    createdAt: '',
    updatedAt: '',
  };
}

/** Today, in the three-letter form the records use. */
const today = new Date().toLocaleDateString('en-GB', { weekday: 'short' }) as TimetableSlot['day'];

function slot(subjectCode: string): TimetableSlot {
  return {
    id: `t-${subjectCode}`,
    profileId,
    day: today,
    startTime: '09:00',
    endTime: '10:00',
    subjectCode,
    room: 'B205',
    faculty: null,
  };
}

describe('recording a class from the attendance page', () => {
  it('raises both counts when the class was attended', async () => {
    const user = userEvent.setup();
    const { bundle, peek } = createMemoryRepositories({
      attendance: [attendance('BCS501', 30, 40)],
    });
    renderWith(<AttendancePage />, { repositories: bundle });

    await user.click(await screen.findByRole('button', { name: /mark a class attended/i }));

    expect(peek.attendance()[0]).toMatchObject({ attended: 31, conducted: 41 });
  });

  it('raises only the classes held when it was missed', async () => {
    // A missed class still HAPPENED. Leaving `conducted` alone would quietly
    // preserve the percentage, which treats attendance as a score.
    const user = userEvent.setup();
    const { bundle, peek } = createMemoryRepositories({
      attendance: [attendance('BCS501', 30, 40)],
    });
    renderWith(<AttendancePage />, { repositories: bundle });

    await user.click(await screen.findByRole('button', { name: /mark a class missed/i }));

    expect(peek.attendance()[0]).toMatchObject({ attended: 30, conducted: 41 });
  });

  it('takes the last mark back', async () => {
    /*
     * The buttons sit next to each other and get pressed while walking out of a
     * lecture, so a mis-tap is the ordinary mistake — and the fix has to be as
     * cheap as the error.
     */
    const user = userEvent.setup();
    const { bundle, peek } = createMemoryRepositories({
      attendance: [attendance('BCS501', 30, 40)],
    });
    renderWith(<AttendancePage />, { repositories: bundle });

    await user.click(await screen.findByRole('button', { name: /mark a class attended/i }));
    expect(peek.attendance()[0]).toMatchObject({ attended: 31, conducted: 41 });

    await user.click(await screen.findByRole('button', { name: /^undo$/i }));
    expect(peek.attendance()[0]).toMatchObject({ attended: 30, conducted: 40 });
  });

  it('updates the figure the student came to read', async () => {
    // 30 of 40 is 75%; 31 of 41 is above it. The percentage comes from the
    // rules engine, so the row and the marking cannot disagree.
    const user = userEvent.setup();
    const { bundle } = createMemoryRepositories({ attendance: [attendance('BCS501', 30, 40)] });
    renderWith(<AttendancePage />, { repositories: bundle });

    expect((await screen.findAllByText('75.0%')).length).toBeGreaterThan(0);
    await user.click(screen.getByRole('button', { name: /mark a class attended/i }));
    expect(screen.queryByText('75.0%')).toBeNull();
    // 31 of 41 is 75.6%, still from calculateAttendance rather than from here.
    expect(screen.getAllByText('75.6%').length).toBeGreaterThan(0);
  });
});

describe("recording a class from today's timetable", () => {
  it('marks attendance for a class the student is looking at', async () => {
    /*
     * THE LOOP §32 DESCRIBES. The student is already looking at the class that
     * just happened; sending them to another screen to find the same subject is
     * the errand this removes.
     */
    const user = userEvent.setup();
    const { bundle, peek } = createMemoryRepositories({
      profile: profile(),
      attendance: [attendance('BCS501', 30, 40)],
      timetable: [slot('BCS501')],
    });
    renderWith(<TimetablePage />, { repositories: bundle });

    await user.click(await screen.findByRole('button', { name: /mark BCS501 attended/i }));

    expect(peek.attendance()[0]).toMatchObject({ attended: 31, conducted: 41 });
  });

  it('starts a record for a subject that has none yet', async () => {
    // The first class of a subject the student has never opened the attendance
    // screen for. Refusing it would make a one-tap action a three-screen errand.
    const user = userEvent.setup();
    const { bundle, peek } = createMemoryRepositories({
      profile: profile(),
      attendance: [],
      timetable: [slot('BCS502')],
    });
    renderWith(<TimetablePage />, { repositories: bundle });

    await user.click(await screen.findByRole('button', { name: /mark BCS502 attended/i }));

    expect(peek.attendance()).toHaveLength(1);
    expect(peek.attendance()[0]).toMatchObject({
      subjectCode: 'BCS502',
      attended: 1,
      conducted: 1,
      semester: 5,
    });
  });

  it('finds the record however the code was spaced or cased', async () => {
    /*
     * The timetable stores `BCS 501` and attendance stores `bcs501`; they are
     * one subject (M10A.1). Creating a second record here would split the
     * student's own count in half without either screen looking wrong.
     */
    const user = userEvent.setup();
    const { bundle, peek } = createMemoryRepositories({
      profile: profile(),
      attendance: [attendance('bcs501', 30, 40)],
      timetable: [slot('BCS 501')],
    });
    renderWith(<TimetablePage />, { repositories: bundle });

    await user.click(await screen.findByRole('button', { name: /mark BCS 501 attended/i }));

    expect(peek.attendance()).toHaveLength(1);
    expect(peek.attendance()[0]).toMatchObject({ attended: 31, conducted: 41 });
  });
});
