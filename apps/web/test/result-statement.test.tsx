/**
 * The printable academic summary (docs/53).
 *
 * Built from the REAL statistics function on records shaped as the app stores
 * them, so what is tested is the statement's reading of the existing figures,
 * not a second calculation. Synthetic records only.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, screen } from '@testing-library/react';
import { VTU_2022_RULE_SET_ID } from '@gradtools/academic-rules';
import { academicStatistics } from '../src/domain/statistics.js';
import { normalizeResultSubject } from '../src/domain/results.js';
import { asStudentProfileId } from '../src/domain/identity.js';
import { buildStatement, STATEMENT_DISCLAIMER } from '../src/domain/statement.js';
import type { BacklogRecord, SemesterResult, StudentProfile } from '../src/domain/types.js';
import { StatementPage } from '../src/features/results/StatementPage.js';
import { createMemoryRepositories, emptyProfile, renderWith } from './helpers.js';

const profileId = asStudentProfileId('11111111-1111-4111-8111-111111111111');
const noLookup = () => null;

function course(
  code: string,
  credits: number | null,
  marks: { internal: number | null; external: number | null; hasSee?: boolean | null },
) {
  return normalizeResultSubject({
    id: `s-${code}`,
    subjectCode: code,
    subjectTitle: `Course ${code}`,
    internal: marks.internal,
    external: marks.external,
    total:
      marks.internal !== null && marks.external !== null ? marks.internal + marks.external : null,
    resultStatus: null,
    credits,
    gradeLetter: null,
    hasSee: marks.hasSee === undefined ? true : marks.hasSee,
    provenance: 'catalogue',
  });
}

function result(
  semester: number,
  subjects: ReturnType<typeof course>[],
  sgpaAsserted: number | null = null,
): SemesterResult {
  return {
    id: `r${String(semester)}`,
    profileId,
    semester,
    schemeId: 'vtu-2022',
    ruleSetId: VTU_2022_RULE_SET_ID,
    sgpaAsserted,
    subjects,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  };
}

const profile: StudentProfile = {
  ...emptyProfile(),
  displayName: 'Synthetic Student',
  usn: null,
  collegeName: 'Example Institute',
  programme: 'B.E.',
  branch: null,
};

const statement = (
  results: SemesterResult[],
  options: {
    semester?: number | null;
    backlogs?: BacklogRecord[];
    profile?: StudentProfile | null;
  } = {},
) =>
  buildStatement({
    profile: options.profile === undefined ? profile : options.profile,
    statistics: academicStatistics({ semesters: [], results, backlogs: options.backlogs ?? [] }),
    backlogs: options.backlogs ?? [],
    identify: noLookup,
    semester: options.semester ?? null,
    now: new Date('2026-10-23T10:00:00Z'),
  });

afterEach(cleanup);

describe('buildStatement', () => {
  it('shows a complete semester as the results screens compute it, marks on their scale', () => {
    const s = statement([
      result(4, [
        course('BQS401', 4, { internal: 46, external: 34 }),
        course('BQS402', 3, { internal: 31, external: 30 }),
      ]),
    ]);
    const [semester] = s.semesters;
    expect(semester?.number).toBe(4);
    expect(semester?.rows[0]).toMatchObject({
      code: 'BQS401',
      internal: { value: 46, outOf: 50 },
      external: { value: 34, outOf: 50 },
      total: { value: 80, outOf: 100 },
      credits: 4,
      grade: { letter: 'A+', points: 9 },
      gradeFrom: 'rules',
      passed: true,
    });
    // (4×9 + 3×7) / 7 = 8.142… → 8.14: the statistics module's own SGPA, not a new one.
    expect(semester?.sgpa.value).toBeCloseTo(8.14, 2);
  });

  it('leaves out what is not known instead of printing zero', () => {
    const s = statement([
      result(3, [course('BQS301', null, { internal: 38, external: null, hasSee: null })]),
    ]);
    const row = s.semesters[0]?.rows[0];
    expect(row?.credits).toBeNull();
    expect(row?.external).toBeNull();
    expect(row?.internal).toEqual({ value: 38, outOf: null }); // no scale when SEE is unknown
    expect(row?.passed).toBeNull();
    expect(s.semesters[0]?.sgpa.value).toBeNull();
    expect(s.semesters[0]?.sgpa.reason).toBeTruthy();
  });

  it('includes every semester with a result, or only the one asked for', () => {
    const results = [
      result(1, [course('BQ101', 4, { internal: 38, external: 40 })]),
      result(2, [course('BQ201', 4, { internal: 35, external: 35 })]),
    ];
    expect(statement(results).semesters.map((x) => x.number)).toEqual([1, 2]);
    const one = statement(results, { semester: 2 });
    expect(one.semesters.map((x) => x.number)).toEqual([2]);
    expect(one.cumulative).toBeNull(); // a one-semester statement carries no CGPA
  });

  it('keeps the grade-card SGPA beside the computed one, never replacing it', () => {
    const s = statement([result(4, [course('BQS401', 4, { internal: 46, external: 34 })], 8.5)]);
    expect(s.semesters[0]?.sgpaPrinted).toBe(8.5);
    expect(s.semesters[0]?.sgpa.value).toBe(9);
  });

  it('omits profile fields the student has not given', () => {
    const s = statement([], { profile });
    expect(s.student).toEqual({
      name: 'Synthetic Student',
      college: 'Example Institute',
      programme: 'B.E.',
      scheme: 'VTU 2022 scheme',
    });
    expect('usn' in s.student).toBe(false);
    expect(statement([], { profile: null }).student).toEqual({});
  });

  it('awards no class for an incomplete record, and says why', () => {
    const s = statement([result(1, [course('BQ101', 4, { internal: 47, external: 45 })])]);
    expect(s.cumulative?.classAwarded).toBeNull();
    expect(s.cumulative?.classNote).toMatch(/completing the degree/);
  });

  it('awards the class for a completed eight-semester record with nothing failed', () => {
    const results = Array.from({ length: 8 }, (_, i) =>
      result(i + 1, [course(`BQS${String(i + 1)}01`, 4, { internal: 47, external: 45 })]),
    );
    const s = statement(results);
    expect(s.cumulative?.cgpa.value).toBe(10);
    expect(s.cumulative?.classAwarded).toBe('First Class with Distinction');
  });

  it('lists recorded backlogs apart from the result rows', () => {
    const backlog: BacklogRecord = {
      id: 'b1',
      profileId,
      subjectCode: 'BQ301',
      subjectTitle: 'Course BQ301',
      originSemester: 3,
      status: 'active',
      attempts: 1,
      clearedInSemester: null,
      updatedAt: '2026-01-01T00:00:00Z',
    };
    const s = statement([result(3, [course('BQ302', 4, { internal: 38, external: 40 })])], {
      backlogs: [backlog],
    });
    expect(s.recordedBacklogs).toEqual([backlog]);
    expect(statement([], { backlogs: [backlog], semester: 4 }).recordedBacklogs).toEqual([]);
  });
});

describe('StatementPage', () => {
  it('renders the summary with the unofficial label, and keeps its controls out of print', async () => {
    const repos = createMemoryRepositories({
      profile,
      results: [result(4, [course('BQS401', 4, { internal: 46, external: 34 })])],
    });
    renderWith(<StatementPage />, { repositories: repos.bundle, route: '/results/statement' });

    expect(await screen.findByRole('heading', { name: /academic summary/i })).toBeTruthy();
    expect(screen.getAllByText(STATEMENT_DISCLAIMER).length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('BQS401')).toBeTruthy();
    expect(screen.getByText('46 / 50')).toBeTruthy();

    const print = screen.getByRole('button', { name: /print or save as pdf/i });
    expect(print.closest('.print\\:hidden')).not.toBeNull();
    expect(
      screen.getByRole('link', { name: /back to results/i }).closest('.print\\:hidden'),
    ).not.toBeNull();
  });

  it('says so when there is nothing to print', async () => {
    renderWith(<StatementPage />, {
      repositories: createMemoryRepositories({ profile }).bundle,
      route: '/results/statement',
    });
    expect(await screen.findByText(/no results are saved/i)).toBeTruthy();
    expect(
      (screen.getByRole('button', { name: /print or save as pdf/i }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });
});
