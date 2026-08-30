/**
 * One-time database preparation for the API test project.
 *
 * Authority: docs/22 §22.2
 *
 * The `public` schema is dropped and recreated ONCE here, before any test file
 * runs, so migrations are always proven from a genuinely clean database.
 *
 * This lives in globalSetup rather than in a file's `beforeAll` because more
 * than one test file needs the database: if each dropped the schema for itself,
 * two files' hooks could interleave and one would find its tables removed
 * mid-setup. One owner, once, before anything else — after which every file can
 * simply migrate and seed, both of which are idempotent.
 */

import { readFile } from 'node:fs/promises';
import { createClient } from '../src/db/client.js';

export async function setup(): Promise<void> {
  await resetReferenceDatabase();
  await resetCloudDatabase();
}

async function resetReferenceDatabase(): Promise<void> {
  const url = process.env.TEST_DATABASE_URL;
  if (url === undefined) return;

  const sql = createClient(url);
  try {
    await sql`DROP SCHEMA IF EXISTS public CASCADE`;
    await sql`CREATE SCHEMA public`;
  } finally {
    await sql.end();
  }
}

/**
 * The student cloud, prepared once (M9.1).
 *
 * SAME REASON AS THE REFERENCE DATABASE, and it was learned the same way: two
 * test files each dropping the schema for themselves interleaved, and whichever
 * ran second removed the other's fixtures mid-run. One owner, once, before
 * anything else.
 *
 * A SEPARATE DATABASE from the reference one, as in production (docs/09 §9.18),
 * and the migrations applied here are the same files applied to Supabase —
 * `0000_local_substrate.sql` excepted, which exists only because a plain
 * PostgreSQL has no `auth` schema (docs/22 §22.17).
 */
async function resetCloudDatabase(): Promise<void> {
  const url = process.env.TEST_CLOUD_ADMIN_DATABASE_URL;
  if (url === undefined) return;

  const sql = createClient(url);
  try {
    await sql`DROP SCHEMA IF EXISTS public CASCADE`;
    await sql`CREATE SCHEMA public`;
    for (const file of [
      '0000_local_substrate.sql',
      '0001_student_cloud.sql',
      '0002_result_subject_sync.sql',
    ]) {
      const path = new URL(`../src/db/supabase/${file}`, import.meta.url);
      await sql.unsafe(await readFile(path, 'utf8'));
    }
  } finally {
    await sql.end();
  }
}
