/**
 * The notification inbox over HTTP: reading, marking read, and not reaching
 * anybody else's.
 *
 * Authority: Phase 7B.3.1 §25–§28, §47–§49, §80–§84, §105, §118
 *
 * WHY THIS IS SEPARATE FROM monitor-fanout. That file proves the WORKER cannot
 * reach a student's data. This proves the STUDENT cannot reach another
 * student's, over the actual route, with an actual bearer token — which is a
 * different boundary and a different failure if it breaks.
 *
 * SYNTHETIC CONTENT ONLY.
 */

import postgres from 'postgres';
import request from 'supertest';
import type { Express } from 'express';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Sql } from '../src/db/client.js';
import { loadConfig } from '../src/config.js';
import { runMigrations } from '../src/db/migrate.js';
import { createApp } from '../src/http/app.js';
import { createLogger } from '../src/observability/logger.js';
import type { Session } from '../src/auth/session.js';
import { STUDENT_ROUTES } from '@gradtools/shared-types';

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const CLOUD_URL = process.env.TEST_CLOUD_DATABASE_URL;
const CLOUD_ADMIN_URL = process.env.TEST_CLOUD_ADMIN_DATABASE_URL;
const describeDb =
  DATABASE_URL === undefined || CLOUD_URL === undefined || CLOUD_ADMIN_URL === undefined
    ? describe.skip
    : describe;

const A = 'aaaaaaaa-3333-4000-8000-00000000000a';
const B = 'bbbbbbbb-3333-4000-8000-00000000000b';

/** Verifies nothing: these tests are about what happens after a token is accepted. */
function fakeVerifier(): (token: string) => Promise<Session> {
  return async (token: string) => {
    if (token !== A && token !== B) throw new Error('not a known synthetic user');
    return { userId: token, token, claims: { sub: token } };
  };
}

describeDb('the notification inbox', () => {
  let cloud: Sql;
  let admin: Sql;
  let sql: Sql;
  let app: Express;

  beforeAll(async () => {
    admin = postgres(CLOUD_ADMIN_URL as string, { max: 2 }) as unknown as Sql;
    cloud = postgres(CLOUD_URL as string, { max: 5, prepare: false }) as unknown as Sql;
    sql = postgres(DATABASE_URL as string, { max: 2 }) as unknown as Sql;
    await runMigrations(sql);
    app = createApp(
      loadConfig({ DATABASE_URL, NODE_ENV: 'test', APP_ENV: 'test' }),
      sql,
      createLogger('silent', false),
      { sql: cloud, verify: fakeVerifier() },
    );
  }, 60_000);

  afterAll(async () => {
    await Promise.all([cloud.end(), admin.end(), sql.end()]);
  });

  /**
   * Two students, each with one notification, written the way the worker writes
   * them — by a privileged connection with no session, because that is what the
   * background run is.
   */
  beforeEach(async () => {
    await admin`DELETE FROM auth.users WHERE id IN (${A}::uuid, ${B}::uuid)`;
    await admin`
      INSERT INTO auth.users (id, email) VALUES
        (${A}::uuid, 'synthetic-inbox-a@example.test'),
        (${B}::uuid, 'synthetic-inbox-b@example.test')
    `;
    for (const [userId, external] of [
      [A, 'exam-inbox-a'],
      [B, 'exam-inbox-b'],
    ] as const) {
      await admin`
        INSERT INTO student_profiles (auth_user_id, scheme_id, programme, current_semester)
        VALUES (${userId}::uuid, '2022', 'B.E.', 5)
      `;
      await admin`
        INSERT INTO source_notifications (
          auth_user_id, source_family, external_id, content_hash, category,
          importance, title, source_url, published_at, reason, run_id
        ) VALUES (
          ${userId}::uuid, 'examination', ${external}, ${'a'.repeat(64)},
          'exam_timetable', 'high',
          'Revised Time Table for the V Semester Examination',
          'https://vtu.ac.in/en/examination/synthetic/', '2026-09-09',
          'Applies to your scheme · programme · semester.', 'inbox-test'
        )
      `;
    }
    /* A second, less urgent one for A, to check the ordering. */
    await admin`
      INSERT INTO source_notifications (
        auth_user_id, source_family, external_id, content_hash, category,
        importance, title, source_url, reason, run_id
      ) VALUES (
        ${A}::uuid, 'academic_calendar', 'cal-inbox-a', ${'b'.repeat(64)},
        'academic_calendar', 'medium', 'Academic Calendar for the odd semester',
        'https://vtu.ac.in/academic-calendar/synthetic/',
        'This notice is for all students.', 'inbox-test'
      )
    `;
  });

  const as = (userId: string) => `Bearer ${userId}`;

  /* ------------------------------------------------------------------------ */

  it('gives a student the notifications a background run left for them', async () => {
    const response = await request(app)
      .get(STUDENT_ROUTES.meNotifications)
      .set('Authorization', as(A))
      .expect(200);

    const ids = (response.body.notifications as { externalId?: string; title: string }[]).map(
      (row) => row.title,
    );
    expect(ids).toContain('Revised Time Table for the V Semester Examination');
    expect(response.body.unread).toBe(2);
  });

  /*
   * §51. A student opening the app after a week wants the postponed
   * examination above the syllabus revision; strict chronology buries it.
   */
  it('puts the urgent one first', async () => {
    const response = await request(app)
      .get(STUDENT_ROUTES.meNotifications)
      .set('Authorization', as(A))
      .expect(200);
    const rows = response.body.notifications as { importance: string }[];
    expect(rows[0]?.importance).toBe('high');
  });

  /* §26, §52, §84. The official document, and a reason they can read. */
  it('carries the official source link and the applicability reason', async () => {
    const response = await request(app)
      .get(STUDENT_ROUTES.meNotifications)
      .set('Authorization', as(A))
      .expect(200);
    const row = (response.body.notifications as { sourceUrl: string; reason: string }[])[0];
    expect(row?.sourceUrl).toMatch(/^https:\/\/vtu\.ac\.in\//);
    expect(row?.reason).toContain('Applies to your');
  });

  /*
   * §28, §80. The response carries what a student needs and not the bookkeeping
   * that says which run told whom about which version.
   */
  it('does not hand the student the plumbing', async () => {
    const response = await request(app)
      .get(STUDENT_ROUTES.meNotifications)
      .set('Authorization', as(A))
      .expect(200);
    const row = (response.body.notifications as Record<string, unknown>[])[0] ?? {};
    for (const leak of ['run_id', 'runId', 'content_hash', 'contentHash', 'auth_user_id']) {
      expect(Object.keys(row)).not.toContain(leak);
    }
  });

  /* §47. B sees their own, and only their own. */
  it('shows each student only their own', async () => {
    const mine = await request(app)
      .get(STUDENT_ROUTES.meNotifications)
      .set('Authorization', as(A))
      .expect(200);
    const theirs = await request(app)
      .get(STUDENT_ROUTES.meNotifications)
      .set('Authorization', as(B))
      .expect(200);

    expect((mine.body.notifications as unknown[]).length).toBe(2);
    expect((theirs.body.notifications as unknown[]).length).toBe(1);
    const mineIds = new Set((mine.body.notifications as { id: string }[]).map((row) => row.id));
    for (const row of theirs.body.notifications as { id: string }[]) {
      expect(mineIds.has(row.id)).toBe(false);
    }
  });

  it('lets a student mark their own read', async () => {
    const list = await request(app)
      .get(STUDENT_ROUTES.meNotifications)
      .set('Authorization', as(A))
      .expect(200);
    const target = (list.body.notifications as { id: string }[])[0];

    await request(app)
      .patch(`/api/v1/me/notifications/${target?.id ?? ''}`)
      .set('Authorization', as(A))
      .send({ state: 'read' })
      .expect(200);

    const after = await request(app)
      .get(STUDENT_ROUTES.meNotifications)
      .set('Authorization', as(A))
      .expect(200);
    expect(after.body.unread).toBe(1);
  });

  /*
   * §48, §105. THE IDOR TEST. B holds A's notification id — the one thing an
   * attacker most plausibly has — and gets the same answer as for an id that
   * was never issued.
   */
  it('refuses one student the id of another’s notification', async () => {
    const list = await request(app)
      .get(STUDENT_ROUTES.meNotifications)
      .set('Authorization', as(A))
      .expect(200);
    const target = (list.body.notifications as { id: string }[])[0];

    const stolen = await request(app)
      .patch(`/api/v1/me/notifications/${target?.id ?? ''}`)
      .set('Authorization', as(B))
      .send({ state: 'dismissed' })
      .expect(404);
    expect(stolen.body.error?.code).toBe('NOT_FOUND');

    /* And A's notification is untouched. */
    const after = await request(app)
      .get(STUDENT_ROUTES.meNotifications)
      .set('Authorization', as(A))
      .expect(200);
    expect(
      (after.body.notifications as { id: string }[]).some((row) => row.id === target?.id),
    ).toBe(true);
  });

  it('gives the same answer for an id that never existed', async () => {
    await request(app)
      .patch('/api/v1/me/notifications/11111111-1111-4111-8111-111111111111')
      .set('Authorization', as(B))
      .send({ state: 'read' })
      .expect(404);
  });

  /* §83. */
  it('marks everything read at once, for that student alone', async () => {
    const response = await request(app)
      .post(STUDENT_ROUTES.meNotificationsRead)
      .set('Authorization', as(A))
      .expect(200);
    expect(response.body.marked).toBe(2);

    const mine = await request(app)
      .get(STUDENT_ROUTES.meNotifications)
      .set('Authorization', as(A))
      .expect(200);
    expect(mine.body.unread).toBe(0);

    const theirs = await request(app)
      .get(STUDENT_ROUTES.meNotifications)
      .set('Authorization', as(B))
      .expect(200);
    expect(theirs.body.unread).toBe(1);
  });

  it('refuses a state that is not one of the three', async () => {
    const list = await request(app)
      .get(STUDENT_ROUTES.meNotifications)
      .set('Authorization', as(A))
      .expect(200);
    const target = (list.body.notifications as { id: string }[])[0];

    await request(app)
      .patch(`/api/v1/me/notifications/${target?.id ?? ''}`)
      .set('Authorization', as(A))
      .send({ state: 'archived' })
      .expect(400);
  });

  it('refuses an unauthenticated request', async () => {
    await request(app).get(STUDENT_ROUTES.meNotifications).expect(401);
  });
});
