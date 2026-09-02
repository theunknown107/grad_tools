/**
 * Entering, correcting and editing a real result card.
 *
 * Authority: docs/22 §22.39 · docs/32 OQ-049 §19, §21, §22, §28
 *
 * `results.test.ts` pins the model. This file pins the WORKFLOW — that a
 * student holding their own card can type what it prints, is stopped when the
 * columns contradict each other, and gets back a screen that says what is
 * calculated and what is simply not there.
 *
 * The case that matters most is the one that reads fine either way: a course
 * with no semester-end examination shows "Not applicable" rather than "0 / 50",
 * and is not marked a backlog. Every mark below is invented; the SHAPE is a real
 * card's, the values are not.
 */

import { afterEach, describe, expect, it } from 'vitest';
import userEvent from '@testing-library/user-event';
import { screen, within } from '@testing-library/dom';
import { cleanup } from '@testing-library/react';
import { ResultsPage } from '../src/features/results/ResultsPage.js';
import { normalizeResultSubject } from '../src/domain/results.js';
import { VTU_2022_RULE_SET_ID } from '@gradtools/academic-rules';
import { asStudentProfileId } from '../src/domain/identity.js';
import type { SemesterResult } from '../src/domain/types.js';
import { createMemoryRepositories, renderWith } from './helpers.js';

afterEach(cleanup);

const profileId = asStudentProfileId('p1');

/** A saved semester built the way storage holds one. */
function saved(semester: number, rows: readonly Record<string, unknown>[]): SemesterResult {
  return {
    id: `r${String(semester)}`,
    profileId,
    semester,
    schemeId: 'vtu-2022',
    ruleSetId: VTU_2022_RULE_SET_ID,
    sgpaAsserted: null,
    subjects: rows.map((row, index) => normalizeResultSubject({ id: `s${String(index)}`, ...row })),
    createdAt: '',
    updatedAt: '',
  };
}

describe('entering a result card', () => {
  it('saves a provisional row with marks and a status, and no grade or credits', async () => {
    /*
     * THE ROW THAT COULD NOT BE ENTERED BEFORE. The old editor required a grade
     * and credits and had nowhere to put internal, external, total or the
     * printed status — so a student copying a provisional card had to invent
     * two values before anything would save.
     */
    const user = userEvent.setup();
    const { bundle, peek } = createMemoryRepositories();
    renderWith(<ResultsPage />, { repositories: bundle });

    await user.click(screen.getByRole('button', { name: /add a semester/i }));
    await user.type(screen.getByLabelText(/subject code 1/i), 'BCS401');
    await user.type(screen.getByLabelText(/internal 1/i), '44');
    await user.type(screen.getByLabelText(/external 1/i), '36');
    await user.type(screen.getByLabelText(/total 1/i), '80');
    await user.selectOptions(screen.getByLabelText(/^result 1$/i), 'P');
    await user.click(screen.getByRole('button', { name: /save semester/i }));

    const stored = peek.results()[0]?.subjects[0];
    expect(stored?.internal).toBe(44);
    expect(stored?.external).toBe(36);
    expect(stored?.total).toBe(80);
    expect(stored?.resultStatus).toBe('P');
    // Missing stays missing. Nothing was filled in on the student's behalf.
    expect(stored?.gradeLetter).toBeNull();
    expect(stored?.credits).toBeNull();
    expect(stored?.hasSee).toBeNull();
  });

  it('refuses a total that contradicts the columns, and does not correct it', async () => {
    const user = userEvent.setup();
    const { bundle, peek } = createMemoryRepositories();
    renderWith(<ResultsPage />, { repositories: bundle });

    await user.click(screen.getByRole('button', { name: /add a semester/i }));
    await user.type(screen.getByLabelText(/subject code 1/i), 'BCS401');
    await user.type(screen.getByLabelText(/internal 1/i), '44');
    await user.type(screen.getByLabelText(/external 1/i), '36');
    await user.type(screen.getByLabelText(/total 1/i), '90');
    await user.click(screen.getByRole('button', { name: /save semester/i }));

    expect(peek.results()).toHaveLength(0);
    expect(screen.getByText(/does not match/i)).toBeTruthy();
    // The typed value is still 90 — the editor states the problem and leaves
    // the number alone for the student to check against the card.
    expect((screen.getByLabelText(/total 1/i) as HTMLInputElement).value).toBe('90');
  });

  it('records SEE applicability as unknown until it is answered', async () => {
    // Never inferred from an external of 0 (DEC-037): "Not sure" is the default
    // and is a real, storable answer.
    const user = userEvent.setup();
    const { bundle, peek } = createMemoryRepositories();
    renderWith(<ResultsPage />, { repositories: bundle });

    await user.click(screen.getByRole('button', { name: /add a semester/i }));
    await user.type(screen.getByLabelText(/subject code 1/i), 'BPEK459');
    await user.type(screen.getByLabelText(/internal 1/i), '96');
    await user.type(screen.getByLabelText(/external 1/i), '0');
    await user.type(screen.getByLabelText(/total 1/i), '96');
    await user.selectOptions(screen.getByLabelText(/semester-end exam 1/i), 'no');
    await user.click(screen.getByRole('button', { name: /save semester/i }));

    expect(peek.results()[0]?.subjects[0]?.hasSee).toBe(false);
  });

  it('adds and removes subject rows without a fixed count', async () => {
    const user = userEvent.setup();
    const { bundle } = createMemoryRepositories();
    renderWith(<ResultsPage />, { repositories: bundle });

    await user.click(screen.getByRole('button', { name: /add a semester/i }));
    // The first row's remove button is disabled while it is the only row: a
    // result with no subjects is not a result.
    expect(
      (screen.getByRole('button', { name: /remove subject 1/i }) as HTMLButtonElement).disabled,
    ).toBe(true);

    for (let index = 0; index < 8; index += 1) {
      await user.click(screen.getByRole('button', { name: /add subject/i }));
    }
    expect(screen.getByLabelText(/subject code 9/i)).toBeTruthy();

    await user.click(screen.getByRole('button', { name: /remove subject 9/i }));
    expect(screen.queryByLabelText(/subject code 9/i)).toBeNull();
  });
});

describe('a saved result', () => {
  const provisional = () =>
    saved(4, [
      {
        subjectCode: 'BCS401',
        subjectTitle: 'Analysis & Design of Algorithms',
        internal: 44,
        external: 36,
        total: 80,
        resultStatus: 'P',
        hasSee: true,
      },
      {
        subjectCode: 'BPEK459',
        subjectTitle: 'Physical Education',
        internal: 96,
        external: 0,
        total: 96,
        resultStatus: 'P',
        hasSee: false,
      },
    ]);

  it('shows the printed marks as columns of their own', async () => {
    const { bundle } = createMemoryRepositories({ results: [provisional()] });
    const user = userEvent.setup();
    renderWith(<ResultsPage />, { repositories: bundle });

    await user.click(await screen.findByRole('tab', { name: /semesters/i }));

    const table = screen.getByRole('table');
    expect(within(table).getByRole('columnheader', { name: /internal/i })).toBeTruthy();
    expect(within(table).getByRole('columnheader', { name: /external/i })).toBeTruthy();
    expect(within(table).getByRole('columnheader', { name: /total/i })).toBeTruthy();
    expect(within(table).getByText('44')).toBeTruthy();
    expect(within(table).getByText('80')).toBeTruthy();
  });

  it('says why there is no SGPA instead of showing a dash alone', async () => {
    // A provisional card prints no grades, so no SGPA can be computed — and the
    // rows that held it back are named so the student can finish the record.
    const { bundle } = createMemoryRepositories({ results: [provisional()] });
    const user = userEvent.setup();
    renderWith(<ResultsPage />, { repositories: bundle });

    await user.click(await screen.findByRole('tab', { name: /semesters/i }));
    expect(screen.getByText(/no sgpa yet/i)).toBeTruthy();
    expect(screen.getAllByText(/BCS401/).length).toBeGreaterThan(0);
  });

  it('calls a CIE-only course Not applicable, and not a backlog', async () => {
    /*
     * THE REGRESSION THIS FILE EXISTS FOR, at the screen. "0 / 50" would say the
     * student sat an exam and scored nothing; a red backlog pill would say they
     * failed a course the university passed them in.
     */
    const { bundle } = createMemoryRepositories({ results: [provisional()] });
    const user = userEvent.setup();
    renderWith(<ResultsPage />, { repositories: bundle });

    await user.click(await screen.findByRole('tab', { name: /semesters/i }));
    await user.click(screen.getByRole('button', { name: /Physical Education/i }));

    const sheet = await screen.findByRole('dialog');
    expect(within(sheet).getByText(/not applicable/i)).toBeTruthy();
    expect(within(sheet).queryByText(/0 \/ 50/)).toBeNull();

    const backlog = within(sheet).getByText('Backlog').closest('div');
    expect(backlog?.textContent).toMatch(/No$/);
  });

  it('shows the SEE contribution out of 50 where the course has one', async () => {
    const { bundle } = createMemoryRepositories({ results: [provisional()] });
    const user = userEvent.setup();
    renderWith(<ResultsPage />, { repositories: bundle });

    await user.click(await screen.findByRole('tab', { name: /semesters/i }));
    await user.click(screen.getByRole('button', { name: /Analysis & Design of Algorithms/i }));

    const sheet = await screen.findByRole('dialog');
    expect(within(sheet).getByText('36 / 50')).toBeTruthy();
  });

  it('reports a backlog count that admits what it could not check', async () => {
    // A row whose SEE applicability is unknown makes the count a FLOOR. The
    // number a student most needs to be right about must not read as complete.
    const { bundle } = createMemoryRepositories({
      results: [
        saved(4, [
          { subjectCode: 'BCS401', internal: 40, external: 17, total: 57, hasSee: true },
          { subjectCode: 'BCS402', internal: 40, external: 20, total: 60 },
        ]),
      ],
    });
    renderWith(<ResultsPage />, { repositories: bundle });

    expect(await screen.findByText(/could not be checked for a backlog/i)).toBeTruthy();
    expect(screen.getByText('1+')).toBeTruthy();
  });

  it('edits a saved semester in place rather than creating a second one', async () => {
    const user = userEvent.setup();
    const { bundle, peek } = createMemoryRepositories({ results: [provisional()] });
    renderWith(<ResultsPage />, { repositories: bundle });

    await user.click(await screen.findByRole('tab', { name: /semesters/i }));
    await user.click(screen.getByRole('button', { name: /actions for semester 4/i }));
    await user.click(await screen.findByRole('menuitem', { name: /edit this semester/i }));

    // The editor opens on the stored values, not on a blank form.
    expect((screen.getByLabelText(/internal 1/i) as HTMLInputElement).value).toBe('44');

    await user.clear(screen.getByLabelText(/internal 1/i));
    await user.type(screen.getByLabelText(/internal 1/i), '45');
    await user.clear(screen.getByLabelText(/total 1/i));
    await user.type(screen.getByLabelText(/total 1/i), '81');
    await user.click(screen.getByRole('button', { name: /save changes/i }));

    // ONE record, updated — not a second row for the same semester (§23).
    expect(peek.results()).toHaveLength(1);
    expect(peek.results()[0]?.subjects[0]?.internal).toBe(45);
    expect(peek.results()[0]?.subjects[0]?.total).toBe(81);
  });

  it('keeps a record that predates the marks fields readable', async () => {
    // A row saved when the model held only credits and a grade still renders,
    // with its marks columns honestly empty rather than zero.
    const { bundle } = createMemoryRepositories({
      results: [saved(3, [{ subjectCode: 'BCS301', credits: 4, gradeLetter: 'A' }])],
    });
    const user = userEvent.setup();
    renderWith(<ResultsPage />, { repositories: bundle });

    await user.click(await screen.findByRole('tab', { name: /semesters/i }));
    const table = screen.getByRole('table');
    // The title falls back to the code, so the cell carries it twice.
    expect(within(table).getAllByText('BCS301').length).toBeGreaterThan(0);
    expect(within(table).getAllByText('—').length).toBeGreaterThan(0);
    expect(screen.getAllByText('8.00').length).toBeGreaterThan(0);
  });
});
