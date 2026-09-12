/**
 * The monitoring pipeline end to end: acquire, store, project, isolate.
 *
 * Authority: Phase 7B.3 §5, §16–§18, §49–§57, §106–§131, §139
 *
 * A REAL DATABASE, both of them. The things being proved here are database
 * guarantees — that a second run inserts nothing, that a revision inserts
 * exactly one row, that one student cannot read another's notifications — and
 * none of them exists in a mock. RLS in particular cannot be tested without
 * Postgres, because RLS is Postgres.
 *
 * SYNTHETIC CONTENT ONLY. The fixtures are written for this suite and the two
 * students are `auth.users` rows created and deleted by it.
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
import {
  acquireFixture,
  acquireLive,
  FAMILY_SOURCE_ID,
  SOURCE_FAMILIES,
} from '../src/monitor/acquire.js';
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
import { projectNotifications, readAudience } from '../src/monitor/notify.js';

const REFERENCE_URL = process.env.TEST_DATABASE_URL;
const CLOUD_URL = process.env.TEST_CLOUD_DATABASE_URL;
const CLOUD_ADMIN_URL = process.env.TEST_CLOUD_ADMIN_DATABASE_URL;
const describeDb =
  REFERENCE_URL === undefined || CLOUD_URL === undefined || CLOUD_ADMIN_URL === undefined
    ? describe.skip
    : describe;

const A = 'aaaaaaaa-1111-4000-8000-0000000000aa';
const B = 'bbbbbbbb-1111-4000-8000-0000000000bb';

const sessionFor = (userId: string): Session => ({
  userId,
  token: userId,
  claims: { sub: userId },
});

describeDb('the VTU monitoring pipeline', () => {
  let sql: Sql;
  let cloud: Sql;
  let admin: Sql;
  let run = 0;

  beforeAll(async () => {
    sql = createClient(REFERENCE_URL as string);
    await runMigrations(sql);
    await seed(sql);
    admin = postgres(CLOUD_ADMIN_URL as string, { max: 2 }) as unknown as Sql;
    cloud = postgres(CLOUD_URL as string, { max: 5, prepare: false }) as unknown as Sql;
  }, 120_000);

  afterAll(async () => {
    await Promise.all([sql.end(), cloud.end(), admin.end()]);
  });

  beforeEach(async () => {
    await sql`DELETE FROM source_items`;
    await sql`DELETE FROM monitor_runs`;
    await admin`DELETE FROM auth.users WHERE id IN (${A}::uuid, ${B}::uuid)`;
    await admin`
      INSERT INTO auth.users (id, email) VALUES
        (${A}::uuid, 'synthetic-monitor-a@example.test'),
        (${B}::uuid, 'synthetic-monitor-b@example.test')
    `;
    run = 0;
  });

  /** One full run over one fixture snapshot, exactly as the worker does it. */
  async function monitor(family: SourceFamily, version: string): Promise<string> {
    run += 1;
    const runId = `test-run-${String(run)}`;
    const sourceId = FAMILY_SOURCE_ID[family];
    const outcome = await acquireFixture(family, version);
    if (!outcome.ok) throw new Error(`fixture ${family}.${version}: ${outcome.detail}`);

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
    return runId;
  }

  /* ------------------------------------------------------------------------ */
  /* Acquisition                                                              */
  /* ------------------------------------------------------------------------ */

  describe('acquisition', () => {
    it('reads a snapshot for every one of the six families', async () => {
      for (const family of SOURCE_FAMILIES) {
        const outcome = await acquireFixture(family, 'v1');
        expect(outcome.ok, `${family}: ${outcome.ok ? '' : outcome.detail}`).toBe(true);
        if (outcome.ok) expect(outcome.snapshot.items.length).toBeGreaterThan(0);
      }
    });

    /*
     * §113, and the test this whole phase is built around. If somebody makes
     * live acquisition stop refusing without the registry saying so, this is
     * what fails.
     */
    it('refuses to acquire any of the six live, and says which gate refused', async () => {
      for (const family of SOURCE_FAMILIES) {
        const outcome = await acquireLive(sql, family);
        expect(outcome.ok).toBe(false);
        if (!outcome.ok) {
          expect(outcome.failure).toBe('unauthorized');
          expect(outcome.detail.length).toBeGreaterThan(20);
        }
      }
    });

    /* IT FAILS CLOSED. An unreachable registry is not permission (docs/41). */
    it('refuses live acquisition when there is no registry at all', async () => {
      const outcome = await acquireLive(null, 'examination');
      expect(outcome.ok).toBe(false);
      if (!outcome.ok) expect(outcome.failure).toBe('unauthorized');
    });

    it('reports a missing snapshot as failed, not as an empty source', async () => {
      const outcome = await acquireFixture('examination', 'v99');
      expect(outcome.ok).toBe(false);
      if (!outcome.ok) expect(outcome.failure).toBe('failed');
    });

    /*
     * §5's MALFORMED case. A snapshot that is not a snapshot must be named as
     * such: "0 items" and "we could not read it" are different operational
     * facts (§75).
     */
    it('reports a snapshot it cannot parse as malformed, and names what is wrong', async () => {
      const directory = new URL('./fixtures/monitor-malformed/', import.meta.url);
      const outcome = await acquireFixture('examination', 'v1', directory);
      expect(outcome.ok).toBe(false);
      if (!outcome.ok) {
        expect(outcome.failure).toBe('malformed');
        expect(outcome.detail).toContain('items');
      }
    });
  });

  /* ------------------------------------------------------------------------ */
  /* The ledger                                                               */
  /* ------------------------------------------------------------------------ */

  describe('what a run writes down', () => {
    it('stores every item it read, and a run row describing the run', async () => {
      const runId = await monitor('examination', 'v1');
      const [row] = await sql<{ discovered: number; outcome: string; mode: string }[]>`
        SELECT discovered, outcome, mode FROM monitor_runs WHERE run_id = ${runId}
      `;
      expect(row?.outcome).toBe('ok');
      expect(row?.mode).toBe('fixture');
      expect(row?.discovered).toBe(3);

      const items = await sql<{ count: string }[]>`
        SELECT count(*)::text AS count FROM source_items WHERE family = 'examination'
      `;
      expect(items[0]?.count).toBe('3');
    });

    it('keeps the phrases that produced each classification', async () => {
      await monitor('examination', 'v1');
      const [row] = await sql<{ category: string; signals: string[]; importance: string }[]>`
        SELECT category, signals, importance FROM source_items
        WHERE external_id = 'exam-2026-0301'
      `;
      expect(row?.category).toBe('exam_timetable');
      expect(row?.importance).toBe('high');
      expect(row?.signals).toContain('Time Table');
    });

    /* §139: running the same worker twice must be safe, by constraint. */
    it('a second run over the same snapshot adds nothing', async () => {
      await monitor('examination', 'v1');
      const before = await sql<
        { count: string }[]
      >`SELECT count(*)::text AS count FROM source_items`;
      await monitor('examination', 'v1');
      const after = await sql<
        { count: string }[]
      >`SELECT count(*)::text AS count FROM source_items`;
      expect(after[0]?.count).toBe(before[0]?.count);

      const [latest] = await sql<{ items_unchanged: number }[]>`
        SELECT items_unchanged FROM monitor_runs ORDER BY started_at DESC LIMIT 1
      `;
      expect(latest?.items_unchanged).toBe(3);
    });

    it('records a revision as a new item beside the one it replaces', async () => {
      await monitor('examination', 'v1');
      await monitor('examination', 'v2');

      const [row] = await sql<{ items_revised: number }[]>`
        SELECT items_revised FROM monitor_runs ORDER BY started_at DESC LIMIT 1
      `;
      expect(row?.items_revised).toBe(1);

      const held = await sql<{ external_id: string }[]>`
        SELECT external_id FROM source_items WHERE external_id IN ('exam-2026-0301', 'exam-2026-0312')
      `;
      /* The original is NOT deleted. A student may already have been told. */
      expect(held).toHaveLength(2);
    });

    it('sees the same item with different content as an update, not a revision', async () => {
      await monitor('academic_calendar', 'v1');
      await monitor('academic_calendar', 'v2');
      const [row] = await sql<{ items_updated: number; items_revised: number }[]>`
        SELECT items_updated, items_revised FROM monitor_runs ORDER BY started_at DESC LIMIT 1
      `;
      expect(row?.items_updated).toBe(1);
      expect(row?.items_revised).toBe(0);
    });

    /* §15, §77. A source that withdraws a document has not made it untrue. */
    it('marks a withdrawn item rather than deleting it', async () => {
      await monitor('ug_scheme_syllabus', 'v1');
      await monitor('ug_scheme_syllabus', 'v2');

      const [row] = await sql<{ removed_at: Date | null }[]>`
        SELECT removed_at FROM source_items WHERE external_id = 'ug-2022-cs-v-draft'
      `;
      expect(row).toBeDefined();
      expect(row?.removed_at).not.toBeNull();
    });
  });

  /* ------------------------------------------------------------------------ */
  /* The projection                                                           */
  /* ------------------------------------------------------------------------ */

  describe('telling a student', () => {
    /** Gives a student a profile, and returns what the engine reads them as. */
    async function enrol(
      userId: string,
      profile: {
        schemeId: string;
        programme?: string;
        branch?: string;
        collegeName?: string;
        currentSemester?: number;
      },
    ): Promise<void> {
      await withUser(cloud, sessionFor(userId), (tx) => upsertProfile(tx, profile));
    }

    async function project(userId: string, muted: Parameters<typeof projectNotifications>[4] = []) {
      const items = await publishedItems(sql);
      return withUser(cloud, sessionFor(userId), async (tx) => {
        const audience = await readAudience(tx);
        if (audience === null) throw new Error('no profile');
        return projectNotifications(tx, 'test-run-1', items, audience, muted);
      });
    }

    async function notificationsOf(userId: string) {
      return withUser(
        cloud,
        sessionFor(userId),
        (tx) => tx<{ external_id: string; reason: string; importance: string }[]>`
          SELECT external_id, reason, importance FROM source_notifications ORDER BY external_id
        `,
      );
    }

    it('tells a matching student, once, with a reason in their own terms', async () => {
      await monitor('examination', 'v1');
      await enrol(A, { schemeId: '2022', programme: 'B.E.', currentSemester: 5 });

      const result = await project(A);
      expect(result.created).toBeGreaterThan(0);

      const rows = await notificationsOf(A);
      const timetable = rows.find((row) => row.external_id === 'exam-2026-0301');
      expect(timetable).toBeDefined();
      expect(timetable?.importance).toBe('high');
      expect(timetable?.reason).toContain('Applies to your');
    });

    /* §53, and the reason the unique index exists. */
    it('projecting twice creates no duplicates', async () => {
      await monitor('examination', 'v1');
      await enrol(A, { schemeId: '2022', programme: 'B.E.', currentSemester: 5 });

      const first = await project(A);
      const second = await project(A);
      expect(second.created).toBe(0);
      expect(second.alreadyHeld).toBe(first.created);
    });

    /* §120. A notice that is not theirs produces NOTHING, not a quiet row. */
    it('a student in a different scheme is told nothing', async () => {
      await monitor('examination', 'v1');
      await enrol(B, { schemeId: '2018', programme: 'B.E.', currentSemester: 5 });

      await project(B);
      const rows = await notificationsOf(B);
      expect(rows.find((row) => row.external_id === 'exam-2026-0301')).toBeUndefined();
    });

    /*
     * §35, §121. The unreadable-scope notice is in `source_items` and reaches
     * nobody — not even the student every other axis would have matched.
     */
    it('a notice whose scope could not be read reaches nobody', async () => {
      await monitor('examination', 'v1');
      await enrol(A, { schemeId: '2022', programme: 'B.E.', currentSemester: 5 });
      await project(A);

      const rows = await notificationsOf(A);
      expect(rows.find((row) => row.external_id === 'exam-2026-0295')).toBeUndefined();

      const [stored] = await sql<{ count: string }[]>`
        SELECT count(*)::text AS count FROM source_items WHERE external_id = 'exam-2026-0295'
      `;
      expect(stored?.count).toBe('1');
    });

    it('an unclassifiable notice reaches nobody', async () => {
      await monitor('regulations', 'v1');
      await enrol(A, { schemeId: '2022', programme: 'B.E.', currentSemester: 5 });
      await project(A);

      const rows = await notificationsOf(A);
      expect(rows.find((row) => row.external_id === 'reg-2026-011')).toBeUndefined();
    });

    /* §56. Muting suppresses the interruption; the item is still on record. */
    it('a muted category is stored and not delivered', async () => {
      await monitor('examination', 'v1');
      await enrol(A, { schemeId: '2022', programme: 'B.E.', currentSemester: 5 });

      const result = await project(A, ['exam_timetable']);
      expect(result.muted).toBeGreaterThan(0);

      const rows = await notificationsOf(A);
      expect(rows.find((row) => row.external_id === 'exam-2026-0301')).toBeUndefined();
    });

    it('a revision produces a second notification where the first was held', async () => {
      await monitor('examination', 'v1');
      await enrol(A, { schemeId: '2022', programme: 'B.E.', currentSemester: 5 });
      await project(A);

      await monitor('examination', 'v2');
      const second = await project(A);
      expect(second.created).toBe(1);

      const rows = await notificationsOf(A);
      expect(rows.find((row) => row.external_id === 'exam-2026-0312')).toBeDefined();
    });

    /*
     * §127, §128. Not an application check — a database one. B's session asks
     * for everything and gets only their own rows.
     */
    it('one student cannot read another student’s notifications', async () => {
      await monitor('examination', 'v1');
      await enrol(A, { schemeId: '2022', programme: 'B.E.', currentSemester: 5 });
      await enrol(B, { schemeId: '2022', programme: 'B.E.', currentSemester: 5 });

      await project(A);
      const mine = await notificationsOf(A);
      expect(mine.length).toBeGreaterThan(0);

      const theirs = await notificationsOf(B);
      expect(theirs).toHaveLength(0);
    });

    it('a student cannot hand their notification to somebody else', async () => {
      await monitor('examination', 'v1');
      await enrol(A, { schemeId: '2022', programme: 'B.E.', currentSemester: 5 });
      await project(A);

      await expect(
        withUser(
          cloud,
          sessionFor(A),
          (tx) => tx`UPDATE source_notifications SET auth_user_id = ${B}::uuid`,
        ),
      ).rejects.toThrow();
    });

    /*
     * §130. Everything in a notification came off a document this project did
     * not write, and the URL constraint is in the schema rather than only in
     * the client — because the client is not the only thing that reads it.
     */
    it('refuses a notification whose source link is not http(s)', async () => {
      await enrol(A, { schemeId: '2022' });
      await expect(
        withUser(
          cloud,
          sessionFor(A),
          (tx) => tx`
            INSERT INTO source_notifications (
              source_family, external_id, content_hash, category, importance,
              title, source_url, reason, run_id
            ) VALUES (
              'examination', 'hostile-1', ${'c'.repeat(64)}, 'examination', 'low',
              'A synthetic title', 'javascript:alert(1)', 'because', 'test-run-1'
            )
          `,
        ),
      ).rejects.toThrow();
    });
  });
});
