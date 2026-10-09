/**
 * Error envelope and handlers.
 *
 * Authority: docs/10_API_SPECIFICATION.md §10.3, docs/13 §T-16
 *
 * `message` is safe to display to a user. Internal detail — stack traces, SQL,
 * driver errors — NEVER reaches the client. It is logged against `reference`,
 * so a bug report carries an id that finds the log line without leaking
 * anything to whoever reads the screen.
 */

import type { ErrorCode, ErrorResponse } from '@gradtools/shared-types';
import type { NextFunction, Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { ZodError } from 'zod';

const STATUS_BY_CODE: Record<ErrorCode, number> = {
  VALIDATION_FAILED: 400,
  UNAUTHENTICATED: 401,
  NOT_FOUND: 404,
  CONFLICT: 409,
  PAYLOAD_TOO_LARGE: 413,
  RATE_LIMITED: 429,
  INTERNAL_ERROR: 500,
  DEPENDENCY_UNAVAILABLE: 503,
};

/** An error that is safe to describe to the caller. */
export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly details: { field: string; issue: string }[] | undefined;

  constructor(code: ErrorCode, message: string, details?: { field: string; issue: string }[]) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.details = details;
  }

  get status(): number {
    return STATUS_BY_CODE[this.code];
  }
}

export function notFound(message: string): ApiError {
  return new ApiError('NOT_FOUND', message);
}

export function buildErrorBody(
  code: ErrorCode,
  message: string,
  reference: string,
  details?: { field: string; issue: string }[],
  incidentId?: string,
): ErrorResponse {
  return {
    error: {
      code,
      message,
      ...(details && details.length > 0 ? { details } : {}),
      reference,
      ...(incidentId !== undefined ? { incidentId } : {}),
    },
  };
}

/** 404 for unmatched routes. Registered after all real routes. */
export function notFoundHandler(_req: Request, res: Response): void {
  res
    .status(404)
    .json(buildErrorBody('NOT_FOUND', 'That endpoint does not exist.', `err_${randomUUID()}`));
}

/**
 * How the error handler persists support signals (OBSERVABILITY-AND-SUPPORT-V1).
 *
 * Injected, synchronous-to-call but fire-and-forget internally, and NEVER
 * allowed to throw into the response path. Returns an Incident ID for a
 * reportable fault (shown to the student), or undefined.
 */
export interface IncidentRecorder {
  /** A reportable server fault (5xx). Returns the Incident ID to echo to the client. */
  readonly recordFault: (ctx: FaultContext) => string;
  /** A security-relevant signal (e.g. a tripped rate limit). No id is echoed. */
  readonly recordSecurity?: (ctx: FaultContext) => void;
}

export interface FaultContext {
  readonly reference: string;
  readonly code: ErrorCode;
  readonly httpStatus: number;
  readonly requestId: string | undefined;
  readonly route: string | undefined;
  readonly subject: string | undefined;
  readonly platform: string | undefined;
  readonly appVersion: string | undefined;
}

/** A safe request path for telemetry: the matched route, never the query string. */
function routeOf(req: Request): string | undefined {
  const path = req.originalUrl.split('?')[0];
  return path === undefined || path === '' ? undefined : path;
}

function clientHeader(req: Request, name: string): string | undefined {
  const value = req.headers[name];
  const text = Array.isArray(value) ? value[0] : value;
  return typeof text === 'string' && text !== '' ? text.slice(0, 40) : undefined;
}

/**
 * Terminal error handler.
 *
 * Express 5 forwards rejected async handlers here automatically, so route
 * handlers need no try/catch of their own. With a `recorder`, a 5xx also
 * creates a support incident and the body carries its Incident ID; a tripped
 * rate limit is recorded as a security signal. Recording never affects the
 * response the client receives.
 */
export function createErrorHandler(recorder?: IncidentRecorder) {
  return function errorHandler(
    error: unknown,
    req: Request,
    res: Response,
    _next: NextFunction,
  ): void {
    const reference = `err_${randomUUID()}`;
    const log = req.log;

    if (error instanceof ZodError) {
      const details = error.issues.map((issue) => ({
        field: issue.path.join('.') || '(root)',
        issue: issue.message,
      }));
      log?.warn({ reference, details }, 'request validation failed');
      res
        .status(400)
        .json(buildErrorBody('VALIDATION_FAILED', 'The request was not valid.', reference, details));
      return;
    }

    if (error instanceof ApiError) {
      // Client faults are expected traffic, not incidents: log at warn.
      log?.warn({ reference, code: error.code }, error.message);
      // A tripped rate limit is a security signal worth surfacing, but not a bug.
      if (error.code === 'RATE_LIMITED' && recorder?.recordSecurity !== undefined) {
        recorder.recordSecurity(faultContext(req, reference, error.code, error.status));
      }
      res
        .status(error.status)
        .json(buildErrorBody(error.code, error.message, reference, error.details));
      return;
    }

    /*
     * body-parser rejects an oversized body before any route sees it, and throws
     * its own error type rather than an ApiError. Without this branch a 1 MB+
     * request would be reported as an internal fault, which is both wrong and
     * would page someone for a client mistake (docs/10 §10.9).
     */
    if (
      typeof error === 'object' &&
      error !== null &&
      (error as { type?: unknown }).type === 'entity.too.large'
    ) {
      log?.warn({ reference }, 'request body too large');
      res
        .status(413)
        .json(buildErrorBody('PAYLOAD_TOO_LARGE', 'That request body is too large.', reference));
      return;
    }

    // Anything else is ours. Log the real error; tell the caller nothing about it.
    log?.error({ reference, err: error }, 'unhandled error');
    const incidentId = recorder?.recordFault(faultContext(req, reference, 'INTERNAL_ERROR', 500));
    res
      .status(500)
      .json(
        buildErrorBody(
          'INTERNAL_ERROR',
          'Something broke on our side. Your data was not changed.',
          reference,
          undefined,
          incidentId,
        ),
      );
  };
}

function faultContext(
  req: Request,
  reference: string,
  code: ErrorCode,
  httpStatus: number,
): FaultContext {
  return {
    reference,
    code,
    httpStatus,
    requestId: typeof req.id === 'string' ? req.id : undefined,
    route: routeOf(req),
    subject: req.session?.userId,
    platform: clientHeader(req, 'x-gradtools-platform'),
    appVersion: clientHeader(req, 'x-gradtools-app-version'),
  };
}

/** The default handler, with no incident persistence — used by tests and bare apps. */
export const errorHandler = createErrorHandler();
