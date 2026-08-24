/**
 * Source and document gates, enforced by the DATABASE.
 *
 * Authority: docs/14 §14.3 · docs/17 §17.11 · M5 §10, §17, §21
 *
 * Every assertion here goes through a CHECK constraint. That is the whole
 * point: these tests prove the policy cannot be bypassed by any code path at
 * all, rather than proving that today's code happens to respect it. A policy
 * enforced in application code is enforced only until someone writes different
 * application code.
 */

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { loadConfig } from '../src/config.js';
import { createClient, type Sql } from '../src/db/client.js';
import { runMigrations } from '../src/db/migrate.js';
import { seed } from '../src/db/seed.js';
import { createApp } from '../src/http/app.js';
import { createLogger } from '../src/observability/logger.js';

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeDb = DATABASE_URL === undefined ? describe.skip : describe;

describeDb('M5 gates', () => {
  let sql: Sql;
  let app: Express;

  beforeAll(async () => {
    sql = createClient(DATABASE_URL as string);

    // The schema is prepared once in test/global-setup.ts. Migrations and seed
    // are idempotent, so every file can simply ensure its own preconditions.
    await runMigrations(sql);
    await seed(sql);
    app = createApp(
      loadConfig({ DATABASE_URL, NODE_ENV: 'test', APP_ENV: 'test' }),
      sql,
      createLogger('silent', false),
    );
  }, 60_000);

  afterAll(async () => {
    await sql.end();
  });

  /* ---------------------------------------------------------------------- */
  /* Source registry                                                        */
  /* ---------------------------------------------------------------------- */

  describe('source registry', () => {
    afterEach(async () => {
      await sql`DELETE FROM sources WHERE id LIKE 'test-%'`;
    });

    const now = () => new Date();

    async function insertSource(fields: Record<string, unknown> = {}) {
      return sql`
        INSERT INTO sources ${sql({
          id: 'test-src',
          kind: 'announcements',
          publisher: 'Test Publisher',
          canonical_url: 'https://example.org/',
          authority: 'official',
          ...fields,
        })}
      `;
    }

    /** Every gate open except the one under test. */
    const allGatesOpen = {
      enabled: true,
      access_method: 'http_fetch',
      robots_status: 'allowed',
      robots_checked_at: now(),
      terms_status: 'permitted',
      terms_reviewed_at: now(),
      verification: 'verified',
      verified_at: now(),
    };

    it('defaults a new source to disabled, unknown and unreachable', async () => {
      await insertSource();
      const [row] = await sql<
        { enabled: boolean; robots_status: string; terms_status: string; access_method: string }[]
      >`
        SELECT enabled, robots_status, terms_status, access_method
        FROM sources WHERE id = 'test-src'
      `;
      expect(row).toEqual({
        enabled: false,
        robots_status: 'unknown',
        terms_status: 'unknown',
        access_method: 'none',
      });
    });

    it('permits enabling only when every gate has passed', async () => {
      await insertSource(allGatesOpen);
      const [row] = await sql<{ enabled: boolean }[]>`
        SELECT enabled FROM sources WHERE id = 'test-src'
      `;
      expect(row?.enabled).toBe(true);
    });

    it.each([
      ['robots is unknown', { robots_status: 'unknown', robots_checked_at: null }],
      ['robots disallows', { robots_status: 'disallowed' }],
      ['terms are unknown', { terms_status: 'unknown', terms_reviewed_at: null }],
      ['terms are restricted', { terms_status: 'restricted' }],
      ['terms are prohibited', { terms_status: 'prohibited' }],
      ['the source is unverified', { verification: 'unverified' }],
      ['the source is a draft', { verification: 'draft', verified_at: null }],
      ['there is no access method', { access_method: 'none' }],
    ])('refuses to enable a source when %s', async (_label, override) => {
      await expect(insertSource({ ...allGatesOpen, ...override })).rejects.toThrow(
        /source_enable_requires_all_gates/,
      );
    });

    /*
     * The two gates are independent, at the database level. robots.txt allows
     * the path; the terms have never been read; the source is still refused.
     * This is precisely VTU's announcements situation.
     */
    it('refuses a robots-allowed source whose terms are unreviewed', async () => {
      await expect(
        insertSource({
          ...allGatesOpen,
          terms_status: 'unknown',
          terms_reviewed_at: null,
        }),
      ).rejects.toThrow(/source_enable_requires_all_gates/);
    });

    it('refuses a status asserted without the evidence date', async () => {
      await expect(insertSource({ robots_status: 'allowed' })).rejects.toThrow(
        /source_robots_status_needs_check/,
      );
      await expect(insertSource({ terms_status: 'permitted' })).rejects.toThrow(
        /source_terms_status_needs_review/,
      );
    });

    it('refuses a non-http canonical url', async () => {
      await expect(insertSource({ canonical_url: 'file:///etc/passwd' })).rejects.toThrow(
        /canonical_url/,
      );
    });

    it('refuses a poll interval below the conservative floor', async () => {
      await expect(insertSource({ poll_interval_seconds: 5 })).rejects.toThrow(
        /poll_interval_seconds/,
      );
    });
  });

  /* ---------------------------------------------------------------------- */
  /* The seeded VTU sources                                                 */
  /* ---------------------------------------------------------------------- */

  describe('seeded VTU sources are recorded and disabled', () => {
    it('serves both, and both are disabled', async () => {
      const res = await request(app).get('/api/v1/sources');
      expect(res.status).toBe(200);
      const sources = res.body.data as { id: string; enabled: boolean }[];
      expect(sources.map((s) => s.id)).toEqual(
        expect.arrayContaining(['vtu-announcements', 'vtu-results']),
      );
      for (const source of sources) {
        expect({ id: source.id, enabled: source.enabled }).toEqual({
          id: source.id,
          enabled: false,
        });
      }
    });

    /*
     * results.vtu.ac.in returns "Disallow: /", checked 2026-08-24. Recording it
     * as data means the constraint enforces the finding rather than a document
     * merely describing it.
     */
    it('records the results host as disallowed and prohibited', async () => {
      const res = await request(app).get('/api/v1/sources/vtu-results');
      expect(res.status).toBe(200);
      expect(res.body.robotsStatus).toBe('disallowed');
      expect(res.body.termsStatus).toBe('prohibited');
      expect(res.body.rightsStatus).toBe('prohibited');
      expect(res.body.accessMethod).toBe('none');
    });

    it('cannot be enabled, even by a direct update', async () => {
      await expect(sql`UPDATE sources SET enabled = true WHERE id = 'vtu-results'`).rejects.toThrow(
        /source_enable_requires_all_gates/,
      );
    });

    /*
     * The announcements host: robots ALLOWS the path, and it is still disabled,
     * because a crawl policy is not a licence to reuse content and its terms
     * have never been reviewed (OQ-006).
     */
    it('records announcements as robots-allowed, terms-unknown, still disabled', async () => {
      const res = await request(app).get('/api/v1/sources/vtu-announcements');
      expect(res.status).toBe(200);
      expect(res.body.robotsStatus).toBe('allowed');
      expect(res.body.termsStatus).toBe('unknown');
      expect(res.body.enabled).toBe(false);
      expect(res.body.accessMethod).toBe('none');
    });

    it('cannot be enabled while its terms are unreviewed', async () => {
      await expect(
        sql`
          UPDATE sources SET enabled = true, access_method = 'http_fetch'
          WHERE id = 'vtu-announcements'
        `,
      ).rejects.toThrow(/source_enable_requires_all_gates/);
    });

    it('says what was actually checked, rather than asserting a conclusion', async () => {
      const res = await request(app).get('/api/v1/sources/vtu-announcements');
      expect(res.body.robotsNote).toContain('robots.txt');
      expect(res.body.termsNote).toContain('OQ-006');
    });

    it('has no results adapter anywhere in the registry', async () => {
      const res = await request(app).get('/api/v1/sources');
      const results = (res.body.data as { kind: string; parserVersion: string | null }[]).filter(
        (s) => s.kind === 'results',
      );
      expect(results.length).toBeGreaterThan(0);
      for (const source of results) {
        expect(source.parserVersion).toBeNull();
      }
    });
  });

  /* ---------------------------------------------------------------------- */
  /* Document rights                                                        */
  /* ---------------------------------------------------------------------- */

  describe('document rights', () => {
    afterEach(async () => {
      await sql`DELETE FROM documents WHERE title LIKE 'TEST %'`;
    });

    const hash = (seedText: string) => seedText.padEnd(64, '0');

    const doc = (fields: Record<string, unknown>, seedText: string) => sql`
      INSERT INTO documents ${sql({
        title: 'TEST document',
        sha256: hash(seedText),
        byte_size: 1024,
        mime_type: 'application/pdf',
        ...fields,
      })}
    `;

    it('defaults to private, quarantined and rights-unknown', async () => {
      await doc({}, 'a1');
      const [row] = await sql<{ presentation: string; state: string; rights_status: string }[]>`
        SELECT presentation, state, rights_status FROM documents WHERE title = 'TEST document'
      `;
      expect(row).toEqual({
        presentation: 'private',
        state: 'quarantined',
        rights_status: 'unknown',
      });
    });

    /*
     * The heart of M5 §17. Unknown rights are not permission. While OQ-008 is
     * open that means no document at all can legitimately be hosted, and the
     * default of `private` makes an omission fail closed rather than open.
     */
    it.each([
      ['rights are unknown', {}, 'h1'],
      ['rights are prohibited', { rights_status: 'prohibited' }, 'h2'],
      ['rights are restricted', { rights_status: 'restricted' }, 'h3'],
      ['rights are permitted but undated', { rights_status: 'permitted' }, 'h4'],
    ])('refuses to host a document when %s', async (_label, override, seedText) => {
      await expect(doc({ presentation: 'host', ...override }, seedText)).rejects.toThrow(
        /document_host_requires_rights/,
      );
    });

    it('allows hosting with permitted rights and a determination date', async () => {
      await doc(
        {
          presentation: 'host',
          rights_status: 'permitted',
          rights_determined_at: new Date(),
          storage_key: `ab/cd/${'e'.repeat(64)}`,
        },
        'a5',
      );
      const [row] = await sql<{ presentation: string }[]>`
        SELECT presentation FROM documents WHERE title = 'TEST document'
      `;
      expect(row?.presentation).toBe('host');
    });

    /*
     * M5 §8. A student's own document is theirs. No combination of other fields
     * can make it public, because the row is refused.
     */
    it('refuses to present a user-private document as anything but private', async () => {
      await expect(
        doc(
          {
            rights_status: 'user_private',
            presentation: 'link',
            source_url: 'https://example.org/x',
          },
          'b1',
        ),
      ).rejects.toThrow(/document_user_private_stays_private/);
    });

    it('refuses to flip an existing private document to public', async () => {
      await doc({ rights_status: 'user_private', presentation: 'private' }, 'b3');
      await expect(
        sql`UPDATE documents SET presentation = 'host' WHERE title = 'TEST document'`,
      ).rejects.toThrow(/document_user_private_stays_private|document_host_requires_rights/);
    });

    it('refuses a link document with nothing to link to', async () => {
      await expect(doc({ presentation: 'link' }, 'c1')).rejects.toThrow(
        /document_link_requires_url/,
      );
    });

    /*
     * M5 §9: for a rights-unclear public document we hold metadata and point at
     * the original. Holding the FILE would be the redistribution that has not
     * been permitted, so the schema refuses to store bytes for a link.
     */
    it('refuses to store bytes for a link-only document', async () => {
      await expect(
        doc(
          {
            presentation: 'link',
            source_url: 'https://example.org/paper.pdf',
            storage_key: `ab/cd/${'f'.repeat(64)}`,
          },
          'c2',
        ),
      ).rejects.toThrow(/document_stored_only_when_held/);
    });

    it('allows a link document with a url and no stored bytes', async () => {
      await doc({ presentation: 'link', source_url: 'https://example.org/paper.pdf' }, 'c3');
      const [row] = await sql<{ presentation: string; storage_key: string | null }[]>`
        SELECT presentation, storage_key FROM documents WHERE title = 'TEST document'
      `;
      expect(row).toEqual({ presentation: 'link', storage_key: null });
    });

    it('refuses a rejected document with no reason', async () => {
      await expect(doc({ state: 'rejected' }, 'd1')).rejects.toThrow(
        /document_rejected_has_reason/,
      );
    });

    it('deduplicates by content hash', async () => {
      await doc({}, 'e1');
      await expect(doc({}, 'e1')).rejects.toThrow(/sha256/);
    });

    it('refuses an oversized document', async () => {
      await expect(doc({ byte_size: 20_971_521 }, 'e2')).rejects.toThrow(/byte_size/);
    });

    it('refuses an implausible page count', async () => {
      await expect(doc({ page_count: 501 }, 'e3')).rejects.toThrow(/page_count/);
    });
  });

  /* ---------------------------------------------------------------------- */
  /* Document API                                                           */
  /* ---------------------------------------------------------------------- */

  describe('documents API serves metadata only', () => {
    afterEach(async () => {
      await sql`DELETE FROM documents WHERE title LIKE 'TEST %'`;
    });

    it('never lists a private document', async () => {
      await sql`
        INSERT INTO documents (title, sha256, byte_size, mime_type, rights_status, presentation)
        VALUES ('TEST private paper', ${'f1'.padEnd(64, '0')}, 2048, 'application/pdf',
                'user_private', 'private')
      `;
      const res = await request(app).get('/api/v1/documents');
      expect(res.status).toBe(200);
      expect(
        (res.body.data as { title: string }[]).some((d) => d.title === 'TEST private paper'),
      ).toBe(false);
    });

    it('lists a link document with its original url', async () => {
      await sql`
        INSERT INTO documents (title, sha256, byte_size, mime_type, presentation, source_url, state)
        VALUES ('TEST linked paper', ${'f2'.padEnd(64, '0')}, 2048, 'application/pdf',
                'link', 'https://example.org/original.pdf', 'validated')
      `;
      const res = await request(app).get('/api/v1/documents');
      const found = (res.body.data as { title: string; sourceUrl: string }[]).find(
        (d) => d.title === 'TEST linked paper',
      );
      expect(found?.sourceUrl).toBe('https://example.org/original.pdf');
    });

    it('never exposes a storage key or a filesystem path', async () => {
      const res = await request(app).get('/api/v1/documents');
      const body = JSON.stringify(res.body);
      expect(body).not.toMatch(/storage_key|storageKey/);
      expect(body).not.toMatch(/[A-Za-z]:\\|\/var\/|\/home\//);
    });

    it('exposes no route that serves a document file', async () => {
      await sql`
        INSERT INTO documents (title, sha256, byte_size, mime_type, presentation, source_url, state)
        VALUES ('TEST linked paper', ${'f3'.padEnd(64, '0')}, 2048, 'application/pdf',
                'link', 'https://example.org/original.pdf', 'validated')
      `;
      const [row] = await sql<{ id: string }[]>`
        SELECT id::text FROM documents WHERE title = 'TEST linked paper'
      `;
      for (const suffix of ['/file', '/download', '/content', '/raw']) {
        const res = await request(app).get(`/api/v1/documents/${String(row?.id)}${suffix}`);
        expect(res.status).toBe(404);
      }
    });
  });

  /* ---------------------------------------------------------------------- */
  /* Change records                                                         */
  /* ---------------------------------------------------------------------- */

  describe('source change records', () => {
    afterEach(async () => {
      await sql`DELETE FROM source_changes WHERE external_id LIKE 'test-%'`;
    });

    const change = (fields: Record<string, unknown> = {}) => sql`
      INSERT INTO source_changes ${sql({
        source_id: 'vtu-announcements',
        external_id: 'test-item',
        change_type: 'new',
        payload_hash: 'ab'.repeat(32),
        parser_version: 'vtu-ann-v1',
        ...fields,
      })}
    `;

    it('records a change', async () => {
      await change();
      const [row] = await sql<{ change_type: string }[]>`
        SELECT change_type FROM source_changes WHERE external_id = 'test-item'
      `;
      expect(row?.change_type).toBe('new');
    });

    /*
     * Without this, an unchanged page re-detected on every poll would append a
     * row each time and turn the change log into noise.
     */
    it('refuses to record the same change twice', async () => {
      await change();
      await expect(change()).rejects.toThrow(/source_changes_dedupe/);
    });

    it('allows the same item at a different hash, which is a real modification', async () => {
      await change();
      await change({ change_type: 'modified', payload_hash: 'cd'.repeat(32) });
      const rows = await sql`SELECT 1 FROM source_changes WHERE external_id = 'test-item'`;
      expect(rows.length).toBe(2);
    });

    it('requires a real source', async () => {
      await expect(change({ source_id: 'no-such-source' })).rejects.toThrow(
        /foreign key|violates/i,
      );
    });

    it('refuses a malformed payload hash', async () => {
      await expect(change({ payload_hash: 'not-a-hash' })).rejects.toThrow(/payload_hash/);
    });

    /* Detection only. Nothing here sends anything (M5 §14). */
    it('has no delivery or notification column', async () => {
      const rows = await sql<{ column_name: string }[]>`
        SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'source_changes'
      `;
      const columns = rows.map((r) => r.column_name);
      for (const absent of ['notified_at', 'delivered_at', 'recipient', 'sent']) {
        expect(columns).not.toContain(absent);
      }
    });
  });

  /* ---------------------------------------------------------------------- */
  /* Stage 1 privacy still holds                                            */
  /* ---------------------------------------------------------------------- */

  it('still has no student table after adding sources and documents', async () => {
    const rows = await sql<{ table_name: string }[]>`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    `;
    const tables = rows.map((r) => r.table_name);
    for (const forbidden of [
      'students',
      'student_profiles',
      'attendance_records',
      'semester_records',
      'timetable_slots',
      'sessions',
      'users',
      'accounts',
    ]) {
      expect(tables).not.toContain(forbidden);
    }
  });

  it('documents carry no uploader identity column', async () => {
    const rows = await sql<{ column_name: string }[]>`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'documents'
    `;
    const columns = rows.map((r) => r.column_name);
    for (const forbidden of ['user_id', 'auth_user_id', 'student_id', 'uploader_email', 'usn']) {
      expect(columns).not.toContain(forbidden);
    }
  });
});
