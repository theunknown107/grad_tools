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
 * as such: it must name `authenticator`, a role with no `bypassrls` and no
 * inherited privileges. `postgres` and `service_role` both bypass RLS and would
 * silently turn every policy in the schema into decoration.
 */

import postgres from 'postgres';
import type { Sql } from './client.js';
import type { Session } from '../auth/session.js';

export interface CloudClientOptions {
  /** An `authenticator`-role connection string. Never `postgres`, never `service_role`. */
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

    return work(tx as unknown as Sql);
  }) as Promise<T>;
}

/**
 * Deletes an account and everything in it.
 *
 * THE ONE OPERATION THIS API PERFORMS WITH ELEVATED RIGHTS, and it is
 * deliberately narrow:
 *
 *   - it removes exactly one `auth.users` row, named by the id in a VERIFIED
 *     session — never by anything a client sent;
 *   - every student table cascades from that row by foreign key, so there is no
 *     list of tables here to fall out of date (M9 §34);
 *   - it is a single named function rather than a general escape hatch, so
 *     there is no privileged query helper for anything else to reach for.
 *
 * `auth.users` lives in a schema the `authenticated` role cannot write, which
 * is why this needs its own connection. If a lower-privilege route becomes
 * available — Supabase's admin API behind a per-user token, say — it should
 * REPLACE this rather than sit beside it (M9 §44).
 *
 * Returns false when no row matched, so a caller can tell "deleted" from
 * "there was nothing to delete" without a second query.
 */
export function createAccountDeleter(adminSql: Sql): (userId: string) => Promise<boolean> {
  return async function deleteAccount(userId: string): Promise<boolean> {
    const rows = await adminSql`
      DELETE FROM auth.users WHERE id = ${userId}::uuid RETURNING id
    `;
    return rows.length > 0;
  };
}
