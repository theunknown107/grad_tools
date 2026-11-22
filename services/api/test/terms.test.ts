/**
 * Terms & Conditions acceptance (TERMS-AND-ONBOARDING, Slice 1).
 *
 * Real cloud Postgres under RLS. Proves: acceptance needs a session; it records
 * the exact current version + timestamp against the verified subject; /me
 * reports the gate state (never localStorage); a stale/forged version is
 * refused; acceptance is idempotent; and a user can neither see nor forge
 * another user's acceptance — ownership is enforced by the database, not just
 * the API. SYNTHETIC SUBJECTS ONLY.
 */

import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import postgres from 'postgres';
import { CURRENT_TERMS } from '@gradtools/shared-types';
import { loadConfig } from '../src/config.js';
import { runMigrations } from '../src/db/migrate.js';
import { createLogger } from '../src/observability/logger.js';
import { createApp } from '../src/http/app.js';
import { withUser } from '../src/db/cloud.js';
import type { Sql } from '../src/db/client.js';
import type { Session } from '../src/auth/session.js';

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const CLOUD_URL = process.env.TEST_CLOUD_DATABASE_URL;
const CLOUD_ADMIN_URL = process.env.TEST_CLOUD_ADMIN_DATABASE_URL;
const describeDb =
  DATABASE_URL === undefined || CLOUD_URL === undefined || CLOUD_ADMIN_URL === undefined
    ? describe.skip
    : describe;

const A = 'user_2synthTermsStudentA';
const B = 'user_2synthTermsStudentB';
const VERSION = CURRENT_TERMS.version;

const sessionFor = (userId: string): Session => ({
  userId,
  token: userId,
  claims: { sub: userId },
});

function fakeVerifier(): (token: string) => Promise<Session> {
  return async (token: string) => {
    if (token !== A && token !== B) throw new Error('not a known synthetic user');
    return sessionFor(token);
  };
}

describeDb('terms & conditions acceptance', () => {
  let sql: Sql;
  let cloud: Sql;
  let admin: Sql;
  let app: Express;

  beforeAll(async () => {
    sql = postgres(DATABASE_URL as string, { max: 2 }) as unknown as Sql;
    cloud = postgres(CLOUD_URL as string, { max: 5, prepare: false }) as unknown as Sql;
    admin = postgres(CLOUD_ADMIN_URL as string, { max: 2 }) as unknown as Sql;
    await runMigrations(sql);
    app = createApp(
      loadConfig({ DATABASE_URL: DATABASE_URL as string, NODE_ENV: 'test', APP_ENV: 'test' }),
      sql,
      createLogger('silent', false),
      { sql: cloud, verify: fakeVerifier() },
    );
  }, 60_000);

  afterAll(async () => {
    await admin`DELETE FROM accounts WHERE id IN (${A}, ${B})`;
    await Promise.all([sql.end(), cloud.end(), admin.end()]);
  });

  beforeEach(async () => {
    await admin`DELETE FROM accounts WHERE id IN (${A}, ${B})`;
  });

  it('refuses acceptance without a session', async () => {
    const res = await request(app).post('/api/v1/me/terms-acceptance').send({ version: VERSION });
    expect(res.status).toBe(401);
  });

  it('records the current version and timestamp against the verified subject', async () => {
    const res = await request(app)
      .post('/api/v1/me/terms-acceptance')
      .set('Authorization', `Bearer ${A}`)
      .send({ version: VERSION });
    expect(res.status).toBe(201);
    expect(res.body.version).toBe(VERSION);
    expect(new Date(res.body.acceptedAt).toString()).not.toBe('Invalid Date');

    const rows = await admin<{ auth_user_id: string; version: string }[]>`
      SELECT auth_user_id, version FROM terms_acceptances`;
    expect(rows).toEqual([{ auth_user_id: A, version: VERSION }]);
  });

  it('reports the gate state on /me (null before, the acceptance after)', async () => {
    const before = await request(app).get('/api/v1/me').set('Authorization', `Bearer ${A}`);
    expect(before.body.termsCurrentVersion).toBe(VERSION);
    expect(before.body.terms).toBeNull();

    await request(app)
      .post('/api/v1/me/terms-acceptance')
      .set('Authorization', `Bearer ${A}`)
      .send({ version: VERSION });

    const after = await request(app).get('/api/v1/me').set('Authorization', `Bearer ${A}`);
    expect(after.body.terms.version).toBe(VERSION);
    expect(after.body.terms.acceptedAt).toBeDefined();
  });

  it('refuses a version that is not the current one, and records nothing', async () => {
    const res = await request(app)
      .post('/api/v1/me/terms-acceptance')
      .set('Authorization', `Bearer ${A}`)
      .send({ version: '0.0.1-stale' });
    expect(res.status).toBe(400);
    expect(await admin`SELECT 1 FROM terms_acceptances WHERE auth_user_id = ${A}`).toHaveLength(0);
  });

  it('is idempotent: accepting twice keeps one row and the original timestamp', async () => {
    const first = await request(app)
      .post('/api/v1/me/terms-acceptance')
      .set('Authorization', `Bearer ${A}`)
      .send({ version: VERSION });
    const second = await request(app)
      .post('/api/v1/me/terms-acceptance')
      .set('Authorization', `Bearer ${A}`)
      .send({ version: VERSION });
    expect(second.status).toBe(201);
    expect(second.body.acceptedAt).toBe(first.body.acceptedAt);
    const rows = await admin`SELECT 1 FROM terms_acceptances WHERE auth_user_id = ${A}`;
    expect(rows).toHaveLength(1);
  });

  it('is keyed to the exact version, so a new version would require renewed acceptance', async () => {
    await request(app)
      .post('/api/v1/me/terms-acceptance')
      .set('Authorization', `Bearer ${A}`)
      .send({ version: VERSION });
    // A different version is not satisfied by having accepted this one.
    const other = await withUser(
      cloud,
      sessionFor(A),
      (tx) => tx`
      SELECT 1 FROM terms_acceptances
      WHERE auth_user_id = (SELECT auth.jwt() ->> 'sub') AND version = '9.9.9'`,
    );
    expect(other).toHaveLength(0);
  });

  describe('ownership is enforced in the database', () => {
    it('one user cannot see another user’s acceptance', async () => {
      await request(app)
        .post('/api/v1/me/terms-acceptance')
        .set('Authorization', `Bearer ${A}`)
        .send({ version: VERSION });
      const bSees = await request(app).get('/api/v1/me').set('Authorization', `Bearer ${B}`);
      expect(bSees.body.terms).toBeNull();
    });

    it('a forged owner in the row itself is refused by RLS', async () => {
      await expect(
        withUser(
          cloud,
          sessionFor(B),
          (tx) => tx`
          INSERT INTO terms_acceptances (auth_user_id, version) VALUES (${A}, ${VERSION})`,
        ),
      ).rejects.toThrow(/row-level security/i);
    });
  });
});
