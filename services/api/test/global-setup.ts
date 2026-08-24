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

import { createClient } from '../src/db/client.js';

export async function setup(): Promise<void> {
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
