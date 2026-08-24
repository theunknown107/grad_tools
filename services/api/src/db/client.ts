/**
 * Database client.
 *
 * Authority: docs/09_DATABASE_SCHEMA.md, docs/13 §T-09
 *
 * Uses postgres.js tagged templates. Every interpolated value becomes a bound
 * parameter, so SQL injection is prevented by construction rather than by
 * remembering to escape (docs/13 §T-09).
 *
 * DEVIATION FROM docs/06 §6.1, recorded as ED-27:
 * docs/06 selected Drizzle ORM. This milestone uses postgres.js plus
 * hand-written SQL migrations because:
 *   1. The migrations become the single source of schema truth. With Drizzle
 *      the schema is declared in TypeScript AND generated into SQL, so the
 *      same facts live in two places.
 *   2. docs/26 §26.10 requires migrations to be hand-reviewed anyway, since
 *      generated ones can propose destructive changes. Writing them directly
 *      makes review the default rather than an extra step.
 *   3. Rows are validated against the SHARED Zod contract on the way out
 *      (see ./queries.ts), which is a stronger guarantee than ORM types: it
 *      catches schema drift at runtime, in a test, rather than only at compile
 *      time against a declaration that might itself be stale.
 * Revisit if write-heavy student persistence arrives, where a query builder
 * earns more of its keep.
 */

import postgres from 'postgres';

export type Sql = postgres.Sql;

export function createClient(databaseUrl: string): Sql {
  return postgres(databaseUrl, {
    // Small pool: this API is read-only reference data at development scale,
    // and managed Postgres tiers cap connections (docs/23 §23.4).
    max: 10,
    idle_timeout: 20,
    connect_timeout: 10,
    // Never let the driver print a connection string or query values.
    onnotice: () => undefined,
    transform: { undefined: null },
  });
}

/** Cheap liveness probe for the readiness endpoint. */
export async function isDatabaseReachable(sql: Sql): Promise<boolean> {
  try {
    await sql`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}
