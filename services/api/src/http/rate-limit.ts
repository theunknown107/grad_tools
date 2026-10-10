/**
 * Application-level rate limiting.
 *
 * Authority: docs/13 (API hardening) · M22 (F1)
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS, AND WHAT IT DOES NOT CLAIM
 * ---------------------------------------------------------------------------
 *
 * The API's authorization model (RLS + verified JWT) already stops one student
 * reading another's data; a limiter adds nothing there. What a limiter adds is
 * a ceiling on brute-force, scraping and cost-amplification — above all on the
 * document-AI route, which is the one expensive path.
 *
 * THE STORE IS IN-MEMORY, SO THE LIMIT IS PER INSTANCE, NOT GLOBAL. On the
 * single Render instance this deployment runs, per-instance IS global; the day
 * a second instance is added, each keeps its own counter and the effective
 * ceiling doubles. That is a deliberate, documented limitation — not a
 * distributed guarantee — and the upgrade path is a shared store (Redis/Key
 * Value) keyed the same way. `ponytail:` in-memory store, swap for a shared
 * store when the API scales past one instance.
 *
 * ---------------------------------------------------------------------------
 * KEYS AND PRIVACY
 * ---------------------------------------------------------------------------
 *
 * The key is the client IP only (via the library's IPv6-safe helper). No token,
 * Authorization header, body or document content ever enters a key or a log:
 * the handler logs nothing itself and hands a plain `ApiError` to the shared
 * error handler, which already logs only a reference id and the error code.
 *
 * The client IP is trusted only as far as `trust proxy` allows (set in
 * `createApp` to one hop — Render's proxy). A client cannot spoof its address
 * through `X-Forwarded-For` beyond that single trusted hop.
 */

import rateLimit, { type RateLimitRequestHandler } from 'express-rate-limit';
import type { NextFunction, Request, Response } from 'express';
import { ApiError } from './errors.js';

/** One minute, shared by both limiters. */
export const RATE_LIMIT_WINDOW_MS = 60_000;

/** Baseline for ordinary `/api/v1/*` traffic, per IP per window. */
export const API_RATE_LIMIT = 100;

/** The expensive AI document-extraction path: materially stricter, per IP per window. */
export const DOCUMENT_RATE_LIMIT = 10;

export interface LimiterOptions {
  readonly windowMs?: number;
  readonly limit?: number;
}

/**
 * Turns a tripped limit into the SAME error shape every other failure uses.
 *
 * `Retry-After` is set from the window reset so a well-behaved client knows when
 * to come back; then a plain `ApiError('RATE_LIMITED')` flows through the shared
 * error handler, which owns the body, the reference id and the (minimal) log.
 */
function tripped(req: Request, res: Response, next: NextFunction): void {
  // express-rate-limit attaches `rateLimit` to the request at runtime; read it
  // through a narrow local type rather than relying on global augmentation.
  const info = (req as Request & { rateLimit?: { resetTime?: Date } }).rateLimit;
  const reset = info?.resetTime?.getTime();
  const seconds = reset === undefined ? undefined : Math.max(1, Math.ceil((reset - Date.now()) / 1000));
  if (seconds !== undefined) res.setHeader('Retry-After', String(seconds));
  next(new ApiError('RATE_LIMITED', 'Too many requests. Please slow down and try again shortly.'));
}

function make(defaultLimit: number, options: LimiterOptions = {}): RateLimitRequestHandler {
  return rateLimit({
    windowMs: options.windowMs ?? RATE_LIMIT_WINDOW_MS,
    limit: options.limit ?? defaultLimit,
    standardHeaders: 'draft-7', // RateLimit-* headers; no legacy X-RateLimit-* noise.
    legacyHeaders: false,
    // Key is the client IP only. The library's built-in default keyGenerator
    // reads `req.ip` (set correctly by `trust proxy`) and normalises IPv6 so a
    // client cannot sidestep the limit by walking addresses in its own subnet.
    // No token, header or body ever enters the key.
    handler: tripped,
  });
}

/** Baseline limiter mounted on `/api/v1`. */
export function createApiLimiter(options?: LimiterOptions): RateLimitRequestHandler {
  return make(API_RATE_LIMIT, options);
}

/** Stricter limiter for the document-AI extraction route; applied in addition to the baseline. */
export function createDocumentLimiter(options?: LimiterOptions): RateLimitRequestHandler {
  return make(DOCUMENT_RATE_LIMIT, options);
}
