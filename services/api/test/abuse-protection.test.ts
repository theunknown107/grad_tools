/**
 * Anonymous abuse: what an unauthenticated client can make the API write.
 *
 * Real reference Postgres and the real `createApp`, because the defects were in
 * middleware ORDER: the limiter ran after the body parser, a parse failure became
 * a 500, and both a 500 and every 429 wrote a row. Rows are counted in the
 * database rather than inferred from status codes.
 */

import express from 'express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import postgres from 'postgres';
import { loadConfig } from '../src/config.js';
import { runMigrations } from '../src/db/migrate.js';
import { createLogger } from '../src/observability/logger.js';
import { createApp } from '../src/http/app.js';
import {
  ANONYMOUS_REPORT_CEILING,
  ANONYMOUS_REPORT_RATE_LIMIT,
  API_RATE_LIMIT,
  clientKey,
  createAnonymousReportLimiter,
  createWriteBudget,
} from '../src/http/rate-limit.js';
import { errorHandler } from '../src/http/errors.js';
import type { Sql } from '../src/db/client.js';
import type { Session } from '../src/auth/session.js';
import { forgetSupportSubject, purgeExpiredSupport, recordEvent } from '../src/support/store.js';
import { overview } from '../src/support/operator.js';

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeDb = DATABASE_URL === undefined ? describe.skip : describe;

const REPORTS = '/api/v1/support-reports';
const USER = 'user_2synthAbuseA';

describe('the limiter key', () => {
  it('keys an IPv6 client by its /64, however it writes the address', () => {
    expect(clientKey('2001:db8:1:2:aaaa::1')).toBe(clientKey('2001:db8:1:2:bbbb::2'));
    expect(clientKey('2001:db8:1:2::1')).toBe(clientKey('2001:DB8:1:2:ffff:ffff:ffff:ffff'));
    expect(clientKey('2001:db8:1:3::1')).not.toBe(clientKey('2001:db8:1:2::1'));
  });

  it('treats an IPv4-mapped address as the IPv4 client it is', () => {
    expect(clientKey('::ffff:203.0.113.9')).toBe('203.0.113.9');
    expect(clientKey('203.0.113.9')).toBe('203.0.113.9');
  });
});

describe('the telemetry budget', () => {
  it('refuses past the limit and refills on the next window', () => {
    let time = 0;
    const allowed = createWriteBudget(2, 1000, () => time);
    expect([allowed(), allowed(), allowed()]).toEqual([true, true, false]);
    time = 1000;
    expect(allowed()).toBe(true);
  });
});

describe('the anonymous report window', () => {
  it('lets a client back in once the window has passed', async () => {
    const app = express();
    app.set('trust proxy', 1);
    app.post('/r', createAnonymousReportLimiter({ limit: 1, windowMs: 60 }), (_req, res) => {
      res.json({ ok: true });
    });
    app.use(errorHandler);
    expect((await request(app).post('/r')).status).toBe(200);
    expect((await request(app).post('/r')).status).toBe(429);
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect((await request(app).post('/r')).status).toBe(200);
  });
});

describeDb('what an anonymous client can write', () => {
  let sql: Sql;

  const fresh = (): express.Express =>
    createApp(
      loadConfig({ DATABASE_URL: DATABASE_URL as string, NODE_ENV: 'test', APP_ENV: 'test' }),
      sql,
      createLogger('silent', false),
      {
        sql,
        verify: async (token: string): Promise<Session> => {
          if (token !== USER) throw new Error('not a known synthetic user');
          return { userId: token, token, claims: { sub: token } };
        },
      },
    );

  const rows = async (): Promise<number> => {
    const [row] = await sql<{ count: string }[]>`SELECT count(*) FROM support_events`;
    return Number(row?.count);
  };
  /* Telemetry is fire-and-forget: give any write that was going to happen time to land. */
  const settled = () => new Promise((resolve) => setTimeout(resolve, 120));

  beforeAll(async () => {
    sql = postgres(DATABASE_URL as string, { max: 4 }) as unknown as Sql;
    await runMigrations(sql);
  }, 60_000);

  beforeEach(async () => {
    await sql`DELETE FROM support_events`;
    await sql`DELETE FROM support_reports`;
  });

  afterAll(async () => {
    await sql.end();
  });

  it('answers malformed JSON with a 400 and writes nothing, on any path', async () => {
    const app = fresh();
    for (const path of ['/anything', '/api/v1/universities', REPORTS]) {
      const res = await request(app)
        .post(path)
        .set('Content-Type', 'application/json')
        .send('{');
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_FAILED');
    }
    await settled();
    expect(await rows()).toBe(0);
  });

  it('counts malformed bodies against the limiter', async () => {
    const app = fresh();
    let last = 0;
    for (let i = 0; i <= API_RATE_LIMIT; i += 1) {
      last = (
        await request(app)
          .post('/api/v1/universities')
          .set('Content-Type', 'application/json')
          .send('{')
      ).status;
    }
    expect(last).toBe(429);
  });

  it('records a tripped limit once, however many requests are rejected', async () => {
    const app = fresh();
    for (let i = 0; i < API_RATE_LIMIT + 25; i += 1) {
      await request(app).get('/api/v1/nowhere');
    }
    await settled();
    expect(await rows()).toBe(1);
  });

  it('accepts a real report and hands back an Incident ID', async () => {
    const res = await request(fresh()).post(REPORTS).send({ category: 'sign_in' });
    expect(res.status).toBe(201);
    expect(res.body.incidentId).toMatch(/^GT-ERR-/);
  });

  it('stops altered payloads at the anonymous limit', async () => {
    const app = fresh();
    const statuses: number[] = [];
    for (let i = 0; i < ANONYMOUS_REPORT_RATE_LIMIT + 3; i += 1) {
      const res = await request(app)
        .post(REPORTS)
        .send({ category: 'sign_in', description: `different words ${String(i)}` });
      statuses.push(res.status);
    }
    expect(statuses.filter((status) => status === 201)).toHaveLength(ANONYMOUS_REPORT_RATE_LIMIT);
    expect(statuses.at(-1)).toBe(429);
    await settled();
    /* The reports, plus the single signal that the limit tripped. */
    expect(await rows()).toBe(ANONYMOUS_REPORT_RATE_LIMIT + 1);
  });

  it('ignores a forged X-Forwarded-For: the proxy-appended entry decides', async () => {
    const app = fresh();
    let last = 0;
    for (let i = 0; i < ANONYMOUS_REPORT_RATE_LIMIT + 1; i += 1) {
      last = (
        await request(app)
          .post(REPORTS)
          .set('X-Forwarded-For', `10.0.0.${String(i)}, 203.0.113.77`)
          .send({ category: 'sign_in' })
      ).status;
    }
    expect(last).toBe(429);
  });

  it('keeps real clients apart', async () => {
    const app = fresh();
    for (let i = 0; i < ANONYMOUS_REPORT_RATE_LIMIT + 1; i += 1) {
      await request(app)
        .post(REPORTS)
        .set('X-Forwarded-For', '203.0.113.80')
        .send({ category: 'sign_in' });
    }
    const other = await request(app)
      .post(REPORTS)
      .set('X-Forwarded-For', '203.0.113.81')
      .send({ category: 'sign_in' });
    expect(other.status).toBe(201);
  });

  it('does not hold a signed-in student to the anonymous limit', async () => {
    const app = fresh();
    for (let i = 0; i < ANONYMOUS_REPORT_RATE_LIMIT + 2; i += 1) {
      const res = await request(app)
        .post('/api/v1/me/support-reports')
        .set('Authorization', `Bearer ${USER}`)
        .send({ category: 'sign_in', description: `report ${String(i)}` });
      expect(res.status).toBe(201);
    }
  });

  it('refuses an oversized anonymous report before it is parsed', async () => {
    const res = await request(fresh())
      .post(REPORTS)
      .send({ category: 'sign_in', description: 'x'.repeat(20_000) });
    expect(res.status).toBe(413);
    await settled();
    expect(await rows()).toBe(0);
  });

  it('tells repeated, altered and empty reports apart', async () => {
    const app = fresh();
    const same = { category: 'sign_in', description: 'Words' };
    const first = await request(app).post(REPORTS).send(same);
    const altered = await request(app)
      .post(REPORTS)
      .send({ category: 'sign_in', description: 'Words!' });
    const otherCategory = await request(app)
      .post(REPORTS)
      .send({ category: 'sync', description: 'Words' });
    const repeat = await request(app).post(REPORTS).send(same);
    expect(repeat.body.incidentId).toBe(first.body.incidentId);
    expect(altered.body.incidentId).not.toBe(first.body.incidentId);
    expect(otherCategory.body.incidentId).not.toBe(first.body.incidentId);
    expect(await rows()).toBe(3);
  });

  it('does not merge an anonymous report into a signed-in student\'s', async () => {
    const app = fresh();
    const body = { category: 'sign_in', description: 'The same words' };
    const signedIn = await request(app)
      .post('/api/v1/me/support-reports')
      .set('Authorization', `Bearer ${USER}`)
      .send(body);
    const anonymous = await request(app).post(REPORTS).send(body);
    expect(anonymous.body.incidentId).not.toBe(signedIn.body.incidentId);
    const after = await overview(sql);
    expect(after.counts.userReports).toBe(1);
    expect(after.counts.anonymousReports).toBe(1);
  });

  it('caps the stored route, so a long URL is not a free write of its own size', async () => {
    const app = fresh();
    for (let i = 0; i <= API_RATE_LIMIT; i += 1) {
      await request(app).get(`/api/v1/${'a'.repeat(4000)}`);
    }
    await settled();
    const [row] = await sql<{ longest: number }[]>`
      SELECT max(length(route)) AS longest FROM support_events
    `;
    expect(row?.longest).toBeLessThanOrEqual(120);
  });

  it('treats a fractional page size as a client value, not a server fault', async () => {
    const res = await request(fresh()).get('/api/v1/announcements?limit=1.5&offset=1e30');
    expect(res.status).toBe(200);
  });

  it('collapses the same report sent twice into one incident', async () => {
    const app = fresh();
    const body = { category: 'sign_in', description: 'The same words' };
    const first = await request(app).post(REPORTS).send(body);
    const second = await request(app).post(REPORTS).send(body);
    expect(second.body.incidentId).toBe(first.body.incidentId);
    expect(await rows()).toBe(1);
  });

  it('keeps reports with no words: there is nothing to say they are the same', async () => {
    const app = fresh();
    const first = await request(app).post(REPORTS).send({ category: 'sign_in' });
    const second = await request(app).post(REPORTS).send({ category: 'sign_in' });
    expect(second.body.incidentId).not.toBe(first.body.incidentId);
    expect(await rows()).toBe(2);
  });

  describe('behind a proxy chain', () => {
    const edge = (): express.Express =>
      createApp(
        loadConfig({
          DATABASE_URL: DATABASE_URL as string,
          NODE_ENV: 'test',
          APP_ENV: 'test',
          CLIENT_IP_HEADER: 'cf-connecting-ip',
        }),
        sql,
        createLogger('silent', false),
        { sql, verify: async () => Promise.reject(new Error('no session')) },
      );
    /* As measured on Render: a rotating proxy address is the right-most entry. */
    const via = (req: request.Test, client: string, proxy: number) =>
      req
        .set('CF-Connecting-IP', client)
        .set('X-Forwarded-For', `${client}, 172.70.0.${String(proxy)}`);

    it('keeps one client in one bucket however the proxy address rotates', async () => {
      const app = edge();
      let last = 0;
      for (let i = 0; i <= ANONYMOUS_REPORT_RATE_LIMIT; i += 1) {
        const res = await via(request(app).post(REPORTS), '203.0.113.90', i).send({
          category: 'sign_in',
        });
        last = res.status;
      }
      expect(last).toBe(429);
    });

    it('keeps two clients behind one proxy address apart', async () => {
      const app = edge();
      for (let i = 0; i <= ANONYMOUS_REPORT_RATE_LIMIT; i += 1) {
        await via(request(app).post(REPORTS), '203.0.113.91', 1).send({ category: 'sign_in' });
      }
      const other = await via(request(app).post(REPORTS), '203.0.113.92', 1).send({
        category: 'sign_in',
      });
      expect(other.status).toBe(201);
    });

    it('falls back to req.ip when the header is not one address', async () => {
      const app = edge();
      let last = 0;
      for (let i = 0; i <= ANONYMOUS_REPORT_RATE_LIMIT; i += 1) {
        const res = await request(app)
          .post(REPORTS)
          .set('CF-Connecting-IP', `203.0.113.${String(i)}, 203.0.113.200`)
          .set('X-Forwarded-For', '203.0.113.93')
          .send({ category: 'sign_in' });
        last = res.status;
      }
      expect(last).toBe(429);
    });

    it('ignores that header entirely unless the deployment names it', async () => {
      const app = fresh();
      let last = 0;
      for (let i = 0; i <= ANONYMOUS_REPORT_RATE_LIMIT; i += 1) {
        const res = await request(app)
          .post(REPORTS)
          .set('CF-Connecting-IP', `198.51.100.${String(i)}`)
          .set('X-Forwarded-For', '203.0.113.94')
          .send({ category: 'sign_in' });
        last = res.status;
      }
      expect(last).toBe(429);
    });

    it('caps everyone together, so unknowable clients still cannot write without limit', async () => {
      const app = fresh();
      let created = 0;
      for (let i = 0; i < ANONYMOUS_REPORT_CEILING + 5; i += 1) {
        const res = await request(app)
          .post(REPORTS)
          .set('X-Forwarded-For', `10.9.${String(Math.floor(i / 200))}.${String(i % 200)}`)
          .send({ category: 'sign_in' });
        if (res.status === 201) created += 1;
      }
      expect(created).toBe(ANONYMOUS_REPORT_CEILING);
    });

    it('holds limits per instance: a second instance starts a fresh count', async () => {
      /* Why a shared store becomes necessary the day numInstances exceeds one. */
      const [first, second] = [fresh(), fresh()];
      const send = (app: express.Express) =>
        request(app)
          .post(REPORTS)
          .set('X-Forwarded-For', '203.0.113.95')
          .send({ category: 'sign_in' });
      for (let i = 0; i < ANONYMOUS_REPORT_RATE_LIMIT; i += 1) await send(first);
      expect((await send(first)).status).toBe(429);
      expect((await send(second)).status).toBe(201);
    });
  });

  it('shows the proxy chain to an operator and to nobody else', async () => {
    const token = 'o'.repeat(40);
    const app = createApp(
      loadConfig({
        DATABASE_URL: DATABASE_URL as string,
        NODE_ENV: 'test',
        APP_ENV: 'test',
        OPERATOR_TOKEN: token,
      }),
      sql,
      createLogger('silent', false),
    );
    const path = '/api/v1/operator/support/client-address';
    expect((await request(app).get(path)).status).toBe(401);
    const seen = await request(app)
      .get(path)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Forwarded-For', '203.0.113.96, 172.70.0.1');
    expect(seen.body).toMatchObject({
      reqIp: '172.70.0.1',
      forwardedFor: '203.0.113.96, 172.70.0.1',
    });
  });

  describe('every write route', () => {
    interface Layer {
      route?: { path: string; methods: Record<string, boolean> };
      handle?: { stack?: Layer[] };
    }
    const writes = (stack: Layer[]): [string, string][] =>
      stack.flatMap((layer) => {
        if (layer.handle?.stack !== undefined) return writes(layer.handle.stack);
        if (layer.route === undefined) return [];
        const { path, methods } = layer.route;
        return Object.keys(methods)
          .filter((method) => ['post', 'put', 'patch', 'delete'].includes(method))
          .map((method): [string, string] => [method, path.replace(/:\w+/g, 'x')]);
      });

    it('needs a session or the operator, except the one anonymous report', async () => {
      const app = fresh() as unknown as { router: { stack: Layer[] } } & express.Express;
      const routes = writes(app.router.stack).filter(([, path]) => path !== REPORTS);
      expect(routes.length).toBeGreaterThan(3);
      for (const [index, [method, path]] of routes.entries()) {
        const client = request(app) as unknown as Record<string, (p: string) => request.Test>;
        const res = await (client[method] as (p: string) => request.Test)(path)
          .set('X-Forwarded-For', `203.0.113.${String(index + 120)}`)
          .send({});
        expect([401, 403, 404, 503], `${method} ${path}`).toContain(res.status);
      }
      await settled();
      expect(await rows()).toBe(0);
    });
  });

  describe('trusted statistics', () => {
    it('an anonymous report cannot move what the server observed', async () => {
      await recordEvent(sql, {
        eventType: 'API_5XX',
        severity: 'error',
        errorCode: 'INTERNAL_ERROR',
        httpStatus: 500,
      });
      const before = await overview(sql);

      const app = fresh();
      for (let i = 0; i < 3; i += 1) {
        await request(app)
          .post(REPORTS)
          .send({
            category: 'sign_in',
            description: `claim ${String(i)}`,
            context: { errorCode: 'RATE_LIMITED', httpStatus: 503 },
          });
      }

      const after = await overview(sql);
      expect(after.topErrorCodes).toEqual(before.topErrorCodes);
      expect(after.windows).toEqual(before.windows);
      expect(after.counts.api5xx).toBe(before.counts.api5xx);
      expect(after.counts.anonymousReports).toBe(3);
      expect(after.counts.userReports).toBe(0);
    });
  });

  describe('deleting an account', () => {
    it('deletes the reports and every event, because a bare event can be matched back', async () => {
      const app = fresh();
      await request(app)
        .post('/api/v1/me/support-reports')
        .set('Authorization', `Bearer ${USER}`)
        .send({ category: 'sign_in', description: 'My own words' });
      await recordEvent(sql, { eventType: 'API_5XX', subject: USER, httpStatus: 500 });

      await forgetSupportSubject(sql, USER);
      await forgetSupportSubject(sql, USER); // idempotent, so a retry is safe

      expect(await sql`SELECT 1 FROM support_reports`).toHaveLength(0);
      expect(await rows()).toBe(0);
    });

    it('leaves no trace in the operator counts', async () => {
      await recordEvent(sql, { eventType: 'API_5XX', subject: USER, httpStatus: 500 });
      await forgetSupportSubject(sql, USER);
      const after = await overview(sql);
      expect(after.counts.api5xx).toBe(0);
      expect(after.topErrorCodes).toEqual([]);
    });

    it('keeps anonymous events, which were never account data', async () => {
      await recordEvent(sql, { eventType: 'API_5XX', httpStatus: 500 });
      await recordEvent(sql, { eventType: 'API_5XX', subject: USER, httpStatus: 500 });
      await forgetSupportSubject(sql, USER);
      expect(await rows()).toBe(1);
    });

    it('leaves another student untouched', async () => {
      const other = 'user_2synthAbuseB';
      await recordEvent(sql, { eventType: 'API_5XX', subject: other, httpStatus: 500 });
      await forgetSupportSubject(sql, USER);
      const [row] = await sql<{ auth_user_id: string }[]>`SELECT auth_user_id FROM support_events`;
      expect(row?.auth_user_id).toBe(other);
    });

    it('runs through DELETE /me before the account goes', async () => {
      const calls: string[] = [];
      const app = createApp(
        loadConfig({ DATABASE_URL: DATABASE_URL as string, NODE_ENV: 'test', APP_ENV: 'test' }),
        sql,
        createLogger('silent', false),
        {
          sql,
          verify: async (token: string): Promise<Session> => ({
            userId: token,
            token,
            claims: { sub: token },
          }),
          deleteAccount: async () => {
            const reports = await sql`SELECT 1 FROM support_reports`;
            calls.push(`account deleted with ${String(reports.length)} reports left`);
            return true;
          },
        },
      );
      await request(app)
        .post('/api/v1/me/support-reports')
        .set('Authorization', `Bearer ${USER}`)
        .send({ category: 'sign_in' });
      const res = await request(app).delete('/api/v1/me').set('Authorization', `Bearer ${USER}`);
      expect(res.status).toBe(200);
      expect(calls).toEqual(['account deleted with 0 reports left']);
    });
  });

  describe('retention', () => {
    it('removes only what is past 90 days', async () => {
      await recordEvent(sql, { eventType: 'API_5XX', httpStatus: 500 });
      await sql`
        INSERT INTO support_events (support_id, event_type, occurred_at)
        VALUES ('GT-00000000', 'API_5XX', now() - interval '91 days')
      `;
      await purgeExpiredSupport(sql);
      expect(await rows()).toBe(1);
    });
  });
});
