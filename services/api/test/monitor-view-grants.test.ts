/**
 * The monitor views expose student context with RLS bypassed (they are
 * security-definer by design, for the background fanout). They must therefore
 * be readable by `gradtools_monitor` and by NOBODY else — in particular not
 * `anon`/`authenticated`, the roles Supabase's Data API exposes.
 *
 * This proves migration 0011 actually REVOKES that access rather than the local
 * database merely never having granted it: each test first GRANTs `anon`/
 * `authenticated` (as Supabase's default privileges would), then applies the
 * 0011 SQL and asserts the access is gone. Run against the local cloud test
 * Postgres; no Supabase, no secrets.
 */
import { readFile } from 'node:fs/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import postgres from 'postgres';
import type { Sql } from '../src/db/client.js';

const ADMIN_URL = process.env.TEST_CLOUD_ADMIN_DATABASE_URL;
const describeDb = ADMIN_URL === undefined ? describe.skip : describe;

const VIEWS = ['monitor_applicability_context', 'monitor_course_context'] as const;

describeDb('monitor views are readable only by gradtools_monitor', () => {
  let admin: Sql;
  let migration0011: string;

  beforeAll(async () => {
    admin = postgres(ADMIN_URL as string, { max: 2 }) as unknown as Sql;
    migration0011 = await readFile(
      new URL('../src/db/supabase/0011_restrict_monitor_view_grants.sql', import.meta.url),
      'utf8',
    );
  });

  afterAll(async () => {
    await admin.end();
  });

  const canSelect = async (role: string, view: string): Promise<boolean> => {
    const [row] = await admin<{ ok: boolean }[]>`
      SELECT has_table_privilege(${role}, ${'public.' + view}, 'SELECT') AS ok
    `;
    return row?.ok === true;
  };

  it('0011 revokes anon/authenticated/PUBLIC even after they were granted', async () => {
    for (const view of VIEWS) {
      // Reproduce what Supabase's default privileges do on a new public object.
      await admin.unsafe(`GRANT SELECT ON ${view} TO anon, authenticated`);
      expect(await canSelect('anon', view), `anon before, ${view}`).toBe(true);
      expect(await canSelect('authenticated', view), `authenticated before, ${view}`).toBe(true);
    }

    // Applying the migration is what must take the access away.
    await admin.unsafe(migration0011);

    for (const view of VIEWS) {
      expect(await canSelect('anon', view), `anon after, ${view}`).toBe(false);
      expect(await canSelect('authenticated', view), `authenticated after, ${view}`).toBe(false);
      // PUBLIC: no role should read it via a PUBLIC grant. `public` is the
      // pseudo-role has_table_privilege accepts for exactly this check.
      expect(await canSelect('public', view), `PUBLIC after, ${view}`).toBe(false);
      // The intended reader keeps its access.
      expect(await canSelect('gradtools_monitor', view), `monitor after, ${view}`).toBe(true);
    }
  });

  it('gradtools_monitor can SELECT the views and anon cannot, functionally', async () => {
    await admin.unsafe(migration0011); // idempotent: safe to apply after 0001–0010
    for (const view of VIEWS) {
      const run = async (role: string): Promise<'ok' | 'denied'> => {
        try {
          await admin.begin(async (tx) => {
            await tx.unsafe(`SET LOCAL ROLE ${role}`);
            await tx.unsafe(`SELECT 1 FROM ${view} LIMIT 1`);
          });
          return 'ok';
        } catch {
          return 'denied';
        }
      };
      expect(await run('gradtools_monitor'), `monitor ${view}`).toBe('ok');
      expect(await run('anon'), `anon ${view}`).toBe('denied');
      expect(await run('authenticated'), `authenticated ${view}`).toBe('denied');
    }
  });

  it('leaves student-table RLS enabled (0011 changes grants only)', async () => {
    const rows = await admin<{ relname: string }[]>`
      SELECT c.relname
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity
    `;
    expect(rows.map((r) => r.relname)).toEqual([]);
  });
});
