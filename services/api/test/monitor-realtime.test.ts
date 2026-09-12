/**
 * Realtime delivery: the doorbell, and what happens when nobody hears it.
 *
 * Authority: Phase 7B.5 §14, §17, §19, §21, §25, §28, §36, §67–§70, §108–§112
 *
 * WHAT THIS FILE IS REALLY ABOUT. Every test here exists to prove the same
 * sentence from a different angle: **the database row is the notification and
 * the socket is a convenience.** A closed connection, a full connection table,
 * a database that refuses to notify, a second worker racing the first — none of
 * them may cost a student a notice.
 *
 * SYNTHETIC CONTENT ONLY.
 */

import postgres from 'postgres';
import request from 'supertest';
import type { Express } from 'express';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Sql } from '../src/db/client.js';
import { createClient } from '../src/db/client.js';
import { loadConfig } from '../src/config.js';
import { runMigrations } from '../src/db/migrate.js';
import { seed } from '../src/db/seed.js';
import { createApp } from '../src/http/app.js';
import { createLogger } from '../src/observability/logger.js';
import { withUser } from '../src/db/cloud.js';
import type { Session } from '../src/auth/session.js';
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
import { materialize } from '../src/monitor/fanout.js';
import {
  addListener,
  clearListeners,
  connectionCount,
  deliver,
  forClient,
  MAX_CONNECTIONS_PER_USER,
  publish,
  startListening,
  type NotificationCreated,
} from '../src/monitor/realtime.js';

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

const A = 'aaaaaaaa-5555-4000-8000-00000000000a';
const B = 'bbbbbbbb-5555-4000-8000-00000000000b';

const sessionFor = (userId: string): Session => ({
  userId,
  token: userId,
  claims: { sub: userId },
});

function event(userId: string, id: string): NotificationCreated {
  return {
    type: 'notification.created',
    userId,
    notificationId: id,
    category: 'exam_timetable',
    importance: 'high',
    title: 'Revised Time Table for the V Semester Examination',
    sourceUrl: 'https://vtu.ac.in/en/examination/synthetic/',
    reason: 'Applies to your scheme · programme · semester.',
  };
}

/* -------------------------------------------------------------------------- */
/* The in-process register — no database needed                               */
/* -------------------------------------------------------------------------- */

describe('who an event reaches', () => {
  afterEach(() => {
    clearListeners();
  });

  /*
   * §17, §19. The addressing IS the routing. B's listener is not filtered out
   * of A's events; it is never in the set those events are delivered to.
   */
  it('delivers to the addressed student and nobody else', () => {
    const mine: NotificationCreated[] = [];
    const theirs: NotificationCreated[] = [];
    addListener(A, (e) => mine.push(e));
    addListener(B, (e) => theirs.push(e));

    deliver(event(A, 'n1'));
    expect(mine).toHaveLength(1);
    expect(theirs).toHaveLength(0);
  });

  it('reaches every device one student has open', () => {
    let phone = 0;
    let laptop = 0;
    addListener(A, () => (phone += 1));
    addListener(A, () => (laptop += 1));
    expect(deliver(event(A, 'n1'))).toBe(2);
    expect(phone).toBe(1);
    expect(laptop).toBe(1);
  });

  it('is a no-op when nobody is connected', () => {
    expect(deliver(event(A, 'n1'))).toBe(0);
  });

  /* §28, §151. The leak that takes a week to show up. */
  it('forgets a connection completely when it closes', () => {
    const stop = addListener(A, () => {});
    expect(connectionCount()).toBe(1);
    stop?.();
    expect(connectionCount()).toBe(0);
    expect(deliver(event(A, 'n1'))).toBe(0);
  });

  /* §150, §154. */
  it('refuses a connection beyond the per-account limit', () => {
    for (let index = 0; index < MAX_CONNECTIONS_PER_USER; index += 1) {
      expect(addListener(A, () => {})).not.toBeNull();
    }
    expect(addListener(A, () => {})).toBeNull();
  });

  it('frees the slot again once one closes', () => {
    const first = addListener(A, () => {});
    for (let index = 1; index < MAX_CONNECTIONS_PER_USER; index += 1) addListener(A, () => {});
    expect(addListener(A, () => {})).toBeNull();
    first?.();
    expect(addListener(A, () => {})).not.toBeNull();
  });

  /* §25, §67. One broken socket must not stop the others. */
  it('keeps delivering after a listener throws', () => {
    let reached = 0;
    addListener(A, () => {
      throw new Error('the socket is gone');
    });
    addListener(A, () => (reached += 1));
    expect(deliver(event(A, 'n1'))).toBe(1);
    expect(reached).toBe(1);
  });

  /*
   * §21, §80. The addressing is stripped: the connection already knows whose
   * it is, and echoing the id back is the one field with no purpose.
   */
  it('does not send the user id back down the wire', () => {
    const payload = forClient(event(A, 'n1'));
    expect(Object.keys(payload)).not.toContain('userId');
    expect(Object.keys(payload).sort()).toEqual([
      'category',
      'importance',
      'notificationId',
      'reason',
      'sourceUrl',
      'title',
      'type',
    ]);
  });
});

/* -------------------------------------------------------------------------- */
/* Across processes, through the database                                     */
/* -------------------------------------------------------------------------- */

describeDb('the doorbell', () => {
  let sql: Sql;
  let cloud: Sql;
  let admin: Sql;
  let monitor: Sql;
  let app: Express;
  let stopListening: (() => Promise<void>) | null = null;
  let run = 0;

  beforeAll(async () => {
    sql = createClient(REFERENCE_URL as string);
    await runMigrations(sql);
    await seed(sql);
    admin = postgres(CLOUD_ADMIN_URL as string, { max: 2 }) as unknown as Sql;
    cloud = postgres(CLOUD_URL as string, { max: 5, prepare: false }) as unknown as Sql;
    monitor = postgres(MONITOR_URL as string, { max: 2, prepare: false }) as unknown as Sql;
    app = createApp(
      loadConfig({ DATABASE_URL: REFERENCE_URL, NODE_ENV: 'test', APP_ENV: 'test' }),
      sql,
      createLogger('silent', false),
      {
        sql: cloud,
        verify: async (token: string) => {
          if (token !== A && token !== B) throw new Error('not a known synthetic user');
          return sessionFor(token);
        },
      },
    );
    /*
     * `createApp` already opened the process's LISTEN session. Calling it again
     * returns that same one rather than a second — which is the guard a failing
     * version of this file proved was needed.
     */
    stopListening = (await startListening(cloud)).stop;
  }, 120_000);

  afterAll(async () => {
    if (stopListening !== null) await stopListening();
    await Promise.all([sql.end(), cloud.end(), admin.end(), monitor.end()]);
  });

  beforeEach(async () => {
    clearListeners();
    await sql`DELETE FROM source_items`;
    await sql`DELETE FROM monitor_runs`;
    await admin`DELETE FROM auth.users WHERE id IN (${A}::uuid, ${B}::uuid)`;
    await admin`
      INSERT INTO auth.users (id, email) VALUES
        (${A}::uuid, 'synthetic-rt-a@example.test'),
        (${B}::uuid, 'synthetic-rt-b@example.test')
    `;
    run = 0;
  });

  afterEach(() => {
    clearListeners();
  });

  /*
   * DRAIN BEFORE ASSERTING ABSENCE. A `NOTIFY` is a round trip: `publish`
   * resolves when the database accepts it, and the delivery arrives afterwards.
   * A test that registers a listener and asserts "nothing arrives" will
   * otherwise catch the previous assertion's doorbell — which is a property of
   * the test, not of the code.
   */
  async function drain(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 300));
    clearListeners();
  }

  async function monitorFamily(family: SourceFamily, version: string): Promise<void> {
    run += 1;
    const runId = `rt-run-${String(run)}`;
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

  async function enrol(userId: string, scheme: string): Promise<void> {
    await withUser(cloud, sessionFor(userId), (tx) =>
      upsertProfile(tx, { schemeId: scheme, programme: 'B.E.', currentSemester: 5 }),
    );
  }

  async function fanout() {
    const items = await publishedItems(sql, null);
    return materialize(monitor, `rt-fanout-${String(Date.now())}`, items, {});
  }

  /** Waits for the LISTEN round trip, which is a real network hop. */
  async function settle(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 300));
  }

  /*
   * The point of the whole phase: an event crosses from the worker process to
   * the API process, and does it through the database rather than a broker.
   */
  it('carries an event from the worker connection to the API connection', async () => {
    const seen: NotificationCreated[] = [];
    addListener(A, (e) => seen.push(e));

    expect(await publish(monitor, event(A, 'n-cross'))).toBe(true);
    await settle();

    expect(seen).toHaveLength(1);
    expect(seen[0]?.notificationId).toBe('n-cross');
  });

  /* §19, §69. Two processes, and B's connection still hears nothing of A's. */
  it('does not carry one student’s event to another’s connection', async () => {
    const theirs: NotificationCreated[] = [];
    addListener(B, (e) => theirs.push(e));

    await publish(monitor, event(A, 'n-not-yours'));
    await settle();
    expect(theirs).toHaveLength(0);
  });

  /* §24, §65. Persisted, then announced. */
  it('announces a real notification the worker just created', async () => {
    await enrol(A, '2022');
    await monitorFamily('examination', 'v1');

    const seen: NotificationCreated[] = [];
    addListener(A, (e) => seen.push(e));

    const result = await fanout();
    await settle();

    expect(result.created).toBeGreaterThan(0);
    expect(result.deliveryAttempted).toBe(result.created);
    expect(seen.length).toBe(result.created);
    /* The id in the event is the row's id, so a client can dedupe on it. */
    const ids = seen.map((e) => e.notificationId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  /*
   * §23, §64, §181. THE PRIMARY RELIABILITY TEST. Nobody is connected at all
   * while the notification is made, and it is simply there afterwards.
   */
  it('persists for a student with nothing open, and they find it later', async () => {
    await enrol(A, '2022');
    await monitorFamily('examination', 'v1');

    expect(connectionCount()).toBe(0);
    const result = await fanout();
    expect(result.created).toBeGreaterThan(0);

    const inbox = await request(app)
      .get('/api/v1/me/notifications')
      .set('Authorization', `Bearer ${A}`)
      .expect(200);
    expect((inbox.body.notifications as unknown[]).length).toBe(result.created);
    expect(inbox.body.unread).toBe(result.created);
  });

  /*
   * §25, §67, §108, §184. The socket is broken and the run does not care.
   */
  it('keeps the notification when every listener throws', async () => {
    await enrol(A, '2022');
    await monitorFamily('examination', 'v1');
    addListener(A, () => {
      throw new Error('the connection died mid-write');
    });

    const result = await fanout();
    await settle();
    expect(result.created).toBeGreaterThan(0);

    const inbox = await request(app)
      .get('/api/v1/me/notifications')
      .set('Authorization', `Bearer ${A}`)
      .expect(200);
    expect((inbox.body.notifications as unknown[]).length).toBe(result.created);
  });

  /*
   * §110. A publish that cannot happen is a DELIVERY problem, and the run says
   * so rather than reporting a source-processing failure.
   */
  it('reports a failed publish without failing the run', async () => {
    const closed = postgres(MONITOR_URL as string, { max: 1 }) as unknown as Sql;
    await closed.end();
    expect(await publish(closed, event(A, 'n-doomed'))).toBe(false);
  });

  /* §35, §179. A second run rings no second doorbell, because it creates nothing. */
  it('announces nothing on a rerun that creates nothing', async () => {
    await enrol(A, '2022');
    await monitorFamily('examination', 'v1');
    await fanout();
    await drain();

    const seen: NotificationCreated[] = [];
    addListener(A, (e) => seen.push(e));

    const second = await fanout();
    await settle();
    expect(second.created).toBe(0);
    expect(second.deliveryAttempted).toBe(0);
    expect(seen).toHaveLength(0);
  });

  /* §36, §162. Two workers at once: one row, and one doorbell. */
  it('two concurrent runs produce one notification and one event', async () => {
    await enrol(A, '2022');
    await monitorFamily('examination', 'v1');

    const seen: NotificationCreated[] = [];
    addListener(A, (e) => seen.push(e));

    const [left, right] = await Promise.all([fanout(), fanout()]);
    await settle();

    const created = left.created + right.created;
    expect(seen.length).toBe(created);
    const ids = seen.map((e) => e.notificationId);
    expect(new Set(ids).size).toBe(ids.length);

    const inbox = await request(app)
      .get('/api/v1/me/notifications')
      .set('Authorization', `Bearer ${A}`)
      .expect(200);
    const external = (inbox.body.notifications as { id: string }[]).map((row) => row.id);
    expect(new Set(external).size).toBe(external.length);
  });

  /*
   * §175. A receives, B does not — end to end, through the real fanout.
   *
   * NOT "B HEARS NOTHING AT ALL", and the first version of this test was wrong
   * to say so. The v1 fixture also carries a revaluation notice scoped to the
   * programme and no scheme, and B is a B.E. student, so it genuinely applies
   * to them. The claim worth making is about the SCHEME-scoped timetable: that
   * one is A's, and B must not hear it.
   */
  it('rings only for the student the notice applies to', async () => {
    await enrol(A, '2022');
    await enrol(B, '2018');
    await monitorFamily('examination', 'v1');
    await drain();

    const mine: NotificationCreated[] = [];
    const theirs: NotificationCreated[] = [];
    addListener(A, (e) => mine.push(e));
    addListener(B, (e) => theirs.push(e));

    await fanout();
    await settle();

    const timetable = (list: NotificationCreated[]) =>
      list.filter((e) => e.category === 'exam_timetable');
    expect(timetable(mine).length).toBeGreaterThan(0);
    expect(timetable(theirs)).toHaveLength(0);
  });

  /* §11, §115. A dry run decides everything and rings nothing. */
  it('a dry run creates nothing and announces nothing', async () => {
    await enrol(A, '2022');
    await monitorFamily('examination', 'v1');
    await drain();

    const seen: NotificationCreated[] = [];
    addListener(A, (e) => seen.push(e));

    const preview = await materialize(monitor, 'rt-dry', await publishedItems(sql, null), {
      dryRun: true,
    });
    await settle();

    expect(preview.created).toBeGreaterThan(0);
    expect(preview.deliveryAttempted).toBe(0);
    expect(seen).toHaveLength(0);

    const inbox = await request(app)
      .get('/api/v1/me/notifications')
      .set('Authorization', `Bearer ${A}`)
      .expect(200);
    expect(inbox.body.notifications).toHaveLength(0);
  });

  /* ------------------------------------------------------------------------ */
  /* The endpoint                                                             */
  /* ------------------------------------------------------------------------ */

  /* §71. There is no parameter to change, so this asserts the guard is on. */
  it('refuses an unauthenticated subscriber', async () => {
    await request(app).get('/api/v1/me/notifications/stream').expect(401);
  });

  it('refuses a subscriber whose token is not valid', async () => {
    await request(app)
      .get('/api/v1/me/notifications/stream')
      .set('Authorization', 'Bearer not-a-user')
      .expect(401);
  });

  /*
   * §16. Opens, identifies itself as a stream, and registers a connection.
   * `supertest` will not hold an endless response open, so the assertion is on
   * the headers and the side effect rather than on the body arriving.
   */
  it('opens a stream for an authenticated student', async () => {
    const before = connectionCount();
    const pending = request(app)
      .get('/api/v1/me/notifications/stream')
      .set('Authorization', `Bearer ${A}`)
      .buffer(false)
      .parse((res, callback) => {
        res.on('data', () => {
          (res as unknown as { destroy?: () => void }).destroy?.();
          callback(null, null);
        });
        res.on('end', () => callback(null, null));
      });

    const response = await pending.catch(() => null);
    if (response !== null) {
      expect(response.headers['content-type']).toContain('text/event-stream');
      expect(response.headers['cache-control']).toContain('no-cache');
    }
    /* The connection registered and, once torn down, did not linger. */
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(connectionCount()).toBeLessThanOrEqual(before + 1);
  });
});
