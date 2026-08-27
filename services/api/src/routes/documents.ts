/**
 * Private document workflow routes.
 *
 * Authority: docs/10 §10.7 · docs/17 §17.1 · M5A §4, §17
 *
 * WHAT THIS ROUTER DELIBERATELY DOES NOT DO
 *
 * - It serves no file. There is no `/file`, `/download` or `/content` route
 *   here or anywhere. Hosting requires a rights determination that does not
 *   exist (`OQ-008`), and a private document is never served to anyone else.
 * - It fetches nothing. `import` accepts BYTES from the request body. There is
 *   no URL parameter, so this endpoint cannot be turned into an SSRF gadget by
 *   any input (M5A §4).
 * - It publishes nothing. Every document it creates is `user_private`, which
 *   the database refuses to present any other way.
 *
 * This is an operator-local surface for Stage 1, not a public upload service.
 * When accounts arrive, these routes gain an owner predicate and an
 * authorization guard; until then they are reachable only from the machine
 * running the API, and the CORS allowlist is what keeps a browser elsewhere
 * from reaching them.
 */

import { Router, type Request, type Response } from 'express';
import express from 'express';
import {
  SOURCE_ROUTES,
  reviewRequestSchema,
  reviewTargetSchema,
  subjectIdSchema,
} from '@gradtools/shared-types';
import type { Sql } from '../db/client.js';
import * as queries from '../db/queries.js';
import { importDocument, processDocument } from '../documents/ingest.js';
import { extractNativeStructure } from '../documents/positional.js';
import { persistExtraction, recordReview } from '../documents/persist.js';
import * as queue from '../jobs/queue.js';
import { MAX_BYTES } from '../documents/validate.js';
import type { ObjectStore } from '../documents/storage.js';
import { ApiError, notFound } from '../http/errors.js';

export function createDocumentRouter(sql: Sql, store: ObjectStore): Router {
  const router = Router();

  /**
   * Import one document.
   *
   * Takes raw bytes, not multipart and not a URL. Raw bytes are the smallest
   * surface that does the job: no parser between the socket and the validator,
   * and nothing in the request that could name a place to fetch from.
   *
   * The body limit is enforced twice — here by express, and again by the
   * validator on the bytes it receives — because the first is a transport
   * limit and the second is a rule about documents.
   */
  router.post(
    SOURCE_ROUTES.documentImport,
    express.raw({ type: 'application/pdf', limit: MAX_BYTES }),
    async (req: Request, res: Response) => {
      const bytes = req.body as unknown;
      if (!Buffer.isBuffer(bytes) || bytes.byteLength === 0) {
        throw new ApiError(
          'VALIDATION_FAILED',
          'Send the document as a request body with Content-Type: application/pdf.',
        );
      }

      const filename = headerString(req, 'x-document-filename') ?? 'document.pdf';
      const title = headerString(req, 'x-document-title');

      const outcome = await importDocument(sql, store, { bytes, filename, title });

      // A rejected document is a recorded outcome, not a server error: the
      // caller gets 201 with the verdict, because the import itself succeeded
      // in doing what it is for.
      res.status(outcome.kind === 'duplicate' ? 200 : 201).json(outcome);
    },
  );

  /** The operator's own working set. Never merged with the public listing. */
  router.get(SOURCE_ROUTES.documentsPrivate, async (_req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'private, no-store');
    res.json({ data: await queries.listPrivateDocuments(sql) });
  });

  /**
   * Extract text and persist sections.
   *
   * Separate from import because extraction is the slow, parser-adjacent step,
   * and separating them means an extractor upgrade can be re-run without
   * re-importing. Idempotent: sections are replaced, not appended.
   */
  router.post('/api/v1/documents/:id/process', async (req: Request, res: Response) => {
    const id = subjectIdSchema.parse(req.params.id);
    let outcome;
    try {
      outcome = await processDocument(sql, store, id);
    } catch (cause) {
      // A document that has not passed validation is a client mistake, not a
      // server fault, and must not read as one.
      throw new ApiError(
        'VALIDATION_FAILED',
        cause instanceof Error ? cause.message : 'That document cannot be processed.',
      );
    }
    if (!outcome) throw notFound(`No document with id "${id}".`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.json(outcome);
  });

  router.get('/api/v1/documents/:id/sections', async (req: Request, res: Response) => {
    const id = subjectIdSchema.parse(req.params.id);
    const document = await queries.findDocument(sql, id);
    if (!document) throw notFound(`No document with id "${id}".`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.json({ data: await queries.listDocumentSections(sql, id) });
  });

  /**
   * Ask for OCR on a document with no text layer.
   *
   * Enqueues a job and returns immediately. The request never waits for OCR:
   * it is ~1.07 s/page measured (docs/23 §23.3.4), which is not a request.
   *
   * NOT A GENERAL JOB RUNNER (M5A.3 §12). It accepts no job type, no
   * parameters and no URL — only the id of a document that already exists, has
   * passed validation, and actually needs OCR. Everything about the work is
   * decided here, not by the caller.
   */
  router.post('/api/v1/documents/:id/ocr', async (req: Request, res: Response) => {
    const id = subjectIdSchema.parse(req.params.id);

    const document = await queries.findDocument(sql, id);
    if (!document) throw notFound(`No document with id "${id}".`);

    if (document.state !== 'validated' && document.state !== 'extracted') {
      throw new ApiError(
        'VALIDATION_FAILED',
        'This document has not been checked yet, so it cannot be read.',
      );
    }

    /*
     * Only documents that actually need OCR. A text-layer document already has
     * its text, and re-reading it by image would be slower and worse.
     *
     * `ocr_queued` and `ocr_processing` are ALLOWED through deliberately: a
     * second click must be harmless, not an error. `enqueue` dedupes against
     * the partial unique index and reports `alreadyQueued`, so the caller gets
     * a truthful 200 rather than a failure for doing nothing wrong.
     */
    const eligible = [
      'ocr_required',
      'ocr_needs_review',
      'extraction_failed',
      'ocr_queued',
      'ocr_processing',
    ];
    if (!eligible.includes(document.extractionStatus)) {
      throw new ApiError(
        'VALIDATION_FAILED',
        'This document already has readable text, so it does not need image reading.',
      );
    }

    const { job, alreadyQueued } = await queue.enqueue(sql, 'ocr', id);
    if (!alreadyQueued) {
      await sql`
        UPDATE documents SET extraction_status = 'ocr_queued', updated_at = now()
         WHERE id = ${id}::uuid
      `;
    }

    res.setHeader('Cache-Control', 'private, no-store');
    res.status(alreadyQueued ? 200 : 202).json({
      jobId: job?.id ?? null,
      alreadyQueued,
    });
  });

  /** Progress. Cheap enough to poll while a document is being read. */
  router.get('/api/v1/documents/:id/status', async (req: Request, res: Response) => {
    const id = subjectIdSchema.parse(req.params.id);
    const status = await queries.findDocumentStatus(sql, id);
    if (!status) throw notFound(`No document with id "${id}".`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.json(status);
  });

  /* ---------------------------------------------------------------------- */
  /* Extracted question structure (M5A.5)                                    */
  /* ---------------------------------------------------------------------- */

  /**
   * Runs the positional parser over a document with a text layer, and stores
   * what it finds.
   *
   * NATIVE ONLY. A scan's structure is produced by the OCR job from the
   * geometry that same recognition pass emitted (docs/17 §17.17); re-reading
   * its images here would repeat a ~759 ms/page workload inside a request.
   * Asking for it on a scan is refused with a sentence saying so rather than
   * quietly doing something slower and worse.
   *
   * Idempotent: a second call for the same parser version returns `unchanged`
   * and touches nothing, so any review already recorded survives (M5A.5 §16).
   */
  router.post('/api/v1/documents/:id/extract', async (req: Request, res: Response) => {
    const id = subjectIdSchema.parse(req.params.id);

    const document = await queries.findDocument(sql, id);
    if (!document) throw notFound(`No document with id "${id}".`);
    if (document.state !== 'validated' && document.state !== 'extracted') {
      throw new ApiError(
        'VALIDATION_FAILED',
        'This document has not been checked yet, so it cannot be read.',
      );
    }
    if (document.extractionStatus !== 'text_available') {
      throw new ApiError(
        'VALIDATION_FAILED',
        'Question structure for a scanned document is produced when the scan is read.',
      );
    }
    /*
     * The storage key is read here rather than taken from the served document:
     * it is deliberately absent from the document contract, because an opaque
     * key is infrastructure and nothing outside this process needs it.
     */
    const [stored] = await sql`
      SELECT storage_key FROM documents WHERE id = ${id}::uuid
    `;
    const storageKey = (stored as { storage_key: string | null } | undefined)?.storage_key ?? null;
    if (storageKey === null) {
      throw new ApiError('VALIDATION_FAILED', 'This document has no stored file to read.');
    }

    const bytes = await store.get(storageKey);
    const extraction = await extractNativeStructure(bytes);

    res.setHeader('Cache-Control', 'private, no-store');
    if (extraction === null) {
      res.json({ kind: 'no_structure', paperId: null, questionCount: 0 });
      return;
    }
    res.json(await persistExtraction(sql, id, extraction));
  });

  /** The document's current extraction run. `null` when it has none. */
  router.get('/api/v1/documents/:id/paper', async (req: Request, res: Response) => {
    const id = subjectIdSchema.parse(req.params.id);
    const document = await queries.findDocument(sql, id);
    if (!document) throw notFound(`No document with id "${id}".`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.json({
      data: await queries.findCurrentPaper(sql, id),
      // Superseded runs are listed, not hidden: seeing that a parser upgrade
      // changed the answer is the point of versioning them (M5A.5 §16).
      history: await queries.listPapersForDocument(sql, id),
    });
  });

  router.get('/api/v1/papers/:id/questions', async (req: Request, res: Response) => {
    const id = subjectIdSchema.parse(req.params.id);
    const paper = await queries.findPaper(sql, id);
    if (!paper) throw notFound(`No extracted paper with id "${id}".`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.json({ data: await queries.listPaperQuestions(sql, id) });
  });

  router.get('/api/v1/papers/:id/mcq-items', async (req: Request, res: Response) => {
    const id = subjectIdSchema.parse(req.params.id);
    const paper = await queries.findPaper(sql, id);
    if (!paper) throw notFound(`No extracted paper with id "${id}".`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.json({ data: await queries.listPaperMcqItems(sql, id) });
  });

  router.get('/api/v1/questions/:id', async (req: Request, res: Response) => {
    const id = subjectIdSchema.parse(req.params.id);
    const question = await queries.findQuestion(sql, id);
    if (!question) throw notFound(`No question with id "${id}".`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.json(question);
  });

  /**
   * The review queue: everything still waiting for a person, worst first.
   *
   * ORDER, NOT SCORE (M5A.6 section 7): review_required, low, medium, high. A
   * number would have to be invented and would blend two incomparable things --
   * how much the geometry agreed, and how much work a record needs.
   *
   * One flat list across questions, sub-questions and MCQ items, because a
   * reviewer works through RECORDS: three lists would make 'what is left?'
   * three questions instead of one.
   */
  router.get('/api/v1/review/queue', async (req: Request, res: Response) => {
    // Bounded by the server, never by the caller alone: an unbounded list is a
    // way to ask for the whole table in one request.
    const limit = Math.min(Number(req.query.limit ?? 50) || 50, 200);
    res.setHeader('Cache-Control', 'private, no-store');
    res.json({ data: await queries.listReviewQueue(sql, limit) });
  });

  /**
   * The one mutation on extracted data.
   *
   * DELIBERATELY NARROW (M5A.5 §8). Three actions, a closed set of record kinds
   * and a closed set of correctable fields — no generic patch, no field name
   * from the caller, and nothing that could name a table or a column. `kind` is
   * validated against an enum and then used to choose one of three fixed
   * statements, never interpolated anywhere.
   *
   * The machine's values are not writable by any request this router accepts.
   * A correction is stored beside them and the original stays (M5A.5 §9).
   *
   * This is an operator-local surface, like everything else in this file: the
   * API binds to loopback and there are no accounts yet. When accounts arrive
   * this route gains an authorization guard before anything else does.
   */
  router.post(
    '/api/v1/extracted/:kind/:id/review',
    express.json({ limit: '64kb' }),
    async (req: Request, res: Response) => {
      const kind = reviewTargetSchema.parse(req.params.kind);
      const id = subjectIdSchema.parse(req.params.id);
      const review = reviewRequestSchema.parse(req.body);

      const updated = await recordReview(sql, kind, id, review);
      if (!updated) throw notFound(`No ${kind} with id "${id}".`);

      res.setHeader('Cache-Control', 'private, no-store');
      res.json({ id, kind, action: review.action });
    },
  );

  return router;
}

/** A single header value, or undefined. Never an array, never a path. */
function headerString(req: Request, name: string): string | undefined {
  const value = req.headers[name];
  return typeof value === 'string' && value !== '' ? value : undefined;
}
