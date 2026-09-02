/**
 * Results and their subject rows, end to end.
 *
 * Authority: docs/08 §8.18 · docs/09 §9.19 · docs/22 §22.18 · M9.1 §1–§5
 *
 * ---------------------------------------------------------------------------
 * THE DEFECT THESE TESTS EXIST FOR
 * ---------------------------------------------------------------------------
 *
 * `result_subjects` was created with ownership and a parent and nothing else —
 * no revision, no timestamps, no tombstone — and was never listed as a synced
 * collection. A semester result could therefore reach the cloud while the
 * codes, credits and grades it is made of could not, and a second device would
 * have shown a result with no subjects in it: a record of a semester in which
 * apparently nothing was taken.
 *
 * Every test below fails if that regresses.
 *
 * REAL POSTGRESQL, REAL RLS, SYNTHETIC STUDENTS.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import postgres from 'postgres';
import { randomUUID } from 'node:crypto';
import type { Sql } from '../src/db/client.js';
import { withUser } from '../src/db/cloud.js';
import type { Session } from '../src/auth/session.js';
import { COLLECTION_TABLES, pullChanges, pushRecord, upsertProfile } from '../src/student/store.js';

const CLOUD_URL = process.env.TEST_CLOUD_DATABASE_URL;
const CLOUD_ADMIN_URL = process.env.TEST_CLOUD_ADMIN_DATABASE_URL;
const describeDb =
  CLOUD_URL === undefined || CLOUD_ADMIN_URL === undefined ? describe.skip : describe;

const A = 'aaaaaaaa-0000-4000-8000-0000000000aa';
const B = 'bbbbbbbb-0000-4000-8000-0000000000bb';

const sessionFor = (userId: string): Session => ({
  userId,
  token: userId,
  claims: { sub: userId },
});

describeDb('results and their subjects', () => {
  let cloud: Sql;
  let admin: Sql;
  let profileA = '';
  let profileB = '';

  beforeAll(async () => {
    // The schema is applied once in `global-setup.ts`, not here (M9.1).
    admin = postgres(CLOUD_ADMIN_URL as string, { max: 2 }) as unknown as Sql;
    cloud = postgres(CLOUD_URL as string, { max: 5, prepare: false }) as unknown as Sql;
  }, 60_000);

  afterAll(async () => {
    await Promise.all([cloud.end(), admin.end()]);
  });

  beforeEach(async () => {
    await admin`DELETE FROM auth.users WHERE id IN (${A}::uuid, ${B}::uuid)`;
    await admin`
      INSERT INTO auth.users (id, email) VALUES
        (${A}::uuid, 'synthetic-a@example.test'),
        (${B}::uuid, 'synthetic-b@example.test')
    `;
    profileA =
      (await withUser(cloud, sessionFor(A), (tx) => upsertProfile(tx, { schemeId: 'vtu-2022' })))
        .kind === 'saved'
        ? ((
            await withUser(
              cloud,
              sessionFor(A),
              (tx) => tx<{ id: string }[]>`SELECT id::text FROM student_profiles LIMIT 1`,
            )
          )[0]?.id as string)
        : '';
    await withUser(cloud, sessionFor(B), (tx) => upsertProfile(tx, { schemeId: 'vtu-2022' }));
    profileB = (
      await withUser(
        cloud,
        sessionFor(B),
        (tx) => tx<{ id: string }[]>`SELECT id::text FROM student_profiles LIMIT 1`,
      )
    )[0]?.id as string;
  });

  /** Pushes one record as a device would. */
  async function push(
    userId: string,
    profileId: string,
    record: {
      id: string;
      collection: string;
      baseRevision: number | null;
      deleted?: boolean;
      data: Record<string, unknown>;
    },
  ) {
    return withUser(cloud, sessionFor(userId), (tx) =>
      pushRecord(tx, profileId, { deleted: false, ...record }),
    );
  }

  /* ------------------------------------------------------------------------ */
  /* The collection exists at all                                             */
  /* ------------------------------------------------------------------------ */

  it('lists resultSubjects as a synced collection', () => {
    expect(Object.keys(COLLECTION_TABLES)).toContain('resultSubjects');
    expect(COLLECTION_TABLES.resultSubjects.table).toBe('result_subjects');
  });

  /*
   * The parent is the RESULT, not the profile — so `result_id` is client
   * supplied, and the composite foreign key is what makes that safe.
   */
  it('takes result_id from the client and has no profile parent', () => {
    expect(COLLECTION_TABLES.resultSubjects.parent).toBeNull();
    expect(COLLECTION_TABLES.resultSubjects.columns).toContain('result_id');
  });

  /* Subject rows are their own records, never nested in the result's columns. */
  it('does not carry subject data on the result itself', () => {
    for (const column of COLLECTION_TABLES.results.columns) {
      expect(column).not.toMatch(/subject|grade/);
    }
  });

  /* ------------------------------------------------------------------------ */
  /* The full round trip                                                      */
  /* ------------------------------------------------------------------------ */

  describe('device A creates a result, device B pulls it', () => {
    const resultId = randomUUID();
    const subjects = [
      {
        id: randomUUID(),
        subjectCode: 'BCS501',
        subjectTitle: 'Software Engineering',
        credits: 3,
        gradeLetter: 'A',
      },
      {
        id: randomUUID(),
        subjectCode: 'BCS502',
        subjectTitle: 'Computer Networks',
        credits: 4,
        gradeLetter: 'S',
      },
      {
        id: randomUUID(),
        subjectCode: 'BCS503',
        subjectTitle: 'Theory of Computation',
        credits: 4,
        gradeLetter: 'B',
      },
    ];

    it('carries the result and every subject row', async () => {
      /* ---- device A pushes ------------------------------------------- */
      const resultOutcome = await push(A, profileA, {
        id: resultId,
        collection: 'results',
        baseRevision: null,
        data: { semester: 5, schemeId: 'vtu-2022', ruleSetId: 'vtu-2022-22ob', sgpaAsserted: 8.5 },
      });
      expect(resultOutcome.status).toBe('applied');

      for (const [ordinal, subject] of subjects.entries()) {
        const outcome = await push(A, profileA, {
          id: subject.id,
          collection: 'resultSubjects',
          baseRevision: null,
          data: { resultId, ...subject, ordinal },
        });
        expect(outcome.status).toBe('applied');
      }

      /* ---- device B is a second pull by the SAME student -------------- */
      const pulled = await withUser(cloud, sessionFor(A), (tx) => pullChanges(tx, null));

      const result = pulled.find((record) => record.id === resultId);
      expect(result?.collection).toBe('results');
      expect(result?.data.sgpaAsserted).toBe('8.50');

      const pulledSubjects = pulled.filter((record) => record.collection === 'resultSubjects');
      expect(pulledSubjects).toHaveLength(3);

      /* Grades, credits and titles survive the trip exactly. */
      for (const subject of subjects) {
        const carried = pulledSubjects.find((record) => record.id === subject.id);
        expect(carried).toBeDefined();
        expect(carried?.data.subjectCode).toBe(subject.subjectCode);
        expect(carried?.data.subjectTitle).toBe(subject.subjectTitle);
        expect(carried?.data.gradeLetter).toBe(subject.gradeLetter);
        expect(Number(carried?.data.credits)).toBe(subject.credits);
        expect(carried?.data.resultId).toBe(resultId);
      }
    });

    it('gives every subject row an owner and a revision', async () => {
      await push(A, profileA, {
        id: resultId,
        collection: 'results',
        baseRevision: null,
        data: { semester: 5, schemeId: 'vtu-2022' },
      });
      const subjectId = randomUUID();
      await push(A, profileA, {
        id: subjectId,
        collection: 'resultSubjects',
        baseRevision: null,
        data: {
          resultId,
          subjectCode: 'BCS501',
          subjectTitle: 'SE',
          credits: 3,
          gradeLetter: 'A',
          ordinal: 0,
        },
      });

      const [row] = await admin<{ auth_user_id: string; revision: number }[]>`
        SELECT auth_user_id::text, revision FROM result_subjects WHERE id = ${subjectId}::uuid
      `;
      expect(row?.auth_user_id).toBe(A);
      expect(row?.revision).toBe(1);
    });

    /* An edited grade conflicts on its own, not on the whole result. */
    it('detects a conflict on one subject without touching the others', async () => {
      await push(A, profileA, {
        id: resultId,
        collection: 'results',
        baseRevision: null,
        data: { semester: 5, schemeId: 'vtu-2022' },
      });
      const first = randomUUID();
      const second = randomUUID();
      for (const id of [first, second]) {
        await push(A, profileA, {
          id,
          collection: 'resultSubjects',
          baseRevision: null,
          data: {
            resultId,
            subjectCode: 'BCS501',
            subjectTitle: 'SE',
            credits: 3,
            gradeLetter: 'A',
            ordinal: 0,
          },
        });
      }

      // Another device moved `first` on.
      await push(A, profileA, {
        id: first,
        collection: 'resultSubjects',
        baseRevision: 1,
        data: { gradeLetter: 'S' },
      });

      // This device still believes revision 1.
      const stale = await push(A, profileA, {
        id: first,
        collection: 'resultSubjects',
        baseRevision: 1,
        data: { gradeLetter: 'B' },
      });
      expect(stale.status).toBe('conflict');
      expect(stale.server?.data.gradeLetter).toBe('S');

      // The sibling is unaffected.
      const sibling = await push(A, profileA, {
        id: second,
        collection: 'resultSubjects',
        baseRevision: 1,
        data: { gradeLetter: 'C' },
      });
      expect(sibling.status).toBe('applied');
    });

    it('propagates a subject deletion as a tombstone', async () => {
      await push(A, profileA, {
        id: resultId,
        collection: 'results',
        baseRevision: null,
        data: { semester: 5, schemeId: 'vtu-2022' },
      });
      const subjectId = randomUUID();
      await push(A, profileA, {
        id: subjectId,
        collection: 'resultSubjects',
        baseRevision: null,
        data: {
          resultId,
          subjectCode: 'BCS501',
          subjectTitle: 'SE',
          credits: 3,
          gradeLetter: 'A',
          ordinal: 0,
        },
      });

      const deleted = await push(A, profileA, {
        id: subjectId,
        collection: 'resultSubjects',
        baseRevision: 1,
        deleted: true,
        data: {},
      });
      expect(deleted.status).toBe('applied');

      // The other device must SEE the deletion, not simply stop seeing the row.
      const pulled = await withUser(cloud, sessionFor(A), (tx) => pullChanges(tx, null));
      const tombstone = pulled.find((record) => record.id === subjectId);
      expect(tombstone).toBeDefined();
      expect(tombstone?.deletedAt).not.toBeNull();
    });

    /* Deleting the result takes its subjects with it. */
    it('cascades a deleted result to its subject rows', async () => {
      await push(A, profileA, {
        id: resultId,
        collection: 'results',
        baseRevision: null,
        data: { semester: 5, schemeId: 'vtu-2022' },
      });
      const subjectId = randomUUID();
      await push(A, profileA, {
        id: subjectId,
        collection: 'resultSubjects',
        baseRevision: null,
        data: {
          resultId,
          subjectCode: 'BCS501',
          subjectTitle: 'SE',
          credits: 3,
          gradeLetter: 'A',
          ordinal: 0,
        },
      });

      await admin`DELETE FROM semester_results WHERE id = ${resultId}::uuid`;
      const [remaining] = await admin<{ count: string }[]>`
        SELECT count(*)::text FROM result_subjects WHERE id = ${subjectId}::uuid
      `;
      expect(remaining?.count).toBe('0');
    });
  });

  /* ------------------------------------------------------------------------ */
  /* Delete before first sync                                                 */
  /* ------------------------------------------------------------------------ */

  describe('a record created and deleted before it ever synced', () => {
    /*
     * THE BUG (M9.1 §2). `current === undefined` meant "insert", so a device
     * asking for a never-synced record to be gone got it CREATED — the student
     * deletes something and it reappears, live, on their other device.
     */
    it('does not create a result the device asked to delete', async () => {
      const id = randomUUID();
      const outcome = await push(A, profileA, {
        id,
        collection: 'results',
        baseRevision: null,
        deleted: true,
        data: { semester: 5, schemeId: 'vtu-2022' },
      });

      expect(outcome.status).toBe('applied');
      expect(outcome.server).toBeNull();

      const [row] = await admin<{ count: string }[]>`
        SELECT count(*)::text FROM semester_results WHERE id = ${id}::uuid
      `;
      expect(row?.count).toBe('0');
    });

    it('does not create a subject row the device asked to delete', async () => {
      const resultId = randomUUID();
      await push(A, profileA, {
        id: resultId,
        collection: 'results',
        baseRevision: null,
        data: { semester: 5, schemeId: 'vtu-2022' },
      });

      const subjectId = randomUUID();
      const outcome = await push(A, profileA, {
        id: subjectId,
        collection: 'resultSubjects',
        baseRevision: null,
        deleted: true,
        data: { resultId, subjectCode: 'BCS501', subjectTitle: 'SE', credits: 3, gradeLetter: 'A' },
      });

      expect(outcome.status).toBe('applied');
      const [row] = await admin<{ count: string }[]>`
        SELECT count(*)::text FROM result_subjects WHERE id = ${subjectId}::uuid
      `;
      expect(row?.count).toBe('0');
    });

    /* Absence, not a tombstone: no other device ever saw it (M9.1 §2). */
    it('leaves nothing for another device to pull', async () => {
      const id = randomUUID();
      await push(A, profileA, {
        id,
        collection: 'attendance',
        baseRevision: null,
        deleted: true,
        data: { semester: 5, subjectCode: 'BCS501', subjectTitle: 'SE', attended: 1, conducted: 1 },
      });

      const pulled = await withUser(cloud, sessionFor(A), (tx) => pullChanges(tx, null));
      expect(pulled.find((record) => record.id === id)).toBeUndefined();
    });

    /* Idempotent: a retried push finds nothing again and answers the same. */
    it('answers the same way when the push is retried', async () => {
      const id = randomUUID();
      const once = await push(A, profileA, {
        id,
        collection: 'results',
        baseRevision: null,
        deleted: true,
        data: { semester: 5, schemeId: 'vtu-2022' },
      });
      const twice = await push(A, profileA, {
        id,
        collection: 'results',
        baseRevision: null,
        deleted: true,
        data: { semester: 5, schemeId: 'vtu-2022' },
      });
      expect(once.status).toBe('applied');
      expect(twice.status).toBe('applied');
    });
  });

  /* ------------------------------------------------------------------------ */
  /* The ownership invariant                                                  */
  /* ------------------------------------------------------------------------ */

  describe('a subject row cannot cross students', () => {
    let bResultId = '';

    beforeEach(async () => {
      bResultId = randomUUID();
      await push(B, profileB, {
        id: bResultId,
        collection: 'results',
        baseRevision: null,
        data: { semester: 5, schemeId: 'vtu-2022' },
      });
    });

    /*
     * THE INVARIANT (M9.1 §3), enforced by the composite foreign key. A wins
     * nothing by naming B's result: the database refuses the row because
     * `(result_id, auth_user_id)` does not exist in `semester_results`.
     */
    it('refuses a subject row attached to another student’s result', async () => {
      const outcome = await push(A, profileA, {
        id: randomUUID(),
        collection: 'resultSubjects',
        baseRevision: null,
        data: {
          resultId: bResultId,
          subjectCode: 'BCS501',
          subjectTitle: 'SE',
          credits: 3,
          gradeLetter: 'A',
        },
      });

      expect(outcome.status).toBe('rejected');
      const [row] = await admin<{ count: string }[]>`
        SELECT count(*)::text FROM result_subjects WHERE result_id = ${bResultId}::uuid
      `;
      expect(row?.count).toBe('0');
    });

    /* And it is the DATABASE refusing, not the application. */
    it('is refused by the database even when the API is bypassed', async () => {
      await expect(
        withUser(
          cloud,
          sessionFor(A),
          (tx) => tx`
            INSERT INTO result_subjects (result_id, subject_code, subject_title, credits, grade_letter)
            VALUES (${bResultId}::uuid, 'BCS501', 'SE', 3, 'A')
          `,
        ),
      ).rejects.toThrow(/foreign key|result_subjects_belong_to_their_result/i);
    });

    /*
     * A constraint violation ABORTS a PostgreSQL transaction, so without a
     * per-record savepoint one bad record would silently take every other
     * record in the same push with it — the opposite of the per-record outcomes
     * the endpoint promises (docs/10 §10.16).
     */
    it('lets the rest of a push land when one record is rejected', async () => {
      const goodResult = randomUUID();
      const goodSubject = randomUUID();
      const badSubject = randomUUID();

      const outcomes = await withUser(cloud, sessionFor(A), async (tx) => [
        await pushRecord(tx, profileA, {
          id: goodResult,
          collection: 'results',
          baseRevision: null,
          deleted: false,
          data: { semester: 6, schemeId: 'vtu-2022' },
        }),
        // Refused: it names B's result.
        await pushRecord(tx, profileA, {
          id: badSubject,
          collection: 'resultSubjects',
          baseRevision: null,
          deleted: false,
          data: {
            resultId: bResultId,
            subjectCode: 'BCS999',
            subjectTitle: 'X',
            credits: 3,
            gradeLetter: 'A',
          },
        }),
        await pushRecord(tx, profileA, {
          id: goodSubject,
          collection: 'resultSubjects',
          baseRevision: null,
          deleted: false,
          data: {
            resultId: goodResult,
            subjectCode: 'BCS601',
            subjectTitle: 'Y',
            credits: 4,
            gradeLetter: 'S',
          },
        }),
      ]);

      expect(outcomes.map((outcome) => outcome.status)).toEqual(['applied', 'rejected', 'applied']);
      expect(outcomes[1]?.reason).toBe('That subject does not belong to one of your results.');

      // Both good records really committed.
      const [row] = await admin<{ count: string }[]>`
        SELECT count(*)::text FROM result_subjects WHERE id = ${goodSubject}::uuid
      `;
      expect(row?.count).toBe('1');
    });

    it('never shows A the subject rows of B’s result', async () => {
      await push(B, profileB, {
        id: randomUUID(),
        collection: 'resultSubjects',
        baseRevision: null,
        data: {
          resultId: bResultId,
          subjectCode: 'BCS999',
          subjectTitle: 'Secret',
          credits: 3,
          gradeLetter: 'A',
        },
      });

      const pulled = await withUser(cloud, sessionFor(A), (tx) => pullChanges(tx, null));
      expect(pulled.some((record) => record.data.subjectTitle === 'Secret')).toBe(false);
      expect(pulled.filter((record) => record.collection === 'resultSubjects')).toHaveLength(0);
    });

    it('cannot be reassigned to another student', async () => {
      const resultId = randomUUID();
      const subjectId = randomUUID();
      await push(A, profileA, {
        id: resultId,
        collection: 'results',
        baseRevision: null,
        data: { semester: 5, schemeId: 'vtu-2022' },
      });
      await push(A, profileA, {
        id: subjectId,
        collection: 'resultSubjects',
        baseRevision: null,
        data: { resultId, subjectCode: 'BCS501', subjectTitle: 'SE', credits: 3, gradeLetter: 'A' },
      });

      await expect(
        withUser(
          cloud,
          sessionFor(A),
          (tx) =>
            tx`UPDATE result_subjects SET auth_user_id = ${B}::uuid WHERE id = ${subjectId}::uuid`,
        ),
      ).rejects.toThrow(/row-level security|foreign key/i);
    });
  });

  /* ------------------------------------------------------------------------ */
  /* Export                                                                   */
  /* ------------------------------------------------------------------------ */

  describe('the export', () => {
    it('includes results and their subject rows, and nobody else’s', async () => {
      const resultId = randomUUID();
      const subjectId = randomUUID();
      await push(A, profileA, {
        id: resultId,
        collection: 'results',
        baseRevision: null,
        data: { semester: 5, schemeId: 'vtu-2022', sgpaAsserted: 8.5 },
      });
      await push(A, profileA, {
        id: subjectId,
        collection: 'resultSubjects',
        baseRevision: null,
        data: {
          resultId,
          subjectCode: 'BCS501',
          subjectTitle: 'Software Engineering',
          credits: 3,
          gradeLetter: 'A',
        },
      });

      // B has a result too, which must not appear.
      const bResult = randomUUID();
      await push(B, profileB, {
        id: bResult,
        collection: 'results',
        baseRevision: null,
        data: { semester: 5, schemeId: 'vtu-2022' },
      });
      await push(B, profileB, {
        id: randomUUID(),
        collection: 'resultSubjects',
        baseRevision: null,
        data: {
          resultId: bResult,
          subjectCode: 'BCS999',
          subjectTitle: 'Not A’s',
          credits: 3,
          gradeLetter: 'A',
        },
      });

      /* The export path is `pullChanges` per collection, as the route uses. */
      const exported = await withUser(cloud, sessionFor(A), async (tx) => {
        const out: Record<string, unknown[]> = {};
        for (const collection of Object.keys(COLLECTION_TABLES)) {
          out[collection] = await pullChanges(tx, null, collection);
        }
        return out;
      });

      expect(exported.results).toHaveLength(1);
      expect(exported.resultSubjects).toHaveLength(1);
      expect(JSON.stringify(exported)).toContain('Software Engineering');
      expect(JSON.stringify(exported)).not.toContain('Not A’s');
      expect(JSON.stringify(exported)).not.toContain(bResult);
    });

    it('exports a subject row with everything needed to rebuild the result', async () => {
      const resultId = randomUUID();
      await push(A, profileA, {
        id: resultId,
        collection: 'results',
        baseRevision: null,
        data: { semester: 5, schemeId: 'vtu-2022' },
      });
      await push(A, profileA, {
        id: randomUUID(),
        collection: 'resultSubjects',
        baseRevision: null,
        data: {
          resultId,
          subjectCode: 'BCS501',
          subjectTitle: 'SE',
          credits: 3,
          gradeLetter: 'A',
          ordinal: 0,
        },
      });

      const rows = await withUser(cloud, sessionFor(A), (tx) =>
        pullChanges(tx, null, 'resultSubjects'),
      );
      const subject = rows[0];
      expect(subject?.data.resultId).toBe(resultId);
      expect(subject?.data.subjectCode).toBe('BCS501');
      expect(subject?.data.gradeLetter).toBe('A');
      expect(subject?.data.credits).toBeDefined();
    });
  });
  /* ------------------------------------------------------------------------ */
  /* What a result card prints (OQ-049)                                       */
  /* ------------------------------------------------------------------------ */

  describe('the printed marks fields', () => {
    /*
     * `result_subjects` REQUIRED credits and a grade letter and could store
     * none of internal, external, total, status or the announcement date — the
     * exact inverse of what a VTU provisional result prints. Supabase 0003
     * corrects that, and these tests fail if the columns, their nullability or
     * the cross-column invariant regress.
     *
     * Marks below are invented. The SHAPE is a real card's; the values are not.
     */
    const resultId = randomUUID();

    async function seedResult() {
      await push(A, profileA, {
        id: resultId,
        collection: 'results',
        baseRevision: null,
        data: { semester: 4, schemeId: 'vtu-2022', ruleSetId: 'vtu-2022-22ob' },
      });
    }

    it('carries every printed column to the second device', async () => {
      await seedResult();
      const subjectId = randomUUID();

      const outcome = await push(A, profileA, {
        id: subjectId,
        collection: 'resultSubjects',
        baseRevision: null,
        data: {
          resultId,
          subjectCode: 'BCS401',
          subjectTitle: 'Analysis & Design of Algorithms',
          internal: 44,
          external: 36,
          total: 80,
          resultStatus: 'P',
          announcedOn: '2026-07-23',
          credits: 4,
          hasSee: true,
          provenance: 'catalogue',
          ordinal: 0,
        },
      });
      expect(outcome.status).toBe('applied');

      const rows = await withUser(cloud, sessionFor(A), (tx) =>
        pullChanges(tx, null, 'resultSubjects'),
      );
      const carried = rows.find((row) => row.id === subjectId);

      expect(Number(carried?.data.internal)).toBe(44);
      expect(Number(carried?.data.external)).toBe(36);
      expect(Number(carried?.data.total)).toBe(80);
      expect(carried?.data.resultStatus).toBe('P');
      expect(carried?.data.hasSee).toBe(true);
      expect(carried?.data.provenance).toBe('catalogue');
      expect(new Date(carried?.data.announcedOn as string).toISOString()).toMatch(/^2026-07-23/);
    });

    it('accepts a provisional row with no grade and no credits', async () => {
      /*
       * THE ROW THAT COULD NOT BE SAVED BEFORE. A card printing marks and a
       * status, and no grade or credits at all, is the ordinary case — and the
       * NOT NULL constraints made it the impossible one.
       */
      await seedResult();
      const outcome = await push(A, profileA, {
        id: randomUUID(),
        collection: 'resultSubjects',
        baseRevision: null,
        data: {
          resultId,
          subjectCode: 'BENGK106',
          subjectTitle: 'Communicative English',
          internal: 33,
          external: 34,
          total: 67,
          resultStatus: 'P',
          gradeLetter: null,
          credits: null,
          ordinal: 0,
        },
      });
      expect(outcome.status).toBe('applied');
    });

    it('stores "we do not know whether this course has a SEE" as unknown', async () => {
      // NULL, not false and not true. An external of 0 does not decide it, and
      // a default would silently decide it for every legacy row (DEC-037).
      await seedResult();
      const subjectId = randomUUID();
      await push(A, profileA, {
        id: subjectId,
        collection: 'resultSubjects',
        baseRevision: null,
        data: { resultId, subjectCode: 'BCS402', subjectTitle: 'X', internal: 40, ordinal: 0 },
      });

      const [row] = await admin<{ has_see: boolean | null }[]>`
        SELECT has_see FROM result_subjects WHERE id = ${subjectId}::uuid
      `;
      expect(row?.has_see).toBeNull();
    });

    it('refuses a row whose columns do not add up', async () => {
      /*
       * Refused, never repaired. A row that has been mistyped or misread makes
       * every figure derived from it wrong, and the database is the last place
       * that can still say no.
       */
      await seedResult();
      await expect(
        admin`
          INSERT INTO result_subjects
            (result_id, auth_user_id, subject_code, subject_title, internal, external, total)
          VALUES (${resultId}::uuid, ${A}::uuid, 'BCS403', 'DBMS', 39, 28, 99)
        `,
      ).rejects.toThrow(/result_subjects_total_adds_up/i);
    });

    it('allows a total with only one side present', async () => {
      // Nothing to disagree with. Requiring the other side would require a
      // number the card may not have printed.
      await seedResult();
      const outcome = await push(A, profileA, {
        id: randomUUID(),
        collection: 'resultSubjects',
        baseRevision: null,
        data: { resultId, subjectCode: 'BCS404', subjectTitle: 'Y', total: 80, ordinal: 0 },
      });
      expect(outcome.status).toBe('applied');
    });

    it('will not let one student attach a marked subject row to a result of another', async () => {
      // The M9.1 ownership invariant, re-checked with the new columns in play:
      // more columns must not mean a new way across the boundary.
      await seedResult();
      await expect(
        admin`
          INSERT INTO result_subjects
            (result_id, auth_user_id, subject_code, subject_title, internal, external, total)
          VALUES (${resultId}::uuid, ${B}::uuid, 'BCS405', 'Z', 40, 30, 70)
        `,
      ).rejects.toThrow(/foreign key|result_subjects_belong_to_their_result/i);
    });
  });
});
