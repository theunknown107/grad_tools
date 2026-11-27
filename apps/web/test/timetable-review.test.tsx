/**
 * The timetable review: it shows where each class came from, and lets a student
 * RESOLVE the ones the parser could not identify — choosing a course from the
 * document's own subject list, never an invented meaning — so that what is saved
 * is exactly what was reviewed. SYNTHETIC CONTENT ONLY.
 */
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { asStudentProfileId } from '../src/domain/identity.js';
import type {
  DictionaryEntry,
  GridClass,
  ParsedTimetable,
} from '../src/domain/timetable-import.js';
import { TimetableReview } from '../src/features/import/TimetableReview.js';
import type { TimetableSlot } from '../src/domain/types.js';
import { renderWith } from './helpers.js';

afterEach(cleanup);

const PROFILE = asStudentProfileId('00000000-0000-4000-8000-000000000001');

const lesson = (over: Partial<GridClass>): GridClass => ({
  day: 'Mon',
  start: '10:00',
  end: '10:55',
  subjectCode: 'BQAS502',
  resolution: 'initialism',
  unresolvedReason: null,
  initials: 'CN',
  batch: null,
  room: 'LH-302',
  spansSlots: 1,
  sourceText: 'CN LH-302',
  ...over,
});

const entry = (subjectCode: string, title: string): DictionaryEntry => ({
  subjectCode,
  title,
  initials: null,
  faculty: null,
  collegeHours: null,
  schemeHours: null,
});

const PARSED: ParsedTimetable = {
  context: {
    className: 'V (B)',
    semester: 5,
    academicYear: '2026-27',
    revision: 'R0',
    effectiveFrom: '2026-09-12',
    room: null,
  },
  slots: [],
  dictionary: [
    entry('BQAS501', 'Fundamentals of Management'),
    entry('BQAS502', 'Computer Networks'),
    entry('BQAS508', 'Environmental Studies and E-waste Management'),
  ],
  classes: [
    lesson({}), // CN — resolved, must stay untouched by any correction
    lesson({
      start: '12:10',
      end: '13:05',
      subjectCode: null,
      resolution: 'unknown',
      unresolvedReason: '"FM" is not defined anywhere on this timetable.',
      initials: 'FM',
      room: null,
      sourceText: 'FM',
    }),
    lesson({
      day: 'Wed', // a SECOND occurrence of the same label
      start: '12:10',
      end: '13:05',
      subjectCode: null,
      resolution: 'unknown',
      unresolvedReason: '"FM" is not defined anywhere on this timetable.',
      initials: 'FM',
      room: null,
      sourceText: 'FM',
    }),
    lesson({
      day: 'Tue',
      start: '13:05',
      end: '14:00',
      subjectCode: null,
      resolution: 'activity',
      unresolvedReason: 'Printed as an activity.',
      initials: 'Value added Course',
      room: null,
      sourceText: 'Value added Course',
    }),
  ],
  batches: [],
  conflicts: [],
  coverage: {
    cellsFound: 4,
    cellsResolved: 2,
    slotsFound: 8,
    dictionaryEntries: 3,
    looksComplete: false,
  },
  warnings: [],
};

function review(onSave: (slots: readonly TimetableSlot[]) => void = () => undefined) {
  return renderWith(
    <TimetableReview
      fileName="timetable.pdf"
      parsed={PARSED}
      fingerprint="synthetic"
      profileId={PROFILE}
      saved={[]}
      onSave={(slots) => onSave(slots)}
    />,
  );
}

describe('resolving unidentified timetable classes', () => {
  it('offers an editable course selector for each unidentified label, and not for resolved ones', () => {
    review();
    // The resolve section, the raw printed text (provenance), and a usable
    // selector named for the label.
    expect(screen.getByText(/resolve these classes before saving/i)).toBeTruthy();
    expect(screen.getAllByText(/printed “FM”/).length).toBeGreaterThan(0);
    expect(screen.getByRole('combobox', { name: /course for fm/i })).toBeTruthy();
    // A resolved class (CN) gets no resolve control.
    expect(screen.queryByRole('combobox', { name: /course for cn/i })).toBeNull();
  });

  it('resolves every occurrence of a label, leaves unrelated classes alone, keeps provenance, and saves exactly that', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    review(onSave);

    await user.click(screen.getByRole('combobox', { name: /course for fm/i }));
    await user.click(
      await screen.findByRole('option', { name: /BQAS501 — Fundamentals of Management/ }),
    );

    // Both FM classes now read as the chosen course; the raw cell text is kept.
    const read = screen.getByText(/how each class was read/i).closest('details')!;
    await waitFor(() => expect(within(read).getAllByText(/→ BQAS501/).length).toBe(2));
    expect(within(read).getAllByText(/“FM”/).length).toBe(2); // provenance preserved
    // CN (unrelated label) is untouched.
    expect(within(read).getByText(/→ BQAS502/)).toBeTruthy();

    await user.click(screen.getByRole('button', { name: /confirm and save timetable/i }));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    const slots = onSave.mock.calls[0]![0] as readonly TimetableSlot[];
    const fm = slots.filter((s) => s.startTime === '12:10');
    expect(fm).toHaveLength(2);
    expect(fm.every((s) => s.subjectCode === 'BQAS501')).toBe(true);
    // The resolved, unrelated CN class kept its own code.
    expect(slots.find((s) => s.startTime === '10:00')?.subjectCode).toBe('BQAS502');
  });

  it('can leave a label unresolved, and saves it with no code rather than a guess', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    review(onSave);

    await user.click(screen.getByRole('combobox', { name: /course for fm/i }));
    await user.click(await screen.findByRole('option', { name: /leave unresolved/i }));

    await user.click(screen.getByRole('button', { name: /confirm and save timetable/i }));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    const slots = onSave.mock.calls[0]![0] as readonly TimetableSlot[];
    expect(slots.filter((s) => s.startTime === '12:10').every((s) => s.subjectCode === null)).toBe(
      true,
    );
  });
});
