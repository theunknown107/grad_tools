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
 * The key is the client IP only, and an IPv6 client is keyed by its /64, because
 * one subscriber holds the whole block and could otherwise walk it for a fresh
 * bucket on every request. No token, request field,
 * Authorization header, body or document content ever enters a key or a log:
 * the handler logs nothing itself and hands a plain `ApiError` to the shared
 * error handler, which already logs only a reference id and the error code.
 *
 * The client IP is trusted only as far as `trust proxy` allows (set in
 * `createApp` to one hop). Express then reads the RIGHT-most `X-Forwarded-For`
 * entry, the one the proxy appended, so anything a client sends itself is
 * ignored.
 *
 * ON RENDER THAT IS NOT THE CLIENT. Measured on 2026-11-01 against staging: one
 * client with one IPv4 address landed in several buckets, even on one reused
 * connection, so the right-most entry is a rotating proxy address (Cloudflare sits
 * in front of Render). `CLIENT_IP_HEADER` names the header to key on instead. It
 * stays opt-in because only an observation through `client-address` (operator
 * route) can show the header arrives. The ceiling below holds either way.
 */

import { isIP, isIPv6 } from 'node:net';
import rateLimit, { type RateLimitRequestHandler } from 'express-rate-limit';
import type { NextFunction, Request, Response } from 'express';
import { ApiError } from './errors.js';

/** One minute, shared by both limiters. */
export const RATE_LIMIT_WINDOW_MS = 60_000;

/** Baseline for ordinary `/api/v1/*` traffic, per IP per window. */
export const API_RATE_LIMIT = 100;

/** The expensive AI document-extraction path: materially stricter, per IP per window. */
export const DOCUMENT_RATE_LIMIT = 10;

/**
 * Anonymous problem reports: the one unauthenticated write, so far stricter than
 * the baseline. Generous for a person who cannot sign in, useless to a script.
 */
export const ANONYMOUS_REPORT_RATE_LIMIT = 5;
export const ANONYMOUS_REPORT_WINDOW_MS = 10 * 60_000;

/**
 * Anonymous reports the process accepts per window, from everyone together. The
 * per-client limit depends on knowing the client; this does not.
 */
export const ANONYMOUS_REPORT_CEILING = 60;

/** Telemetry rows the process may write per minute, whoever caused them. */
export const TELEMETRY_WRITE_BUDGET = 120;

/**
 * The client's address: the configured edge header if it holds exactly one
 * address, otherwise `req.ip`. Anything else in that header is ignored.
 */
export function clientAddress(req: Request): string | undefined {
  const header = req.app.get('client ip header') as string | undefined;
  const value = header === undefined ? undefined : req.get(header)?.trim();
  return value !== undefined && isIP(value) !== 0 ? value : req.ip;
}

/** The limiter key: the address, or the /64 for an IPv6 client. */
export function clientKey(ip: string | undefined): string {
  const address = ip ?? 'unknown';
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
  if (mapped !== null) return mapped[1] as string;
  if (!isIPv6(address)) return address;
  const [head = '', tail = ''] = address.split('::');
  const left = head === '' ? [] : head.split(':');
  const right = tail === '' ? [] : tail.split(':');
  const groups = address.includes('::')
    ? [...left, ...Array<string>(Math.max(0, 8 - left.length - right.length)).fill('0'), ...right]
    : left;
  return `${groups.slice(0, 4).join(':').toLowerCase()}::/64`;
}

/**
 * A process-wide ceiling on telemetry writes.
 *
 * Per-client limits cannot bound many clients at once, and a fault must still
 * give the student an Incident ID, so past the budget the id is returned and
 * the row is skipped.
 *
 * ponytail: per instance, and a flood can crowd out real rows for up to a
 * minute. A shared counter or per-event-type budgets if that ever matters.
 */
export function createWriteBudget(
  limit: number = TELEMETRY_WRITE_BUDGET,
  windowMs: number = RATE_LIMIT_WINDOW_MS,
  now: () => number = Date.now,
): () => boolean {
  let windowStart = now();
  let used = 0;
  return () => {
    if (now() - windowStart >= windowMs) {
      windowStart = now();
      used = 0;
    }
    used += 1;
    return used <= limit;
  };
}

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

function make(
  defaultLimit: number,
  options: LimiterOptions = {},
  key: (req: Request) => string = (req) => clientKey(clientAddress(req)),
): RateLimitRequestHandler {
  return rateLimit({
    windowMs: options.windowMs ?? RATE_LIMIT_WINDOW_MS,
    limit: options.limit ?? defaultLimit,
    standardHeaders: 'draft-7', // RateLimit-* headers; no legacy X-RateLimit-* noise.
    legacyHeaders: false,
    // No token, Authorization header or body enters the key.
    keyGenerator: key,
    handler: tripped,
  });
}

/** Baseline limiter mounted on `/api/v1`. */
export function createApiLimiter(options?: LimiterOptions): RateLimitRequestHandler {
  return make(API_RATE_LIMIT, options);
}

/** The unauthenticated report route, applied in addition to the baseline. */
export function createAnonymousReportLimiter(options?: LimiterOptions): RateLimitRequestHandler {
  return make(ANONYMOUS_REPORT_RATE_LIMIT, {
    windowMs: ANONYMOUS_REPORT_WINDOW_MS,
    ...options,
  });
}

/** One bucket shared by every anonymous reporter. */
export function createAnonymousReportCeiling(options?: LimiterOptions): RateLimitRequestHandler {
  return make(
    ANONYMOUS_REPORT_CEILING,
    { windowMs: ANONYMOUS_REPORT_WINDOW_MS, ...options },
    () => 'all-anonymous-reports',
  );
}

/** Stricter limiter for the document-AI extraction route; applied in addition to the baseline. */
export function createDocumentLimiter(options?: LimiterOptions): RateLimitRequestHandler {
  return make(DOCUMENT_RATE_LIMIT, options);
}
