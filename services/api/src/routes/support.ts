/**
 * Support routes (OBSERVABILITY-AND-SUPPORT-V1).
 *
 * TWO SURFACES:
 *   - Student: create and list ONE'S OWN problem reports. The owner is the
 *     verified session subject; a `userId`/`supportId`/`ownerId` in the body is
 *     never consulted, so a caller can only ever act on themselves.
 *   - Operator: read models across users, behind the one `OPERATOR_TOKEN`
 *     bearer gate (mounted only when that token is configured, else 404).
 *
 * Neither surface returns academic content, tokens or the internal subject.
 */

import { Router, type Request, type Response } from 'express';
import express from 'express';
import {
  OPERATOR_SUPPORT_ROUTES,
  SUPPORT_ROUTES,
  supportReportInputSchema,
  type AnonymousSupportReport,
  type SupportReportList,
} from '@gradtools/shared-types';
import type { Sql } from '../db/client.js';
import { requireOperator } from '../auth/operator.js';
import { requireSession, sessionOf, type SessionSource } from '../auth/session.js';
import { notFound } from '../http/errors.js';
import { supportIdFor } from '../support/id.js';
import { createAnonymousReport, createReport, listOwnReports } from '../support/store.js';
import * as operator from '../support/operator.js';

export interface SupportRouterDeps {
  readonly sql: Sql;
  readonly verify: SessionSource;
}

/** Student-facing: `/api/v1/me/support-reports`. Session-guarded, self-only. */
export function createSupportRouter(deps: SupportRouterDeps): Router {
  const router = Router();
  const guard = requireSession(deps.verify);

  router.use(SUPPORT_ROUTES.reports, (_req, res, next) => {
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Vary', 'Authorization');
    next();
  });

  router.post(
    SUPPORT_ROUTES.reports,
    guard,
    express.json({ limit: '16kb' }),
    async (req: Request, res: Response) => {
      const { userId } = sessionOf(req);
      const input = supportReportInputSchema.parse(req.body);
      const report = await createReport(deps.sql, {
        subject: userId,
        category: input.category,
        description: input.description,
        context: input.context,
      });
      res.status(201).json(report);
    },
  );

  router.get(SUPPORT_ROUTES.reports, guard, async (req: Request, res: Response) => {
    const { userId } = sessionOf(req);
    const body: SupportReportList = {
      supportId: supportIdFor(userId),
      reports: await listOwnReports(deps.sql, userId),
    };
    res.json(body);
  });

  return router;
}

/**
 * Public-facing: `POST /api/v1/support-reports`, UNAUTHENTICATED.
 *
 * For someone who cannot sign in. No session, no bearer token, no Support ID in
 * or out — just an Incident ID back. The body is the SAME strict schema as the
 * authenticated report (category + short description + allowlisted context), so
 * unknown or sensitive fields are rejected, not stored. It never reveals whether
 * any account exists. Rate limiting is the shared `/api/v1` limiter applied in
 * `createApp`, so this needs none of its own.
 */
export function createPublicSupportRouter(sql: Sql): Router {
  const router = Router();
  router.post(
    SUPPORT_ROUTES.anonymousReport,
    (_req, res, next) => {
      res.setHeader('Cache-Control', 'no-store');
      next();
    },
    express.json({ limit: '16kb' }),
    async (req: Request, res: Response) => {
      const input = supportReportInputSchema.parse(req.body);
      const incidentId = await createAnonymousReport(sql, {
        category: input.category,
        description: input.description,
        context: input.context,
      });
      const body: AnonymousSupportReport = { incidentId };
      res.status(201).json(body);
    },
  );
  return router;
}

/** Operator-facing support/observability API. Mounted only with an operator token. */
export function createOperatorSupportRouter(sql: Sql, operatorToken: string): Router {
  const router = Router();
  const gate = requireOperator(operatorToken);
  router.use('/api/v1/operator', (_req, res, next) => {
    res.setHeader('Cache-Control', 'private, no-store');
    next();
  });

  router.get(OPERATOR_SUPPORT_ROUTES.overview, gate, async (_req: Request, res: Response) => {
    res.json(await operator.overview(sql));
  });

  router.get(OPERATOR_SUPPORT_ROUTES.user, gate, async (req: Request, res: Response) => {
    const view = await operator.userBySupportId(sql, String(req.params.supportId));
    if (view === null) throw notFound('No user with that Support ID.');
    res.json(view);
  });

  router.get(OPERATOR_SUPPORT_ROUTES.incident, gate, async (req: Request, res: Response) => {
    const view = await operator.incident(sql, String(req.params.incidentId));
    if (view === null) throw notFound('No incident with that Incident ID.');
    res.json(view);
  });

  router.get(OPERATOR_SUPPORT_ROUTES.security, gate, async (_req: Request, res: Response) => {
    res.json({ events: await operator.security(sql) });
  });

  return router;
}
