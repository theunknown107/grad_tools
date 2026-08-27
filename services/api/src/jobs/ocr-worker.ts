/**
 * OCR worker.
 *
 * Authority: docs/17 §17.15 · docs/24 §24.2 · M5A.3 §5, §18
 *
 *   claim -> mark processing -> load bytes -> rasterize -> tesseract
 *         -> persist sections -> record metadata -> complete
 *
 * Runs OUT OF BAND. Nothing here is reachable from an HTTP request, and no
 * request ever waits on it: OCR is ~1.07 s/page measured (docs/23 §23.3.4),
 * which is two to three orders of magnitude beyond what the API answers in.
 *
 * A DOCUMENT IS NEVER SILENTLY DISCARDED. Every failure path either schedules a
 * retry or leaves the document in `ocr_needs_review` with a reason a person can
 * read. There is no branch that drops work quietly.
 */

import type { Logger } from 'pino';
import type { Sql } from '../db/client.js';
import type { ObjectStore } from '../documents/storage.js';
import { sectionize } from '../documents/extract.js';
import { runOcr } from '../documents/ocr.js';
import { structureFromOcrTsv } from '../documents/positional.js';
import { persistExtraction } from '../documents/persist.js';
import * as queue from './queue.js';

/** How long a `processing` job may sit before it is presumed abandoned. */
export const STALLED_AFTER_MS = 30 * 60_000;

export interface WorkerDeps {
  readonly sql: Sql;
  readonly store: ObjectStore;
  readonly logger: Logger;
  readonly workerId: string;
}

export interface JobOutcome {
  readonly jobId: string;
  readonly documentId: string;
  readonly result: 'completed' | 'retry' | 'failed' | 'skipped';
  readonly durationMs: number;
}

/**
 * Runs at most one job. Returns null when the queue is empty.
 *
 * One job per call, so the caller owns the loop and its pacing. That keeps this
 * function trivially testable: a test runs exactly one job without a scheduler.
 */
export async function runOneJob(deps: WorkerDeps): Promise<JobOutcome | null> {
  const { sql, store, logger, workerId } = deps;

  const job = await queue.claim(sql, 'ocr', workerId);
  if (job === null) return null;

  const started = Date.now();
  logger.info(
    { jobId: job.id, documentId: job.documentId, attempt: job.attempts },
    'ocr job claimed',
  );

  try {
    const rows = await sql<{ state: string; storage_key: string | null }[]>`
      SELECT state, storage_key FROM documents WHERE id = ${job.documentId}::uuid
    `;
    const doc = rows[0];

    if (doc === undefined) {
      // The document was deleted while the job waited. Nothing to do, and
      // nothing wrong — complete rather than fail, so it does not retry.
      await queue.complete(sql, job.id);
      logger.info({ jobId: job.id }, 'ocr job skipped: document no longer exists');
      return { jobId: job.id, documentId: job.documentId, result: 'skipped', durationMs: 0 };
    }
    if (doc.storage_key === null) {
      throw new Error('Document has no stored bytes to read.');
    }
    if (doc.state !== 'validated' && doc.state !== 'extracted') {
      throw new Error(`Document is ${doc.state} and has not passed validation.`);
    }

    await sql`
      UPDATE documents SET extraction_status = 'ocr_processing', updated_at = now()
       WHERE id = ${job.documentId}::uuid
    `;
    logger.info({ jobId: job.id, documentId: job.documentId }, 'ocr started');

    const bytes = await store.get(doc.storage_key);
    const result = await runOcr(bytes);

    const sections = result.ok ? sectionize(result.text) : [];
    const status = !result.ok
      ? 'ocr_needs_review'
      : result.needsReview
        ? 'ocr_needs_review'
        : 'ocr_extracted';

    await sql.begin(async (tx) => {
      // Replace rather than append, so a re-run is idempotent.
      await tx`DELETE FROM document_sections WHERE document_id = ${job.documentId}::uuid`;
      for (const section of sections) {
        await tx`
          INSERT INTO document_sections (
            document_id, page_number, ordinal, content, extractor_version
          ) VALUES (
            ${job.documentId}::uuid, ${section.pageNumber}, ${section.ordinal},
            ${section.content}, ${result.extractorVersion}
          )
        `;
      }
      await tx`
        UPDATE documents
           SET state = 'extracted',
               extraction_status = ${status},
               paper_format = ${result.format},
               ocr_engine = ${result.engine},
               ocr_engine_version = ${result.engineVersion},
               ocr_languages = ${result.config.languages},
               ocr_psm = ${result.config.psm},
               ocr_dpi = ${result.config.dpi},
               ocr_duration_ms = ${result.durationMs},
               ocr_char_count = ${result.charCount},
               needs_review = ${result.needsReview},
               review_reason = ${result.reviewReason},
               updated_at = now()
         WHERE id = ${job.documentId}::uuid
      `;
    });

    /*
     * Structure, from the geometry OCR ALREADY produced.
     *
     * The TSV came out of the same recognition pass as the text (docs/17
     * §17.17), so this costs milliseconds rather than a second recognition of
     * every page. Persisting it here rather than in a later request is what
     * keeps the expensive work to exactly one pass.
     *
     * OUTSIDE the transaction above on purpose: a paper that fails to persist
     * must not roll back text a person can already use. The failure is logged
     * and the document keeps its sections.
     */
    let paperOutcome = null;
    if (result.ok) {
      try {
        const extraction = structureFromOcrTsv(
          result.pages.map((page) => ({ pageNumber: page.pageNumber, tsv: page.tsv })),
          result.config.dpi,
          result.format,
        );
        paperOutcome = await persistExtraction(sql, job.documentId, extraction);
      } catch (cause) {
        logger.warn(
          { jobId: job.id, documentId: job.documentId, err: cause },
          'ocr text stored but question structure could not be persisted',
        );
      }
    }

    await queue.complete(sql, job.id);
    const durationMs = Date.now() - started;

    // Metadata only. Document CONTENT is never logged (docs/24 §24.2).
    logger.info(
      {
        jobId: job.id,
        documentId: job.documentId,
        durationMs,
        format: result.format,
        languages: result.config.languages,
        psm: result.config.psm,
        pages: result.pages.length,
        chars: result.charCount,
        sections: sections.length,
        questions: paperOutcome?.questionCount ?? 0,
        subQuestions: paperOutcome?.subQuestionCount ?? 0,
        mcqItems: paperOutcome?.mcqItemCount ?? 0,
        paper: paperOutcome?.kind ?? 'none',
        needsReview: result.needsReview,
        status,
      },
      'ocr completed',
    );
    return { jobId: job.id, documentId: job.documentId, result: 'completed', durationMs };
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : 'OCR failed.';
    const disposition = await queue.fail(sql, job.id, message);
    const durationMs = Date.now() - started;

    if (disposition === 'failed') {
      // Terminal. The document says so rather than sitting in `ocr_processing`
      // forever with no explanation.
      await sql`
        UPDATE documents
           SET extraction_status = 'ocr_needs_review',
               needs_review = true,
               review_reason = 'Text could not be read from this document after several attempts.',
               updated_at = now()
         WHERE id = ${job.documentId}::uuid
      `;
      logger.error({ jobId: job.id, documentId: job.documentId, durationMs }, 'ocr failed');
    } else {
      await sql`
        UPDATE documents SET extraction_status = 'ocr_queued', updated_at = now()
         WHERE id = ${job.documentId}::uuid
      `;
      logger.warn(
        { jobId: job.id, documentId: job.documentId, durationMs, attempt: job.attempts },
        'ocr retried',
      );
    }
    return { jobId: job.id, documentId: job.documentId, result: disposition, durationMs };
  }
}

/**
 * Drains the queue until it is empty, or `limit` jobs have run.
 *
 * `limit` exists so a test can be bounded and so an operator running this by
 * hand cannot accidentally start an unbounded batch.
 */
export async function drain(deps: WorkerDeps, limit = 100): Promise<JobOutcome[]> {
  const outcomes: JobOutcome[] = [];
  for (let i = 0; i < limit; i += 1) {
    const outcome = await runOneJob(deps);
    if (outcome === null) break;
    outcomes.push(outcome);
  }
  return outcomes;
}

/** Returns abandoned jobs to the queue. Safe to call repeatedly. */
export async function recoverStalled(deps: WorkerDeps): Promise<number> {
  const count = await queue.requeueStalled(deps.sql, STALLED_AFTER_MS);
  if (count > 0) deps.logger.warn({ count }, 'requeued stalled ocr jobs');
  return count;
}
