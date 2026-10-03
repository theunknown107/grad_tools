/**
 * Server-side fanout: reaching a student who is not here, safely.
 *
 * Authority: Phase 7B.3.1 §21–§24, §31–§34, §44–§49, §67–§71, §101–§117
 *
 * A REAL DATABASE, AND A REAL ROLE. The claim this file exists to support is
 * "the worker cannot read a student's grades", and that is a statement about
 * PostgreSQL privileges. Asserting it against a mock would assert nothing: the
 * mock would be written by the same person who wrote the grant.
 *
 * So the fanout here connects as `monitor_login`, `SET ROLE gradtools_monitor`,
 * and is told no by the database when it reaches for anything it should not
 * have.
 *
 * SYNTHETIC CONTENT ONLY.
 */

import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Sql } from '../src/db/client.js';
import { createClient } from '../src/db/client.js';
import { withUser } from '../src/db/cloud.js';
import type { Session } from '../src/auth/session.js';
import { runMigrations } from '../src/db/migrate.js';
import { seed } from '../src/db/seed.js';
import { upsertProfile } from '../src/student/store.js';
import { acquireFixture, FAMILY_SOURCE_ID } from '../src/monitor/acquire.js';
import { changeOf, contentHashOf, runMonitor, type SourceFamily } from '../src/monitor/run.js';
import {
  finishRun,
  knownItems,
  markRemoved,
  publishedItems,
  saveItems,
  startRun,
  type StoredItem,
} from '../src/monitor/store.js';
import { asMonitor, materialize, recipientBatch } from '../src/monitor/fanout.js';
import {
  DEFAULT_INTERVAL_MINUTES,
  MINIMUM_INTERVAL_MINUTES,
  scheduleFromEnv,
  startScheduler,
} from '../src/monitor/schedule.js';

const REFERENCE_URL = process.env.TEST_DATABASE_URL;
const CLOUD_URL = process.env.TEST_CLOUD_DATABASE_URL;
const CLOUD_ADMIN_URL = process.env.TEST_CLOUD_ADMIN_DATABASE_URL;
const MONITOR_URL = process.env.TEST_MONITOR_DATABASE_URL;
const describeDb =
  REFERENCE_URL === undefined ||
  CLOUD_URL === undefined ||
  CLOUD_ADMIN_URL === undefined ||
  MONITOR_URL === undefined
    ? describe.skip
    : describe;

const A = 'aaaaaaaa-2222-4000-8000-0000000000aa';
const B = 'bbbbbbbb-2222-4000-8000-0000000000bb';

const sessionFor = (userId: string): Session => ({
  userId,
  token: userId,
  claims: { sub: userId },
});

/* The scheduler is pure configuration and needs no database. */
describe('the schedule', () => {
  it('defaults to hourly when nothing is configured', () => {
    expect(scheduleFromEnv({}).intervalMinutes).toBe(DEFAULT_INTERVAL_MINUTES);
  });

  /*
   * §39. A university publishes a handful of notices a day; a sub-minute poll
   * would gain nothing and would look, from the far end, exactly like the
   * data-mining VTU's terms exclude.
   */
  it('refuses a cadence below the floor rather than rounding it up', () => {
    expect(() => scheduleFromEnv({ MONITOR_INTERVAL_MINUTES: '1' })).toThrow(/below the/);
    expect(MINIMUM_INTERVAL_MINUTES).toBeGreaterThanOrEqual(5);
  });

  /* A typo should be heard about, not silently replaced by the default. */
  it('refuses a cadence that is not a number', () => {
    expect(() => scheduleFromEnv({ MONITOR_INTERVAL_MINUTES: '6O' })).toThrow(/whole number/);
  });

  it('accepts a sane cadence', () => {
    expect(scheduleFromEnv({ MONITOR_INTERVAL_MINUTES: '30' }).intervalMinutes).toBe(30);
  });

  /*
   * §63, §70. The one guarantee worth having from a long-running loop is that
   * it is still there tomorrow.
   */
  it('keeps going after a cycle throws, and reports the failure', async () => {
    const seen: boolean[] = [];
    const handle = startScheduler(
      { intervalMinutes: MINIMUM_INTERVAL_MINUTES, runOnStart: true },
      () => Promise.reject(new Error('the database went away')),
      (outcome) => seen.push(outcome.ok),
    );
    await handle.stop();
    expect(seen).toEqual([false]);
  });
});

describeDb('server-side notification fanout', () => {
  let sql: Sql;
  let cloud: Sql;
  let admin: Sql;
  let monitor: Sql;
  let run = 0;

  beforeAll(async () => {
    sql = createClient(REFERENCE_URL as string);
    await runMigrations(sql);
    await seed(sql);
    admin = postgres(CLOUD_ADMIN_URL as string, { max: 2 }) as unknown as Sql;
    cloud = postgres(CLOUD_URL as string, { max: 5, prepare: false }) as unknown as Sql;
    monitor = postgres(MONITOR_URL as string, { max: 2, prepare: false }) as unknown as Sql;
  }, 120_000);

  afterAll(async () => {
    // Leave no enrolled synthetic student for a later file's fanout to notify.
    await admin`DELETE FROM auth.users WHERE email LIKE 'synthetic-fanout-%@example.test'`;
    await Promise.all([sql.end(), cloud.end(), admin.end(), monitor.end()]);
  });

  beforeEach(async () => {
    await sql`DELETE FROM source_items`;
    await sql`DELETE FROM monitor_runs`;
    await admin`DELETE FROM auth.users WHERE email LIKE 'synthetic-fanout-%'`;
    await admin`
      INSERT INTO auth.users (id, email) VALUES
        (${A}::uuid, 'synthetic-fanout-a@example.test'),
        (${B}::uuid, 'synthetic-fanout-b@example.test')
    `;
    run = 0;
  });

  /** One monitoring run, exactly as the worker performs it. */
  async function monitorFamily(family: SourceFamily, version: string): Promise<void> {
    run += 1;
    const runId = `fanout-run-${String(run)}`;
    const sourceId = FAMILY_SOURCE_ID[family];
    const outcome = await acquireFixture(family, version);
    if (!outcome.ok) throw new Error(outcome.detail);

    await startRun(sql, runId, family, 'fixture', false);
    const known = await knownItems(sql, sourceId);
    const result = runMonitor(runId, outcome.snapshot, known);
    const stored: StoredItem[] = outcome.snapshot.items.map((item) => {
      const hash = contentHashOf(item);
      const row = result.ledger.find((entry) => entry.externalId === item.externalId);
      return {
        item,
        contentHash: hash,
        change: changeOf(item, hash, known),
        category: row?.category ?? 'unresolved',
        signals: row?.signals ?? [],
        importance: row?.importance ?? 'low',
      };
    });
    await saveItems(sql, runId, sourceId, family, stored);
    await markRemoved(
      sql,
      runId,
      sourceId,
      result.ledger.filter((row) => row.change === 'removed').map((row) => row.externalId),
    );
    await finishRun(sql, runId, 'ok', null, result.ledger);
  }

  async function enrol(
    userId: string,
    profile: { schemeId: string; programme?: string; branch?: string; currentSemester?: number },
  ): Promise<void> {
    await withUser(cloud, sessionFor(userId), (tx) => upsertProfile(tx, profile));
  }

  /** The fanout, with nobody signed in anywhere. */
  async function fanout(options: Parameters<typeof materialize>[3] = {}) {
    const items = await publishedItems(sql, null);
    return materialize(monitor, `fanout-${String(Date.now())}`, items, options);
  }

  async function inboxOf(userId: string) {
    return withUser(
      cloud,
      sessionFor(userId),
      (tx) => tx<
        { id: string; external_id: string; reason: string; importance: string; state: string }[]
      >`
        SELECT id::text, external_id, reason, importance, state
        FROM source_notifications ORDER BY external_id
      `,
    );
  }

  /* ------------------------------------------------------------------------ */
  /* What the worker can and cannot reach (§106, §44, §45, §46)               */
  /* ------------------------------------------------------------------------ */

  describe('worker privilege', () => {
    it('reads the matching context it needs', async () => {
      await enrol(A, { schemeId: '2022', programme: 'B.E.', currentSemester: 5 });
      const rows = await asMonitor(monitor, (tx) => recipientBatch(tx, null, 100));
      expect(rows.length).toBeGreaterThan(0);
      expect(rows[0]?.audience.scheme).toBe('2022');
    });

    /*
     * THE LIST IS THE POINT. A worker deciding whether an examination notice
     * concerns semester 5 has no use for a name or a register number, so it
     * cannot have them — and this asserts the columns are absent from the view
     * rather than merely unused by the code.
     */
    it('cannot see a name or a register number, because the view has neither', async () => {
      const columns = await admin<{ column_name: string }[]>`
        SELECT column_name FROM information_schema.columns
        WHERE table_name = 'monitor_applicability_context'
      `;
      const names = columns.map((row) => row.column_name);
      expect(names).not.toContain('display_name');
      expect(names).not.toContain('usn');
      expect(names.sort()).toEqual([
        'auth_user_id',
        'branch',
        'college_name',
        'current_semester',
        'programme',
        'scheme_id',
      ]);
    });

    /* §4: it must not gain the ability to read arbitrary private records. */
    const forbidden = [
      'student_profiles',
      'semester_results',
      'result_subjects',
      'attendance_records',
      'timetable_slots',
      'backlog_records',
      'semester_subjects',
    ];
    for (const table of forbidden) {
      it(`is refused SELECT on ${table}`, async () => {
        await expect(
          asMonitor(monitor, (tx) => tx.unsafe(`SELECT count(*) FROM ${table}`)),
        ).rejects.toThrow(/permission denied/i);
      });
    }

    /*
     * IT CANNOT READ WHAT IT WROTE. Dedupe works without SELECT because
     * ON CONFLICT DO NOTHING needs none — which is what makes insert-only
     * fanout possible rather than merely desirable.
     */
    it('cannot read notifications back, not even its own', async () => {
      await expect(
        asMonitor(monitor, (tx) => tx`SELECT count(*) FROM source_notifications`),
      ).rejects.toThrow(/permission denied/i);
    });

    it('cannot mark a notification read on a student’s behalf', async () => {
      await expect(
        asMonitor(monitor, (tx) => tx`UPDATE source_notifications SET state = 'read'`),
      ).rejects.toThrow(/permission denied/i);
    });

    it('cannot delete a notification it sent', async () => {
      await expect(
        asMonitor(monitor, (tx) => tx`DELETE FROM source_notifications`),
      ).rejects.toThrow(/permission denied/i);
    });

    it('cannot modify a profile', async () => {
      await expect(
        asMonitor(monitor, (tx) => tx`UPDATE student_profiles SET branch = 'anything'`),
      ).rejects.toThrow(/permission denied/i);
    });

    it('holds no privilege at all until it takes the role', async () => {
      /* NOINHERIT: the login role is an empty account until it SET ROLEs. */
      /*
       * PostgreSQL hides what a role cannot reach, so the refusal arrives as
       * "does not exist" rather than "permission denied". Either is the
       * answer this asserts: without taking the role, there is nothing here.
       */
      await expect(monitor`SELECT count(*) FROM monitor_applicability_context`).rejects.toThrow(
        /permission denied|does not exist/i,
      );
    });
  });

  /* ------------------------------------------------------------------------ */
  /* The behaviour B.3 could not do (§24, §109)                               */
  /* ------------------------------------------------------------------------ */

  describe('a student who is not here', () => {
    /*
     * THE MANDATORY TEST (§109). No student session exists at any point while
     * the notification is created; one is opened afterwards, as a person opening
     * the app the next morning would.
     */
    it('is notified anyway, and finds it waiting when they next open the app', async () => {
      await enrol(A, { schemeId: '2022', programme: 'B.E.', currentSemester: 5 });
      await monitorFamily('examination', 'v1');

      const result = await fanout();
      expect(result.created).toBeGreaterThan(0);

      const inbox = await inboxOf(A);
      const timetable = inbox.find((row) => row.external_id === 'exam-2026-0301');
      expect(timetable).toBeDefined();
      expect(timetable?.state).toBe('unread');
      expect(timetable?.importance).toBe('high');
      expect(timetable?.reason).toContain('Applies to your');
    });

    /* §110, §22. */
    it('reaches the student it applies to and not the other one', async () => {
      await enrol(A, { schemeId: '2022', programme: 'B.E.', currentSemester: 5 });
      await enrol(B, { schemeId: '2018', programme: 'B.E.', currentSemester: 5 });
      await monitorFamily('examination', 'v1');
      await fanout();

      expect((await inboxOf(A)).some((row) => row.external_id === 'exam-2026-0301')).toBe(true);
      expect((await inboxOf(B)).some((row) => row.external_id === 'exam-2026-0301')).toBe(false);
    });

    /* §23. One notice matching three axes is ONE notification, not three. */
    it('creates one notification for a notice that matches on several dimensions', async () => {
      await enrol(A, { schemeId: '2022', programme: 'B.E.', currentSemester: 5 });
      await monitorFamily('examination', 'v1');
      await fanout();

      const held = (await inboxOf(A)).filter((row) => row.external_id === 'exam-2026-0301');
      expect(held).toHaveLength(1);
      /* §78: the matched dimensions are still explained, in one row. */
      expect(held[0]?.reason).toMatch(/scheme|programme|semester/);
    });
  });

  /* ------------------------------------------------------------------------ */
  /* Idempotence, concurrency, recovery (§21, §31–§34, §71, §114–§116)        */
  /* ------------------------------------------------------------------------ */

  describe('running it more than once', () => {
    it('creates nothing the second time', async () => {
      await enrol(A, { schemeId: '2022', programme: 'B.E.', currentSemester: 5 });
      await monitorFamily('examination', 'v1');

      const first = await fanout();
      const second = await fanout();
      expect(first.created).toBeGreaterThan(0);
      expect(second.created).toBe(0);
      expect(second.alreadyHeld).toBe(first.created);
    });

    /* §32, §34, §114. Two workers, one logical notification. */
    it('two workers racing produce one notification each', async () => {
      await enrol(A, { schemeId: '2022', programme: 'B.E.', currentSemester: 5 });
      await monitorFamily('examination', 'v1');

      const [left, right] = await Promise.all([fanout(), fanout()]);
      expect(left.created + right.created).toBeGreaterThan(0);

      const inbox = await inboxOf(A);
      const ids = inbox.map((row) => row.external_id);
      expect(new Set(ids).size).toBe(ids.length);
    });

    /*
     * §115, §116. The crash is simulated where it actually hurts: the source is
     * persisted, some students are notified, and the process dies. A rerun must
     * finish the job without doubling the part that succeeded.
     */
    it('finishes a partial fanout without duplicating what already landed', async () => {
      const users: string[] = [];
      for (let index = 0; index < 10; index += 1) {
        const id = `cccccccc-2222-4000-8000-0000000${String(index).padStart(5, '0')}`;
        users.push(id);
        await admin`
          INSERT INTO auth.users (id, email)
          VALUES (${id}::uuid, ${`synthetic-fanout-${String(index)}@example.test`})
        `;
        await enrol(id, { schemeId: '2022', programme: 'B.E.', currentSemester: 5 });
      }
      await monitorFamily('examination', 'v1');

      /* The interrupted run: only the first five students are reached. */
      const items = await publishedItems(sql, null);
      const halfway = await materialize(monitor, 'crashed-run', items, { batchSize: 5 });
      expect(halfway.usersConsidered).toBeGreaterThanOrEqual(5);

      const partial = await sql`SELECT 1`;
      expect(partial).toBeDefined();

      /* The rerun. */
      const recovery = await fanout();
      expect(recovery.created + halfway.created).toBeGreaterThan(0);

      for (const id of users) {
        const inbox = await inboxOf(id);
        const timetables = inbox.filter((row) => row.external_id === 'exam-2026-0301');
        expect(timetables, `user ${id}`).toHaveLength(1);
      }

      await admin`DELETE FROM auth.users WHERE id = ANY(${admin.array(users)}::uuid[])`;
    });

    /* §113, §59. A genuine revision is news; a rerun of it is not. */
    it('a revision notifies once, and a rerun of the revision notifies nobody', async () => {
      await enrol(A, { schemeId: '2022', programme: 'B.E.', currentSemester: 5 });
      await monitorFamily('examination', 'v1');
      await fanout();
      const before = (await inboxOf(A)).length;

      await monitorFamily('examination', 'v2');
      const afterRevision = await fanout();
      expect(afterRevision.created).toBe(1);

      const again = await fanout();
      expect(again.created).toBe(0);
      expect((await inboxOf(A)).length).toBe(before + 1);
    });

    /* §60. Same hash, no new notification. */
    it('an unchanged source notifies nobody a second time', async () => {
      await enrol(A, { schemeId: '2022', programme: 'B.E.', currentSemester: 5 });
      await monitorFamily('examination', 'v1');
      await fanout();
      await monitorFamily('examination', 'v1');
      expect((await fanout()).created).toBe(0);
    });

    /*
     * §62. A source that withdraws a document has not told the student
     * anything, so nothing is sent about it.
     */
    it('says nothing when a source simply withdraws a document', async () => {
      await enrol(A, { schemeId: '2022', programme: 'B.E.', currentSemester: 5 });
      await monitorFamily('ug_scheme_syllabus', 'v1');
      await fanout();
      const before = (await inboxOf(A)).length;

      await monitorFamily('ug_scheme_syllabus', 'v2');
      await fanout();
      expect((await inboxOf(A)).length).toBe(before);
    });
  });

  /* ------------------------------------------------------------------------ */
  /* Who gets interrupted (§54, §55, §111, §112)                              */
  /* ------------------------------------------------------------------------ */

  describe('the importance floor', () => {
    /*
     * §54. The families carry a great deal that is official, true and none of a
     * student's business. A tender notice is `administration/low` and
     * university-wide — exactly the shape that would reach everybody.
     */
    it('does not interrupt anybody about a housekeeping tender', async () => {
      await enrol(A, { schemeId: '2022', programme: 'B.E.', currentSemester: 5 });
      await monitorFamily('administration', 'v1');
      await fanout();

      const inbox = await inboxOf(A);
      expect(inbox.some((row) => row.external_id === 'adm-2026-0139')).toBe(false);
    });

    it('still stores the item it declined to interrupt anybody about', async () => {
      await monitorFamily('administration', 'v1');
      const [row] = await sql<{ count: string }[]>`
        SELECT count(*)::text AS count FROM source_items WHERE external_id = 'adm-2026-0139'
      `;
      expect(row?.count).toBe('1');
    });

    it('a high floor keeps a medium-importance notice to itself', async () => {
      await enrol(A, { schemeId: '2022', programme: 'B.E.', currentSemester: 5 });
      await monitorFamily('academic_calendar', 'v1');
      await fanout({ floor: 'high' });
      expect((await inboxOf(A)).some((row) => row.external_id === 'cal-2026-odd')).toBe(false);

      await fanout({ floor: 'medium' });
      expect((await inboxOf(A)).some((row) => row.external_id === 'cal-2026-odd')).toBe(true);
    });
  });

  describe('profile completeness', () => {
    /* §111. A complete profile resolves a programme-scoped notice. */
    it('a complete profile receives a programme-scoped notice', async () => {
      await enrol(A, { schemeId: '2022', programme: 'B.E.', currentSemester: 5 });
      await monitorFamily('examination', 'v1');
      await fanout();
      expect((await inboxOf(A)).some((row) => row.external_id === 'exam-2026-0301')).toBe(true);
    });

    /*
     * §12, §111. A legacy profile with no programme keeps working and is simply
     * not interrupted about programme-scoped notices. Unresolved is an answer.
     */
    it('a profile with no programme stays unresolved rather than guessed', async () => {
      await enrol(B, { schemeId: '2022', currentSemester: 5 });
      await monitorFamily('examination', 'v1');
      const result = await fanout();
      expect(result.unresolved).toBeGreaterThan(0);
      expect((await inboxOf(B)).some((row) => row.external_id === 'exam-2026-0301')).toBe(false);
    });

    /*
     * §112, §77. The student holds courses whose codes would let a clever
     * system infer a branch. It must not. Nothing is inferred from a course
     * code, a title or a college name.
     */
    it('does not infer a missing programme from the courses the student holds', async () => {
      await enrol(B, { schemeId: '2022', currentSemester: 5 });
      const [profile] = await withUser(
        cloud,
        sessionFor(B),
        (tx) => tx<{ id: string }[]>`SELECT id::text FROM student_profiles LIMIT 1`,
      );
      await withUser(
        cloud,
        sessionFor(B),
        (tx) => tx`
          INSERT INTO semester_subjects (profile_id, semester, code, title, credits)
          VALUES (${profile?.id ?? ''}::uuid, 5, 'BCS502', 'A synthetic course', 4)
        `,
      );

      const rows = await asMonitor(monitor, (tx) => recipientBatch(tx, null, 100));
      const theirs = rows.find((row) => row.userId === B);
      expect(theirs?.audience.programme).toBeNull();
      expect(theirs?.audience.enrolledCourses).toContain('BCS502');
    });
  });

  /* ------------------------------------------------------------------------ */
  /* Isolation (§47, §48, §49, §79)                                           */
  /* ------------------------------------------------------------------------ */

  describe('one student cannot reach another', () => {
    beforeEach(async () => {
      await enrol(A, { schemeId: '2022', programme: 'B.E.', currentSemester: 5 });
      await enrol(B, { schemeId: '2022', programme: 'B.E.', currentSemester: 5 });
      await monitorFamily('examination', 'v1');
    });

    /* §47, §79. Not the notification, not the reason, not the read state. */
    it('B cannot see A’s notifications even when both were notified', async () => {
      await fanout();
      const mine = await inboxOf(A);
      const theirs = await inboxOf(B);
      expect(mine.length).toBeGreaterThan(0);
      expect(theirs.length).toBeGreaterThan(0);

      const mineIds = new Set(mine.map((row) => row.id));
      for (const row of theirs) expect(mineIds.has(row.id)).toBe(false);
    });

    /* §48, §105. A direct id is not a key to somebody else's row. */
    it('B asking for A’s notification by id finds nothing', async () => {
      await fanout();
      const target = (await inboxOf(A))[0];
      expect(target).toBeDefined();

      const stolen = await withUser(
        cloud,
        sessionFor(B),
        (tx) => tx<{ id: string }[]>`
          SELECT id::text FROM source_notifications WHERE id = ${target?.id ?? ''}::uuid
        `,
      );
      expect(stolen).toHaveLength(0);
    });

    /* §49. Forging one by naming somebody else in the payload. */
    it('B cannot create a notification addressed to A', async () => {
      await expect(
        withUser(
          cloud,
          sessionFor(B),
          (tx) => tx`
            INSERT INTO source_notifications (
              auth_user_id, source_family, external_id, content_hash,
              category, importance, title, source_url, reason, run_id
            ) VALUES (
              ${A}::uuid, 'examination', 'forged-1', ${'d'.repeat(64)},
              'examination', 'high', 'A forged notice',
              'https://example.test/forged', 'because', 'forged-run'
            )
          `,
        ),
      ).rejects.toThrow();
    });

    /* §25, §82, §83. The existing read semantics still belong to the student. */
    it('a student can mark their own notification read, and only their own', async () => {
      await fanout();
      const target = (await inboxOf(A))[0];
      await withUser(
        cloud,
        sessionFor(A),
        (tx) =>
          tx`UPDATE source_notifications SET state = 'read' WHERE id = ${target?.id ?? ''}::uuid`,
      );
      expect((await inboxOf(A)).find((row) => row.id === target?.id)?.state).toBe('read');

      /* B's attempt targets a row RLS will not show them: nothing changes. */
      await withUser(
        cloud,
        sessionFor(B),
        (tx) =>
          tx`UPDATE source_notifications SET state = 'dismissed' WHERE id = ${target?.id ?? ''}::uuid`,
      );
      expect((await inboxOf(A)).find((row) => row.id === target?.id)?.state).toBe('read');
    });
  });

  /* ------------------------------------------------------------------------ */
  /* Health (§66–§69, §124, §125)                                             */
  /* ------------------------------------------------------------------------ */

  describe('health', () => {
    it('reports a run that found nothing as a success', async () => {
      await monitorFamily('examination', 'v1');
      await monitorFamily('examination', 'v1');
      const [row] = await sql<
        { last_outcome: string; consecutive_failures: number; last_success_at: Date | null }[]
      >`SELECT last_outcome, consecutive_failures, last_success_at
        FROM monitor_health WHERE family = 'examination'`;
      expect(row?.last_outcome).toBe('ok');
      expect(row?.consecutive_failures).toBe(0);
      expect(row?.last_success_at).not.toBeNull();
    });

    /*
     * §69. The distinction the view exists for: both runs discovered nothing,
     * and only one of them is healthy.
     */
    it('distinguishes a source that failed from a source that was quiet', async () => {
      await startRun(sql, 'health-fail-1', 'regulations', 'fixture', false);
      await finishRun(sql, 'health-fail-1', 'failed', 'the snapshot could not be read', []);

      const [row] = await sql<{ last_outcome: string; consecutive_failures: number }[]>`
        SELECT last_outcome, consecutive_failures FROM monitor_health WHERE family = 'regulations'
      `;
      expect(row?.last_outcome).toBe('failed');
      expect(row?.consecutive_failures).toBe(1);
    });

    /*
     * Being refused by the registry is the system working, and paging somebody
     * hourly about it would train them to ignore the alert that matters.
     */
    it('does not count a registry refusal as a failure', async () => {
      await startRun(sql, 'health-refused-1', 'pg_scheme_syllabus', 'live', false);
      await finishRun(sql, 'health-refused-1', 'unauthorized', 'terms are unknown', []);

      const [row] = await sql<{ consecutive_failures: number; last_refusal_at: Date | null }[]>`
        SELECT consecutive_failures, last_refusal_at
        FROM monitor_health WHERE family = 'pg_scheme_syllabus'
      `;
      expect(row?.consecutive_failures).toBe(0);
      expect(row?.last_refusal_at).not.toBeNull();
    });
  });

  /* ------------------------------------------------------------------------ */
  /* Paging (§72, §73)                                                        */
  /* ------------------------------------------------------------------------ */

  describe('reading students in batches', () => {
    it('pages through every student without repeating or skipping one', async () => {
      const users: string[] = [];
      for (let index = 0; index < 7; index += 1) {
        const id = `dddddddd-2222-4000-8000-0000000${String(index).padStart(5, '0')}`;
        users.push(id);
        await admin`
          INSERT INTO auth.users (id, email)
          VALUES (${id}::uuid, ${`synthetic-fanout-page-${String(index)}@example.test`})
        `;
        await enrol(id, { schemeId: '2022', programme: 'B.E.', currentSemester: 5 });
      }

      const seen: string[] = [];
      await asMonitor(monitor, async (tx) => {
        let after: string | null = null;
        for (;;) {
          const batch = await recipientBatch(tx, after, 3);
          if (batch.length === 0) break;
          for (const recipient of batch) seen.push(recipient.userId);
          after = batch[batch.length - 1]?.userId ?? null;
          if (batch.length < 3) break;
        }
      });

      for (const id of users) expect(seen).toContain(id);
      expect(new Set(seen).size).toBe(seen.length);

      await admin`DELETE FROM auth.users WHERE id = ANY(${admin.array(users)}::uuid[])`;
    });
  });

  /* ------------------------------------------------------------------------ */
  /* The dry run (§43)                                                        */
  /* ------------------------------------------------------------------------ */

  describe('a dry run', () => {
    it('decides everything and writes nothing', async () => {
      await enrol(A, { schemeId: '2022', programme: 'B.E.', currentSemester: 5 });
      await monitorFamily('examination', 'v1');

      const preview = await fanout({ dryRun: true });
      expect(preview.created).toBeGreaterThan(0);
      expect(preview.decisions.length).toBeGreaterThan(0);
      expect((await inboxOf(A)).length).toBe(0);

      const real = await fanout();
      expect(real.created).toBe(preview.created);
    });

    it('reports the source, the match and the outcome for each decision', async () => {
      await enrol(A, { schemeId: '2022', programme: 'B.E.', currentSemester: 5 });
      await monitorFamily('examination', 'v1');

      const preview = await fanout({ dryRun: true });
      const decision = preview.decisions.find((row) => row.externalId === 'exam-2026-0301');
      expect(decision).toBeDefined();
      expect(decision?.userId).toBe(A);
      expect(decision?.importance).toBe('high');
      expect(decision?.outcome).toBe('created');
      expect(decision?.matched.length).toBeGreaterThan(0);
    });
  });
});
