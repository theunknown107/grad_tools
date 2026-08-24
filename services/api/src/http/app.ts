/**
 * Express application assembly.
 *
 * Authority: docs/10_API_SPECIFICATION.md §10.9, docs/13_SECURITY_THREAT_MODEL.md §13.5
 *
 * Middleware order is deliberate: security headers first, then origin policy,
 * then body limits, then logging, then routes, then the terminal error
 * handler. A header applied after a route has already responded does nothing.
 */

import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import { randomUUID } from 'node:crypto';
import type { Logger } from 'pino';
import type { Config } from '../config.js';
import { isDatabaseReachable, type Sql } from '../db/client.js';
import { createReferenceRouter } from '../routes/reference.js';
import { errorHandler, notFoundHandler } from './errors.js';

export function createApp(config: Config, sql: Sql, logger: Logger): Express {
  const app = express();

  // Express advertises itself by default; there is no reason to tell an
  // attacker which framework and version to look up (docs/13 §13.5).
  app.disable('x-powered-by');

  /*
   * Security headers.
   *
   * A JSON API needs a restrictive CSP even though it serves no HTML: it
   * costs nothing and closes the gap if a response is ever rendered in a
   * browser context. HSTS is enabled but is inert over plaintext localhost.
   */
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'none'"],
          frameAncestors: ["'none'"],
          baseUri: ["'none'"],
          formAction: ["'none'"],
        },
      },
      crossOriginResourcePolicy: { policy: 'same-site' },
      // docs/13 §13.5 specifies DENY. helmet defaults to SAMEORIGIN, which CSP
      // frame-ancestors already overrides in modern browsers, but the header
      // should not contradict the document it is implementing.
      frameguard: { action: 'deny' },
      referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
      hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
    }),
  );

  /*
   * CORS with an explicit allowlist. No wildcard, ever (docs/13 §13.5).
   * Requests without an Origin header (curl, server-to-server, health probes)
   * are allowed because CORS is a browser policy and blocking them would only
   * break monitoring while stopping no attack.
   */
  app.use(
    cors({
      origin(origin, callback) {
        if (origin === undefined || config.allowedOrigins.includes(origin)) {
          callback(null, true);
          return;
        }
        callback(null, false);
      },
      methods: ['GET', 'HEAD', 'OPTIONS'],
      credentials: false,
      maxAge: 600,
    }),
  );

  // 1 MB body limit (docs/10 §10.9). No endpoint in M5a accepts a body at all,
  // so this is a floor rather than a working limit.
  app.use(express.json({ limit: '1mb' }));

  /*
   * Request logging with a correlation id.
   *
   * The same id is what a 500 response returns as `reference`, so a user's bug
   * report maps to exactly one log line (docs/24 §24.2).
   */
  app.use(
    pinoHttp({
      logger,
      genReqId: (_req, res) => {
        const id = randomUUID();
        res.setHeader('X-Request-Id', id);
        return id;
      },
      customLogLevel: (_req, res, err) => {
        if (err !== undefined || res.statusCode >= 500) return 'error';
        if (res.statusCode >= 400) return 'warn';
        return 'info';
      },
      // Trim the default serialisers: the full header set is noisy and is the
      // most likely accidental carrier of something sensitive.
      serializers: {
        req: (req) => ({ id: req.id, method: req.method, url: req.url }),
        res: (res) => ({ statusCode: res.statusCode }),
      },
    }),
  );

  /*
   * Liveness. Performs NO dependency checks by design: a liveness probe that
   * fails when the database blips makes the platform restart a container that
   * is working perfectly (docs/10 §10.11).
   */
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  /*
   * Readiness. Reports dependency reachability and nothing else — no version,
   * no host, no connection string. Health endpoints reveal minimal
   * information (M5a §18).
   */
  app.get('/health/ready', async (_req, res) => {
    const databaseUp = await isDatabaseReachable(sql);
    res.status(databaseUp ? 200 : 503).json({
      status: databaseUp ? 'ready' : 'degraded',
      checks: { database: databaseUp ? 'up' : 'down' },
    });
  });

  app.use(createReferenceRouter(sql));

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
