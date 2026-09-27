/**
 * POST /api/v1/me/documents/extract — AI reading of one result card or
 * timetable. Authority: docs/13 §13.29.
 *
 * SIGNED IN, ALWAYS. The route sits behind the same session guard as every
 * other `/api/v1/me` route, and is mounted only where the student cloud AND a
 * Gemini key are configured — there is no anonymous AI endpoint in any mode.
 * The guard runs BEFORE the body is read, so an anonymous upload is refused
 * without being buffered.
 *
 * NOTHING IS KEPT. The body is the file's bytes (its declared type is ignored;
 * its signature decides). It is sent to the configured Gemini model inline,
 * the reply is validated and gated, and the review payload goes back to the
 * device. Nothing is written to the database, nothing about the document is
 * logged, and the request buffer is zeroed when the request ends. Saving is
 * the device's, after the student confirms.
 */

import express, { Router, type Request, type Response } from 'express';
import { AI_DOCUMENT_MAX_BYTES, DOCUMENT_AI_ROUTES } from '@gradtools/shared-types';
import { requireSession, type Verifier } from '../auth/session.js';
import type { DocumentReader } from '../documents/gemini.js';
import { DocumentReadError, readDocument, type ReadFailure } from '../documents/read.js';
import { ApiError } from '../http/errors.js';

export interface DocumentRouterDeps {
  readonly verify: Verifier;
  readonly reader: DocumentReader;
  readonly model: string;
}

/** Safe, fixed words for each failure. No provider text and no document text, ever. */
function toApiError(failure: ReadFailure, model: string): ApiError {
  switch (failure) {
    case 'too_large':
      return new ApiError('PAYLOAD_TOO_LARGE', 'This file is too large to read with AI.');
    case 'unsupported_type':
      return new ApiError(
        'VALIDATION_FAILED',
        'AI reading takes a PDF or a photo (JPG, PNG, WebP).',
      );
    case 'rate_limited':
      return new ApiError('RATE_LIMITED', 'AI reading is busy right now. Try again shortly.');
    case 'not_configured':
      return new ApiError(
        'DEPENDENCY_UNAVAILABLE',
        'AI reading is not configured correctly on this server.',
      );
    case 'model_unavailable':
      return new ApiError(
        'DEPENDENCY_UNAVAILABLE',
        `The configured AI model (${model}) is not available to this server.`,
      );
    case 'timeout':
      return new ApiError('DEPENDENCY_UNAVAILABLE', 'AI reading took too long. Try again.');
    case 'invalid_reply':
      return new ApiError(
        'DEPENDENCY_UNAVAILABLE',
        'The AI reply was not in the expected form, so nothing from it was used. Try again, or read the document on this device.',
      );
    case 'service':
      return new ApiError('DEPENDENCY_UNAVAILABLE', 'AI reading is unavailable right now.');
  }
}

export function createDocumentRouter(deps: DocumentRouterDeps): Router {
  const router = Router();
  const guard = requireSession(deps.verify);

  router.post(
    DOCUMENT_AI_ROUTES.extract,
    guard,
    express.raw({ type: () => true, limit: AI_DOCUMENT_MAX_BYTES }),
    async (req: Request, res: Response) => {
      res.setHeader('Cache-Control', 'private, no-store');
      const body: unknown = req.body;
      if (!Buffer.isBuffer(body) || body.length === 0) {
        throw new ApiError('VALIDATION_FAILED', 'Attach the document to read.');
      }
      try {
        res.json(await readDocument(body, deps.reader, deps.model));
      } catch (error) {
        if (error instanceof DocumentReadError) throw toApiError(error.failure, deps.model);
        throw toApiError('service', deps.model);
      } finally {
        body.fill(0);
      }
    },
  );

  return router;
}
