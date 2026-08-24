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
import {
  API_ROUTES,
  referenceIdSchema,
  ruleSetQuerySchema,
  subjectIdSchema,
  subjectQuerySchema,
  SOURCE_ROUTES,
} from '@gradtools/shared-types';
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
    // Optional `?college=` selects a college-specific rule set where one is
    // active, falling back to the scheme-wide set (M4.1 §3).
    const { college } = ruleSetQuerySchema.parse(req.query);
    const ruleSet = await queries.findActiveRuleSetForScheme(sql, id, college);
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

  /**
   * A subject by its UUID.
   *
   * Addressed by id rather than by code because `(scheme_id, branch_id, code)`
   * is what is unique — the same code recurs across branches and schemes, so a
   * code-addressed route had to pick one arbitrarily (M4.1 §2). A caller who
   * has a code filters the collection instead.
   */
  router.get('/api/v1/subjects/:id', async (req: Request, res: Response) => {
    const id = subjectIdSchema.parse(req.params.id);
    const subject = await queries.findSubjectById(sql, id);
    if (!subject) throw notFound(`No published subject with id "${id}".`);
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
  router.get('/api/v1/subjects/:id/syllabus', async (req: Request, res: Response) => {
    const id = subjectIdSchema.parse(req.params.id);
    const subject = await queries.findSubjectById(sql, id);
    if (!subject) throw notFound(`No published subject with id "${id}".`);
    sendList(res, await queries.listSyllabusModules(sql, id));
  });

  /* ---------------------------------------------------------------------- */
  /* Sources and documents (M5)                                             */
  /* ---------------------------------------------------------------------- */

  /**
   * The source registry, published deliberately.
   *
   * Showing what GradTools reads, whether robots and terms permit it, and
   * whether it is switched on turns a claim into something a student or a
   * college can check (docs/14 §14.7.1). Every seeded source is currently
   * disabled, and this endpoint is how that is verifiable from outside.
   */
  router.get(SOURCE_ROUTES.sources, async (_req: Request, res: Response) => {
    sendList(res, await queries.listSources(sql));
  });

  router.get('/api/v1/sources/:id', async (req: Request, res: Response) => {
    const id = referenceIdSchema.parse(req.params.id);
    const source = await queries.findSource(sql, id);
    if (!source) throw notFound(`No source with id "${id}".`);
    res.setHeader('Cache-Control', REFERENCE_CACHE);
    res.json(source);
  });

  /**
   * Document METADATA only.
   *
   * There is no route that serves a document file, in this milestone or in this
   * file. Hosting requires a rights determination that does not exist yet
   * (OQ-008), so a `link` document is metadata plus the original URL and a
   * `private` document does not appear here at all (M5 §9, §17).
   */
  router.get(SOURCE_ROUTES.documents, async (_req: Request, res: Response) => {
    sendList(res, await queries.listPublicDocuments(sql));
  });

  router.get('/api/v1/documents/:id', async (req: Request, res: Response) => {
    const id = subjectIdSchema.parse(req.params.id);
    const document = await queries.findPublicDocument(sql, id);
    if (!document) throw notFound(`No document with id "${id}".`);
    res.setHeader('Cache-Control', REFERENCE_CACHE);
    res.json(document);
  });

  return router;
}
