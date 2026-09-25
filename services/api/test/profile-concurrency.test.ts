/**
 * Two writers, one profile: `upsertProfile` under real transaction overlap.
 *
 * Both writers are the same student, each in its own `withUser` transaction
 * (the authenticator role with request.jwt claims, as the API runs). Ordering
 * is forced, not timed: T1 writes and holds its transaction open; T2 is started
 * and the test waits until the server reports T2 blocked on T1
 * (`pg_blocking_pids`) before letting T1 commit. No sleeps.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import postgres from 'postgres';
import type { ProfileInput } from '@gradtools/shared-types';
import type { Sql } from '../src/db/client.js';
import { withUser } from '../src/db/cloud.js';
import { readProfile, upsertProfile } from '../src/student/store.js';
import type { Session } from '../src/auth/session.js';

const C = 'aaaaaaaa-0000-4000-8000-0000000000c1';
const session: Session = { userId: C, token: C, claims: { sub: C } };

const edit = (displayName: string, baseRevision?: number): ProfileInput => ({
  schemeId: 'vtu-2022',
  displayName,
  ...(baseRevision === undefined ? {} : { baseRevision }),
});

const CLOUD_URL = process.env.TEST_CLOUD_DATABASE_URL;
const CLOUD_ADMIN_URL = process.env.TEST_CLOUD_ADMIN_DATABASE_URL;
const describeDb =
  CLOUD_URL === undefined || CLOUD_ADMIN_URL === undefined ? describe.skip : describe;

describeDb('profile writes that overlap', () => {
  let cloud: Sql;
  let admin: Sql;

  beforeAll(() => {
    admin = postgres(CLOUD_ADMIN_URL as string, { max: 2 }) as unknown as Sql;
    cloud = postgres(CLOUD_URL as string, {
      max: 4,
      prepare: false,
      connection: { TimeZone: 'UTC' },
    }) as unknown as Sql;
  });

  afterAll(async () => {
    await admin`DELETE FROM auth.users WHERE id = ${C}::uuid`;
    await Promise.all([cloud.end(), admin.end()]);
  });

  beforeEach(async () => {
    await admin`DELETE FROM auth.users WHERE id = ${C}::uuid`;
    await admin`INSERT INTO auth.users (id, email) VALUES (${C}::uuid, 'synthetic-c1@example.test')`;
  });

  const as = <T>(work: (tx: Sql) => Promise<T>) => withUser(cloud, session, work);

  /** Resolves once backend `waiter` is blocked by backend `holder`. */
  async function blockedBy(waiter: Promise<number>, holder: number): Promise<void> {
    const pid = await waiter;
    for (let i = 0; i < 10_000; i += 1) {
      const [row] = await admin<{ blocked: boolean }[]>`
        SELECT ${holder}::int = ANY (pg_blocking_pids(${pid}::int)) AS blocked
      `;
      if (row!.blocked) return;
    }
    throw new Error(`backend ${pid} never blocked on ${holder}`);
  }

  /**
   * T1 runs `first` and stays open; T2 runs `second` in its own transaction.
   * T1 commits only once T2 is waiting on T1's lock.
   */
  async function overlap<A, B>(
    first: (tx: Sql) => Promise<A>,
    second: (tx: Sql) => Promise<B>,
  ): Promise<[A, B]> {
    let t2Pid!: (pid: number) => void;
    const t2PidKnown = new Promise<number>((resolve) => (t2Pid = resolve));
    let t2Started!: () => void;
    const startT2 = new Promise<void>((resolve) => (t2Started = resolve));

    const t1 = as(async (tx) => {
      const { pid } = (await tx<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`)[0]!;
      const out = await first(tx);
      t2Started();
      await blockedBy(t2PidKnown, pid);
      return out;
    });
    const t2 = startT2.then(() =>
      as(async (tx) => {
        const { pid } = (await tx<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`)[0]!;
        t2Pid(pid);
        return second(tx);
      }),
    );
    return Promise.all([t1, t2]);
  }

  it('refuses a stale base after the other writer committed', async () => {
    const created = await as((tx) => upsertProfile(tx, edit('Start')));
    expect(created.kind).toBe('saved');
    const base = created.kind === 'saved' ? created.profile.revision : -1;

    const first = await as((tx) => upsertProfile(tx, edit('First', base)));
    const second = await as((tx) => upsertProfile(tx, edit('Second', base)));

    expect(first).toMatchObject({ kind: 'saved', profile: { displayName: 'First' } });
    expect(second).toMatchObject({
      kind: 'conflict',
      server: { displayName: 'First', revision: base + 1 },
    });
    expect(await as(readProfile)).toMatchObject({ displayName: 'First', revision: base + 1 });
  });

  it('refuses the second of two updates from the same base when they truly overlap', async () => {
    const created = await as((tx) => upsertProfile(tx, edit('Start')));
    const base = created.kind === 'saved' ? created.profile.revision : -1;

    /* T2 reads revision `base` (T1 is uncommitted), passes the base check, and
       its conditional UPDATE waits on T1's row lock. After T1 commits, the
       re-checked `WHERE revision = base` matches nothing: a conflict. */
    const [first, second] = await overlap(
      (tx) => upsertProfile(tx, edit('First', base)),
      (tx) => upsertProfile(tx, edit('Second', base)),
    );

    expect(first).toMatchObject({ kind: 'saved', profile: { displayName: 'First' } });
    expect(second).toMatchObject({
      kind: 'conflict',
      server: { displayName: 'First', revision: base + 1 },
    });
    expect(await as(readProfile)).toMatchObject({ displayName: 'First', revision: base + 1 });
  });

  it('refuses the second of two first-time creates when they truly overlap', async () => {
    /* Both see no profile; T2's INSERT waits on T1's uncommitted row in the
       unique index, then does nothing: a conflict with T1's profile. */
    const [first, second] = await overlap(
      (tx) => upsertProfile(tx, edit('First')),
      (tx) => upsertProfile(tx, edit('Second')),
    );

    expect(first).toMatchObject({ kind: 'saved', profile: { displayName: 'First' } });
    expect(second).toMatchObject({ kind: 'conflict', server: { displayName: 'First' } });
    const rows = await admin<{ count: number }[]>`
      SELECT count(*)::int AS count FROM student_profiles WHERE auth_user_id = ${C}::uuid
    `;
    expect(rows[0]?.count).toBe(1);
  });
});
