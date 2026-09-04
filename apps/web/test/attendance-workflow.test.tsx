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

import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { screen } from '@testing-library/dom';
import { cleanup } from '@testing-library/react';
import { AttendancePage } from '../src/features/attendance/AttendancePage.js';
import { TimetablePage } from '../src/features/timetable/TimetablePage.js';
import { DashboardPage } from '../src/features/dashboard/DashboardPage.js';
import { asStudentProfileId } from '../src/domain/identity.js';
import type { AttendanceRecord, StudentProfile, TimetableSlot } from '../src/domain/types.js';
import type { SavedCalendar } from '../src/domain/calendar-import.js';
import { localDay } from '../src/lib/format.js';
import { createMemoryRepositories, renderWith } from './helpers.js';

afterEach(cleanup);

/*
 * A FIXED MONDAY, 10:30.
 *
 * Every assertion here is about "today" — today's classes, today's marks, the
 * class happening now — and the suite used to read the machine's clock. That
 * made it correct six days a week and broken on the seventh: Sunday is not a
 * teaching day, `WEEKDAYS` does not contain it, and today's agenda would have
 * been empty for reasons that have nothing to do with the code under test.
 *
 * Only Date is faked; timers are left alone so `userEvent` still works.
 */
vi.useFakeTimers({ toFake: ['Date'] });
vi.setSystemTime(new Date('2026-09-07T10:30:00'));
afterAll(() => {
  vi.useRealTimers();
});

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

/* -------------------------------------------------------------------------- */
/* M10A.11 — the daily loop, and what must never happen twice                  */
/* -------------------------------------------------------------------------- */

/** Today as the marks store it: the device's own day, not UTC's (§13). */
const todayDate = localDay();

function holidayCalendar(date: string, title: string): SavedCalendar {
  return {
    id: 'c1',
    semester: 5,
    academicYear: '2026-27',
    events: [
      {
        id: 'e1',
        startDate: date,
        endDate: null,
        title,
        category: 'HOLIDAY',
        sourceLine: `${date} ${title}`,
        page: 1,
      },
    ],
    fingerprint: 'f1',
    importedAt: '2026-09-01T00:00:00.000Z',
    sourceKind: 'text',
  };
}

describe('a class cannot be counted twice', () => {
  it('ignores a second tap on the answer that is already given', async () => {
    /*
     * THE FAILURE THIS EXISTS TO PREVENT. Two taps on Attended — a double
     * click, an impatient press, a button that did not look like it responded —
     * used to be two classes, and the student's percentage was quietly wrong
     * with nothing on screen looking odd (§13).
     */
    const user = userEvent.setup();
    const { bundle, peek } = createMemoryRepositories({
      profile: profile(),
      attendance: [attendance('BCS501', 30, 40)],
      timetable: [slot('BCS501')],
    });
    renderWith(<TimetablePage />, { repositories: bundle });

    const button = await screen.findByRole('button', { name: /mark BCS501 attended/i });
    await user.click(button);
    await user.click(button);
    await user.click(button);

    expect(peek.attendance()[0]).toMatchObject({ attended: 31, conducted: 41 });
    expect(peek.classMarks()).toHaveLength(1);
  });

  it('still knows what was marked after the student walks away and comes back', async () => {
    /*
     * The stored mark is what makes this survive navigation. Without it the
     * page would forget on unmount, offer the class again, and count it twice
     * for a student who simply looked at the dashboard in between.
     */
    const user = userEvent.setup();
    const { bundle, peek } = createMemoryRepositories({
      profile: profile(),
      attendance: [attendance('BCS501', 30, 40)],
      timetable: [slot('BCS501')],
    });
    const first = renderWith(<TimetablePage />, { repositories: bundle });
    await user.click(await screen.findByRole('button', { name: /mark BCS501 attended/i }));
    first.unmount();

    renderWith(<TimetablePage />, { repositories: bundle });
    const button = await screen.findByRole('button', { name: /mark BCS501 attended/i });
    expect(button.getAttribute('aria-pressed')).toBe('true');

    await user.click(button);
    expect(peek.attendance()[0]).toMatchObject({ attended: 31, conducted: 41 });
  });

  it('keeps two classes of the same subject on the same day apart', async () => {
    // A subject scheduled twice is two classes, and both count.
    const user = userEvent.setup();
    const { bundle, peek } = createMemoryRepositories({
      profile: profile(),
      attendance: [attendance('BCS501', 30, 40)],
      timetable: [
        slot('BCS501'),
        { ...slot('BCS501'), id: 't-second', startTime: '11:00', endTime: '12:00' },
      ],
    });
    renderWith(<TimetablePage />, { repositories: bundle });

    const buttons = await screen.findAllByRole('button', { name: /mark BCS501 attended/i });
    await user.click(buttons[0] as HTMLElement);
    await user.click(buttons[1] as HTMLElement);

    expect(peek.attendance()[0]).toMatchObject({ attended: 32, conducted: 42 });
    expect(peek.classMarks()).toHaveLength(2);
  });
});

describe('correcting what was marked', () => {
  it('moves attended to missed without inventing a second class', async () => {
    const user = userEvent.setup();
    const { bundle, peek } = createMemoryRepositories({
      profile: profile(),
      attendance: [attendance('BCS501', 30, 40)],
      timetable: [slot('BCS501')],
    });
    renderWith(<TimetablePage />, { repositories: bundle });

    await user.click(await screen.findByRole('button', { name: /mark BCS501 attended/i }));
    await user.click(screen.getByRole('button', { name: /mark BCS501 missed/i }));

    // The class happened either way: `conducted` rose once, not twice.
    expect(peek.attendance()[0]).toMatchObject({ attended: 30, conducted: 41 });
    expect(peek.classMarks()[0]).toMatchObject({ outcome: 'missed' });
  });

  it('takes the mark back entirely, counts and all', async () => {
    /*
     * The class that turned out not to have happened (§30). Undo returns the
     * record to where it was and removes the mark, so the class is offered
     * again rather than left half-recorded.
     */
    const user = userEvent.setup();
    const { bundle, peek } = createMemoryRepositories({
      profile: profile(),
      attendance: [attendance('BCS501', 30, 40)],
      timetable: [slot('BCS501')],
    });
    renderWith(<TimetablePage />, { repositories: bundle });

    await user.click(await screen.findByRole('button', { name: /mark BCS501 attended/i }));
    await user.click(await screen.findByRole('button', { name: /^undo$/i }));

    expect(peek.attendance()[0]).toMatchObject({ attended: 30, conducted: 40 });
    expect(peek.classMarks()).toHaveLength(0);
    expect(
      screen.getByRole('button', { name: /mark BCS501 attended/i }).getAttribute('aria-pressed'),
    ).toBe('false');
  });
});

describe('a day the college is shut', () => {
  it('offers no class actions when the calendar printed a holiday', async () => {
    /*
     * THE CALENDAR OUTRANKS THE TIMETABLE (§19, §20). A timetable says what a
     * Monday contains; the calendar says whether this Monday is one. Showing
     * the classes anyway invites attendance for a class that could not have
     * happened.
     */
    const { bundle } = createMemoryRepositories({
      profile: profile(),
      timetable: [slot('BCS501')],
      calendars: [holidayCalendar(todayDate, 'Ganesh Chaturthi')],
    });
    renderWith(<TimetablePage />, { repositories: bundle });

    expect(await screen.findByText(/Ganesh Chaturthi/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /mark BCS501 attended/i })).toBeNull();
  });

  it('says which document said so', async () => {
    // Provenance without technical detail (§25).
    const { bundle } = createMemoryRepositories({
      profile: profile(),
      timetable: [slot('BCS501')],
      calendars: [holidayCalendar(todayDate, 'Ganesh Chaturthi')],
    });
    renderWith(<TimetablePage />, { repositories: bundle });

    expect(await screen.findByText(/from your academic calendar/i)).toBeTruthy();
  });

  it('shows the classes again on a day the calendar says nothing about', async () => {
    const { bundle } = createMemoryRepositories({
      profile: profile(),
      timetable: [slot('BCS501')],
      calendars: [holidayCalendar('2020-01-01', 'Some other year')],
    });
    renderWith(<TimetablePage />, { repositories: bundle });

    expect(await screen.findByRole('button', { name: /mark BCS501 attended/i })).toBeTruthy();
  });
});

describe('which timetable am I looking at', () => {
  it('shows the revision and the date it takes effect', async () => {
    // Read at import and stored since M10A.8, and shown nowhere until now.
    const { bundle } = createMemoryRepositories({
      profile: profile(),
      timetable: [slot('BCS501')],
      timetableImports: [
        {
          id: 'i1',
          className: '5 SEM CSE A',
          semester: 5,
          academicYear: '2026-27',
          revision: 'R2',
          effectiveFrom: '2026-07-15',
          batch: null,
          fingerprint: 'tf1',
          importedAt: '2026-09-01T00:00:00.000Z',
          slotCount: 1,
        },
      ],
    });
    renderWith(<TimetablePage />, { repositories: bundle });

    expect(await screen.findByText(/5 SEM CSE A · R2 · from 15 Jul 2026/)).toBeTruthy();
  });

  it('says so when a later revision is also stored', async () => {
    /*
     * Two revisions in storage and one week on screen. Which one produced the
     * classes is a fact the student is entitled to rather than one the screen
     * settles quietly (§24).
     */
    const base = {
      className: '5 SEM CSE A',
      semester: 5,
      academicYear: '2026-27',
      batch: null,
      slotCount: 1,
    };
    const { bundle } = createMemoryRepositories({
      profile: profile(),
      timetable: [slot('BCS501')],
      timetableImports: [
        {
          ...base,
          id: 'i2',
          revision: 'R3',
          effectiveFrom: '2026-08-01',
          fingerprint: 'tf2',
          importedAt: '2026-09-01T00:00:00.000Z',
        },
        {
          ...base,
          id: 'i1',
          revision: 'R2',
          effectiveFrom: '2026-07-15',
          fingerprint: 'tf1',
          importedAt: '2026-09-02T00:00:00.000Z',
        },
      ],
    });
    renderWith(<TimetablePage />, { repositories: bundle });

    expect(
      await screen.findByText(/A timetable effective 1 Aug 2026 was also imported/),
    ).toBeTruthy();
  });
});

describe('a lab is one class', () => {
  it('offers one attendance action for a block that spans several periods', async () => {
    /*
     * The parser already reads a lab written across three columns as ONE class
     * with one start and one end (M10A.8). This pins the consequence: three
     * buttons would count a two-hour lab three times (§32).
     */
    const { bundle } = createMemoryRepositories({
      profile: profile(),
      timetable: [{ ...slot('BCSL504'), startTime: '14:00', endTime: '17:00' }],
    });
    renderWith(<TimetablePage />, { repositories: bundle });

    expect(await screen.findAllByRole('button', { name: /mark BCSL504 attended/i })).toHaveLength(1);
  });
});

describe('the class happening right now', () => {
  it('names it, and only while it is true', async () => {
    /*
     * DERIVED, NEVER STORED (§17). The clock is pinned to 10:30, so the 10:00
     * class is the one in progress and the 09:00 one is over. A minute of real
     * time changes the answer, which is exactly why nothing persists it.
     */
    const { bundle } = createMemoryRepositories({
      profile: profile(),
      timetable: [
        slot('BCS501'),
        { ...slot('BCS502'), id: 't-now', startTime: '10:00', endTime: '11:00' },
      ],
    });
    renderWith(<TimetablePage />, { repositories: bundle });

    expect(await screen.findAllByText('Now')).toHaveLength(1);
  });
});

describe('what did I mark, seen from the dashboard', () => {
  it('reports the decision without offering to take it again', async () => {
    /*
     * READ-ONLY HERE (§35). The actions live on the timetable's Today; two
     * screens both able to mark the same class is how the two come to disagree.
     */
    const { bundle } = createMemoryRepositories({
      profile: profile(),
      timetable: [slot('BCS501')],
      classMarks: [
        {
          id: `${todayDate}:t-BCS501`,
          profileId,
          date: todayDate,
          slotId: 't-BCS501',
          subjectCode: 'BCS501',
          outcome: 'attended',
          markedAt: `${todayDate}T10:00:00.000Z`,
        },
      ],
    });
    renderWith(<DashboardPage />, { repositories: bundle });

    expect(await screen.findByText(/attended/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /mark BCS501 attended/i })).toBeNull();
  });
});
