/**
 * Support and observability (OBSERVABILITY-AND-SUPPORT-V1).
 *
 * Real reference Postgres, a fake verifier for the session. Proves: Support ID
 * stability and shape, Incident ID uniqueness, self-only reports, operator
 * reads behind the token, automatic 5xx incidents with an echoed Incident ID,
 * security signals, app-version capture, and — most load-bearing — that NO
 * academic content, token or internal subject ever reaches a stored row or an
 * operator response.
 */

import express from 'express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import postgres from 'postgres';
import { loadConfig } from '../src/config.js';
import { runMigrations } from '../src/db/migrate.js';
import { createLogger } from '../src/observability/logger.js';
import { createApp } from '../src/http/app.js';
import { createErrorHandler, type IncidentRecorder } from '../src/http/errors.js';
import { newIncidentId, supportIdFor } from '../src/support/id.js';
import { createIncident, recordEventSafe } from '../src/support/store.js';
import type { Sql } from '../src/db/client.js';
import type { Session } from '../src/auth/session.js';

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeDb = DATABASE_URL === undefined ? describe.skip : describe;

const A = 'user_2synthSupportA';
const B = 'user_2synthSupportB';
const OPERATOR_TOKEN = 'test-operator-token-0123456789abcdef0123456789';
const OPERATOR = { Authorization: `Bearer ${OPERATOR_TOKEN}` };

function fakeVerifier(): (token: string) => Promise<Session> {
  return async (token: string) => {
    if (token !== A && token !== B) throw new Error('not a known synthetic user');
    return { userId: token, token, claims: { sub: token } };
  };
}

describeDb('support and observability', () => {
  let sql: Sql;
  let app: express.Express;

  beforeAll(async () => {
    sql = postgres(DATABASE_URL as string, { max: 4 }) as unknown as Sql;
    await runMigrations(sql);
    app = createApp(
      loadConfig({
        DATABASE_URL: DATABASE_URL as string,
        NODE_ENV: 'test',
        APP_ENV: 'test',
        OPERATOR_TOKEN,
      }),
      sql,
      createLogger('silent', false),
      { sql, verify: fakeVerifier() },
    );
  }, 60_000);

  afterAll(async () => {
    await sql`DELETE FROM support_events WHERE support_id IN (${supportIdFor(A)}, ${supportIdFor(B)}, 'GT-00000000')`;
    await sql`DELETE FROM support_reports WHERE support_id IN (${supportIdFor(A)}, ${supportIdFor(B)})`;
    await sql.end();
  });

  beforeEach(async () => {
    await sql`DELETE FROM support_events WHERE support_id IN (${supportIdFor(A)}, ${supportIdFor(B)}, 'GT-00000000')`;
    await sql`DELETE FROM support_reports WHERE support_id IN (${supportIdFor(A)}, ${supportIdFor(B)})`;
  });

  describe('identifiers', () => {
    it('a Support ID is stable, provider-neutral in shape, and hides the subject', () => {
      expect(supportIdFor(A)).toMatch(/^GT-[0-9A-HJKMNP-TV-Z]{8}$/);
      expect(supportIdFor(A)).toBe(supportIdFor(A));
      expect(supportIdFor(A)).not.toBe(supportIdFor(B));
      expect(supportIdFor(A)).not.toContain(A);
      // A uuid subject hashes exactly the same way as a Clerk one.
      expect(supportIdFor('aaaaaaaa-0000-4000-8000-000000000001')).toMatch(
        /^GT-[0-9A-HJKMNP-TV-Z]{8}$/,
      );
    });

    it('Incident IDs are unique and non-sequential in shape', () => {
      const ids = new Set(Array.from({ length: 500 }, () => newIncidentId()));
      expect(ids.size).toBe(500);
      for (const id of ids) expect(id).toMatch(/^GT-ERR-[0-9A-HJKMNP-TV-Z]{6}$/);
    });
  });

  describe('a student reporting a problem', () => {
    it('creates a report owned by the session', async () => {
      const res = await request(app)
        .post('/api/v1/me/support-reports')
        .set('Authorization', `Bearer ${A}`)
        .send({ category: 'sync', description: 'sync keeps failing' });
      expect(res.status).toBe(201);
      expect(res.body.incidentId).toMatch(/^GT-ERR-/);
      expect(res.body.supportId).toBe(supportIdFor(A));
      expect(res.body.status).toBe('open');

      const owners = await sql<{ auth_user_id: string }[]>`
        SELECT auth_user_id FROM support_reports WHERE incident_id = ${res.body.incidentId}`;
      expect(owners[0]?.auth_user_id).toBe(A);
    });

    it('refuses a body that tries to name a different owner', async () => {
      // The owner is never read from the body; the strict schema rejects any
      // attempt to supply one, so impersonation cannot even be expressed.
      const res = await request(app)
        .post('/api/v1/me/support-reports')
        .set('Authorization', `Bearer ${A}`)
        .send({ category: 'sync', userId: B, supportId: supportIdFor(B), ownerId: B });
      expect(res.status).toBe(400);
      const rows = await sql`SELECT 1 FROM support_reports WHERE support_id = ${supportIdFor(B)}`;
      expect(rows).toHaveLength(0);
    });

    it('refuses an unauthenticated report', async () => {
      const res = await request(app).post('/api/v1/me/support-reports').send({ category: 'other' });
      expect(res.status).toBe(401);
    });

    it('lists only the caller’s own reports', async () => {
      await request(app)
        .post('/api/v1/me/support-reports')
        .set('Authorization', `Bearer ${A}`)
        .send({ category: 'results' });
      await request(app)
        .post('/api/v1/me/support-reports')
        .set('Authorization', `Bearer ${B}`)
        .send({ category: 'import' });

      const mine = await request(app)
        .get('/api/v1/me/support-reports')
        .set('Authorization', `Bearer ${A}`);
      expect(mine.body.supportId).toBe(supportIdFor(A));
      expect(mine.body.reports).toHaveLength(1);
      expect(mine.body.reports[0].category).toBe('results');
      expect(JSON.stringify(mine.body)).not.toContain(A); // the raw subject never leaves the server
    });

    it('rejects unknown context fields rather than storing them', async () => {
      const res = await request(app)
        .post('/api/v1/me/support-reports')
        .set('Authorization', `Bearer ${A}`)
        .send({
          category: 'other',
          context: { marks: '10/10', token: 'secret', usn: '1XX', platform: 'web' },
        });
      expect(res.status).toBe(400); // .strict() context schema refuses the smuggled fields
    });
  });

  describe('an anonymous (pre-login) report', () => {
    const ANON = 'GT-00000000';

    it('is accepted with no session and returns an Incident ID but no Support ID', async () => {
      const res = await request(app)
        .post('/api/v1/support-reports')
        .send({ category: 'sign_in', description: 'cannot sign in', context: { platform: 'web' } });
      expect(res.status).toBe(201);
      expect(res.body.incidentId).toMatch(/^GT-ERR-[0-9A-HJKMNP-TV-Z]{6}$/);
      expect(res.body.supportId).toBeUndefined();
      expect(Object.keys(res.body)).toEqual(['incidentId']);
      // A rate-limit header proves it sits under the shared /api/v1 limiter.
      expect(res.headers['ratelimit-limit'] ?? res.headers['ratelimit']).toBeDefined();
    });

    it('records no auth_user_id and creates no support_reports row', async () => {
      const res = await request(app)
        .post('/api/v1/support-reports')
        .send({ category: 'app_android', description: 'app crashes on open' });
      const [event] = await sql<
        { auth_user_id: string | null; support_id: string; event_type: string }[]
      >`
        SELECT auth_user_id, support_id, event_type FROM support_events WHERE incident_id = ${res.body.incidentId}`;
      expect(event?.auth_user_id).toBeNull();
      expect(event?.support_id).toBe(ANON);
      expect(event?.event_type).toBe('USER_REPORT');
      const reports =
        await sql`SELECT 1 FROM support_reports WHERE incident_id = ${res.body.incidentId}`;
      expect(reports).toHaveLength(0);
    });

    it('rejects unknown/sensitive fields and malformed input', async () => {
      const bad = [
        { category: 'sync', usn: '1XX', token: 'secret' }, // unknown top-level fields
        { category: 'sync', context: { usn: '1XX', platform: 'web' } }, // smuggled context field
        { category: 'not_a_category' }, // invalid enum
        { description: 'no category' }, // missing required category
        {}, // empty
      ];
      for (const body of bad) {
        const res = await request(app).post('/api/v1/support-reports').send(body);
        expect(res.status).toBe(400);
      }
    });

    it('rejects an oversized description and accepts an empty one', async () => {
      const tooLong = await request(app)
        .post('/api/v1/support-reports')
        .send({ category: 'other', description: 'x'.repeat(1001) });
      expect(tooLong.status).toBe(400);
      const empty = await request(app).post('/api/v1/support-reports').send({ category: 'other' });
      expect(empty.status).toBe(201);
    });

    it('does not create a support_reports row for any anonymous handle', async () => {
      await request(app).post('/api/v1/support-reports').send({ category: 'results' });
      const anon = await sql`SELECT 1 FROM support_reports WHERE support_id = ${ANON}`;
      expect(anon).toHaveLength(0);
    });
  });

  describe('existing authorization is unchanged', () => {
    it('the authenticated report route still needs a session', async () => {
      expect(
        (await request(app).post('/api/v1/me/support-reports').send({ category: 'other' })).status,
      ).toBe(401);
    });
    it('the operator routes still need the operator token', async () => {
      expect((await request(app).get('/api/v1/operator/support/overview')).status).toBe(401);
    });
  });

  describe('what a report stores — the privacy guarantee', () => {
    it('keeps only allowlisted context keys, never academic content or secrets', async () => {
      const res = await request(app)
        .post('/api/v1/me/support-reports')
        .set('Authorization', `Bearer ${A}`)
        .send({
          category: 'ai_document',
          description: 'reading failed',
          context: {
            platform: 'android',
            appVersion: '1.4.0',
            route: '/import',
            errorCode: 'DOCUMENT_AI_UNAVAILABLE',
            httpStatus: 503,
            online: true,
          },
        });
      expect(res.status).toBe(201);
      const [row] = await sql<{ context_safe: Record<string, unknown> }[]>`
        SELECT context_safe FROM support_reports WHERE incident_id = ${res.body.incidentId}`;
      const keys = Object.keys(row?.context_safe ?? {}).sort();
      expect(keys).toEqual(
        ['appVersion', 'errorCode', 'httpStatus', 'online', 'platform', 'route'].sort(),
      );
      const blob = JSON.stringify(row?.context_safe);
      for (const forbidden of ['token', 'usn', 'marks', 'email', 'password', 'cookie']) {
        expect(blob).not.toContain(forbidden);
      }
    });
  });

  describe('the operator view', () => {
    it('requires the operator token', async () => {
      expect((await request(app).get('/api/v1/operator/support/overview')).status).toBe(401);
      expect(
        (await request(app).get('/api/v1/operator/support/overview').set(OPERATOR)).status,
      ).toBe(200);
    });

    it('finds a user by Support ID and never returns the internal subject', async () => {
      await request(app)
        .post('/api/v1/me/support-reports')
        .set('Authorization', `Bearer ${A}`)
        .send({ category: 'attendance' });
      const res = await request(app)
        .get(`/api/v1/operator/support/users/${supportIdFor(A)}`)
        .set(OPERATOR);
      expect(res.status).toBe(200);
      expect(res.body.supportId).toBe(supportIdFor(A));
      expect(res.body.reports[0].category).toBe('attendance');
      expect(
        res.body.events.some((e: { eventType: string }) => e.eventType === 'USER_REPORT'),
      ).toBe(true);
      expect(JSON.stringify(res.body)).not.toContain(A); // no raw subject anywhere
    });

    it('404s an unknown Support ID', async () => {
      const res = await request(app)
        .get('/api/v1/operator/support/users/GT-ZZZZZZZZ')
        .set(OPERATOR);
      expect(res.status).toBe(404);
    });

    it('opens one incident’s safe detail', async () => {
      const created = await request(app)
        .post('/api/v1/me/support-reports')
        .set('Authorization', `Bearer ${A}`)
        .send({ category: 'sync' });
      const res = await request(app)
        .get(`/api/v1/operator/support/incidents/${created.body.incidentId}`)
        .set(OPERATOR);
      expect(res.status).toBe(200);
      expect(res.body.event.incidentId).toBe(created.body.incidentId);
      expect(res.body.report.category).toBe('sync');
    });

    it('surfaces security events', async () => {
      await recordEventSafe(sql, {
        eventType: 'RATE_LIMIT_TRIGGERED',
        subject: A,
        httpStatus: 429,
      });
      const res = await request(app).get('/api/v1/operator/support/security').set(OPERATOR);
      expect(res.status).toBe(200);
      expect(
        res.body.events.some((e: { eventType: string }) => e.eventType === 'RATE_LIMIT_TRIGGERED'),
      ).toBe(true);
    });
  });

  describe('automatic incidents from the error handler', () => {
    function appThatThrows() {
      const recorder: IncidentRecorder = {
        recordFault(ctx) {
          const incidentId = newIncidentId();
          void recordEventSafe(sql, {
            eventType: 'API_5XX',
            severity: 'error',
            incidentId,
            subject: ctx.subject,
            requestId: ctx.requestId,
            route: ctx.route,
            httpStatus: ctx.httpStatus,
            errorCode: 'INTERNAL_ERROR',
            platform: ctx.platform,
            appVersion: ctx.appVersion,
          });
          return incidentId;
        },
      };
      const tiny = express();
      tiny.get('/boom', () => {
        throw new Error('synthetic failure');
      });
      tiny.use(createErrorHandler(recorder));
      return tiny;
    }

    it('creates an incident on a 5xx, echoes its Incident ID, and captures the app version', async () => {
      const res = await request(appThatThrows())
        .get('/boom')
        .set('X-GradTools-Platform', 'android')
        .set('X-GradTools-App-Version', '1.4.0');
      expect(res.status).toBe(500);
      expect(res.body.error.incidentId).toMatch(/^GT-ERR-/);
      expect(res.body.error.message).not.toMatch(/synthetic failure|stack|at /i); // no internal detail

      // The async record lands shortly after the response.
      const incidentId = res.body.error.incidentId;
      type Row = {
        event_type: string;
        severity: string;
        app_version: string | null;
        route: string;
      };
      let row: Row | undefined;
      for (let i = 0; i < 20 && row === undefined; i++) {
        [row] = await sql<Row[]>`
          SELECT event_type, severity, app_version, route FROM support_events WHERE incident_id = ${incidentId}`;
        if (row === undefined) await new Promise((r) => setTimeout(r, 25));
      }
      expect(row?.event_type).toBe('API_5XX');
      expect(row?.severity).toBe('error');
      expect(row?.app_version).toBe('1.4.0');
      expect(row?.route).toBe('/boom');
      await sql`DELETE FROM support_events WHERE incident_id = ${incidentId}`;
    });
  });

  describe('createIncident helper', () => {
    it('returns an Incident ID even when the write is attempted best-effort', async () => {
      const id = await createIncident(sql, {
        eventType: 'SYNC_FAILED',
        subject: A,
        errorCode: 'SYNC_UNAVAILABLE',
      });
      expect(id).toMatch(/^GT-ERR-/);
      const [row] = await sql<
        { error_code: string }[]
      >`SELECT error_code FROM support_events WHERE incident_id = ${id}`;
      expect(row?.error_code).toBe('SYNC_UNAVAILABLE');
    });
  });
});
