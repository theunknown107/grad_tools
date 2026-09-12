/**
 * Manual subjects: a student's own records, in both places they belong.
 *
 * Authority: Phase 7B.1 §6, §9, §12–§15, §21, §27, §47, §49
 *
 * ---------------------------------------------------------------------------
 * WHAT THESE PROVE
 * ---------------------------------------------------------------------------
 *
 * A student can record something the university has no code for — "Placement &
 * Training" — in their timetable, and it survives a reload as what it is. What
 * they must NOT be able to do is get a fabricated code into the product, and
 * what the product must not do is quietly turn such an hour into an
 * attendance-bearing subject (§27).
 */
import { afterEach, describe, expect, it } from 'vitest';
import userEvent from '@testing-library/user-event';
import { screen } from '@testing-library/dom';
import { cleanup } from '@testing-library/react';
import { TimetablePage } from '../src/features/timetable/TimetablePage.js';
import { asStudentProfileId } from '../src/domain/identity.js';
import type { StudentProfile } from '../src/domain/types.js';
import { createMemoryRepositories, renderWith } from './helpers.js';

afterEach(cleanup);

const profileId = asStudentProfileId('p1');
const profile: StudentProfile = {
  id: profileId,
  authUserId: null,
  usn: '1XX22CS001',
  displayName: 'A Student',
  collegeName: null,
  programme: null,
  branch: 'CSBS',
  schemeId: 'vtu-2022',
  currentSemester: 5,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

/** Open the disclosure the page keeps its add-a-class form behind. */
async function openForm(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByText('Add a class'));
}

/** The form's submit control. */
const submit = () => screen.getByRole('button', { name: /^add class$/i });

describe('adding a class by hand', () => {
  it('records an activity that has no subject code', async () => {
    /*
     * §6, §47. This was impossible: the form demanded a code, so a student
     * with a scheduled hour that has none had to invent one — and an invented
     * code reads exactly like a code the university issued.
     */
    const user = userEvent.setup();
    const { bundle, peek } = createMemoryRepositories({ profile });
    renderWith(<TimetablePage />, { repositories: bundle });
    await openForm(user);

    await user.type(await screen.findByLabelText(/or an activity/i), 'Placement & Training');
    await user.click(submit());

    const saved = peek.timetable();
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ subjectCode: null, activity: 'Placement & Training' });
  });

  it('still records an ordinary coded class', async () => {
    const user = userEvent.setup();
    const { bundle, peek } = createMemoryRepositories({ profile });
    renderWith(<TimetablePage />, { repositories: bundle });
    await openForm(user);

    await user.type(await screen.findByLabelText(/^subject code$/i), 'bcs502');
    await user.click(submit());

    expect(peek.timetable()[0]).toMatchObject({ subjectCode: 'BCS502', activity: null });
  });

  it('refuses an hour that is neither coded nor named', async () => {
    const user = userEvent.setup();
    const { bundle, peek } = createMemoryRepositories({ profile });
    renderWith(<TimetablePage />, { repositories: bundle });
    await openForm(user);

    await user.click(submit());

    expect(peek.timetable()).toHaveLength(0);
    expect(await screen.findByText(/code, or a name for the activity/i)).toBeTruthy();
  });

  it('refuses both at once rather than choosing one', async () => {
    /* Two claims about one hour. The slot's invariant allows exactly one. */
    const user = userEvent.setup();
    const { bundle, peek } = createMemoryRepositories({ profile });
    renderWith(<TimetablePage />, { repositories: bundle });
    await openForm(user);

    await user.type(await screen.findByLabelText(/^subject code$/i), 'BCS502');
    await user.type(screen.getByLabelText(/or an activity/i), 'Placement & Training');
    await user.click(submit());

    expect(peek.timetable()).toHaveLength(0);
  });

  it('opens no attendance record for an activity (§27)', async () => {
    /*
     * The hour is the student's to mark; what it cannot do is become a subject
     * that attendance is counted against, because it names none.
     */
    const user = userEvent.setup();
    const { bundle, peek } = createMemoryRepositories({ profile });
    renderWith(<TimetablePage />, { repositories: bundle });
    await openForm(user);

    await user.type(await screen.findByLabelText(/or an activity/i), 'Placement & Training');
    await user.click(submit());

    expect(peek.attendance()).toHaveLength(0);
  });
});
