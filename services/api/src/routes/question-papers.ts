/**
 * The question-paper library.
 *
 * Authority: docs/10 §10.15 · docs/13 §13.16 · docs/17 §17.13 · M8 §28–§31
 *
 * A READ-ONLY VIEW OVER `documents`. There is no library table, no library
 * write and no second visibility rule (M8 §4, §29) — the same two conditions
 * that decide whether a document may be listed decide whether a paper appears
 * here, and `private` and `blocked` fail them in the query rather than in a
 * filter someone can forget to apply.
 *
 * THE FILE ROUTE IS THE ONE NEW POWER IN THIS MILESTONE, so it is worth being
 * explicit about what it is not:
 *
 * - It is not a file server. The only parameter is an opaque document id; the
 *   storage key is looked up server-side, and no path, key or filename is
 *   accepted from a client under any name (M8 §30).
 * - It is not a proxy. A `link` paper has no bytes here, and this route will
 *   not fetch them from the origin — that is what the link itself is for
 *   (M8 §15).
 * - It serves only `host`, which the database will not permit without a dated
 *   rights determination. Since `OQ-008` is unresolved, the only papers that
 *   legitimately reach `host` today are ones GradTools itself authored.
 */

import { Router, type Request, type Response } from 'express';
import {
  SOURCE_ROUTES,
  paperFormatSchema,
  paperSortSchema,
  subjectIdSchema,
} from '@gradtools/shared-types';
import type { Sql } from '../db/client.js';
import * as queries from '../db/queries.js';
import type { ObjectStore } from '../documents/storage.js';
import { notFound } from '../http/errors.js';

/** A page a phone can render without scrolling for a minute. */
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

/** The longest search a student could plausibly mean (M8 §27). */
const MAX_SEARCH = 100;

function intParam(raw: unknown, min: number, max: number): number | undefined {
  if (typeof raw !== 'string' || raw === '' || raw === 'all') return undefined;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) return undefined;
  return value;
}

function textParam(raw: unknown): string | undefined {
  return typeof raw === 'string' && raw !== '' && raw !== 'all' ? raw : undefined;
}

export function createQuestionPaperRouter(
  sql: Sql,
  store: ObjectStore,
  /** The origins allowed to frame a hosted paper. Same list CORS uses. */
  allowedOrigins: readonly string[],
): Router {
  const router = Router();

  /**
   * The library listing.
   *
   * NO STUDENT CONTEXT IS ACCEPTED (M8 §25), exactly as for announcements: the
   * response is the public library, identical for every visitor, and the
   * browser decides what is relevant to whoever is looking. A semester
   * parameter would be indistinguishable from a semester parameter used to
   * profile, so there is not one.
   *
   * An out-of-range filter value is IGNORED rather than rejected. Unlike a
   * category, these come from a URL a student may have edited or shared, and
   * `semester=99` is far more likely to be a stale link than an attack —
   * showing the unfiltered library is the more useful answer than an error.
   */
  router.get(SOURCE_ROUTES.questionPapers, async (req: Request, res: Response) => {
    const search = textParam(req.query.search)?.slice(0, MAX_SEARCH);
    const format = textParam(req.query.format);
    const sort = textParam(req.query.sort);
    const limit = intParam(req.query.limit, 1, MAX_LIMIT) ?? DEFAULT_LIMIT;
    const offset = intParam(req.query.offset, 0, 1_000_000) ?? 0;

    const { items, total } = await queries.listQuestionPapers(sql, {
      subjectCode: textParam(req.query.subject),
      schemeId: textParam(req.query.scheme),
      branchId: textParam(req.query.branch),
      semester: intParam(req.query.semester, 1, 8),
      year: intParam(req.query.year, 2015, 2100),
      // A format outside the enum is dropped rather than passed to a cast that
      // would fail in the database.
      format: paperFormatSchema.safeParse(format).success ? format : undefined,
      sourceId: textParam(req.query.source),
      search,
      sort: paperSortSchema.safeParse(sort).success ? sort : undefined,
      limit,
      offset,
    });

    /*
     * Cacheable when it is the plain library, private when it carries a search
     * term. A search is the one part of this endpoint that reflects what a
     * particular person was looking for, and a shared cache is the wrong place
     * for that however harmless the term (M8 §27).
     */
    res.setHeader(
      'Cache-Control',
      search === undefined ? 'public, max-age=60' : 'private, no-store',
    );
    res.json({ data: items, total, limit, offset });
  });

  /** The filter values that would actually return something (M8 §10). */
  router.get(SOURCE_ROUTES.questionPaperFilters, async (_req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'public, max-age=60');
    res.json(await queries.listQuestionPaperFilters(sql));
  });

  router.get(SOURCE_ROUTES.questionPaper(':id'), async (req: Request, res: Response) => {
    const id = subjectIdSchema.parse(req.params.id);
    const paper = await queries.findQuestionPaper(sql, id);
    if (paper === null) throw notFound(`No question paper with id "${id}".`);
    res.setHeader('Cache-Control', 'public, max-age=60');
    res.json(paper);
  });

  /**
   * The bytes of a hosted paper.
   *
   * `inline` rather than `attachment`: the point of hosting is that a student
   * can read the paper without leaving, and the browser's own PDF viewer is a
   * better one than anything worth building here (M8 §35).
   *
   * `X-Content-Type-Options: nosniff` and a fixed `application/pdf` mean the
   * response cannot be re-interpreted as HTML, and `Content-Disposition`
   * carries a generated filename rather than anything stored — the original
   * filename is user-supplied text and has no business in a header.
   */
  router.get(SOURCE_ROUTES.questionPaperFile(':id'), async (req: Request, res: Response) => {
    const id = subjectIdSchema.parse(req.params.id);
    const file = await queries.findHostedPaperFile(sql, id);
    // Covers "does not exist", "is not a paper", "is not hosted" and "has no
    // stored bytes" with one answer. Distinguishing them would tell a caller
    // which private documents exist.
    if (file === null) throw notFound(`No hosted file for question paper "${id}".`);

    const bytes = await store.get(file.storageKey);

    /*
     * THE ONE PLACE THIS API PERMITS FRAMING, and narrowly.
     *
     * The app-wide policy is `frame-ancestors 'none'` with `X-Frame-Options:
     * DENY` (docs/13 §13.5), which is right for a JSON API and would also stop
     * a student's browser from showing this PDF inside the paper page. So the
     * exception is made here and only here: the same origins CORS already
     * trusts, no wildcard, and `default-src 'none'` still refuses everything
     * else the response could try to load.
     *
     * `X-Frame-Options` is REMOVED rather than loosened — it has no origin
     * list, so leaving it set to DENY would override the CSP in browsers that
     * honour both.
     */
    const ancestors = allowedOrigins.length === 0 ? "'none'" : allowedOrigins.join(' ');
    res.setHeader('Content-Security-Policy', `default-src 'none'; frame-ancestors ${ancestors}`);
    res.removeHeader('X-Frame-Options');

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Disposition', `inline; filename="paper-${id}.pdf"`);
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.send(bytes);
  });

  return router;
}
