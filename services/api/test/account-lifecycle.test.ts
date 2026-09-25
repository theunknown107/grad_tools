/**
 * What an account IS, across sign-ins.
 *
 * Authority: docs/11 §11.13 · docs/09 §9.18 · M9 §13, §19, §37
 *
 * ---------------------------------------------------------------------------
 * ONE IDENTITY KEY, AND ONLY ONE
 * ---------------------------------------------------------------------------
 *
 * A student signs in, signs out, and signs in again — possibly months later,
 * possibly from another device, possibly with a different email shown on the
 * screen because Apple's private relay rotates it. None of that may produce a
 * second profile or a second copy of their academic records.
 *
 * The only thing that decides whose records these are is `auth_user_id`. Not
 * the email, not the USN, not the display name — each of which a student can
 * change, and two of which two students can share.
 *
 * These run against REAL row-level security, on the same migration applied to
 * Supabase. SYNTHETIC STUDENTS ONLY: invented ids, invented records, no
 * password of any kind (GradTools stores none).
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

const A = 'aaaaaaaa-9999-4000-8000-00000000000a';
const B = 'bbbbbbbb-9999-4000-8000-00000000000b';

const sessionFor = (userId: string): Session => ({
  userId,
  token: userId,
  claims: { sub: userId },
});

describeDb('an account across sign-ins', () => {
  let cloud: Sql;
  let admin: Sql;
  /*
   * Deletion removes the `auth.users` row and lets the foreign keys cascade,
   * which needs a schema the `authenticated` role cannot write — the same
   * privileged path the route uses, not a test shortcut (db/cloud.ts).
   */
  let deleteAccount: (userId: string) => Promise<boolean>;

  beforeAll(async () => {
    admin = postgres(CLOUD_ADMIN_URL as string, { max: 2 }) as unknown as Sql;
    cloud = postgres(CLOUD_URL as string, { max: 5, prepare: false }) as unknown as Sql;
    deleteAccount = createAccountDeleter(admin);
  }, 60_000);

  afterAll(async () => {
    await Promise.all([cloud.end(), admin.end()]);
  });

  beforeEach(async () => {
    await admin`DELETE FROM auth.users WHERE id IN (${A}::uuid, ${B}::uuid)`;
    await admin`
      INSERT INTO auth.users (id, email) VALUES
        (${A}::uuid, 'synthetic-a@example.test'),
        (${B}::uuid, 'synthetic-b@example.test')
    `;
  });

  /* ---------------------------------------------------------------- A ---- */

  it('gives one auth user exactly one profile, however often they sign in', async () => {
    /* Three sessions for the same person: first sign-in, a refresh, a return. */
    for (const attempt of ['first', 'second', 'third']) {
      await withUser(cloud, sessionFor(A), async (sql) => {
        const outcome = await upsertProfile(sql, {
          schemeId: 'vtu-2022',
          displayName: `Demo ${attempt}`,
          currentSemester: 5,
          baseRevision: (await readProfile(sql))?.revision,
        });
        expect(outcome.kind).toBe('saved');
      });
    }

    const rows = await admin<{ count: string }[]>`
      SELECT count(*)::text AS count FROM student_profiles WHERE auth_user_id = ${A}::uuid
    `;
    expect(rows[0]?.count).toBe('1');
  });

  it('answers two racing first saves with one save and one conflict, never an error', async () => {
    const outcomes = await Promise.all(
      [5, 6].map((currentSemester) =>
        withUser(cloud, sessionFor(A), (sql) =>
          upsertProfile(sql, { schemeId: 'vtu-2022', currentSemester }),
        ),
      ),
    );
    expect(outcomes.map((o) => o.kind).sort()).toEqual(['conflict', 'saved']);
  });

  it('returns the same profile id to the same auth user', async () => {
    const first = await withUser(cloud, sessionFor(A), (sql) =>
      upsertProfile(sql, { schemeId: 'vtu-2022', currentSemester: 5 }),
    );
    if (first.kind !== 'saved') throw new Error('first save failed');
    const again = await withUser(cloud, sessionFor(A), (sql) =>
      upsertProfile(sql, {
        schemeId: 'vtu-2022',
        currentSemester: 6,
        baseRevision: first.profile.revision,
      }),
    );

    expect(again.kind).toBe('saved');
    if (again.kind !== 'saved') return;
    expect(again.profile.id).toBe(first.profile.id);
    /* The edit landed; it did not create a second row to land in. */
    expect(again.profile.currentSemester).toBe(6);
  });

  it('never re-keys a profile around an email a student can change', async () => {
    const before = await withUser(cloud, sessionFor(A), (sql) =>
      upsertProfile(sql, { schemeId: 'vtu-2022', currentSemester: 5 }),
    );
    if (before.kind !== 'saved') throw new Error('first save failed');

    /* The same person, now signing in with a different address on the token. */
    await admin`UPDATE auth.users SET email = 'renamed-a@example.test' WHERE id = ${A}::uuid`;

    const after = await withUser(cloud, sessionFor(A), (sql) =>
      upsertProfile(sql, {
        schemeId: 'vtu-2022',
        currentSemester: 5,
        baseRevision: before.profile.revision,
      }),
    );
    expect(after.kind).toBe('saved');

    const rows = await admin<{ count: string }[]>`
      SELECT count(*)::text AS count FROM student_profiles WHERE auth_user_id = ${A}::uuid
    `;
    expect(rows[0]?.count).toBe('1');
  });

  it('gives two students two profiles, and neither can see the other', async () => {
    await withUser(cloud, sessionFor(A), (sql) =>
      upsertProfile(sql, { schemeId: 'vtu-2022', currentSemester: 5 }),
    );
    await withUser(cloud, sessionFor(B), (sql) =>
      upsertProfile(sql, { schemeId: 'vtu-2022', currentSemester: 3 }),
    );

    const mine = await withUser(cloud, sessionFor(A), (sql) => readProfile(sql));
    const theirs = await withUser(cloud, sessionFor(B), (sql) => readProfile(sql));

    expect(mine?.currentSemester).toBe(5);
    expect(theirs?.currentSemester).toBe(3);
    expect(mine?.id).not.toBe(theirs?.id);
  });

  /* ---------------------------------------------------------------- C ---- */

  it('leaves nothing of an account behind when it is deleted, and nothing of anyone else', async () => {
    await withUser(cloud, sessionFor(A), async (sql) => {
      await upsertProfile(sql, { schemeId: 'vtu-2022', currentSemester: 5 });
    });
    await withUser(cloud, sessionFor(B), async (sql) => {
      await upsertProfile(sql, { schemeId: 'vtu-2022', currentSemester: 3 });
    });

    await deleteAccount(A);

    const gone = await admin<{ count: string }[]>`
      SELECT count(*)::text AS count FROM student_profiles WHERE auth_user_id = ${A}::uuid
    `;
    const survives = await admin<{ count: string }[]>`
      SELECT count(*)::text AS count FROM student_profiles WHERE auth_user_id = ${B}::uuid
    `;
    expect(gone[0]?.count).toBe('0');
    expect(survives[0]?.count).toBe('1');
  });

  it('starts an account that signs in again after deletion from nothing', async () => {
    await withUser(cloud, sessionFor(A), (sql) =>
      upsertProfile(sql, { schemeId: 'vtu-2022', currentSemester: 5 }),
    );
    await deleteAccount(A);

    /*
     * The auth user is gone, so a session for it is a token for somebody who
     * no longer exists. The row is put back to model the same person signing
     * up again — a NEW account that happens to reuse the id, holding nothing.
     */
    await admin`INSERT INTO auth.users (id, email) VALUES (${A}::uuid, 'synthetic-a@example.test')`;

    const after = await withUser(cloud, sessionFor(A), (sql) => readProfile(sql));
    expect(after).toBeNull();
    const records = await withUser(cloud, sessionFor(A), (sql) => pullChanges(sql, null));
    expect(records).toEqual([]);

    /* And a fresh sign-in can create one again, without colliding. */
    const created = await withUser(cloud, sessionFor(A), (sql) =>
      upsertProfile(sql, { schemeId: 'vtu-2022', currentSemester: 1 }),
    );
    expect(created.kind).toBe('saved');
  });

  it('shows an empty account to a student who has never synced', async () => {
    const empty = await withUser(cloud, sessionFor(B), (sql) => pullChanges(sql, null));
    expect(empty).toEqual([]);
  });
});
