/**
 * Deployment readiness: the gate holds, the health is legible, the schedule
 * behaves over time.
 *
 * Authority: Phase 7B.6 §18–§21, §54, §61, §85, §155–§163
 *
 * WHAT THIS FILE ADDS THAT THE OTHERS DO NOT. `monitor-pipeline` proves the
 * registry refuses; this proves **nothing reaches the network before it does**,
 * which is a different claim and the one VTU's terms of use actually turn on.
 * `monitor-fanout` proves a rerun is idempotent; this proves three scheduled
 * runs across two snapshots behave as a deployment would see them.
 *
 * SYNTHETIC CONTENT ONLY.
 */

import postgres from 'postgres';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Sql } from '../src/db/client.js';
import { createClient } from '../src/db/client.js';
import { runMigrations } from '../src/db/migrate.js';
import { seed } from '../src/db/seed.js';
import { withUser } from '../src/db/cloud.js';
import type { Session } from '../src/auth/session.js';
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
import { materialize } from '../src/monitor/fanout.js';
import { clearListeners } from '../src/monitor/realtime.js';
import { monitorHealth, STALE_AFTER_INTERVALS, worstOf } from '../src/monitor/health.js';

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

const A = 'aaaaaaaa-6666-4000-8000-00000000000a';
const sessionFor = (userId: string): Session => ({
  userId,
  token: userId,
  claims: { sub: userId },
});

describeDb('deployment readiness', () => {
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
    await Promise.all([sql.end(), cloud.end(), admin.end(), monitor.end()]);
  });

  beforeEach(async () => {
    clearListeners();
    await sql`DELETE FROM source_items`;
    await sql`DELETE FROM monitor_runs`;
    await admin`DELETE FROM auth.users WHERE id = ${A}::uuid`;
    await admin`INSERT INTO auth.users (id, email) VALUES (${A}::uuid, 'synthetic-deploy@example.test')`;
    run = 0;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    clearListeners();
  });

  /* ------------------------------------------------------------------------ */
  /* The gate (§18, §19, §20)                                                 */
  /* ------------------------------------------------------------------------ */

  describe('the legal gate', () => {
    /*
     * §18. The four values the whole refusal rests on. If somebody relaxes one
     * of these to "make the worker work", this is what fails.
     */
    it('every family is still registered as unfetchable', async () => {
      for (const family of SOURCE_FAMILIES) {
        const [row] = await sql<
          {
            terms_status: string;
            rights_status: string;
            access_method: string;
            enabled: boolean;
          }[]
        >`
          SELECT terms_status, rights_status, access_method, enabled
          FROM sources WHERE id = ${FAMILY_SOURCE_ID[family]}
        `;
        expect(row, family).toBeDefined();
        expect(row?.terms_status, family).toBe('unknown');
        expect(row?.rights_status, family).toBe('unknown');
        expect(row?.access_method, family).toBe('none');
        expect(row?.enabled, family).toBe(false);
      }
    });

    /*
     * §19, §20. THE CLAIM THAT MATTERS. Being refused is not enough on its own
     * — a worker that fetched first and then decided would still have made an
     * automated request to vtu.ac.in, which is the thing VTU's terms exclude.
     *
     * So the network is removed entirely: any outbound call throws. If a single
     * one is attempted before the refusal, the refusal never arrives and this
     * fails.
     */
    it('refuses without touching the network', async () => {
      const attempted: string[] = [];
      vi.stubGlobal(
        'fetch',
        vi.fn((url: unknown) => {
          attempted.push(String(url));
          throw new Error('the network is not available to this test');
        }),
      );

      for (const family of SOURCE_FAMILIES) {
        const outcome = await acquireLive(sql, family);
        expect(outcome.ok, family).toBe(false);
        if (!outcome.ok) expect(outcome.failure, family).toBe('unauthorized');
      }

      expect(attempted, `attempted: ${attempted.join(', ')}`).toEqual([]);
    });

    /* Fails closed: no registry is not permission, and still no fetch. */
    it('refuses without touching the network when there is no registry either', async () => {
      const attempted: string[] = [];
      vi.stubGlobal(
        'fetch',
        vi.fn((url: unknown) => {
          attempted.push(String(url));
          throw new Error('the network is not available to this test');
        }),
      );

      const outcome = await acquireLive(null, 'examination');
      expect(outcome.ok).toBe(false);
      expect(attempted).toEqual([]);
    });

    /* §59. Fixture acquisition keeps working with the network gone. */
    it('reads fixtures with the network unavailable', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(() => {
          throw new Error('the network is not available to this test');
        }),
      );
      const outcome = await acquireFixture('examination', 'v1');
      expect(outcome.ok).toBe(true);
    });
  });

  /* ------------------------------------------------------------------------ */
  /* Health (§54, §155–§158)                                                  */
  /* ------------------------------------------------------------------------ */

  describe('health an operator can act on', () => {
    /*
     * §54. THE FAILURE THE VIEW ALONE CANNOT SEE. Every row in `monitor_health`
     * is written by a run, so a scheduler that was never configured leaves it
     * empty — indistinguishable from healthy to anything that only reads rows.
     */
    it('reports a family that has never run as never_ran', async () => {
      const health = await monitorHealth(sql, 60, SOURCE_FAMILIES);
      expect(health).toHaveLength(SOURCE_FAMILIES.length);
      for (const entry of health) expect(entry.state).toBe('never_ran');
      expect(worstOf(health)).toBe('never_ran');
    });

    /* §156. Finding nothing is a success and must not read as a fault. */
    it('reports a run that found nothing as healthy', async () => {
      await startRun(sql, 'deploy-ok-1', 'examination', 'fixture', false);
      await finishRun(sql, 'deploy-ok-1', 'ok', null, []);

      const health = await monitorHealth(sql, 60, ['examination']);
      expect(health[0]?.state).toBe('healthy');
      expect(health[0]?.detail).toContain('healthy run');
    });

    /* §157. A failed source is not a quiet one. */
    it('reports a failed source apart from a quiet one', async () => {
      await startRun(sql, 'deploy-fail-1', 'regulations', 'fixture', false);
      await finishRun(sql, 'deploy-fail-1', 'failed', 'the snapshot could not be read', []);

      const health = await monitorHealth(sql, 60, ['regulations']);
      expect(health[0]?.state).toBe('degraded');
      expect(health[0]?.detail).toContain('could not be read');
    });

    /* §158. Refusal is its own state, and is not an alert. */
    it('reports a registry refusal as its own state, not a failure', async () => {
      await startRun(sql, 'deploy-refused-1', 'administration', 'live', false);
      await finishRun(sql, 'deploy-refused-1', 'unauthorized', 'terms are unknown', []);

      const health = await monitorHealth(sql, 60, ['administration']);
      expect(health[0]?.state).toBe('unauthorized');
      expect(worstOf(health)).toBe('unauthorized');
    });

    /*
     * §54. A scheduler that stopped firing leaves a cheerful `ok` behind
     * forever. Overdue has to outrank the last outcome or a stopped deployment
     * looks perfectly healthy.
     */
    it('reports a family whose last run is long past as stale, however well it went', async () => {
      await sql`
        INSERT INTO monitor_runs (run_id, family, mode, started_at, finished_at, outcome)
        VALUES ('deploy-old-1', 'examination', 'fixture', now() - interval '2 days',
                now() - interval '2 days', 'ok')
      `;
      const health = await monitorHealth(sql, 60, ['examination']);
      expect(health[0]?.state).toBe('stale');
      expect(health[0]?.detail).toMatch(/probably is not/);
    });

    /* One missed run is a blip; alerting on it is how alerts get muted. */
    it('does not call a single slightly-late run stale', async () => {
      await sql`
        INSERT INTO monitor_runs (run_id, family, mode, started_at, finished_at, outcome)
        VALUES ('deploy-recent-1', 'examination', 'fixture',
                now() - interval '90 minutes', now() - interval '90 minutes', 'ok')
      `;
      const health = await monitorHealth(sql, 60, ['examination']);
      expect(health[0]?.state).toBe('healthy');
      expect(STALE_AFTER_INTERVALS).toBeGreaterThanOrEqual(2);
    });
  });

  /* ------------------------------------------------------------------------ */
  /* Three scheduled runs (§61, §85)                                          */
  /* ------------------------------------------------------------------------ */

  describe('what a scheduler would see over time', () => {
    async function scheduledRun(family: SourceFamily, version: string): Promise<void> {
      run += 1;
      const runId = `deploy-run-${String(run)}`;
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

    async function fanout() {
      return materialize(
        monitor,
        `deploy-fanout-${String(Date.now())}`,
        await publishedItems(sql, null),
        {},
      );
    }

    async function inbox() {
      return withUser(
        cloud,
        sessionFor(A),
        (tx) => tx<{ id: string; external_id: string; created_at: string }[]>`
          SELECT id::text, external_id, created_at::text FROM source_notifications
          ORDER BY created_at ASC, external_id ASC
        `,
      );
    }

    /*
     * §61. THE CADENCE TEST, exactly as a deployment experiences it: the
     * scheduler fires, fires again with nothing changed, and fires a third time
     * after VTU revised something.
     */
    it('t1 creates, t2 creates nothing, t3 creates the revision', async () => {
      await withUser(cloud, sessionFor(A), (tx) =>
        upsertProfile(tx, { schemeId: '2022', programme: 'B.E.', currentSemester: 5 }),
      );

      /*
       * COUNTED FROM A's OWN INBOX, NOT FROM THE RUN TOTAL.
       *
       * `materialize` fans out to every profile in the database, so its
       * `created` is a property of whoever else happens to exist — and the
       * cloud test database is shared with every other file in this suite. An
       * earlier version asserted on the run total, passed, and then failed the
       * moment another file left a matching profile behind. The claim this test
       * makes is about one student, so it counts one student's rows.
       */
      /* t1 — first sight. */
      await scheduledRun('examination', 'v1');
      await fanout();
      const afterFirst = (await inbox()).length;
      expect(afterFirst).toBeGreaterThan(0);

      /* t2 — the source has not moved. */
      await scheduledRun('examination', 'v1');
      await fanout();
      expect((await inbox()).length).toBe(afterFirst);

      /* t3 — VTU revised the timetable. */
      await scheduledRun('examination', 'v2');
      await fanout();

      const rows = await inbox();
      expect(rows).toHaveLength(afterFirst + 1);
      /* §24. Every row is a distinct notification; none arrived twice. */
      expect(new Set(rows.map((row) => row.id)).size).toBe(rows.length);

      /* The revision is the newest, and the earlier ones were not disturbed. */
      expect(rows[rows.length - 1]?.external_id).toBe('exam-2026-0312');
    });

    /* §85, §163. Chronological order survives across scheduled runs. */
    it('keeps the older notifications older', async () => {
      await withUser(cloud, sessionFor(A), (tx) =>
        upsertProfile(tx, { schemeId: '2022', programme: 'B.E.', currentSemester: 5 }),
      );
      await scheduledRun('examination', 'v1');
      await fanout();
      await scheduledRun('examination', 'v2');
      await fanout();

      const rows = await inbox();
      const stamps = rows.map((row) => Date.parse(row.created_at));
      const sorted = [...stamps].sort((left, right) => left - right);
      expect(stamps).toEqual(sorted);
    });

    /*
     * §57. A source that cannot be read this time must not erase what it said
     * last time, and must not be reported as a quiet success.
     */
    it('keeps the last known good source when a run fails', async () => {
      await scheduledRun('examination', 'v1');
      const before = await sql<{ count: string }[]>`
        SELECT count(*)::text AS count FROM source_items WHERE family = 'examination'
      `;

      /* The next scheduled run cannot read the snapshot. */
      const outcome = await acquireFixture('examination', 'v-missing');
      expect(outcome.ok).toBe(false);
      await startRun(sql, 'deploy-outage-1', 'examination', 'fixture', false);
      await finishRun(sql, 'deploy-outage-1', 'failed', 'the snapshot could not be read', []);

      const after = await sql<{ count: string }[]>`
        SELECT count(*)::text AS count FROM source_items WHERE family = 'examination'
      `;
      expect(after[0]?.count).toBe(before[0]?.count);

      const health = await monitorHealth(sql, 60, ['examination']);
      expect(health[0]?.state).not.toBe('healthy');
    });
  });
});
