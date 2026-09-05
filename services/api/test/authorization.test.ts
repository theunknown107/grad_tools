/**
 * The authorization matrix.
 *
 * Authority: docs/13 §13.17 · docs/22 §22.17 · M9 §18, §19, §62
 *
 * ---------------------------------------------------------------------------
 * THESE RUN AGAINST REAL ROW-LEVEL SECURITY
 * ---------------------------------------------------------------------------
 *
 * Not a mock, not an application-layer stub. The database is a real PostgreSQL
 * carrying the SAME `0001_student_cloud.sql` that is applied to Supabase, with
 * `0000_local_substrate.sql` supplying the `auth` schema and roles the platform
 * would otherwise provide (docs/22 §22.17).
 *
 * The same policies were also exercised directly against the live Supabase
 * project. These tests exist so that a change which weakens them fails in CI
 * rather than in production.
 *
 * ---------------------------------------------------------------------------
 * SYNTHETIC STUDENTS ONLY
 * ---------------------------------------------------------------------------
 *
 * Two invented users with invented records. No real name, no real USN, no real
 * grade, no password of any kind — GradTools stores none (M9 §66, §69).
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import postgres from 'postgres';
import { loadConfig } from '../src/config.js';
import type { Sql } from '../src/db/client.js';
import { createApp } from '../src/http/app.js';
import { runMigrations } from '../src/db/migrate.js';
import { createLogger } from '../src/observability/logger.js';
import { MemoryObjectStore } from '../src/documents/storage.js';
import { assertCloudRoleIsSafe, withUser } from '../src/db/cloud.js';
import type { Session } from '../src/auth/session.js';

const CLOUD_URL = process.env.TEST_CLOUD_DATABASE_URL;
const CLOUD_ADMIN_URL = process.env.TEST_CLOUD_ADMIN_DATABASE_URL;
const DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeDb =
  CLOUD_URL === undefined || CLOUD_ADMIN_URL === undefined || DATABASE_URL === undefined
    ? describe.skip
    : describe;

/*
 * THE CLOUD DATABASE IS A DIFFERENT DATABASE, not a different schema, and it is
 * prepared ONCE in `global-setup.ts` rather than here. Two files each dropping
 * the schema for themselves interleaved, and one removed the other's fixtures
 * mid-run (M9.1).
 */

/** Two synthetic students. Nothing here belongs to a person. */
const A = 'aaaaaaaa-0000-4000-8000-00000000000a';
const B = 'bbbbbbbb-0000-4000-8000-00000000000b';

/**
 * A stand-in for the JWT verifier.
 *
 * IT VERIFIES NOTHING, and that is deliberate: these tests are about what
 * happens AFTER a token is accepted. Signature verification is a separate
 * concern with its own tests, and mixing them would let a passing signature
 * test hide a broken authorization one.
 *
 * The token here is simply the user id. `Bearer <A>` means "a request that
 * arrived carrying a validly-signed token for A".
 */
function fakeVerifier(): (token: string) => Promise<Session> {
  return async (token: string) => {
    if (token !== A && token !== B) {
      throw new Error('not a known synthetic user');
    }
    return {
      userId: token,
      token,
      claims: { sub: token, email: `synthetic-${token.slice(0, 1)}@example.test` },
    };
  };
}

describeDb('the authorization matrix', () => {
  let cloud: Sql;
  let admin: Sql;
  let app: Express;
  let sql: Sql;

  const ids = { aSemester: '', bSemester: '', aProfile: '', bProfile: '' };

  const sessionFor = (userId: string): Session => ({
    userId,
    token: userId,
    claims: { sub: userId },
  });

  beforeAll(async () => {
    // The `authenticator` role: no bypassrls, exactly as in production.
    // A privileged connection on the CLOUD database, used ONLY to set up and
    // tear down fixtures — never by the application.
    admin = postgres(CLOUD_ADMIN_URL as string, { max: 2 }) as unknown as Sql;

    // The `authenticator` role: no bypassrls, exactly as in production.
    cloud = postgres(CLOUD_URL as string, { max: 5, prepare: false }) as unknown as Sql;
    // The reference database, for the public routes. Migrated here because
    // this file asserts that introducing authentication left them public.
    sql = postgres(DATABASE_URL as string, { max: 2 }) as unknown as Sql;
    await runMigrations(sql);

    app = createApp(
      loadConfig({ DATABASE_URL, NODE_ENV: 'test', APP_ENV: 'test' }),
      sql,
      createLogger('silent', false),
      new MemoryObjectStore(),
      { sql: cloud, verify: fakeVerifier() },
    );
  }, 60_000);

  afterAll(async () => {
    await Promise.all([cloud.end(), admin.end(), sql.end()]);
  });

  beforeEach(async () => {
    await admin`DELETE FROM auth.users WHERE id IN (${A}::uuid, ${B}::uuid)`;
    await admin`
      INSERT INTO auth.users (id, email) VALUES
        (${A}::uuid, 'synthetic-a@example.test'),
        (${B}::uuid, 'synthetic-b@example.test')
    `;

    for (const [user, key] of [
      [A, 'aProfile'],
      [B, 'bProfile'],
    ] as const) {
      const [row] = await admin<{ id: string }[]>`
        INSERT INTO student_profiles (auth_user_id, scheme_id, display_name)
        VALUES (${user}::uuid, 'vtu-2022', ${`Synthetic ${user === A ? 'A' : 'B'}`})
        RETURNING id::text
      `;
      ids[key] = row?.id as string;
    }

    for (const [user, profileKey, key] of [
      [A, 'aProfile', 'aSemester'],
      [B, 'bProfile', 'bSemester'],
    ] as const) {
      const [row] = await admin<{ id: string }[]>`
        INSERT INTO semester_records (auth_user_id, profile_id, number, status)
        VALUES (${user}::uuid, ${ids[profileKey]}::uuid, 5, 'in_progress')
        RETURNING id::text
      `;
      ids[key] = row?.id as string;
    }
  });

  /* ------------------------------------------------------------------------ */
  /* The connection itself                                                    */
  /* ------------------------------------------------------------------------ */

  describe('the trust boundary', () => {
    /*
     * THE ASSERTION THE WHOLE MODEL RESTS ON. If the student connection could
     * bypass RLS, every policy below would still pass its test while
     * protecting nothing.
     */
    it('refuses to serve student data through a role that bypasses RLS', async () => {
      await expect(assertCloudRoleIsSafe(cloud)).resolves.toBeUndefined();
      await expect(assertCloudRoleIsSafe(admin)).rejects.toThrow(/bypasses row-level security/);
    });

    it('connects as authenticator, not as postgres', async () => {
      const [row] = await cloud<{ user: string }[]>`SELECT current_user AS user`;
      expect(row?.user).toBe('authenticator');
    });
  });

  /* ------------------------------------------------------------------------ */
  /* User A                                                                   */
  /* ------------------------------------------------------------------------ */

  describe('a student and their own data', () => {
    it('can read their own profile', async () => {
      const response = await request(app).get('/api/v1/me').set('Authorization', `Bearer ${A}`);
      expect(response.status).toBe(200);
      expect(response.body.profile.displayName).toBe('Synthetic A');
      expect(response.body.identity.userId).toBe(A);
    });

    it('can update their own profile', async () => {
      const before = await request(app).get('/api/v1/me').set('Authorization', `Bearer ${A}`);
      const response = await request(app)
        .put('/api/v1/me/profile')
        .set('Authorization', `Bearer ${A}`)
        .send({
          schemeId: 'vtu-2022',
          displayName: 'Renamed A',
          baseRevision: before.body.profile.revision,
        });

      expect(response.status).toBe(200);
      expect(response.body.displayName).toBe('Renamed A');
      // The database bumped it, not the client.
      expect(response.body.revision).toBe(before.body.profile.revision + 1);
    });

    it('can read their own semesters and sees only their own', async () => {
      const response = await request(app)
        .get('/api/v1/me/sync')
        .set('Authorization', `Bearer ${A}`);

      expect(response.status).toBe(200);
      const semesters = (response.body.records as { id: string; collection: string }[]).filter(
        (r) => r.collection === 'semesters',
      );
      expect(semesters).toHaveLength(1);
      expect(semesters[0]?.id).toBe(ids.aSemester);
    });
  });

  /* ------------------------------------------------------------------------ */
  /* Cross-user — the whole point                                             */
  /* ------------------------------------------------------------------------ */

  describe('a student and somebody else’s data', () => {
    /*
     * There is no route that takes an id, so the attack has to be attempted
     * through the only thing a client controls: the record ids inside a sync
     * push (M9 §19).
     */
    it('cannot update another student’s semester by naming its id', async () => {
      const response = await request(app)
        .post('/api/v1/me/sync')
        .set('Authorization', `Bearer ${A}`)
        .send({
          records: [
            {
              id: ids.bSemester,
              collection: 'semesters',
              baseRevision: 1,
              deleted: false,
              data: { number: 1, status: 'completed' },
            },
          ],
        });

      expect(response.status).toBe(200);
      // B's row is invisible to A, so A's push reads as "a record that is gone".
      expect(response.body.outcomes[0].status).toBe('conflict');

      // And B's record is untouched.
      const [row] = await admin<{ status: string; revision: number }[]>`
        SELECT status, revision FROM semester_records WHERE id = ${ids.bSemester}::uuid
      `;
      expect(row?.status).toBe('in_progress');
      expect(row?.revision).toBe(1);
    });

    it('cannot delete another student’s semester', async () => {
      await request(app)
        .post('/api/v1/me/sync')
        .set('Authorization', `Bearer ${A}`)
        .send({
          records: [
            {
              id: ids.bSemester,
              collection: 'semesters',
              baseRevision: 1,
              deleted: true,
              data: {},
            },
          ],
        });

      const [row] = await admin<{ deleted_at: string | null }[]>`
        SELECT deleted_at FROM semester_records WHERE id = ${ids.bSemester}::uuid
      `;
      expect(row?.deleted_at).toBeNull();
    });

    /* A student cannot count another student's records, let alone read them. */
    it('cannot enumerate another student’s records', async () => {
      const response = await request(app)
        .get('/api/v1/me/sync')
        .set('Authorization', `Bearer ${A}`);

      const ownerIds = (response.body.records as { id: string }[]).map((r) => r.id);
      expect(ownerIds).not.toContain(ids.bSemester);
    });

    it('sees only their own records in an export', async () => {
      const response = await request(app)
        .get('/api/v1/me/export')
        .set('Authorization', `Bearer ${A}`);

      expect(response.status).toBe(200);
      expect(JSON.stringify(response.body)).not.toContain(ids.bSemester);
      expect(JSON.stringify(response.body)).not.toContain('Synthetic B');
    });

    /* The mirror image, so the result cannot be an artefact of A being first. */
    it('holds in the other direction too', async () => {
      const response = await request(app).get('/api/v1/me').set('Authorization', `Bearer ${B}`);
      expect(response.body.profile.displayName).toBe('Synthetic B');
      expect(response.body.profile.id).toBe(ids.bProfile);
      expect(response.body.profile.id).not.toBe(ids.aProfile);
    });

    /*
     * DIRECTLY AT THE DATABASE, bypassing the API entirely. This is what says
     * the guarantee is the database's rather than the router's.
     */
    it('is enforced by the database, not by the API', async () => {
      const rows = await withUser(
        cloud,
        sessionFor(A),
        (tx) => tx<{ id: string }[]>`SELECT id::text FROM semester_records`,
      );
      expect(rows.map((r) => r.id)).toEqual([ids.aSemester]);

      const stolen = await withUser(
        cloud,
        sessionFor(A),
        (tx) =>
          tx<
            { id: string }[]
          >`SELECT id::text FROM semester_records WHERE id = ${ids.bSemester}::uuid`,
      );
      expect(stolen).toHaveLength(0);
    });

    /* A student cannot hand their own row to somebody else either (WITH CHECK). */
    it('cannot reassign one of their own records to another student', async () => {
      await expect(
        withUser(
          cloud,
          sessionFor(A),
          (tx) =>
            tx`UPDATE semester_records SET auth_user_id = ${B}::uuid WHERE id = ${ids.aSemester}::uuid`,
        ),
      ).rejects.toThrow(/row-level security/);
    });
  });

  /* ------------------------------------------------------------------------ */
  /* Unauthenticated                                                          */
  /* ------------------------------------------------------------------------ */

  describe('an unauthenticated caller', () => {
    const routes: [string, string][] = [
      ['get', '/api/v1/me'],
      ['get', '/api/v1/me/sync'],
      ['post', '/api/v1/me/sync'],
      ['get', '/api/v1/me/export'],
      ['put', '/api/v1/me/profile'],
      ['delete', '/api/v1/me'],
    ];

    it.each(routes)('is refused by %s %s', async (method, route) => {
      const response = await (request(app) as unknown as Record<string, (r: string) => never>)[
        method
      ]?.(route);
      expect((response as unknown as { status: number }).status).toBe(401);
    });

    /*
     * EVERY FAILURE LOOKS THE SAME (M9 §23, §46). A different message for
     * "expired" than for "forged" would make the endpoint an oracle.
     */
    it('cannot tell a forged token from an expired one', async () => {
      const forged = await request(app).get('/api/v1/me').set('Authorization', 'Bearer forged');
      const malformed = await request(app).get('/api/v1/me').set('Authorization', 'Bearer ...');
      const absent = await request(app).get('/api/v1/me');

      expect(forged.status).toBe(401);
      expect(malformed.status).toBe(401);
      expect(forged.body.error.message).toBe(malformed.body.error.message);
      expect(absent.status).toBe(401);
    });

    it('never reaches student tables at the database either', async () => {
      await expect(
        cloud.begin(async (tx) => {
          await tx`SELECT set_config('role', 'anon', true)`;
          return tx`SELECT count(*) FROM student_profiles`;
        }),
      ).rejects.toThrow(/permission denied/);
    });
  });

  /* ------------------------------------------------------------------------ */
  /* The public surface is unaffected                                         */
  /* ------------------------------------------------------------------------ */

  describe('the public/private line', () => {
    /*
     * Introducing authentication must not accidentally make a public thing
     * private, nor a private thing public (M9 §43).
     */
    it('leaves genuinely public data public', async () => {
      /*
       * This asked for `/api/v1/question-papers` until M10A.13. That route was
       * removed with the rest of the question-paper surface in M10A.11, and
       * NOTHING NOTICED — the whole API suite was skipping for want of a
       * database, so a test asserting a deleted endpoint returns 200 sat green
       * for two milestones. It is the exact failure the M10A.12 report warned
       * about when it declined to remove more API code while these tests could
       * not run.
       *
       * The route is not coming back (M10A.13 §28). What this checks is what it
       * always meant to: introducing authentication must not have made a public
       * thing private, nor a private thing public.
       */
      await request(app).get('/api/v1/announcements').expect(200);
      await request(app).get('/api/v1/schemes').expect(200);
    });

    it('never lets student data be cached', async () => {
      const response = await request(app).get('/api/v1/me').set('Authorization', `Bearer ${A}`);
      expect(response.headers['cache-control']).toBe('private, no-store');
      expect(response.headers['vary']).toContain('Authorization');
    });
  });
});
