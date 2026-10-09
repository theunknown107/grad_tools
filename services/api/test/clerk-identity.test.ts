/**
 * Clerk-shaped identities against REAL row-level security (Supabase 0012).
 *
 * A Clerk user id is `user_...` — text, not a uuid, and never present in
 * `auth.users`. Before 0012 every policy compared `auth_user_id = auth.uid()`,
 * which CASTS the subject to uuid and would have raised on every Clerk request.
 * These tests prove the text-subject schema isolates two such users completely,
 * refuses forged ownership, shows nothing without a session, and deletes an
 * account with no elevated rights.
 *
 * SYNTHETIC SUBJECTS ONLY. No real Clerk user, no network.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import postgres from 'postgres';
import type { Sql } from '../src/db/client.js';
import { createAccountDeleter, withUser } from '../src/db/cloud.js';
import { pullChanges, readProfile, upsertProfile } from '../src/student/store.js';
import type { Session } from '../src/auth/session.js';

const CLOUD_URL = process.env.TEST_CLOUD_DATABASE_URL;
const CLOUD_ADMIN_URL = process.env.TEST_CLOUD_ADMIN_DATABASE_URL;
const describeDb =
  CLOUD_URL === undefined || CLOUD_ADMIN_URL === undefined ? describe.skip : describe;

const A = 'user_2synthClerkStudentA';
const B = 'user_2synthClerkStudentB';

const sessionFor = (userId: string): Session => ({ userId, token: '', claims: { sub: userId } });

describeDb('Clerk-shaped identities under RLS', () => {
  let cloud: Sql;
  let admin: Sql;

  beforeAll(async () => {
    admin = postgres(CLOUD_ADMIN_URL as string, { max: 2 }) as unknown as Sql;
    cloud = postgres(CLOUD_URL as string, { max: 5, prepare: false }) as unknown as Sql;
  }, 60_000);

  afterAll(async () => {
    await admin`DELETE FROM accounts WHERE id IN (${A}, ${B})`;
    await Promise.all([cloud.end(), admin.end()]);
  });

  beforeEach(async () => {
    await admin`DELETE FROM accounts WHERE id IN (${A}, ${B})`;
  });

  const as = <T>(userId: string, work: (tx: Sql) => Promise<T>) =>
    withUser(cloud, sessionFor(userId), work);

  it('no policy still depends on the uuid-casting auth.uid()', async () => {
    const rows = await admin<{ count: string }[]>`
      SELECT count(*)::text AS count FROM pg_policies
       WHERE schemaname = 'public' AND (qual ILIKE '%auth.uid()%' OR with_check ILIKE '%auth.uid()%')
    `;
    expect(rows[0]?.count).toBe('0');
  });

  it('a first request provisions exactly one account, keyed by the verified subject', async () => {
    await as(A, (sql) => readProfile(sql));
    await as(A, (sql) => readProfile(sql));
    const rows = await admin<{ id: string }[]>`SELECT id FROM accounts WHERE id = ${A}`;
    expect(rows.map((row) => row.id)).toEqual([A]);
  });

  it('each user reads and writes their own data, and only their own', async () => {
    const saved = await as(A, (sql) =>
      upsertProfile(sql, { schemeId: 'vtu-2022', currentSemester: 5 }),
    );
    expect(saved.kind).toBe('saved');

    expect(await as(A, (sql) => readProfile(sql))).not.toBeNull();
    expect(await as(B, (sql) => readProfile(sql))).toBeNull();
    expect(await as(B, (sql) => pullChanges(sql, null))).toEqual([]);

    const owner = await admin<
      { auth_user_id: string }[]
    >`SELECT auth_user_id FROM student_profiles WHERE auth_user_id IN (${A}, ${B}) ORDER BY auth_user_id`;
    expect(owner.map((row) => row.auth_user_id)).toEqual([A]);
  });

  it('B cannot reach A’s rows by naming them', async () => {
    await as(A, (sql) => upsertProfile(sql, { schemeId: 'vtu-2022', currentSemester: 5 }));
    const updated = await as(
      B,
      (sql) => sql`UPDATE student_profiles SET current_semester = 1 RETURNING id`,
    );
    const deleted = await as(B, (sql) => sql`DELETE FROM student_profiles RETURNING id`);
    expect([updated.length, deleted.length]).toEqual([0, 0]);
    const intact = await admin<
      { current_semester: number }[]
    >`SELECT current_semester FROM student_profiles WHERE auth_user_id = ${A}`;
    expect(intact[0]?.current_semester).toBe(5);
  });

  it('refuses ownership forged in the row itself', async () => {
    await expect(
      as(
        B,
        (sql) =>
          sql`INSERT INTO student_profiles (auth_user_id, scheme_id) VALUES (${A}, 'vtu-2022')`,
      ),
    ).rejects.toThrow(/row-level security/i);
  });

  it('refuses an account created for somebody else', async () => {
    await expect(as(B, (sql) => sql`INSERT INTO accounts (id) VALUES (${A})`)).rejects.toThrow(
      /row-level security/i,
    );
    const rows = await admin<{ id: string }[]>`SELECT id FROM accounts WHERE id = ${A}`;
    expect(rows).toEqual([]);
  });

  it('shows nothing and accepts nothing without a session', async () => {
    await as(A, (sql) => upsertProfile(sql, { schemeId: 'vtu-2022', currentSemester: 5 }));
    const seen = await cloud.begin(async (tx) => {
      await tx`SELECT set_config('role', 'authenticated', true)`;
      return tx`SELECT id FROM student_profiles`;
    });
    expect(seen).toEqual([]);
    await expect(
      cloud.begin(async (tx) => {
        await tx`SELECT set_config('role', 'authenticated', true)`;
        await tx`INSERT INTO accounts (id) VALUES (${A})`;
      }),
    ).rejects.toThrow();
  });

  describe('account deletion, with no elevated rights', () => {
    it('removes everything A owns, leaves B untouched, then deletes the identity', async () => {
      await as(A, (sql) => upsertProfile(sql, { schemeId: 'vtu-2022', currentSemester: 5 }));
      await as(B, (sql) => upsertProfile(sql, { schemeId: 'vtu-2022', currentSemester: 3 }));
      const removedIdentities: string[] = [];
      const deleteAccount = createAccountDeleter(cloud, async (userId) => {
        removedIdentities.push(userId);
      });

      expect(await deleteAccount(A)).toBe(true);

      const remaining = await admin<
        { auth_user_id: string }[]
      >`SELECT auth_user_id FROM student_profiles WHERE auth_user_id IN (${A}, ${B}) ORDER BY auth_user_id`;
      expect(remaining.map((row) => row.auth_user_id)).toEqual([B]);
      expect(await admin`SELECT id FROM accounts WHERE id = ${A}`).toEqual([]);
      expect(removedIdentities).toEqual([A]);
    });

    it('a failed identity deletion leaves no data behind, and a retry finishes the job', async () => {
      await as(A, (sql) => upsertProfile(sql, { schemeId: 'vtu-2022', currentSemester: 5 }));
      let attempts = 0;
      const deleteAccount = createAccountDeleter(cloud, async () => {
        attempts += 1;
        if (attempts === 1) throw new Error('identity provider unavailable');
      });

      await expect(deleteAccount(A)).rejects.toThrow(/unavailable/);
      expect(await admin`SELECT id FROM student_profiles WHERE auth_user_id = ${A}`).toEqual([]);

      expect(await deleteAccount(A)).toBe(false); // nothing left to delete…
      expect(attempts).toBe(2); // …but the identity is retried
    });
  });
});
