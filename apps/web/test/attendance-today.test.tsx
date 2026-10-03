/**
 * Today: the screen the product is opened for.
 *
 * Three things are proven here that no pure test can reach: that the date comes
 * from the CLOCK rather than from the render, that the three-state control is a
 * real radiogroup a keyboard can drive, and that a break is never offered an
 * attendance control however the timetable describes it.
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
  DayOverride,
  LedgerEntry,
  StudentProfile,
  TimetableSlot,
} from '../src/domain/types.js';
import { createMemoryRepositories, renderWith } from './helpers.js';

const profileId = asStudentProfileId('11111111-1111-1111-1111-111111111111');

/* A Wednesday, mid-morning: after the 09:00 class and before the 14:00 one. */
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

function occurrences(peek: ReturnType<typeof createMemoryRepositories>['peek']): ClassOccurrence[] {
  return peek
    .attendanceLedger()
    .filter((entry: LedgerEntry): entry is ClassOccurrence => entry.kind === 'occurrence');
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], shouldAdvanceTime: true });
  vi.setSystemTime(WEDNESDAY);
});

/**
 * The laptop waking up, which is how midnight is usually crossed.
 *
 * Only `Date` is faked here, so the clock's own minute timer is a real one and
 * would take a real minute to fire. The tab returning is the other path that
 * re-reads the clock, and the one that matters most: no timer fires at all
 * while a machine is asleep.
 */
function tabBecomesVisible(): void {
  document.dispatchEvent(new Event('visibilitychange'));
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("today's classes", () => {
  it('opens on today, showing the date and the time', async () => {
    const { bundle } = createMemoryRepositories({
      profile: profile(),
      timetable: [slot({ id: 's1' })],
    });
    renderWith(<AttendancePage />, { repositories: bundle });

    expect((await screen.findAllByText(/Wednesday 16 September/)).length).toBeGreaterThan(0);
    expect(screen.getByLabelText(/^The time is /)).toBeTruthy();
    // Today is the selected view without anybody choosing it.
    expect(screen.getByRole('radio', { name: /^today$/i }).getAttribute('aria-checked')).toBe(
      'true',
    );
  });

  it('groups the day around the clock', async () => {
    const { bundle } = createMemoryRepositories({
      profile: profile(),
      timetable: [
        slot({ id: 'earlier' }),
        slot({ id: 'now', startTime: '10:00', endTime: '11:00', subjectCode: 'BCS502' }),
        slot({ id: 'later', startTime: '14:00', endTime: '15:00', subjectCode: 'BCS503' }),
      ],
    });
    renderWith(<AttendancePage />, { repositories: bundle });

    expect(await screen.findByText('On now')).toBeTruthy();
    expect(screen.getByText('Still to come')).toBeTruthy();
    expect(screen.getByText('Earlier today')).toBeTruthy();
  });

  /* THE MIDNIGHT BUG. The date is read from the clock, not captured at mount. */
  it('moves to the next day when the clock does', async () => {
    const { bundle } = createMemoryRepositories({
      profile: profile(),
      timetable: [slot({ id: 's1' }), slot({ id: 'thu', day: 'Thu', subjectCode: 'BCS504' })],
    });
    renderWith(<AttendancePage />, { repositories: bundle });
    expect((await screen.findAllByText(/Wednesday 16 September/)).length).toBeGreaterThan(0);

    /* Ten past midnight, with the app still open. */
    vi.setSystemTime(new Date('2026-09-17T00:10:00'));
    tabBecomesVisible();

    await waitFor(() => {
      expect(screen.getAllByText(/Thursday 17 September/).length).toBeGreaterThan(0);
    });
  });

  it('marks a class against the date, through the ledger', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { bundle, peek } = createMemoryRepositories({
      profile: profile(),
      attendance: [attendance('BCS501', 30, 40)],
      timetable: [slot({ id: 's1' })],
    });
    renderWith(<AttendancePage />, { repositories: bundle });

    const control = await screen.findByRole('radiogroup', { name: /attendance for BCS501/i });
    await user.click(within(control).getByRole('radio', { name: /attended/i }));

    await waitFor(() => {
      expect(occurrences(peek)).toHaveLength(1);
    });
    expect(occurrences(peek)[0]).toMatchObject({
      date: '2026-09-16',
      classId: 'class-s1',
      subjectCode: 'BCS501',
      outcome: 'attended',
    });
    // …and the figure the student reads follows from it.
    expect(peek.attendance()[0]).toMatchObject({ attended: 31, conducted: 41 });
  });

  it('records a cancelled class as a schedule fact, counted neither way', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { bundle, peek } = createMemoryRepositories({
      profile: profile(),
      attendance: [attendance('BCS501', 30, 40)],
      timetable: [slot({ id: 's1' })],
    });
    renderWith(<AttendancePage />, { repositories: bundle });

    const control = await screen.findByRole('radiogroup', { name: /attendance for BCS501/i });
    await user.click(within(control).getByRole('radio', { name: /cancelled/i }));

    await waitFor(() => {
      expect(peek.timetableOverrides()).toHaveLength(1);
    });
    expect(peek.timetableOverrides()[0]).toMatchObject({
      date: '2026-09-16',
      classId: 'class-s1',
      status: 'cancelled',
    });
    // No attendance row was written, and the figure did not move.
    expect(occurrences(peek)).toHaveLength(0);
    expect(peek.attendance()[0]).toMatchObject({ attended: 30, conducted: 40 });
  });

  /* THE RULE THE WHOLE DENOMINATOR RESTS ON. */
  it('offers no control for a break, an activity or an unscheduled hour', async () => {
    const { bundle } = createMemoryRepositories({
      profile: profile(),
      timetable: [
        slot({
          id: 'lunch',
          subjectCode: null,
          activity: 'Lunch break',
          startTime: '13:00',
          endTime: '14:00',
        }),
        slot({
          id: 'training',
          subjectCode: null,
          activity: 'Placement Training',
          startTime: '15:00',
          endTime: '16:00',
        }),
        slot({ id: 'free', kind: 'unscheduled', startTime: '16:00', endTime: '17:00' }),
        slot({ id: 'real' }),
      ],
    });
    renderWith(<AttendancePage />, { repositories: bundle });

    await screen.findByText('Lunch break');
    // Exactly one control on a day with four rows on it.
    expect(screen.getAllByRole('radiogroup', { name: /attendance for/i })).toHaveLength(1);
    expect(screen.getAllByText('Not counted')).toHaveLength(3);
  });

  it('shows a corrupt row for repair rather than hiding or marking it', async () => {
    const { bundle } = createMemoryRepositories({
      profile: profile(),
      timetable: [slot({ id: 'broken', startTime: '11:00', endTime: '11:00' })],
    });
    renderWith(<AttendancePage />, { repositories: bundle });

    expect(await screen.findByText(/no valid time and cannot be marked/i)).toBeTruthy();
    expect(screen.queryByRole('radiogroup', { name: /attendance for/i })).toBeNull();
  });

  it('keeps the state it is showing when the same answer is pressed again', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { bundle, peek } = createMemoryRepositories({
      profile: profile(),
      attendance: [attendance('BCS501', 30, 40)],
      timetable: [slot({ id: 's1' })],
    });
    renderWith(<AttendancePage />, { repositories: bundle });

    const control = await screen.findByRole('radiogroup', { name: /attendance for BCS501/i });
    const attended = within(control).getByRole('radio', { name: /attended/i });
    await user.click(attended);
    await user.click(attended);
    await user.click(attended);

    /*
     * A mis-tap that erases a record is worse than one that records the wrong
     * thing, so re-pressing never clears. Clearing is the toast's Undo.
     */
    await waitFor(() => {
      expect(occurrences(peek)).toHaveLength(1);
    });
    expect(peek.attendance()[0]).toMatchObject({ attended: 31, conducted: 41 });
  });

  it('moves between the three states with the arrow keys', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { bundle, peek } = createMemoryRepositories({
      profile: profile(),
      attendance: [attendance('BCS501', 30, 40)],
      timetable: [slot({ id: 's1' })],
    });
    renderWith(<AttendancePage />, { repositories: bundle });

    const control = await screen.findByRole('radiogroup', { name: /attendance for BCS501/i });
    await user.click(within(control).getByRole('radio', { name: /attended/i }));
    await waitFor(() => {
      expect(occurrences(peek)[0]?.outcome).toBe('attended');
    });

    /*
     * Focused explicitly, then HELD DOWN: the row re-renders on the write, and
     * Radix moves focus on a deferred effect that user-event's default keypress
     * releases before it runs.
     */
    const selected = within(
      await screen.findByRole('radiogroup', { name: /attendance for BCS501/i }),
    ).getByRole('radio', { name: /attended/i });
    selected.focus();
    /* Held, as a finger holds it: Radix moves focus on a deferred effect. */
    await user.keyboard('{ArrowRight>}');
    await waitFor(() => {
      expect(document.activeElement?.textContent).toContain('Missed');
    });
    await user.keyboard('{/ArrowRight}');
    /* The arrow moves; the space bar chooses. Nothing is recorded by passing
       over an option, which is what stops a keyboard walk marking a class. */
    await user.keyboard(' ');

    await waitFor(() => {
      expect(occurrences(peek)[0]?.outcome).toBe('missed');
    });
  });

  it('shows every state with an icon AND a word, never colour alone', async () => {
    const { bundle } = createMemoryRepositories({
      profile: profile(),
      timetable: [slot({ id: 's1' })],
    });
    renderWith(<AttendancePage />, { repositories: bundle });

    const control = await screen.findByRole('radiogroup', { name: /attendance for BCS501/i });
    for (const label of ['Attended', 'Missed', 'Cancelled']) {
      const option = within(control).getByRole('radio', { name: new RegExp(label, 'i') });
      expect(option.textContent).toContain(label);
      expect(option.querySelector('svg')).toBeTruthy();
    }
  });

  it('takes a mark back from the toast, leaving nothing behind', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { bundle, peek } = createMemoryRepositories({
      profile: profile(),
      attendance: [attendance('BCS501', 30, 40)],
      timetable: [slot({ id: 's1' })],
    });
    renderWith(<AttendancePage />, { repositories: bundle });

    const control = await screen.findByRole('radiogroup', { name: /attendance for BCS501/i });
    await user.click(within(control).getByRole('radio', { name: /attended/i }));
    await waitFor(() => {
      expect(occurrences(peek)).toHaveLength(1);
    });

    await user.click(await screen.findByRole('button', { name: /^undo$/i }));

    await waitFor(() => {
      expect(occurrences(peek)).toHaveLength(0);
    });
    expect(peek.attendance()[0]).toMatchObject({ attended: 30, conducted: 40 });
  });

  it('shows a class cancelled for this date as cancelled', async () => {
    const override: DayOverride = {
      id: '2026-09-16:class-s1',
      profileId,
      date: '2026-09-16',
      classId: 'class-s1',
      status: 'cancelled',
      addition: null,
      replacedBy: null,
      createdAt: '2026-09-16T08:00:00.000Z',
    };
    const { bundle } = createMemoryRepositories({
      profile: profile(),
      timetable: [slot({ id: 's1' })],
      timetableOverrides: [override],
    });
    renderWith(<AttendancePage />, { repositories: bundle });

    const control = await screen.findByRole('radiogroup', { name: /attendance for BCS501/i });
    expect(
      within(control)
        .getByRole('radio', { name: /cancelled/i })
        .getAttribute('aria-checked'),
    ).toBe('true');
  });
});

describe('the history view', () => {
  it('lists what was recorded, by date', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const occurrence: ClassOccurrence = {
      kind: 'occurrence',
      id: '2026-09-14:class-s1',
      classId: 'class-s1',
      date: '2026-09-14',
      subjectCode: 'BCS501',
      subjectTitle: 'Software Engineering',
      startTime: '09:00',
      endTime: '10:00',
      outcome: 'missed',
      markedAt: '2026-09-14T09:55:00.000Z',
    };
    const { bundle } = createMemoryRepositories({
      profile: profile(),
      attendance: [attendance('BCS501', 30, 40)],
      attendanceLedger: [occurrence],
    });
    renderWith(<AttendancePage />, { repositories: bundle });

    await user.click(await screen.findByRole('radio', { name: /^history$/i }));

    expect(await screen.findByText(/Monday 14 September/)).toBeTruthy();
    expect(screen.getByText('Missed')).toBeTruthy();
    // The subject renders from the ledger row's own copy of the title, with no
    // timetable slot in sight: the class may have left the week since.
    expect(screen.getByText('Software Engineering')).toBeTruthy();
  });
});
