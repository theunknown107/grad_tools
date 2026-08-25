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
import { SOURCE_ROUTES, subjectIdSchema } from '@gradtools/shared-types';
import type { Sql } from '../db/client.js';
import * as queries from '../db/queries.js';
import { importDocument, processDocument } from '../documents/ingest.js';
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

  return router;
}

/** A single header value, or undefined. Never an array, never a path. */
function headerString(req: Request, name: string): string | undefined {
  const value = req.headers[name];
  return typeof value === 'string' && value !== '' ? value : undefined;
}
