/**
 * The private document workflow, end to end, against real PostgreSQL.
 *
 * Authority: docs/17 §17.1 · docs/12 · M5A §1, §7, §8, §18, §19
 *
 *   import -> QUARANTINE -> validate -> store -> extract -> sections
 *
 * Everything here goes through the real ingestion code and a real database.
 * The object store is in-memory, which is the one substitution: it implements
 * the same interface, and using it means these tests do not litter a developer's
 * disk with fixtures.
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
import { MemoryObjectStore, storageKeyFor } from '../src/documents/storage.js';
import { importDocument, processDocument } from '../src/documents/ingest.js';
import {
  activeContentPdf,
  decompressionBombPdf,
  notAPdf,
  scannedPdf,
  validPdf,
} from './fixtures/pdfs.js';

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeDb = DATABASE_URL === undefined ? describe.skip : describe;

describeDb('private document workflow', () => {
  let sql: Sql;
  let app: Express;
  let store: MemoryObjectStore;

  beforeAll(async () => {
    sql = createClient(DATABASE_URL as string);
    await runMigrations(sql);
    await seed(sql);
    store = new MemoryObjectStore();
    app = createApp(
      loadConfig({ DATABASE_URL, NODE_ENV: 'test', APP_ENV: 'test' }),
      sql,
      createLogger('silent', false),
      store,
    );
  }, 60_000);

  afterAll(async () => {
    await sql.end();
  });

  afterEach(async () => {
    await sql`DELETE FROM documents WHERE original_filename LIKE 'wf-%'`;
  });

  const importPdf = (bytes: Buffer, filename: string) =>
    importDocument(sql, store, { bytes, filename });

  /* ---------------------------------------------------------------------- */
  /* The happy path                                                         */
  /* ---------------------------------------------------------------------- */

  describe('import -> validate -> extract -> sections', () => {
    it('carries a real document through the whole lifecycle', async () => {
      const bytes = validPdf({ pages: 3, text: 'ANALYSIS AND DESIGN OF ALGORITHMS' });
      const outcome = await importPdf(bytes, 'wf-paper.pdf');
      expect(outcome.kind).toBe('imported');
      if (outcome.kind !== 'imported') return;

      // Validated, stored, and PRIVATE — never anything else on arrival.
      const [afterImport] = await sql<
        {
          state: string;
          presentation: string;
          rights_status: string;
          storage_key: string;
          page_count: number;
        }[]
      >`
        SELECT state, presentation, rights_status, storage_key, page_count
        FROM documents WHERE id = ${outcome.id}::uuid
      `;
      expect(afterImport?.state).toBe('validated');
      expect(afterImport?.presentation).toBe('private');
      expect(afterImport?.rights_status).toBe('user_private');
      expect(afterImport?.page_count).toBe(3);

      // Bytes went to the object store, keyed by content hash.
      expect(afterImport?.storage_key).toBe(storageKeyFor(outcome.sha256));
      expect(await store.exists(storageKeyFor(outcome.sha256))).toBe(true);

      const processed = await processDocument(sql, store, outcome.id);
      expect(processed?.extractionStatus).toBe('text_available');
      expect(processed?.sectionCount).toBeGreaterThan(0);

      const sections = await sql<{ page_number: number; content: string }[]>`
        SELECT page_number, content FROM document_sections
        WHERE document_id = ${outcome.id}::uuid ORDER BY page_number, ordinal
      `;
      expect(sections.length).toBe(processed?.sectionCount);
      expect(sections.some((s) => s.content.includes('ALGORITHMS'))).toBe(true);
      expect(new Set(sections.map((s) => s.page_number)).size).toBe(3);
    }, 40_000);

    it('is idempotent: reprocessing replaces sections rather than doubling them', async () => {
      const outcome = await importPdf(validPdf({ pages: 2 }), 'wf-idem.pdf');
      if (outcome.kind !== 'imported') return;

      const first = await processDocument(sql, store, outcome.id);
      const second = await processDocument(sql, store, outcome.id);
      expect(second?.sectionCount).toBe(first?.sectionCount);

      const [{ count } = { count: '0' }] = await sql<{ count: string }[]>`
        SELECT count(*)::text FROM document_sections WHERE document_id = ${outcome.id}::uuid
      `;
      expect(Number(count)).toBe(first?.sectionCount);
    }, 40_000);

    it('records ocr_required without OCR-ing, and stores no sections', async () => {
      const outcome = await importPdf(scannedPdf(), 'wf-scan.pdf');
      if (outcome.kind !== 'imported') return;

      const processed = await processDocument(sql, store, outcome.id);
      expect(processed?.extractionStatus).toBe('ocr_required');
      expect(processed?.sectionCount).toBe(0);

      const [{ count } = { count: '0' }] = await sql<{ count: string }[]>`
        SELECT count(*)::text FROM document_sections WHERE document_id = ${outcome.id}::uuid
      `;
      expect(Number(count)).toBe(0);
    }, 40_000);
  });

  /* ---------------------------------------------------------------------- */
  /* Quarantine                                                             */
  /* ---------------------------------------------------------------------- */

  describe('quarantine', () => {
    /*
     * The property that makes rejection auditable without keeping what was
     * rejected: the row records the attempt, the bytes are never stored.
     */
    it.each([
      ['a non-PDF', notAPdf(), 'not_a_pdf'],
      ['a decompression bomb', decompressionBombPdf(), 'decompression_bomb'],
      ['embedded active content', activeContentPdf(), 'active_content'],
    ])('rejects %s, records why, and stores no bytes', async (_label, bytes, code) => {
      const outcome = await importPdf(bytes, 'wf-hostile.pdf');
      expect(outcome.kind).toBe('rejected');
      if (outcome.kind !== 'rejected') return;
      expect(outcome.code).toBe(code);

      const [row] = await sql<
        { state: string; storage_key: string | null; rejection_reason: string }[]
      >`
        SELECT state, storage_key, rejection_reason FROM documents WHERE id = ${outcome.id}::uuid
      `;
      expect(row?.state).toBe('rejected');
      expect(row?.storage_key).toBeNull();
      expect(row?.rejection_reason?.length).toBeGreaterThan(0);
      expect(await store.exists(storageKeyFor(outcome.sha256))).toBe(false);
    });

    it('refuses to extract from a document that has not passed validation', async () => {
      await sql`
        INSERT INTO documents (title, sha256, byte_size, mime_type, original_filename, state)
        VALUES ('wf quarantined', ${'ab'.repeat(32)}, 1024, 'application/pdf',
                'wf-q.pdf', 'quarantined')
      `;
      const [row] = await sql<{ id: string }[]>`
        SELECT id::text FROM documents WHERE original_filename = 'wf-q.pdf'
      `;
      await expect(processDocument(sql, store, String(row?.id))).rejects.toThrow(
        /quarantined|has not passed validation/,
      );
    });

    it('returns null rather than throwing for a document that does not exist', async () => {
      expect(await processDocument(sql, store, '00000000-0000-0000-0000-000000000000')).toBeNull();
    });
  });

  /* ---------------------------------------------------------------------- */
  /* Duplicates                                                             */
  /* ---------------------------------------------------------------------- */

  describe('duplicates', () => {
    it('recognises the same bytes and does not create a second document', async () => {
      const bytes = validPdf({
        text: 'DUPLICATE TEST WITH ENOUGH TEXT TO COUNT AS A REAL TEXT LAYER',
      });
      const first = await importPdf(bytes, 'wf-dupe-a.pdf');
      const second = await importPdf(Buffer.from(bytes), 'wf-dupe-b.pdf');

      expect(second.kind).toBe('duplicate');
      expect(second.id).toBe(first.id);

      const [{ count } = { count: '0' }] = await sql<{ count: string }[]>`
        SELECT count(*)::text FROM documents WHERE sha256 = ${first.sha256}
      `;
      expect(Number(count)).toBe(1);
    });

    /*
     * A re-import must never reset a document that has already been processed
     * or reviewed. Content-addressing makes it a no-op rather than a rewrite.
     */
    it('does not reset the state of an already-processed document', async () => {
      const bytes = validPdf({
        text: 'REPROCESS GUARD WITH ENOUGH TEXT TO COUNT AS A REAL TEXT LAYER',
      });
      const first = await importPdf(bytes, 'wf-dupe-c.pdf');
      if (first.kind !== 'imported') return;
      await processDocument(sql, store, first.id);

      await importPdf(Buffer.from(bytes), 'wf-dupe-d.pdf');

      const [row] = await sql<{ state: string }[]>`
        SELECT state FROM documents WHERE id = ${first.id}::uuid
      `;
      expect(row?.state).toBe('extracted');
    }, 40_000);
  });

  /* ---------------------------------------------------------------------- */
  /* Privacy — the property M5A exists to establish                         */
  /* ---------------------------------------------------------------------- */

  describe('an imported document is private and stays private', () => {
    it('never appears in the public listing', async () => {
      const outcome = await importPdf(
        validPdf({ text: 'PRIVATE ONE WITH ENOUGH TEXT TO COUNT AS A REAL TEXT LAYER' }),
        'wf-priv.pdf',
      );
      if (outcome.kind !== 'imported') return;

      const publicList = await request(app).get('/api/v1/documents');
      expect((publicList.body.data as { id: string }[]).some((d) => d.id === outcome.id)).toBe(
        false,
      );

      const direct = await request(app).get(`/api/v1/documents/${outcome.id}`);
      expect(direct.status).toBe(404);
    });

    it('does appear in the operator private listing', async () => {
      const outcome = await importPdf(
        validPdf({ text: 'PRIVATE TWO WITH ENOUGH TEXT TO COUNT AS A REAL TEXT LAYER' }),
        'wf-priv2.pdf',
      );
      if (outcome.kind !== 'imported') return;

      const res = await request(app).get('/api/v1/documents/private');
      expect(res.status).toBe(200);
      expect((res.body.data as { id: string }[]).some((d) => d.id === outcome.id)).toBe(true);
    });

    it.each(['host', 'link'])('cannot be turned into a %s document by update', async (mode) => {
      const outcome = await importPdf(
        validPdf({ text: `NO PUBLISH ${mode} WITH ENOUGH TEXT TO COUNT AS A TEXT LAYER` }),
        `wf-nopub-${mode}.pdf`,
      );
      if (outcome.kind !== 'imported') return;

      /*
       * Deliberately does NOT touch rights_status. The claim under test is that
       * a user's own document cannot be published; an update that also rewrote
       * the rights would be testing a different document.
       *
       * SEVERAL constraints refuse this, not one, and which fires first depends
       * on the mode:
       *   host -> document_host_requires_rights (no rights determination)
       *   link -> document_stored_only_when_held (we hold the bytes)
       *   both -> document_user_private_stays_private
       * The assertion accepts any of them, because the claim is that publishing
       * is impossible, not that one particular check catches it. Being refused
       * by more than one independent rule is the stronger result.
       */
      await expect(
        sql`
          UPDATE documents
             SET presentation = ${mode}, source_url = 'https://example.org/x'
           WHERE id = ${outcome.id}::uuid
        `,
      ).rejects.toThrow(
        /document_user_private_stays_private|document_host_requires_rights|document_stored_only_when_held/,
      );
    });

    it('survives a reprocess still private', async () => {
      const outcome = await importPdf(
        validPdf({ text: 'STILL PRIVATE WITH ENOUGH TEXT TO COUNT AS A REAL TEXT LAYER' }),
        'wf-priv3.pdf',
      );
      if (outcome.kind !== 'imported') return;
      await processDocument(sql, store, outcome.id);

      const [row] = await sql<{ presentation: string; rights_status: string }[]>`
        SELECT presentation, rights_status FROM documents WHERE id = ${outcome.id}::uuid
      `;
      expect(row).toEqual({ presentation: 'private', rights_status: 'user_private' });
    }, 40_000);
  });

  /* ---------------------------------------------------------------------- */
  /* The HTTP surface                                                       */
  /* ---------------------------------------------------------------------- */

  describe('import endpoint', () => {
    const post = (bytes: Buffer, filename = 'wf-http.pdf') =>
      request(app)
        .post('/api/v1/documents/import')
        .set('Content-Type', 'application/pdf')
        .set('X-Document-Filename', filename)
        .send(bytes);

    it('imports a document and reports the outcome', async () => {
      const res = await post(
        validPdf({ text: 'OVER HTTP WITH ENOUGH TEXT TO COUNT AS A REAL TEXT LAYER' }),
      );
      expect(res.status).toBe(201);
      expect(res.body.kind).toBe('imported');
      expect(res.body.sha256).toMatch(/^[0-9a-f]{64}$/);
    });

    /* A rejection is a recorded outcome, not a server error. */
    it('returns 201 and a verdict for a rejected document', async () => {
      const res = await post(notAPdf());
      expect(res.status).toBe(201);
      expect(res.body.kind).toBe('rejected');
      expect(res.body.code).toBe('not_a_pdf');
    });

    it('returns 200 for a duplicate', async () => {
      const bytes = validPdf({ text: 'HTTP DUPE WITH ENOUGH TEXT TO COUNT AS A REAL TEXT LAYER' });
      await post(bytes, 'wf-http-a.pdf');
      const res = await post(bytes, 'wf-http-b.pdf');
      expect(res.status).toBe(200);
      expect(res.body.kind).toBe('duplicate');
    });

    it('rejects an empty body', async () => {
      const res = await request(app)
        .post('/api/v1/documents/import')
        .set('Content-Type', 'application/pdf')
        .send(Buffer.alloc(0));
      expect(res.status).toBe(400);
    });

    /*
     * The endpoint takes BYTES. There is no URL parameter, so it cannot be
     * turned into a fetcher by any input (M5A §4). This asserts the shape
     * rather than the behaviour: a URL in the body is just bytes, and bytes
     * that are not a PDF are rejected.
     */
    it('cannot be made to fetch a URL', async () => {
      const res = await request(app)
        .post('/api/v1/documents/import')
        .set('Content-Type', 'application/pdf')
        .send(Buffer.from('http://169.254.169.254/latest/meta-data/', 'utf8'));
      expect(res.status).toBe(201);
      expect(res.body.kind).toBe('rejected');
      expect(res.body.code).toBe('not_a_pdf');
    });

    it('sanitises a traversal filename rather than using it as a path', async () => {
      const res = await post(
        validPdf({ text: 'TRAVERSAL WITH ENOUGH TEXT TO COUNT AS A REAL TEXT LAYER' }),
        '../../../etc/wf-passwd.pdf',
      );
      expect(res.status).toBe(201);

      const [row] = await sql<{ original_filename: string }[]>`
        SELECT original_filename FROM documents WHERE id = ${res.body.id}::uuid
      `;
      expect(row?.original_filename).toBe('wf-passwd.pdf');
      expect(row?.original_filename).not.toContain('..');
    });

    it('never returns a storage key or filesystem path', async () => {
      const res = await post(
        validPdf({ text: 'NO PATHS WITH ENOUGH TEXT TO COUNT AS A REAL TEXT LAYER' }),
      );
      const body = JSON.stringify(res.body);
      expect(body).not.toMatch(/storage_key|storageKey/);
      expect(body).not.toMatch(/[A-Za-z]:\\|\/var\/|\/home\//);
    });

    it('exposes no file-serving route for an imported document', async () => {
      const outcome = await importPdf(
        validPdf({ text: 'NO SERVE WITH ENOUGH TEXT TO COUNT AS A REAL TEXT LAYER' }),
        'wf-noserve.pdf',
      );
      for (const suffix of ['/file', '/download', '/content', '/raw']) {
        const res = await request(app).get(`/api/v1/documents/${outcome.id}${suffix}`);
        expect(res.status).toBe(404);
      }
    });
  });

  describe('process and sections endpoints', () => {
    it('processes a document and serves its sections', async () => {
      const outcome = await importPdf(
        validPdf({ pages: 2, text: 'SECTIONS TEST WITH ENOUGH TEXT TO COUNT AS A TEXT LAYER' }),
        'wf-sec.pdf',
      );
      if (outcome.kind !== 'imported') return;

      const processed = await request(app).post(`/api/v1/documents/${outcome.id}/process`);
      expect(processed.status).toBe(200);
      expect(processed.body.extractionStatus).toBe('text_available');

      const sections = await request(app).get(`/api/v1/documents/${outcome.id}/sections`);
      expect(sections.status).toBe(200);
      expect((sections.body.data as unknown[]).length).toBeGreaterThan(0);
      const first = (sections.body.data as { pageNumber: number; extractorVersion: string }[])[0];
      expect(first?.pageNumber).toBe(1);
      expect(first?.extractorVersion).toBe('pdftotext-v1');
    }, 40_000);

    it('marks private responses no-store', async () => {
      const outcome = await importPdf(
        validPdf({ text: 'NO STORE WITH ENOUGH TEXT TO COUNT AS A REAL TEXT LAYER' }),
        'wf-nostore.pdf',
      );
      const res = await request(app).get(`/api/v1/documents/${outcome.id}/sections`);
      expect(res.headers['cache-control']).toContain('no-store');
    });

    it('404s sections for a document that does not exist', async () => {
      const res = await request(app).get(
        '/api/v1/documents/00000000-0000-0000-0000-000000000000/sections',
      );
      expect(res.status).toBe(404);
    });

    it('rejects a malformed document id', async () => {
      const res = await request(app).get('/api/v1/documents/not-a-uuid/sections');
      expect(res.status).toBe(400);
    });

    it('reports a client error, not a server error, for an unprocessable document', async () => {
      await sql`
        INSERT INTO documents (title, sha256, byte_size, mime_type, original_filename, state)
        VALUES ('wf q2', ${'cd'.repeat(32)}, 1024, 'application/pdf', 'wf-q2.pdf', 'quarantined')
      `;
      const [row] = await sql<{ id: string }[]>`
        SELECT id::text FROM documents WHERE original_filename = 'wf-q2.pdf'
      `;
      const res = await request(app).post(`/api/v1/documents/${String(row?.id)}/process`);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_FAILED');
    });
  });
});
