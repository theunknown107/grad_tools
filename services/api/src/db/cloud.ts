/**
 * The student cloud connection.
 *
 * Authority: docs/09 §9.18 · docs/13 §13.17 · docs/25 §25.15 · M9 §15, §16, §44
 *
 * ---------------------------------------------------------------------------
 * EVERY STUDENT QUERY RUNS AS THE STUDENT
 * ---------------------------------------------------------------------------
 *
 * This module is the only way student data is reached, and it can only reach it
 * on behalf of somebody. There is no "admin" path, no service-role client and
 * no unscoped query helper — not because callers are trusted to avoid them,
 * but because they do not exist to be called (M9 §44).
 *
 * Each request opens a transaction and, inside it:
 *
 *     SET LOCAL ROLE authenticated;
 *     SET LOCAL request.jwt.claims = '<verified claims>';
 *
 * `auth.uid()` then resolves to the user the token was issued to, and every RLS
 * policy on every student table compares against it. `SET LOCAL` is scoped to
 * the transaction, so the role and the claims cannot leak into the next request
 * that borrows the same pooled connection — which is the failure mode this
 * whole shape has to get right.
 *
 * ---------------------------------------------------------------------------
 * THE PROPERTY THIS BUYS
 * ---------------------------------------------------------------------------
 *
 * **A bug in this API cannot expose one student's records to another.** A query
 * that forgets its owner predicate returns the caller's rows; a query that asks
 * for somebody else's id returns nothing. The application checks are still
 * written and still tested, but they are the second lock on the door rather
 * than the only one (M9 §15).
 *
 * The trust boundary is therefore the CONNECTION STRING, and it is documented
 * as such: it must log in as a role with no `bypassrls` and no inherited
 * privileges — the Supabase `authenticator` role, or a dedicated login role
 * (e.g. `gradtools_runtime`) granted membership in `authenticated` where the
 * host reserves `authenticator` (docs/48). `postgres` and `service_role` both
 * bypass RLS and would silently turn every policy in the schema into decoration.
 */

import postgres from 'postgres';
import type { Sql } from './client.js';
import type { Session } from '../auth/session.js';

export interface CloudClientOptions {
  /** A non-bypassrls login role's connection string (`authenticator` or a
   *  dedicated role granted `authenticated`). Never `postgres`/`service_role`. */
  readonly url: string;
  readonly max?: number;
}

export function createCloudClient(options: CloudClientOptions): Sql {
  return postgres(options.url, {
    max: options.max ?? 10,
    prepare: false,
    // The API speaks ISO strings; the database keeps timestamps.
    types: {},
    onnotice: () => {
      /* Notices are the schema's business, not an operational signal. */
    },
  }) as unknown as Sql;
}

/**
 * Refuses to serve student data through a connection that can bypass RLS.
 *
 * A STARTUP ASSERTION, ON PURPOSE. Pointing this at a `postgres`-role URL is
 * the single mistake that would quietly disable every authorization policy in
 * the system while leaving all the tests passing — because the tests would
 * still be running as `authenticated`. Failing to boot is the only response
 * proportionate to that.
 */
export async function assertCloudRoleIsSafe(sql: Sql): Promise<void> {
  const [row] = await sql<{ role: string; bypass: boolean; superuser: boolean }[]>`
    SELECT current_user AS role,
           rolbypassrls AS bypass,
           rolsuper AS superuser
    FROM pg_roles WHERE rolname = current_user
  `;

  if (row === undefined) {
    throw new Error('Could not determine the role the student cloud connection uses.');
  }
  if (row.bypass || row.superuser) {
    throw new Error(
      `The student cloud connection uses "${row.role}", which bypasses row-level security. ` +
        'Use an `authenticator` connection string; RLS is the authorization model (docs/13 §13.17).',
    );
  }
}

/**
 * Runs a unit of work as one student.
 *
 * The claims are passed as a parameter rather than interpolated, so nothing in
 * a token can reach the SQL text even in principle. They are the claims this
 * server VERIFIED — not the ones the client sent — and the two are different
 * objects for exactly that reason.
 *
 * `SET LOCAL ROLE authenticated` comes first and is never conditional. There is
 * no branch in this function that runs a caller's work as anything else.
 */
export async function withUser<T>(
  sql: Sql,
  session: Session,
  work: (tx: Sql) => Promise<T>,
  { provision = true }: { readonly provision?: boolean } = {},
): Promise<T> {
  return sql.begin(async (tx) => {
    const claims = JSON.stringify({
      sub: session.userId,
      role: 'authenticated',
      // Nothing else is forwarded. Email, provider and user metadata are not
      // authorization inputs and have no business in a database session
      // (M9 §7, §8).
    });

    await tx`SELECT set_config('role', 'authenticated', true)`;
    await tx`SELECT set_config('request.jwt.claims', ${claims}, true)`;

    /*
     * THE ACCOUNT EXISTS BEFORE ANYTHING IS WRITTEN UNDER IT (Supabase 0012).
     *
     * Every student table references `accounts`, so a first sign-in creates
     * the row here. Its id is the column DEFAULT — the verified `sub` set just
     * above — so no value from the request reaches this statement, and the
     * policy would refuse any other id anyway.
     */
    if (provision) {
      await tx`INSERT INTO accounts DEFAULT VALUES ON CONFLICT (id) DO NOTHING`;
    }

    return work(tx as unknown as Sql);
  }) as Promise<T>;
}

/**
 * Deletes an account and everything in it — WITHOUT elevated rights.
 *
 *   1. As the student, under RLS, their own `accounts` row is deleted. The
 *      policy reaches nothing else, and every student table cascades from that
 *      row by foreign key, so there is no list of tables here to fall out of
 *      date (M9 §34). The id is the VERIFIED session subject — the route passes
 *      `sessionOf(req).userId`, never anything a client sent.
 *   2. Then the identity itself is removed at the provider (`deleteIdentity`:
 *      Clerk's backend API, or `auth.users` for a legacy Supabase deployment).
 *      Data first: a failure here leaves a login with nothing behind it, which
 *      a retry cleans up — the reverse order could orphan data nobody can reach.
 *
 * Idempotent: a retry after a provider failure deletes no rows (already gone)
 * and retries the identity. Returns whether any data existed.
 */
export function createAccountDeleter(
  cloudSql: Sql,
  deleteIdentity?: (userId: string) => Promise<void>,
): (userId: string) => Promise<boolean> {
  return async function deleteAccount(userId: string): Promise<boolean> {
    const rows = await withUser(
      cloudSql,
      { userId, token: '', claims: { sub: userId } },
      (tx) => tx`DELETE FROM accounts WHERE id = (SELECT auth.jwt() ->> 'sub') RETURNING id`,
      { provision: false },
    );
    if (deleteIdentity !== undefined) await deleteIdentity(userId);
    return rows.length > 0;
  };
}

/**
 * The legacy Supabase identity deleter: removes the `auth.users` login over a
 * privileged connection. Only for a deployment still on Supabase Auth; a Clerk
 * deployment deletes the user through Clerk's backend instead (auth/clerk.ts).
 */
export function createSupabaseIdentityDeleter(adminSql: Sql): (userId: string) => Promise<void> {
  return async function deleteIdentity(userId: string): Promise<void> {
    await adminSql`DELETE FROM auth.users WHERE id::text = ${userId}`;
  };
}
