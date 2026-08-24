/**
 * Read-only reference-data routes.
 *
 * Authority: docs/10_API_SPECIFICATION.md §10.7
 *
 * Everything here is public, read-only, cacheable academic reference data.
 * There are no write endpoints and no student-scoped endpoints in this
 * milestone, which is why there is no authorization guard: there is nothing
 * to authorize. The moment a student-scoped route is added, the guard rules in
 * docs/11 §11.5 and the authorization test matrix in docs/22 §22.4 apply.
 */

import { Router, type Request, type Response } from 'express';
import { API_ROUTES, referenceIdSchema, subjectQuerySchema } from '@gradtools/shared-types';
import type { Sql } from '../db/client.js';
import * as queries from '../db/queries.js';
import { notFound } from '../http/errors.js';

/**
 * Cache headers for reference data.
 *
 * Reference data changes once per scheme revision, so a short max-age with a
 * long stale-while-revalidate gives near-instant repeat loads with bounded
 * staleness (docs/07 §7.8). `public` is correct precisely because none of this
 * is student-specific — a student-scoped response would be `private, no-store`.
 */
const REFERENCE_CACHE = 'public, max-age=300, stale-while-revalidate=3600';

function sendList<T>(res: Response, data: T[]): void {
  res.setHeader('Cache-Control', REFERENCE_CACHE);
  res.json({ data });
}

export function createReferenceRouter(sql: Sql): Router {
  const router = Router();

  router.get(API_ROUTES.universities, async (_req: Request, res: Response) => {
    sendList(res, await queries.listUniversities(sql));
  });

  router.get(API_ROUTES.schemes, async (_req: Request, res: Response) => {
    sendList(res, await queries.listSchemes(sql));
  });

  router.get('/api/v1/schemes/:id', async (req: Request, res: Response) => {
    const id = referenceIdSchema.parse(req.params.id);
    const scheme = await queries.findScheme(sql, id);
    if (!scheme) throw notFound(`No published scheme with id "${id}".`);
    res.setHeader('Cache-Control', REFERENCE_CACHE);
    res.json(scheme);
  });

  /**
   * Rule-set METADATA for a scheme.
   *
   * Publishing the rule set is itself a trust feature: it lets the client show
   * which thresholds and clause citations produced a number, without the
   * client hard-coding any of them (docs/10 §10.7).
   *
   * The server does not compute anything here. Calculation stays in
   * @gradtools/academic-rules on the caller's side.
   */
  router.get('/api/v1/schemes/:id/rules', async (req: Request, res: Response) => {
    const id = referenceIdSchema.parse(req.params.id);
    const ruleSet = await queries.findActiveRuleSetForScheme(sql, id);
    if (!ruleSet) throw notFound(`No active published rule set for scheme "${id}".`);
    res.setHeader('Cache-Control', REFERENCE_CACHE);
    res.json(ruleSet);
  });

  router.get(API_ROUTES.branches, async (_req: Request, res: Response) => {
    sendList(res, await queries.listBranches(sql));
  });

  router.get(API_ROUTES.colleges, async (_req: Request, res: Response) => {
    sendList(res, await queries.listColleges(sql));
  });

  router.get(API_ROUTES.subjects, async (req: Request, res: Response) => {
    const query = subjectQuerySchema.parse(req.query);
    sendList(res, await queries.listSubjects(sql, query));
  });

  router.get('/api/v1/subjects/:code', async (req: Request, res: Response) => {
    const code = referenceIdSchema.parse(req.params.code);
    const subject = await queries.findSubjectByCode(sql, code);
    if (!subject) throw notFound(`No published subject with code "${code}".`);
    res.setHeader('Cache-Control', REFERENCE_CACHE);
    res.json(subject);
  });

  /**
   * Syllabus modules for a subject.
   *
   * An empty array is a legitimate answer, not a 404: the subject exists and
   * is published, but its modules have not been verified yet. Distinguishing
   * "no such subject" from "this subject's syllabus is not verified" matters,
   * because the second is a data-completeness state the UI should say out loud
   * rather than presenting as a missing page.
   */
  router.get('/api/v1/subjects/:code/syllabus', async (req: Request, res: Response) => {
    const code = referenceIdSchema.parse(req.params.code);
    const subject = await queries.findSubjectByCode(sql, code);
    if (!subject) throw notFound(`No published subject with code "${code}".`);
    sendList(res, await queries.listSyllabusModules(sql, code));
  });

  return router;
}
