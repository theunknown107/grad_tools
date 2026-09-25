/**
 * PUT /me/profile and the academic identity (Supabase 0010, UF-01).
 *
 * Admission year, expected passout year, entry route and the name
 * confirmation are stored as the student stated them. The window and the
 * passout-after-admission rule are enforced by zod before the database is
 * reached, and again by the 0010 CHECKs. NO DATE OF BIRTH (DEC-008).
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import postgres from 'postgres';
import { loadConfig } from '../src/config.js';
import type { Sql } from '../src/db/client.js';
import { createApp } from '../src/http/app.js';
import { createLogger } from '../src/observability/logger.js';
import type { Session } from '../src/auth/session.js';

const A = 'aaaaaaaa-0000-4000-8000-0000000000a1';

const verify = async (token: string): Promise<Session> => {
  if (token !== A) throw new Error('not a known synthetic user');
  return { userId: A, token, claims: { sub: A } };
};

const IDENTITY = {
  schemeId: 'vtu-2022',
  admissionYear: 2022,
  expectedPassoutYear: 2026,
  entryRoute: 'puc',
  identityConfirmedAt: '2026-09-01T10:00:00.000Z',
};

/* Validation runs before any query, so a connection that is never used will do. */
describe('PUT /me/profile validation', () => {
  const unused = new Proxy(
    {},
    {
      get() {
        throw new Error('the database must not be reached');
      },
    },
  ) as unknown as Sql;
  const app = createApp(
    loadConfig({ DATABASE_URL: 'postgres://unused/unused', NODE_ENV: 'test', APP_ENV: 'test' }),
    unused,
    createLogger('silent', false),
    { sql: unused, verify },
  );

  it.each([
    ['an admission year outside the window', { admissionYear: 1999 }],
    ['a passout year outside the window', { expectedPassoutYear: 2101 }],
    ['a year that is not whole', { admissionYear: 2022.5 }],
    ['an entry route that is not PUC or Diploma', { entryRoute: 'lateral' }],
    [
      'a passout year before the admission year',
      { admissionYear: 2024, expectedPassoutYear: 2023 },
    ],
    ['a confirmation that is not a time', { identityConfirmedAt: 'yesterday' }],
  ])('refuses %s', async (_label, patch) => {
    const response = await request(app)
      .put('/api/v1/me/profile')
      .set('Authorization', `Bearer ${A}`)
      .send({ ...IDENTITY, ...patch });
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_FAILED');
  });
});

const CLOUD_URL = process.env.TEST_CLOUD_DATABASE_URL;
const CLOUD_ADMIN_URL = process.env.TEST_CLOUD_ADMIN_DATABASE_URL;
const DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeDb =
  CLOUD_URL === undefined || CLOUD_ADMIN_URL === undefined || DATABASE_URL === undefined
    ? describe.skip
    : describe;

describeDb('PUT /me/profile with the academic identity', () => {
  let cloud: Sql;
  let admin: Sql;
  let sql: Sql;
  let app: ReturnType<typeof createApp>;

  beforeAll(() => {
    admin = postgres(CLOUD_ADMIN_URL as string, { max: 2 }) as unknown as Sql;
    cloud = postgres(CLOUD_URL as string, { max: 2, prepare: false }) as unknown as Sql;
    sql = postgres(DATABASE_URL as string, { max: 2 }) as unknown as Sql;
    app = createApp(
      loadConfig({ DATABASE_URL, NODE_ENV: 'test', APP_ENV: 'test' }),
      sql,
      createLogger('silent', false),
      { sql: cloud, verify },
    );
  });

  afterAll(async () => {
    await admin`DELETE FROM auth.users WHERE id = ${A}::uuid`;
    await Promise.all([cloud.end(), admin.end(), sql.end()]);
  });

  beforeEach(async () => {
    await admin`DELETE FROM auth.users WHERE id = ${A}::uuid`;
    await admin`INSERT INTO auth.users (id, email) VALUES (${A}::uuid, 'synthetic-a1@example.test')`;
  });

  it('creates and returns the stated fields, then updates them', async () => {
    const created = await request(app)
      .put('/api/v1/me/profile')
      .set('Authorization', `Bearer ${A}`)
      .send(IDENTITY);
    expect(created.status).toBe(200);
    expect(created.body).toMatchObject({
      admissionYear: 2022,
      expectedPassoutYear: 2026,
      entryRoute: 'puc',
    });
    expect(Date.parse(created.body.identityConfirmedAt)).toBe(
      Date.parse(IDENTITY.identityConfirmedAt),
    );
    expect(Object.keys(created.body).filter((key) => /dob|birth/i.test(key))).toEqual([]);

    const updated = await request(app)
      .put('/api/v1/me/profile')
      .set('Authorization', `Bearer ${A}`)
      .send({
        schemeId: 'vtu-2022',
        entryRoute: 'diploma',
        expectedPassoutYear: 2025,
        baseRevision: created.body.revision,
      });
    expect(updated.status).toBe(200);
    expect(updated.body).toMatchObject({
      admissionYear: null,
      expectedPassoutYear: 2025,
      entryRoute: 'diploma',
      identityConfirmedAt: null,
    });
  });

  it('is backed by CHECKs the database enforces on its own', async () => {
    await expect(
      admin`
        INSERT INTO student_profiles (auth_user_id, scheme_id, admission_year, expected_passout_year)
        VALUES (${A}::uuid, 'vtu-2022', 2024, 2023)
      `,
    ).rejects.toThrow(/student_profiles_passout_after_admission/);
    await expect(
      admin`
        INSERT INTO student_profiles (auth_user_id, scheme_id, entry_route)
        VALUES (${A}::uuid, 'vtu-2022', 'lateral')
      `,
    ).rejects.toThrow(/check constraint/);
  });
});
