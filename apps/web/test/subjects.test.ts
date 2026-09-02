/**
 * One subject identity, across every part of the product.
 *
 * Authority: docs/22 §22.41 · docs/32 OQ-051, DEC-041
 *
 * ---------------------------------------------------------------------------
 * THE PAIR THAT RULES OUT NAME MATCHING
 * ---------------------------------------------------------------------------
 *
 * A real timetable and a real result card name `BPHYS102` "Applied Physics for
 * CSE stream" and "PHYSICS FOR CSE STREAM". A real catalogue and a real card
 * name `BMATS101` "Mathematics-I for CSE Stream" and "MATHEMATICS FOR CSE
 * STREAM-I". Any comparison loose enough to join the first pair also joins
 * "Mathematics-I" to "Mathematics-II".
 *
 * So the tests below never assert that two titles match. They assert that two
 * CODES do, that both wordings survive, and that a different code never merges
 * however similar its name.
 *
 * Codes and wordings here follow the structure of the real artifacts; the
 * student's marks, name and seat number appear nowhere in this repository.
 */

import { describe, expect, it } from 'vitest';
import type { Subject } from '@gradtools/shared-types';
import {
  buildSubjectIndex,
  displayTitle,
  otherTitles,
  resolveSubject,
  subjectKey,
} from '../src/domain/subjects.js';
import { normalizeResultSubject } from '../src/domain/results.js';
import { asStudentProfileId } from '../src/domain/identity.js';
import type {
  AttendanceRecord,
  BacklogRecord,
  SemesterResult,
  TimetableSlot,
} from '../src/domain/types.js';

const profileId = asStudentProfileId('p1');

function catalogueSubject(overrides: Partial<Subject> & Pick<Subject, 'code'>): Subject {
  return {
    id: `cat-${overrides.code}`,
    schemeId: 'vtu-2022',
    branchId: 'cse',
    semester: 1,
    title: overrides.code,
    credits: 4,
    category: 'core',
    cieMax: 50,
    seeMax: 100,
    hasSee: true,
    moduleCount: 5,
    provenance: { sourceUrl: 'https://example.test', verification: 'verified' },
    ...overrides,
  } as Subject;
}

function result(semester: number, rows: readonly Record<string, unknown>[]): SemesterResult {
  return {
    id: `r${String(semester)}`,
    profileId,
    semester,
    schemeId: 'vtu-2022',
    ruleSetId: 'vtu-2022-v1',
    sgpaAsserted: null,
    subjects: rows.map((row, index) => normalizeResultSubject({ id: `s${String(index)}`, ...row })),
    createdAt: '',
    updatedAt: '',
  };
}

function attendance(subjectCode: string, subjectTitle: string): AttendanceRecord {
  return {
    id: `a-${subjectCode}`,
    profileId,
    semester: 1,
    subjectCode,
    subjectTitle,
    attended: 30,
    conducted: 40,
    updatedAt: '',
  };
}

function slot(subjectCode: string): TimetableSlot {
  return {
    id: `t-${subjectCode}`,
    profileId,
    day: 'Mon',
    startTime: '10:00',
    endTime: '10:55',
    subjectCode,
    room: 'B205',
    faculty: null,
  };
}

function backlog(subjectCode: string, subjectTitle: string): BacklogRecord {
  return {
    id: `b-${subjectCode}`,
    profileId,
    subjectCode,
    subjectTitle,
    originSemester: 1,
    status: 'active',
    attempts: 0,
    clearedInSemester: null,
    updatedAt: '',
  };
}

/* -------------------------------------------------------------------------- */

describe('the identity key', () => {
  it('is the code, cased and spaced however it was typed', () => {
    expect(subjectKey('bcs 301')).toBe('BCS301');
    expect(subjectKey('  BCS301  ')).toBe('BCS301');
    expect(subjectKey('BCS301')).toBe('BCS301');
  });

  it('keeps two electives that differ only in their suffix apart', () => {
    /*
     * A real timetable carries BESCK104B and a real card carries BETCK105I —
     * letter-suffixed electives from the same family. A rule that stripped the
     * suffix to be "helpful" would merge two subjects a student really took
     * separately.
     */
    expect(subjectKey('BESCK104B')).not.toBe(subjectKey('BESCK104C'));
    expect(subjectKey('BMATS101')).not.toBe(subjectKey('BMATS201'));
  });
});

describe('one code, many wordings', () => {
  it('gathers every source under one identity', () => {
    /*
     * THE WHOLE MILESTONE IN ONE ASSERTION. Four sources, four wordings, one
     * subject — and no wording discarded.
     */
    const built = buildSubjectIndex({
      catalogue: [catalogueSubject({ code: 'BPHYS102', title: 'Applied Physics for CSE Stream' })],
      results: [
        result(1, [
          { subjectCode: 'BPHYS102', subjectTitle: 'PHYSICS FOR CSE STREAM', credits: 4 },
        ]),
      ],
      attendance: [attendance('bphys102', 'Physics')],
      timetable: [slot('BPHYS 102')],
    });

    expect(built.size).toBe(1);
    const identity = resolveSubject(built, 'BPHYS102');
    expect(identity?.code).toBe('BPHYS102');
    expect([...(identity?.sources ?? [])].sort()).toEqual([
      'attendance',
      'catalogue',
      'result',
      'timetable',
    ]);
    expect(identity?.titles.map((entry) => entry.title).sort()).toEqual([
      'Applied Physics for CSE Stream',
      'PHYSICS FOR CSE STREAM',
      'Physics',
    ]);
  });

  it('never merges two different codes, however alike their names', () => {
    const built = buildSubjectIndex({
      attendance: [
        attendance('BMATS101', 'Mathematics-I for CSE Stream'),
        attendance('BMATS201', 'Mathematics-I for CSE Stream'),
      ],
    });
    // Identical titles, two codes: two subjects. Titles are never compared.
    expect(built.size).toBe(2);
  });

  it('does not record the code itself as a title', () => {
    // Several screens fall back to the code when they have no name. Storing
    // that would make a nameless subject look like it had a wording.
    const built = buildSubjectIndex({ attendance: [attendance('BCS301', 'BCS301')] });
    expect(resolveSubject(built, 'BCS301')?.titles).toEqual([]);
  });

  it('records one wording once, however many sources print it', () => {
    const built = buildSubjectIndex({
      attendance: [attendance('BCS301', 'Data Structures')],
      backlogs: [backlog('BCS301', 'Data Structures')],
    });
    expect(resolveSubject(built, 'BCS301')?.titles).toHaveLength(1);
    expect([...(resolveSubject(built, 'BCS301')?.sources ?? [])].sort()).toEqual([
      'attendance',
      'backlog',
    ]);
  });

  it('ignores a blank code rather than creating a nameless subject', () => {
    expect(buildSubjectIndex({ attendance: [attendance('   ', 'Something')] }).size).toBe(0);
  });
});

describe('the canonical title', () => {
  it('comes from the catalogue, and only from the catalogue', () => {
    const built = buildSubjectIndex({
      catalogue: [catalogueSubject({ code: 'BMATS101', title: 'Mathematics-I for CSE Stream' })],
      results: [
        result(1, [
          { subjectCode: 'BMATS101', subjectTitle: 'MATHEMATICS FOR CSE STREAM-I', credits: 4 },
        ]),
      ],
    });
    expect(resolveSubject(built, 'BMATS101')?.canonicalTitle).toBe('Mathematics-I for CSE Stream');
  });

  it('stays unknown when no catalogue row exists', () => {
    /*
     * A student's own wording is a source title, never a canonical one. Calling
     * it canonical would claim the university endorses it.
     */
    const built = buildSubjectIndex({
      results: [result(1, [{ subjectCode: 'BESCK104B', subjectTitle: 'Intro to EEE' }])],
    });
    const identity = resolveSubject(built, 'BESCK104B');
    expect(identity?.canonicalTitle).toBeNull();
    expect(identity?.titles).toHaveLength(1);
  });

  it('stays unknown when two catalogue rows for one code disagree', () => {
    /*
     * Catalogue uniqueness is (scheme, branch, code), so one code can carry two
     * verified rows with different wording across branches. Picking either
     * would invent an answer the reference data does not give (§5).
     */
    const built = buildSubjectIndex({
      catalogue: [
        catalogueSubject({ code: 'BCS301', title: 'Data Structures' }),
        catalogueSubject({ code: 'BCS301', title: 'Data Structures and Applications' }),
      ],
    });
    const identity = resolveSubject(built, 'BCS301');
    expect(identity?.canonicalTitle).toBeNull();
    // Both wordings survive; neither is discarded to force an answer.
    expect(identity?.titles).toHaveLength(2);
  });
});

describe('reference credits and SEE applicability', () => {
  it('takes both from the catalogue', () => {
    const built = buildSubjectIndex({
      catalogue: [catalogueSubject({ code: 'BMATS101', credits: 4, hasSee: true })],
    });
    expect(resolveSubject(built, 'BMATS101')?.credits).toBe(4);
    expect(resolveSubject(built, 'BMATS101')?.hasSee).toBe(true);
  });

  it('leaves both unknown when nothing authoritative supplied them', () => {
    // UNKNOWN DOES NOT BECOME ZERO, AND IT DOES NOT BECOME FALSE (§9, §30).
    const built = buildSubjectIndex({
      results: [result(4, [{ subjectCode: 'BQA405B', subjectTitle: 'Graph Theory' }])],
    });
    const identity = resolveSubject(built, 'BQA405B');
    expect(identity?.credits).toBeNull();
    expect(identity?.hasSee).toBeNull();
  });

  it('ignores a hand-typed credit, and accepts a catalogue-backed one', () => {
    /*
     * A number typed into one result row is a fact about that row. Promoting it
     * to the answer on the timetable, the attendance screen and the degree page
     * would spread one student's guess across the product.
     */
    const manual = buildSubjectIndex({
      results: [
        result(1, [
          {
            subjectCode: 'BCS301',
            subjectTitle: 'DS',
            credits: 4,
            hasSee: true,
            provenance: 'manual',
          },
        ]),
      ],
    });
    expect(resolveSubject(manual, 'BCS301')?.credits).toBeNull();
    expect(resolveSubject(manual, 'BCS301')?.hasSee).toBeNull();

    const backed = buildSubjectIndex({
      results: [
        result(1, [
          {
            subjectCode: 'BCS301',
            subjectTitle: 'DS',
            credits: 4,
            hasSee: true,
            provenance: 'catalogue',
          },
        ]),
      ],
    });
    expect(resolveSubject(backed, 'BCS301')?.credits).toBe(4);
    expect(resolveSubject(backed, 'BCS301')?.hasSee).toBe(true);
  });

  it('carries a CIE-only course as false, which is not the same as unknown', () => {
    const built = buildSubjectIndex({
      catalogue: [
        catalogueSubject({ code: 'BPEK459', title: 'Physical Education', hasSee: false }),
      ],
    });
    expect(resolveSubject(built, 'BPEK459')?.hasSee).toBe(false);
  });
});

describe('what a screen shows', () => {
  const built = buildSubjectIndex({
    catalogue: [catalogueSubject({ code: 'BMATS101', title: 'Mathematics-I for CSE Stream' })],
    results: [
      result(1, [
        { subjectCode: 'BMATS101', subjectTitle: 'MATHEMATICS FOR CSE STREAM-I', credits: 4 },
      ]),
    ],
    attendance: [attendance('BMATS101', 'Maths I')],
    timetable: [slot('BMATS101')],
  });
  const identity = resolveSubject(built, 'BMATS101');

  it('prefers the wording the viewing screen itself used', () => {
    // So a row is recognisable against the paper document in the student's hand.
    expect(displayTitle(identity, 'result')).toBe('MATHEMATICS FOR CSE STREAM-I');
    expect(displayTitle(identity, 'attendance')).toBe('Maths I');
  });

  it('falls back to the catalogue where a screen has no wording of its own', () => {
    // The timetable stores a code and no title, so this is the real case.
    expect(displayTitle(identity, 'timetable')).toBe('Mathematics-I for CSE Stream');
  });

  it('falls back to the code, never to an empty cell', () => {
    const bare = resolveSubject(buildSubjectIndex({ timetable: [slot('BCS404')] }), 'BCS404');
    expect(displayTitle(bare, 'timetable')).toBe('BCS404');
  });

  it('lists the other wordings, and nothing when every source agrees', () => {
    expect(
      otherTitles(identity, 'MATHEMATICS FOR CSE STREAM-I')
        .map((entry) => entry.title)
        .sort(),
      // Sorted: "Mathematics" precedes "Maths" — 'e' before 's' at the fourth
      // character. Spelled out because the order is the assertion's, not the
      // module's; `otherTitles` preserves sighting order.
    ).toEqual(['Mathematics-I for CSE Stream', 'Maths I']);

    const agreed = resolveSubject(
      buildSubjectIndex({
        attendance: [attendance('BCS301', 'Data Structures')],
        backlogs: [backlog('BCS301', 'Data Structures')],
      }),
      'BCS301',
    );
    expect(otherTitles(agreed, 'Data Structures')).toEqual([]);
  });
});

describe('across the whole product', () => {
  /*
   * A student whose subject appears in all five student collections plus a
   * question paper, under four wordings and three spellings of the code.
   */
  const built = buildSubjectIndex({
    results: [
      result(3, [{ subjectCode: 'BCS301', subjectTitle: 'DATA STRUCTURES AND APPLICATIONS' }]),
    ],
    attendance: [attendance('bcs301', 'Data Structures')],
    timetable: [slot('BCS 301')],
    backlogs: [backlog('BCS301', 'Data Structures & Applications')],
    papers: [{ subjectCode: 'BCS301', subjectTitle: 'Data Structures', semester: 3 }],
  });

  it('is one subject, not five', () => {
    expect(built.size).toBe(1);
    expect([...(resolveSubject(built, 'BCS301')?.sources ?? [])].sort()).toEqual([
      'attendance',
      'backlog',
      'paper',
      'result',
      'timetable',
    ]);
  });

  it('resolves from any spelling of the code', () => {
    for (const spelling of ['BCS301', 'bcs301', 'BCS 301', '  bcs 301 ']) {
      expect(resolveSubject(built, spelling)?.code).toBe('BCS301');
    }
  });

  it('reports the semesters it was seen in, without inventing a range', () => {
    // Result semester 3, backlog origin 3, paper semester 3 — one semester, not
    // an assumption that a code belongs to one semester forever (§7).
    expect(resolveSubject(built, 'BCS301')?.semesters).toEqual([1, 3]);
  });

  it('returns null for a code nothing knows about', () => {
    expect(resolveSubject(built, 'BCS999')).toBeNull();
    expect(displayTitle(null, 'result')).toBe('');
    expect(otherTitles(null, 'anything')).toEqual([]);
  });
});
