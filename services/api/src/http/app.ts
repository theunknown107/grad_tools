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
import { LocalObjectStore, type ObjectStore } from '../documents/storage.js';
import { createQuestionPaperRouter } from '../routes/question-papers.js';
import { createStudentRouter } from '../routes/me.js';
import { createAccountDeleter, createCloudClient } from '../db/cloud.js';
import { authConfigFor, createVerifier } from '../auth/session.js';
import { createAnnouncementRouter } from '../routes/announcements.js';
import { createDocumentRouter } from '../routes/documents.js';
import { createReferenceRouter } from '../routes/reference.js';
import { errorHandler, notFoundHandler } from './errors.js';

/**
 * The URL as it may be written to a log.
 *
 * A LIBRARY SEARCH IS THE ONE QUERY PARAMETER THAT REFLECTS A PERSON rather
 * than a filter (M8 §27). Students type all sorts of things into a search box,
 * and none of it needs to survive in an operational log to diagnose a request.
 * The parameter's presence is kept, its value is not.
 */
function redactQuery(url: string | undefined): string | undefined {
  if (url === undefined || !url.includes('search=')) return url;
  return url.replace(/([?&]search=)[^&]*/g, '$1[redacted]');
}

export function createApp(
  config: Config,
  sql: Sql,
  logger: Logger,
  /*
   * Injected so tests can use an in-memory store. The default is the local
   * filesystem driver rooted at the configured path, which lives outside the
   * repository and outside any served directory (docs/25 §25.6.3).
   */
  store: ObjectStore = new LocalObjectStore(config.DOCUMENT_STORAGE_ROOT),
  /*
   * The student cloud, when this deployment has one (M9).
   *
   * Injected rather than constructed here so a test can supply an RLS-scoped
   * connection to a local database and its own verifier, and so a deployment
   * without Supabase configured simply has no student routes — rather than
   * having them and failing at the first query.
   */
  cloud?: {
    readonly sql: Sql;
    readonly verify: ReturnType<typeof createVerifier>;
    readonly deleteAccount?: (userId: string) => Promise<boolean>;
  },
): Express {
  const app = express();

  // Express advertises itself by default; there is no reason to tell an
  // attacker which framework and version to look up (docs/13 §13.5).
  app.disable('x-powered-by');

  /*
   * `<`, `>` and `&` are emitted as \uXXXX escapes in every JSON response.
   *
   * Defence in depth for M5A.5: extracted question text comes out of a PDF
   * anyone could have crafted, and a response that is never valid HTML cannot
   * be turned into markup by a client that mis-handles the content type. React
   * escaping at render is the primary defence; this closes the gap before the
   * bytes leave (docs/13 §T-21, M5A.5 §21).
   */
  app.set('json escape', true);

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
        req: (req) => ({ id: req.id, method: req.method, url: redactQuery(req.url) }),
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

  app.use(createAnnouncementRouter(sql));
  /*
   * STUDENT ROUTES ARE MOUNTED ONLY WHERE A CLOUD EXISTS.
   *
   * A deployment with no Supabase configuration serves the public surface and
   * nothing else — there is no half-configured state in which `/api/v1/me`
   * exists but cannot authorize anybody (docs/25 §25.15).
   */
  const student =
    cloud ??
    (config.SUPABASE_URL !== undefined && config.SUPABASE_DB_URL !== undefined
      ? {
          sql: createCloudClient({ url: config.SUPABASE_DB_URL }),
          verify: createVerifier(authConfigFor(config.SUPABASE_URL)),
          /*
           * Account deletion needs to reach `auth.users`, which the student
           * connection cannot write. Where no admin connection is configured
           * the route reports itself unavailable rather than half working
           * (docs/25 §25.15).
           */
          ...(config.SUPABASE_ADMIN_DB_URL === undefined
            ? {}
            : {
                deleteAccount: createAccountDeleter(
                  createCloudClient({ url: config.SUPABASE_ADMIN_DB_URL, max: 2 }),
                ),
              }),
        }
      : undefined);

  if (student !== undefined) {
    app.use(
      createStudentRouter({
        cloud: student.sql,
        verify: student.verify,
        ...(student.deleteAccount === undefined ? {} : { deleteAccount: student.deleteAccount }),
      }),
    );
  }

  app.use(createQuestionPaperRouter(sql, store, config.allowedOrigins));
  app.use(createDocumentRouter(sql, store));
  app.use(createReferenceRouter(sql));

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
