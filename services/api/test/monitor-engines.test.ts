/**
 * The monitoring engines: applicability, classification, importance, change.
 *
 * Authority: Phase 7B.3 §12–§15, §28–§48, §106–§124
 *
 * NO DATABASE. Every decision in these four modules is a pure function of what
 * the source said and what the student is, and a test that needed Postgres to
 * prove "this notice is for a different branch" would be testing the wrong
 * thing.
 *
 * SYNTHETIC CONTENT ONLY. No real VTU notice appears here, and no student's
 * record does either.
 */

import { describe, expect, it } from 'vitest';
import {
  applicabilityOf,
  type SourceAudience,
  type StudentAudience,
} from '../src/monitor/applicability.js';
import { classifySourceItem, importanceOf } from '../src/monitor/classify.js';
import {
  changeOf,
  contentHashOf,
  runMonitor,
  type KnownItem,
  type SourceItemInput,
} from '../src/monitor/run.js';

/* -------------------------------------------------------------------------- */
/* Builders — so each test states only what it is about                        */
/* -------------------------------------------------------------------------- */

const NOBODY_IN_PARTICULAR: SourceAudience = {
  scheme: null,
  programme: null,
  branch: null,
  department: null,
  stream: null,
  college: null,
  semester: null,
  courses: [],
  examCycle: null,
  unresolvedScope: false,
};

function targeting(overrides: Partial<SourceAudience>): SourceAudience {
  return { ...NOBODY_IN_PARTICULAR, ...overrides };
}

/**
 * A student who has filled everything in.
 *
 * The values are deliberately NOT the ones this project's own developer holds.
 * §32 forbids hardcoding CSBS / 2022 / Semester 5 anywhere in the engine, and a
 * test suite that used them everywhere would let such a shortcut pass.
 */
const COMPLETE: StudentAudience = {
  scheme: '2021',
  programme: 'B.E.',
  branch: 'Mechanical Engineering',
  department: 'Mechanical',
  stream: 'Physics',
  college: 'Example Institute of Technology',
  semester: 3,
  enrolledCourses: ['BME301', 'BME302'],
  backlogCourses: ['BPH101'],
};

function student(overrides: Partial<StudentAudience> = {}): StudentAudience {
  return { ...COMPLETE, ...overrides };
}

function item(overrides: Partial<SourceItemInput> = {}): SourceItemInput {
  return {
    externalId: 'x-1',
    url: 'https://vtu.ac.in/en/examination/x-1/',
    title: 'Circular regarding something',
    /* Deliberately free of any word the classifier keys on, so a test that
     * means to assert `unresolved` is not quietly rescued by the builder. */
    body: 'Synthetic body text for the suite.',
    publishedAt: '2026-09-01',
    updatedAt: null,
    audience: NOBODY_IN_PARTICULAR,
    supersedes: null,
    ...overrides,
  };
}

/* -------------------------------------------------------------------------- */
/* Applicability — the §115 matrix, one dimension at a time                    */
/* -------------------------------------------------------------------------- */

describe('applicability, dimension by dimension', () => {
  it('a notice targeting nothing is for everybody', () => {
    const verdict = applicabilityOf(NOBODY_IN_PARTICULAR, COMPLETE);
    expect(verdict.verdict).toBe('applicable');
    expect(verdict.matched).toEqual([]);
    expect(verdict.reason).toBe('This notice is for all students.');
  });

  /*
   * Each axis is asserted twice — matched and missed — because an engine that
   * only ever returns `applicable` passes every single-sided test.
   */
  const axes: readonly {
    readonly name: string;
    readonly hit: Partial<SourceAudience>;
    readonly miss: Partial<SourceAudience>;
  }[] = [
    { name: 'scheme', hit: { scheme: '2021' }, miss: { scheme: '2018' } },
    { name: 'programme', hit: { programme: 'B.E.' }, miss: { programme: 'M.Tech.' } },
    {
      name: 'branch',
      hit: { branch: 'Mechanical Engineering' },
      miss: { branch: 'Civil Engineering' },
    },
    { name: 'department', hit: { department: 'Mechanical' }, miss: { department: 'Civil' } },
    { name: 'stream', hit: { stream: 'Physics' }, miss: { stream: 'Chemistry' } },
    {
      name: 'college',
      hit: { college: 'Example Institute of Technology' },
      miss: { college: 'Another Institute of Technology' },
    },
    { name: 'semester', hit: { semester: 3 }, miss: { semester: 4 } },
  ];

  for (const axis of axes) {
    it(`matches on ${axis.name}, and misses on it`, () => {
      const matched = applicabilityOf(targeting(axis.hit), COMPLETE);
      expect(matched.verdict).toBe('applicable');
      expect(matched.reason).toMatch(/^Applies to your /);

      const missed = applicabilityOf(targeting(axis.miss), COMPLETE);
      expect(missed.verdict).toBe('not_applicable');
    });
  }

  it('compares names the way a person would, not byte for byte', () => {
    const verdict = applicabilityOf(targeting({ branch: '  mechanical ENGINEERING ' }), COMPLETE);
    expect(verdict.verdict).toBe('applicable');
  });

  /*
   * THE CONJUNCTION IS THE WHOLE POINT (§31). Treating an audience as a
   * disjunction is how a notice for one branch's third semester quietly reaches
   * every third-semester student in the university.
   */
  it('requires every stated axis, not any of them', () => {
    const verdict = applicabilityOf(
      targeting({ semester: 3, branch: 'Civil Engineering' }),
      COMPLETE,
    );
    expect(verdict.verdict).toBe('not_applicable');
    expect(verdict.reason).toContain('branch');
  });

  it('names every axis that matched, once, in the explanation', () => {
    const verdict = applicabilityOf(
      targeting({ scheme: '2021', semester: 3, branch: 'Mechanical Engineering' }),
      COMPLETE,
    );
    expect(verdict.verdict).toBe('applicable');
    expect(verdict.matched).toEqual(['scheme', 'branch', 'semester']);
    expect(verdict.reason).toBe('Applies to your scheme · branch · semester.');
  });
});

describe('applicability and courses', () => {
  /*
   * COURSES ARE A DISJUNCTION, and deliberately unlike every other axis: a
   * notice naming five codes is for anyone sitting ANY of them.
   */
  it('matches when the student holds any one of the named courses', () => {
    const verdict = applicabilityOf(
      targeting({ courses: ['BCV301', 'BME302', 'BEC303'] }),
      COMPLETE,
    );
    expect(verdict.verdict).toBe('applicable');
    expect(verdict.matched).toContain('course');
  });

  it('counts a backlog paper as the student’s own', () => {
    const verdict = applicabilityOf(targeting({ courses: ['BPH101'] }), COMPLETE);
    expect(verdict.verdict).toBe('applicable');
  });

  it('is not applicable when none of the named courses is theirs', () => {
    const verdict = applicabilityOf(targeting({ courses: ['BCV301'] }), COMPLETE);
    expect(verdict.verdict).toBe('not_applicable');
  });

  it('ignores the case a code was printed in', () => {
    const verdict = applicabilityOf(targeting({ courses: ['bme301'] }), COMPLETE);
    expect(verdict.verdict).toBe('applicable');
  });
});

describe('applicability when something is not known', () => {
  /*
   * §35, and the distinction the whole engine turns on. "The publisher did not
   * restrict this" and "we could not read who this is for" must never produce
   * the same answer, because the first is a broadcast and the second is a
   * sentence nobody can act on.
   */
  it('a scope nobody could read is unresolved, not university-wide', () => {
    const verdict = applicabilityOf(targeting({ unresolvedScope: true }), COMPLETE);
    expect(verdict.verdict).toBe('unresolved');
  });

  it('an axis the student has not filled in is unresolved, not a match', () => {
    const verdict = applicabilityOf(
      targeting({ branch: 'Civil Engineering' }),
      student({ branch: null }),
    );
    expect(verdict.verdict).toBe('unresolved');
    expect(verdict.reason).toContain('your profile does not say');
  });

  it('an axis the student has not filled in is unresolved, not a miss either', () => {
    const verdict = applicabilityOf(targeting({ semester: 7 }), student({ semester: null }));
    expect(verdict.verdict).toBe('unresolved');
  });

  /*
   * A DEFINITE MISS OUTRANKS AN UNKNOWN. If the source says "Civil, semester 7"
   * and the student is Mechanical with no semester recorded, we know enough:
   * it is not theirs. Returning `unresolved` there would leave a decidable
   * question open.
   */
  it('still decides when one axis misses and another is unknown', () => {
    const verdict = applicabilityOf(
      targeting({ branch: 'Civil Engineering', semester: 7 }),
      student({ semester: null }),
    );
    expect(verdict.verdict).toBe('not_applicable');
  });

  it('a university-wide notice still reaches a student who has filled in nothing', () => {
    const empty: StudentAudience = {
      scheme: null,
      programme: null,
      branch: null,
      department: null,
      stream: null,
      college: null,
      semester: null,
      enrolledCourses: [],
      backlogCourses: [],
    };
    expect(applicabilityOf(NOBODY_IN_PARTICULAR, empty).verdict).toBe('applicable');
  });
});

/* -------------------------------------------------------------------------- */
/* Classification                                                              */
/* -------------------------------------------------------------------------- */

describe('classification', () => {
  const cases: readonly (readonly [string, string])[] = [
    ['Time Table for B.E. V Semester Examination', 'exam_timetable'],
    ['Results announced for the June/July examination', 'result'],
    ['Notification regarding revaluation of answer scripts', 'revaluation'],
    ['Examination registration for the odd semester', 'registration'],
    ['Academic Calendar for the even semester', 'academic_calendar'],
    ['Regulations governing the award of degrees', 'regulation'],
    ['Scheme and Syllabus for the first semester', 'scheme'],
    ['Syllabus for the open elective', 'syllabus'],
    ['Circular regarding conduct of examination', 'examination'],
    ['Circular regarding the housekeeping tender', 'administration'],
  ];

  for (const [title, expected] of cases) {
    it(`reads "${title}" as ${expected}`, () => {
      expect(classifySourceItem(title).category).toBe(expected);
    });
  }

  /*
   * §121. An item nobody could classify notifies nobody — and it says
   * `unresolved`, not `other`. "Other" would claim we read it and decided.
   */
  it('refuses to classify a notice that says nothing it recognises', () => {
    const result = classifySourceItem('Corrigendum to the earlier communication');
    expect(result.category).toBe('unresolved');
    expect(result.signals).toEqual([]);
  });

  /*
   * §54. The evidence is the words the DOCUMENT used, so a wrong answer is
   * reviewable by a person who has never seen the rule table.
   */
  it('reports the phrase the document actually printed', () => {
    expect(classifySourceItem('Revised Time Table for the examination').signals).toEqual([
      'Time Table',
    ]);
  });

  it('is deterministic: the same text always classifies the same way', () => {
    const text = 'Notification - Application for revaluation of answer scripts';
    const once = classifySourceItem(text);
    const again = classifySourceItem(text);
    expect(again).toEqual(once);
  });

  /*
   * The ordering is load-bearing, and running the fixtures is what caught it:
   * "Scheme and Syllabus" was reading as a syllabus.
   */
  it('reads a scheme-and-syllabus document as a scheme, not a syllabus', () => {
    expect(classifySourceItem('Scheme and Syllabus - M.Tech. I Semester').category).toBe('scheme');
  });
});

describe('importance', () => {
  it('ranks a timetable high and a tender low', () => {
    expect(importanceOf('exam_timetable', 'Time Table for the examination')).toBe('high');
    expect(importanceOf('administration', 'Invitation of tenders for housekeeping')).toBe('low');
  });

  /*
   * §46. A student who already planned around the first version is the one
   * person who must be told, so a change outranks whatever it is a change to.
   */
  it('ranks a change high whatever it is a change to', () => {
    expect(importanceOf('administration', 'Revised circular regarding the holiday')).toBe('high');
    expect(importanceOf('administration', 'The event stands postponed')).toBe('high');
  });

  it('ranks anything with a deadline high', () => {
    expect(importanceOf('administration', 'Last date for submission is 20 September')).toBe('high');
  });

  it('leaves a syllabus in the middle', () => {
    expect(importanceOf('syllabus', 'Syllabus for the open elective')).toBe('medium');
  });
});

/* -------------------------------------------------------------------------- */
/* Identity and change detection                                               */
/* -------------------------------------------------------------------------- */

describe('content identity', () => {
  /*
   * §13. A source that re-slugs a post, or serves it from a second URL, has not
   * published anything new — and a student told about it twice learns that this
   * app wastes their attention.
   */
  it('is the same item when the same words arrive from a different URL', () => {
    const first = item({ url: 'https://vtu.ac.in/en/examination/a/' });
    const alias = item({ url: 'https://vtu.ac.in/en/examination/a-1/' });
    expect(contentHashOf(alias)).toBe(contentHashOf(first));
  });

  it('is a different item when the source changed the words', () => {
    expect(contentHashOf(item({ body: 'Something else entirely.' }))).not.toBe(
      contentHashOf(item()),
    );
  });

  it('is a different item when the source re-dated it', () => {
    expect(contentHashOf(item({ publishedAt: '2026-09-02' }))).not.toBe(contentHashOf(item()));
  });
});

describe('change detection', () => {
  const known = (...entries: readonly (readonly [string, string])[]): Map<string, KnownItem> =>
    new Map(
      entries.map(([id, hash]) => [id, { externalId: id, contentHash: hash, supersededBy: null }]),
    );

  it('an item nobody has seen is new', () => {
    const one = item();
    expect(changeOf(one, contentHashOf(one), known())).toBe('new');
  });

  it('an item with the same hash is unchanged', () => {
    const one = item();
    expect(changeOf(one, contentHashOf(one), known(['x-1', contentHashOf(one)]))).toBe('unchanged');
  });

  it('an item whose content moved is updated', () => {
    const one = item({ body: 'Amended.' });
    expect(changeOf(one, contentHashOf(one), known(['x-1', 'a'.repeat(64)]))).toBe('updated');
  });

  /*
   * §12, §88. REVISED IS NOT UPDATED. Only the source can say that one document
   * replaces another; recency cannot, and inferring it is how a correction gets
   * treated as a typo fix.
   */
  it('an item that says what it replaces is revised', () => {
    const one = item({ externalId: 'x-2', supersedes: 'x-1' });
    expect(changeOf(one, contentHashOf(one), known(['x-1', 'a'.repeat(64)]))).toBe('revised');
  });

  it('is not a revision when we never held what it claims to replace', () => {
    const one = item({ externalId: 'x-2', supersedes: 'x-99' });
    expect(changeOf(one, contentHashOf(one), known(['x-1', 'a'.repeat(64)]))).toBe('new');
  });
});

/* -------------------------------------------------------------------------- */
/* A whole run                                                                 */
/* -------------------------------------------------------------------------- */

describe('a monitoring run', () => {
  it('ledgers every item it saw, including the ones it took no further', () => {
    const result = runMonitor(
      'run-1',
      {
        family: 'examination',
        items: [
          item({ externalId: 'a', title: 'Time Table for the examination' }),
          item({ externalId: 'b', title: 'Corrigendum to the earlier communication' }),
          item({
            externalId: 'c',
            title: 'Circular regarding examination centres',
            audience: targeting({ unresolvedScope: true }),
          }),
        ],
      },
      new Map(),
    );

    expect(result.ledger).toHaveLength(3);
    expect(result.metrics.discovered).toBe(3);
    expect(result.metrics.notifiable).toBe(1);
    expect(result.metrics.held).toBe(2);
    /* §16: nothing is dropped without a reason a person can read. */
    for (const row of result.ledger.filter((entry) => !entry.notifiable)) {
      expect(row.note).not.toBeNull();
    }
  });

  it('records an item the source stopped serving rather than forgetting it', () => {
    const result = runMonitor(
      'run-2',
      { family: 'administration', items: [] },
      new Map([['gone', { externalId: 'gone', contentHash: 'b'.repeat(64), supersededBy: null }]]),
    );
    expect(result.metrics.removed).toBe(1);
    expect(result.ledger[0]?.note).toContain('the record is kept');
  });

  /* §139: the same run over the same snapshot twice must decide the same. */
  it('is idempotent: a second run over an unchanged snapshot notifies nobody', () => {
    const snapshot = {
      family: 'examination' as const,
      items: [item({ externalId: 'a', title: 'Time Table for the examination' })],
    };
    const first = runMonitor('run-1', snapshot, new Map());
    expect(first.metrics.notifiable).toBe(1);

    const after = new Map(
      first.ledger.map((row) => [
        row.externalId,
        { externalId: row.externalId, contentHash: row.contentHash, supersededBy: null },
      ]),
    );
    const second = runMonitor('run-2', snapshot, after);
    expect(second.metrics.unchanged).toBe(1);
    expect(second.metrics.notifiable).toBe(0);
  });

  it('sees a genuine revision as news even though the first version is held', () => {
    const original = item({ externalId: 'a', title: 'Time Table for the examination' });
    const first = runMonitor('run-1', { family: 'examination', items: [original] }, new Map());
    const after = new Map(
      first.ledger.map((row) => [
        row.externalId,
        { externalId: row.externalId, contentHash: row.contentHash, supersededBy: null },
      ]),
    );

    const second = runMonitor(
      'run-2',
      {
        family: 'examination',
        items: [
          original,
          item({
            externalId: 'b',
            title: 'Revised Time Table for the examination',
            body: 'The paper on 12 December stands postponed.',
            supersedes: 'a',
          }),
        ],
      },
      after,
    );
    expect(second.metrics.revised).toBe(1);
    expect(second.metrics.notifiable).toBe(1);
    expect(second.ledger.find((row) => row.externalId === 'b')?.importance).toBe('high');
  });
});
