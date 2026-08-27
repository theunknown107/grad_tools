/**
 * Job queue and OCR worker, against real PostgreSQL.
 *
 * Authority: docs/09 §9.7 · docs/17 §17.15 · M5A.3 §16, §19
 *
 * The claim path is the reason these tests need a real database: `FOR UPDATE
 * SKIP LOCKED` is the entire concurrency guarantee, and no mock reproduces it.
 * Two workers competing for one job is tested by actually running two claims
 * against Postgres.
 *
 * OCR itself is stubbed in the worker tests. Running Tesseract here would make
 * the suite depend on a machine's installed binaries and add seconds per test;
 * the OCR engine is qualified by measurement (docs/17 §17.11d), and what these
 * tests own is the LIFECYCLE around it.
 */

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { loadConfig } from '../src/config.js';
import { createClient, type Sql } from '../src/db/client.js';
import { runMigrations } from '../src/db/migrate.js';
import { seed } from '../src/db/seed.js';
import { createApp } from '../src/http/app.js';
import { createLogger } from '../src/observability/logger.js';
import { MemoryObjectStore } from '../src/documents/storage.js';
import { importDocument } from '../src/documents/ingest.js';
import * as queue from '../src/jobs/queue.js';
import { runOneJob, recoverStalled } from '../src/jobs/ocr-worker.js';
import * as ocr from '../src/documents/ocr.js';
import { scannedPdf, validPdf } from './fixtures/pdfs.js';

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeDb = DATABASE_URL === undefined ? describe.skip : describe;

describeDb('OCR jobs', () => {
  let sql: Sql;
  let app: Express;
  let store: MemoryObjectStore;
  const logger = createLogger('silent', false);

  beforeAll(async () => {
    sql = createClient(DATABASE_URL as string);
    await runMigrations(sql);
    await seed(sql);
    store = new MemoryObjectStore();
    app = createApp(
      loadConfig({ DATABASE_URL, NODE_ENV: 'test', APP_ENV: 'test' }),
      sql,
      logger,
      store,
    );
  }, 60_000);

  afterAll(async () => {
    await sql.end();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await sql`DELETE FROM documents WHERE original_filename LIKE 'job-%'`;
  });

  /** Imports a scan and marks it as needing OCR, which is where a real one lands. */
  async function scanNeedingOcr(name: string): Promise<string> {
    const outcome = await importDocument(sql, store, {
      bytes: scannedPdf(),
      filename: `job-${name}.pdf`,
    });
    if (outcome.kind !== 'imported') throw new Error('fixture import failed');
    await sql`
      UPDATE documents SET extraction_status = 'ocr_required' WHERE id = ${outcome.id}::uuid
    `;
    return outcome.id;
  }

  const deps = (workerId: string) => ({ sql, store, logger, workerId });

  /* ---------------------------------------------------------------------- */
  /* Queue                                                                  */
  /* ---------------------------------------------------------------------- */

  describe('queue', () => {
    it('enqueues a job', async () => {
      const id = await scanNeedingOcr('enq');
      const { job, alreadyQueued } = await queue.enqueue(sql, 'ocr', id);
      expect(alreadyQueued).toBe(false);
      expect(job?.status).toBe('queued');
      expect(job?.attempts).toBe(0);
    });

    /*
     * Idempotence at the DATABASE, not in a check-then-insert: two concurrent
     * requests would race past an application-level check into two jobs, and
     * each job is seconds of work.
     */
    it('is idempotent: a second enqueue creates nothing', async () => {
      const id = await scanNeedingOcr('idem');
      const first = await queue.enqueue(sql, 'ocr', id);
      const second = await queue.enqueue(sql, 'ocr', id);

      expect(second.alreadyQueued).toBe(true);
      expect(second.job?.id).toBe(first.job?.id);

      const [{ count } = { count: '0' }] = await sql<{ count: string }[]>`
        SELECT count(*)::text FROM jobs WHERE document_id = ${id}::uuid
      `;
      expect(Number(count)).toBe(1);
    });

    it('survives concurrent enqueues without creating duplicates', async () => {
      const id = await scanNeedingOcr('race');
      await Promise.all(Array.from({ length: 5 }, () => queue.enqueue(sql, 'ocr', id)));

      const [{ count } = { count: '0' }] = await sql<{ count: string }[]>`
        SELECT count(*)::text FROM jobs WHERE document_id = ${id}::uuid
      `;
      expect(Number(count)).toBe(1);
    });

    it('claims a queued job and marks it processing', async () => {
      const id = await scanNeedingOcr('claim');
      await queue.enqueue(sql, 'ocr', id);

      const job = await queue.claim(sql, 'ocr', 'worker-a');
      expect(job?.status).toBe('processing');
      expect(job?.attempts).toBe(1);
    });

    /*
     * THE concurrency guarantee. Two workers, one job: exactly one wins, and
     * the loser gets null rather than blocking. This is what SKIP LOCKED buys
     * and why no broker is needed.
     */
    it('never hands the same job to two workers', async () => {
      const id = await scanNeedingOcr('concurrent');
      await queue.enqueue(sql, 'ocr', id);

      const [a, b] = await Promise.all([
        queue.claim(sql, 'ocr', 'worker-a'),
        queue.claim(sql, 'ocr', 'worker-b'),
      ]);

      const claimed = [a, b].filter((job) => job !== null);
      expect(claimed).toHaveLength(1);
    });

    it('returns null when the queue is empty', async () => {
      await sql`DELETE FROM jobs`;
      expect(await queue.claim(sql, 'ocr', 'worker-idle')).toBeNull();
    });

    it('retries a failed job with backoff, then gives up', async () => {
      const id = await scanNeedingOcr('retry');
      const { job } = await queue.enqueue(sql, 'ocr', id);
      const jobId = String(job?.id);

      // Attempts 1 and 2 retry; the third exhausts max_attempts.
      for (const expected of ['retry', 'retry', 'failed'] as const) {
        await queue.claim(sql, 'ocr', 'worker-a');
        expect(await queue.fail(sql, jobId, 'boom')).toBe(expected);
        if (expected === 'retry') {
          await sql`UPDATE jobs SET run_after = now() WHERE id = ${jobId}::uuid`;
        }
      }

      const [row] = await sql<{ status: string; error: string }[]>`
        SELECT status, error FROM jobs WHERE id = ${jobId}::uuid
      `;
      expect(row?.status).toBe('failed');
      expect(row?.error).toBe('boom');
    });

    it('holds a retried job until its backoff has elapsed', async () => {
      const id = await scanNeedingOcr('backoff');
      const { job } = await queue.enqueue(sql, 'ocr', id);
      await queue.claim(sql, 'ocr', 'worker-a');
      await queue.fail(sql, String(job?.id), 'boom');

      // Still queued, but not yet runnable.
      expect(await queue.claim(sql, 'ocr', 'worker-b')).toBeNull();
    });

    it('grows the backoff with each attempt', () => {
      expect(queue.retryDelayMs(2)).toBeGreaterThan(queue.retryDelayMs(1));
      expect(queue.retryDelayMs(99)).toBeLessThanOrEqual(15 * 60_000);
    });

    /*
     * A worker killed mid-job leaves its row `processing` forever, and the
     * partial unique index would then block the document from ever retrying.
     */
    it('returns an abandoned job to the queue', async () => {
      const id = await scanNeedingOcr('stalled');
      await queue.enqueue(sql, 'ocr', id);
      await queue.claim(sql, 'ocr', 'worker-dead');
      await sql`
        UPDATE jobs SET started_at = now() - interval '2 hours'
         WHERE document_id = ${id}::uuid
      `;

      expect(await recoverStalled(deps('worker-b'))).toBeGreaterThan(0);
      expect(await queue.claim(sql, 'ocr', 'worker-b')).not.toBeNull();
    });

    it('allows a fresh job once an earlier one completed', async () => {
      const id = await scanNeedingOcr('again');
      const first = await queue.enqueue(sql, 'ocr', id);
      await queue.complete(sql, String(first.job?.id));

      const second = await queue.enqueue(sql, 'ocr', id);
      expect(second.alreadyQueued).toBe(false);
      expect(second.job?.id).not.toBe(first.job?.id);
    });
  });

  /* ---------------------------------------------------------------------- */
  /* Worker                                                                 */
  /* ---------------------------------------------------------------------- */

  describe('worker', () => {
    /** Stubs the OCR engine so the test owns the lifecycle, not Tesseract. */
    function stubOcr(overrides: Partial<ocr.OcrResult> = {}) {
      vi.spyOn(ocr, 'runOcr').mockResolvedValue({
        ok: true,
        pages: [{ pageNumber: 1, text: 'Module-1 Explain normalization.' }],
        text: 'Module-1 Explain normalization.\n\nQ.1 a. Discuss anomalies.',
        format: 'descriptive',
        config: { languages: 'eng', psm: 3, dpi: 150, needsReview: false, reviewReason: null },
        engine: 'tesseract',
        engineVersion: 'tesseract 5.5.3',
        durationMs: 1234,
        charCount: 55,
        needsReview: false,
        reviewReason: null,
        extractorVersion: 'tesseract-v1',
        ...overrides,
      });
    }

    it('processes a job end to end and records the metadata', async () => {
      const id = await scanNeedingOcr('work');
      await queue.enqueue(sql, 'ocr', id);
      stubOcr();

      const outcome = await runOneJob(deps('worker-a'));
      expect(outcome?.result).toBe('completed');

      const [doc] = await sql<
        {
          state: string;
          extraction_status: string;
          paper_format: string;
          ocr_engine: string;
          ocr_languages: string;
          ocr_psm: number;
          ocr_dpi: number;
          needs_review: boolean;
        }[]
      >`
        SELECT state, extraction_status, paper_format, ocr_engine, ocr_languages,
               ocr_psm, ocr_dpi, needs_review
        FROM documents WHERE id = ${id}::uuid
      `;
      expect(doc?.state).toBe('extracted');
      expect(doc?.extraction_status).toBe('ocr_extracted');
      expect(doc?.paper_format).toBe('descriptive');
      expect(doc?.ocr_engine).toBe('tesseract');
      expect(doc?.ocr_languages).toBe('eng');
      expect(doc?.ocr_psm).toBe(3);
      expect(doc?.ocr_dpi).toBe(150);
      expect(doc?.needs_review).toBe(false);

      const sections = await sql`
        SELECT 1 FROM document_sections WHERE document_id = ${id}::uuid
      `;
      expect(sections.length).toBeGreaterThan(0);

      const [job] = await sql<{ status: string }[]>`
        SELECT status FROM jobs WHERE document_id = ${id}::uuid
      `;
      expect(job?.status).toBe('completed');
    });

    it('flags an unknown format for review rather than presenting it as clean', async () => {
      const id = await scanNeedingOcr('unknown');
      await queue.enqueue(sql, 'ocr', id);
      stubOcr({
        format: 'unknown',
        needsReview: true,
        reviewReason: 'The paper format could not be identified.',
        config: { languages: 'eng', psm: 3, dpi: 150, needsReview: true, reviewReason: 'x' },
      });

      await runOneJob(deps('worker-a'));
      const [doc] = await sql<
        { extraction_status: string; needs_review: boolean; review_reason: string }[]
      >`
        SELECT extraction_status, needs_review, review_reason
        FROM documents WHERE id = ${id}::uuid
      `;
      expect(doc?.extraction_status).toBe('ocr_needs_review');
      expect(doc?.needs_review).toBe(true);
      expect(doc?.review_reason?.length).toBeGreaterThan(0);
    });

    it('is idempotent: re-running replaces sections rather than doubling them', async () => {
      const id = await scanNeedingOcr('idem2');
      await queue.enqueue(sql, 'ocr', id);
      stubOcr();
      await runOneJob(deps('worker-a'));

      const countSections = async () => {
        const [{ count } = { count: '0' }] = await sql<{ count: string }[]>`
          SELECT count(*)::text FROM document_sections WHERE document_id = ${id}::uuid
        `;
        return Number(count);
      };
      const first = await countSections();

      await sql`UPDATE documents SET extraction_status = 'ocr_required' WHERE id = ${id}::uuid`;
      await queue.enqueue(sql, 'ocr', id);
      stubOcr();
      await runOneJob(deps('worker-a'));

      expect(await countSections()).toBe(first);
    });

    /* A document is never silently discarded, however OCR fails. */
    it('retries a failing job and leaves the document explicable', async () => {
      const id = await scanNeedingOcr('fail');
      await queue.enqueue(sql, 'ocr', id);
      vi.spyOn(ocr, 'runOcr').mockRejectedValue(new Error('engine exploded'));

      const outcome = await runOneJob(deps('worker-a'));
      expect(outcome?.result).toBe('retry');

      const [doc] = await sql<{ extraction_status: string }[]>`
        SELECT extraction_status FROM documents WHERE id = ${id}::uuid
      `;
      expect(doc?.extraction_status).toBe('ocr_queued');
    });

    it('marks the document for review once attempts are exhausted', async () => {
      const id = await scanNeedingOcr('exhaust');
      const { job } = await queue.enqueue(sql, 'ocr', id);
      await sql`UPDATE jobs SET attempts = 2 WHERE id = ${String(job?.id)}::uuid`;
      vi.spyOn(ocr, 'runOcr').mockRejectedValue(new Error('engine exploded'));

      const outcome = await runOneJob(deps('worker-a'));
      expect(outcome?.result).toBe('failed');

      const [doc] = await sql<
        { extraction_status: string; needs_review: boolean; review_reason: string }[]
      >`
        SELECT extraction_status, needs_review, review_reason
        FROM documents WHERE id = ${id}::uuid
      `;
      expect(doc?.extraction_status).toBe('ocr_needs_review');
      expect(doc?.needs_review).toBe(true);
      expect(doc?.review_reason).toMatch(/could not be read/i);
    });

    it('returns null when there is nothing to do', async () => {
      await sql`DELETE FROM jobs`;
      expect(await runOneJob(deps('worker-idle'))).toBeNull();
    });
  });

  /* ---------------------------------------------------------------------- */
  /* HTTP surface                                                           */
  /* ---------------------------------------------------------------------- */

  describe('ocr endpoint', () => {
    it('accepts a document that needs OCR and returns immediately', async () => {
      const id = await scanNeedingOcr('http');
      const res = await request(app).post(`/api/v1/documents/${id}/ocr`);

      expect(res.status).toBe(202);
      expect(res.body.jobId).toMatch(/^[0-9a-f-]{36}$/);
      expect(res.headers['cache-control']).toContain('no-store');

      const [doc] = await sql<{ extraction_status: string }[]>`
        SELECT extraction_status FROM documents WHERE id = ${id}::uuid
      `;
      expect(doc?.extraction_status).toBe('ocr_queued');
    });

    it('reports an existing job rather than creating a second', async () => {
      const id = await scanNeedingOcr('http2');
      await request(app).post(`/api/v1/documents/${id}/ocr`);
      const second = await request(app).post(`/api/v1/documents/${id}/ocr`);

      expect(second.status).toBe(200);
      expect(second.body.alreadyQueued).toBe(true);
    });

    /* A text-layer document already has its text; re-reading it by image is worse. */
    it('refuses a document that already has readable text', async () => {
      const outcome = await importDocument(sql, store, {
        bytes: validPdf({ text: 'THIS DOCUMENT HAS A REAL TEXT LAYER ALREADY PRESENT' }),
        filename: 'job-text.pdf',
      });
      if (outcome.kind !== 'imported') return;
      await sql`
        UPDATE documents SET extraction_status = 'text_available' WHERE id = ${outcome.id}::uuid
      `;

      const res = await request(app).post(`/api/v1/documents/${outcome.id}/ocr`);
      expect(res.status).toBe(400);
      expect(res.body.error.message).toMatch(/already has readable text/i);
    });

    it('404s an unknown document', async () => {
      const res = await request(app).post(
        '/api/v1/documents/00000000-0000-0000-0000-000000000000/ocr',
      );
      expect(res.status).toBe(404);
    });

    it('rejects a malformed id', async () => {
      expect((await request(app).post('/api/v1/documents/not-a-uuid/ocr')).status).toBe(400);
    });

    /*
     * Not a general job runner (M5A.3 §12): the route takes no job type, no
     * parameters and no URL, so a caller cannot use it to run arbitrary work.
     */
    it('accepts no parameters that could redirect the work', async () => {
      const id = await scanNeedingOcr('params');
      const res = await request(app)
        .post(`/api/v1/documents/${id}/ocr`)
        .send({ jobType: 'shell', url: 'http://169.254.169.254/', command: 'rm -rf /' });

      expect(res.status).toBe(202);
      const [job] = await sql<{ job_type: string }[]>`
        SELECT job_type FROM jobs WHERE document_id = ${id}::uuid
      `;
      expect(job?.job_type).toBe('ocr');
    });
  });

  describe('status endpoint', () => {
    it('reports progress including the job', async () => {
      const id = await scanNeedingOcr('status');
      await request(app).post(`/api/v1/documents/${id}/ocr`);

      const res = await request(app).get(`/api/v1/documents/${id}/status`);
      expect(res.status).toBe(200);
      expect(res.body.extractionStatus).toBe('ocr_queued');
      expect(res.body.job.status).toBe('queued');
      expect(res.body.sectionCount).toBe(0);
      expect(res.headers['cache-control']).toContain('no-store');
    });

    it('reports a document with no job', async () => {
      const id = await scanNeedingOcr('nojob');
      const res = await request(app).get(`/api/v1/documents/${id}/status`);
      expect(res.status).toBe(200);
      expect(res.body.job).toBeNull();
    });

    it('404s an unknown document', async () => {
      const res = await request(app).get(
        '/api/v1/documents/00000000-0000-0000-0000-000000000000/status',
      );
      expect(res.status).toBe(404);
    });
  });
});
