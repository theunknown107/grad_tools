/**
 * Migration runner.
 *
 * Authority: docs/09_DATABASE_SCHEMA.md §9.10, docs/25 §25.6
 *
 * Deterministic by construction: migrations are numbered files applied in
 * lexicographic order, each inside a transaction, each recorded in
 * `schema_migrations` so re-running is a no-op.
 *
 * Forward-only. There are no down-migrations: they are almost never tested and
 * give false confidence, so a mistake is corrected by a new forward migration
 * (docs/09 §9.10).
 */

import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pathToFileURL } from 'node:url';
import type { Sql } from './client.js';

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), 'migrations');

export interface MigrationResult {
  readonly applied: readonly string[];
  readonly skipped: readonly string[];
}

async function ensureMigrationTable(sql: Sql): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name        text PRIMARY KEY,
      applied_at  timestamptz NOT NULL DEFAULT now()
    )
  `;
}

/** Migration files, sorted. The numeric prefix is what makes order stable. */
export async function listMigrations(): Promise<string[]> {
  const entries = await readdir(MIGRATIONS_DIR);
  return entries.filter((name) => name.endsWith('.sql')).sort((a, b) => a.localeCompare(b));
}

/**
 * Advisory-lock key for the migration runner.
 *
 * PostgreSQL's two-argument form takes a pair of 32-bit integers, which avoids
 * the 64-bit round-trip entirely. The values are arbitrary but fixed: the only
 * requirement is that every process migrating this database uses the same pair.
 */
const MIGRATION_LOCK_CLASS = 0x6772; // 'gr'
const MIGRATION_LOCK_KEY = 0x6474; // 'dt'

/**
 * Applies pending migrations, one process at a time.
 *
 * THE LOCK IS NOT TEST SCAFFOLDING. Two processes running this concurrently
 * both read `schema_migrations`, both conclude a migration is pending, and both
 * try to apply it — and the second fails on a duplicate type or table rather
 * than skipping. That is exactly what a rolling deploy of two instances does,
 * and it was found by two test files racing.
 *
 * `pg_advisory_lock` blocks rather than failing, so the second caller waits and
 * then finds nothing left to apply. The lock is session-scoped and released in
 * `finally`, so a failed migration cannot leave it held.
 */
export async function runMigrations(sql: Sql): Promise<MigrationResult> {
  await sql`SELECT pg_advisory_lock(${MIGRATION_LOCK_CLASS}, ${MIGRATION_LOCK_KEY})`;
  try {
    return await applyPending(sql);
  } finally {
    await sql`SELECT pg_advisory_unlock(${MIGRATION_LOCK_CLASS}, ${MIGRATION_LOCK_KEY})`;
  }
}

async function applyPending(sql: Sql): Promise<MigrationResult> {
  await ensureMigrationTable(sql);

  const alreadyApplied = new Set(
    (await sql<{ name: string }[]>`SELECT name FROM schema_migrations`).map((row) => row.name),
  );

  const applied: string[] = [];
  const skipped: string[] = [];

  for (const name of await listMigrations()) {
    if (alreadyApplied.has(name)) {
      skipped.push(name);
      continue;
    }

    const statements = await readFile(join(MIGRATIONS_DIR, name), 'utf8');

    // Each migration is atomic: a failure half-way leaves no partial schema.
    await sql.begin(async (tx) => {
      await tx.unsafe(statements);
      await tx`INSERT INTO schema_migrations (name) VALUES (${name})`;
    });

    applied.push(name);
  }

  return { applied, skipped };
}

/** CLI entry point: `pnpm --filter @gradtools/api migrate`. */
async function main(): Promise<void> {
  const { loadConfig } = await import('../config.js');
  const { createClient } = await import('./client.js');
  const config = loadConfig();
  const sql = createClient(config.DATABASE_URL);
  try {
    const result = await runMigrations(sql);
    // eslint-disable-next-line no-console
    console.log(
      `migrations: ${String(result.applied.length)} applied, ${String(result.skipped.length)} already present`,
    );
    for (const name of result.applied) {
      // eslint-disable-next-line no-console
      console.log(`  + ${name}`);
    }
  } finally {
    await sql.end();
  }
}

/*
 * Run only when invoked directly, not when imported by a test.
 * pathToFileURL is used rather than string concatenation because a Windows
 * path produces `file:///D:/...` with three slashes, which a hand-built
 * `file://` prefix does not match.
 */
const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  main().catch((error: unknown) => {
    // eslint-disable-next-line no-console
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
