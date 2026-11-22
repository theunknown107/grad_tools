/**
 * The timetable review answers "where did this class come from?" for every
 * class, and lists the ones that need a person before anything is saved.
 * SYNTHETIC CONTENT ONLY.
 */
import { cleanup, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { asStudentProfileId } from '../src/domain/identity.js';
import type { GridClass, ParsedTimetable } from '../src/domain/timetable-import.js';
import { TimetableReview } from '../src/features/import/TimetableReview.js';
import { renderWith } from './helpers.js';

afterEach(cleanup);

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
  dictionary: [],
  classes: [
    lesson({}),
    lesson({
      start: '15:10',
      end: '16:05',
      subjectCode: 'BQAS508',
      resolution: 'near',
      unresolvedReason: '"ESEVM" is not in this timetable\'s subject list. The closest is "ESEWM".',
      initials: 'ESEVM',
      room: null,
      sourceText: 'ESEVM',
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
    cellsFound: 3,
    cellsResolved: 3,
    slotsFound: 8,
    dictionaryEntries: 4,
    looksComplete: true,
  },
  warnings: [],
};

describe('reviewing an imported timetable', () => {
  it('lists every class that needs a person, with the reason, and only those', () => {
    renderWith(
      <TimetableReview
        fileName="timetable.pdf"
        parsed={PARSED}
        fingerprint="synthetic"
        profileId={asStudentProfileId('00000000-0000-4000-8000-000000000001')}
        saved={[]}
        onSave={() => undefined}
      />,
    );
    const check = screen
      .getByText(/check these classes before saving/i)
      .closest('div') as HTMLElement;
    expect(within(check).getByText(/printed “ESEVM”/)).toBeTruthy();
    expect(within(check).getByText(/closest is "ESEWM"/)).toBeTruthy();
    expect(within(check).queryByText(/Value added/)).toBeNull();
  });

  it('says where each class came from, in words rather than colour', () => {
    renderWith(
      <TimetableReview
        fileName="timetable.pdf"
        parsed={PARSED}
        fingerprint="synthetic"
        profileId={asStudentProfileId('00000000-0000-4000-8000-000000000001')}
        saved={[]}
        onSave={() => undefined}
      />,
    );
    expect(screen.getByText(/how each class was read \(3\)/i)).toBeTruthy();
    expect(screen.getByText('Initials match the timetable’s subject list')).toBeTruthy();
    expect(screen.getByText('Needs review — closest match')).toBeTruthy();
    expect(screen.getByText('Activity, as printed')).toBeTruthy();
    expect(screen.getByText(/room LH-302/)).toBeTruthy();
  });
});
