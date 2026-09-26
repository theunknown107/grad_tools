/**
 * Announcement routes.
 *
 * Authority: docs/10 §10.14 · docs/13 §13.15 · M7 §12, §23, §40
 *
 * PUBLIC READS AND TWO OPERATOR WRITES.
 *
 * The reads take NO STUDENT CONTEXT — no branch, no semester, no profile, not
 * even an optional one. Relevance is computed in the browser from data that
 * never leaves the device, so this service cannot personalise a feed and
 * therefore cannot learn anything about who is asking (M7 §13, §40).
 *
 * The writes are operator entry and publication. They are mounted ONLY when
 * the deployment has an `OPERATOR_TOKEN`, and every call must present it as a
 * bearer token. Without the token configured they do not exist (404), so a
 * public deployment with no operator has no write path here at all. Entry
 * still CANNOT publish: an entry arrives unverified like a fetched one and
 * passes the same gate (M7 §12).
 *
 * `verifiedBy` is a label the operator writes, not an identity: there is one
 * operator credential, not per-person accounts. Only the token holder can set
 * it, so nobody without the token can put a name on a publication.
 */

import { Router, type NextFunction, type Request, type Response } from 'express';
import express from 'express';
import { createHash, timingSafeEqual } from 'node:crypto';
import {
  SOURCE_ROUTES,
  announcementCategorySchema,
  announcementEntrySchema,
  subjectIdSchema,
} from '@gradtools/shared-types';
import type { Sql } from '../db/client.js';
import * as queries from '../db/queries.js';
import { normalizeAnnouncement } from '../announcements/normalize.js';
import { publishAnnouncement, upsertAnnouncement } from '../announcements/store.js';
import { ApiError, notFound } from '../http/errors.js';

/** A page a phone can render and a server can produce without straining. */
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

/** Hashing both sides first gives equal-length buffers, so the comparison is constant-time. */
function digest(value: string): Buffer {
  return createHash('sha256').update(value).digest();
}

/**
 * Admits a request only if it carries the operator token.
 *
 * One answer for every failure — missing header, wrong scheme, wrong token —
 * so the endpoint cannot be used to tell a near guess from a far one.
 */
function requireOperator(token: string) {
  const expected = digest(token);
  return (req: Request, _res: Response, next: NextFunction): void => {
    const header = req.headers.authorization ?? '';
    const presented = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : '';
    if (presented === '' || !timingSafeEqual(digest(presented), expected)) {
      next(new ApiError('UNAUTHENTICATED', 'Operator authorization is required.'));
      return;
    }
    next();
  };
}

export function createAnnouncementRouter(
  sql: Sql,
  options: { readonly operatorToken?: string | undefined } = {},
): Router {
  const router = Router();

  /**
   * The student feed.
   *
   * Published and verified only — the gate is in the query as well as in the
   * schema, so an unvalidated notice would have to defeat both to be served.
   */
  router.get(SOURCE_ROUTES.announcements, async (req: Request, res: Response) => {
    const rawLimit = Number(req.query.limit ?? DEFAULT_LIMIT);
    const rawOffset = Number(req.query.offset ?? 0);
    const limit = Number.isFinite(rawLimit)
      ? Math.min(Math.max(1, rawLimit), MAX_LIMIT)
      : DEFAULT_LIMIT;
    const offset = Number.isFinite(rawOffset) ? Math.max(0, rawOffset) : 0;

    /*
     * An unknown category is a client mistake, not an empty feed. Silently
     * returning everything would make a typo look like "there is nothing in
     * that category", which is a different and misleading answer.
     */
    const categoryParam = req.query.category;
    const category =
      typeof categoryParam === 'string' && categoryParam !== '' && categoryParam !== 'all'
        ? announcementCategorySchema.parse(categoryParam)
        : undefined;

    const sourceParam = req.query.source;
    const sourceId =
      typeof sourceParam === 'string' && sourceParam !== '' && sourceParam !== 'all'
        ? sourceParam
        : undefined;

    const { items, total } = await queries.listPublishedAnnouncements(sql, {
      category,
      sourceId,
      limit,
      offset,
    });

    /*
     * Public — identical for every visitor, because it contains nothing about
     * any of them — but revalidated on every use. The app refreshes this feed
     * when a student returns to the tab, and a minute of `max-age` would answer
     * that refresh from the browser's cache and hide a notice published since.
     * Express's ETag keeps an unchanged feed to a 304.
     */
    res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
    res.json({ data: items, total, limit, offset });
  });

  /** The filters that would actually return something (M7 §24). */
  router.get('/api/v1/announcements/filters', async (_req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'public, max-age=60');
    res.json(await queries.listAnnouncementFilters(sql));
  });

  router.get(SOURCE_ROUTES.announcement(':id'), async (req: Request, res: Response) => {
    const id = subjectIdSchema.parse(req.params.id);
    const announcement = await queries.findPublishedAnnouncement(sql, id);
    // An unpublished notice is NOT FOUND rather than forbidden: "it exists but
    // you may not see it" is itself information about unreleased content.
    if (!announcement) throw notFound(`No announcement with id "${id}".`);
    res.setHeader('Cache-Control', 'public, max-age=60');
    res.json(announcement);
  });

  // No operator configured: the writes are not mounted, so they 404.
  if (options.operatorToken === undefined) return router;
  const operator = requireOperator(options.operatorToken);

  /**
   * Operator entry.
   *
   * DELIBERATELY NOT A PUBLIC WRITE (M7 §12). Only the operator token admits
   * it, and it accepts no verification or publication state: the caller cannot
   * publish, and the record it creates is invisible to students until someone
   * verifies it.
   */
  router.post(
    SOURCE_ROUTES.announcementEntry,
    operator,
    express.json({ limit: '128kb' }),
    async (req: Request, res: Response) => {
      const entry = announcementEntrySchema.parse(req.body);

      const normalized = normalizeAnnouncement({
        publisher: entry.publisher,
        title: entry.title,
        body: entry.body ?? null,
        category: entry.category,
        canonicalUrl: entry.canonicalUrl ?? null,
        publishedAt: entry.publishedAt ?? null,
        eventStartAt: entry.eventStartAt ?? null,
        deadlineAt: entry.deadlineAt ?? null,
        externalId: null,
      });

      if (!normalized.ok) throw new ApiError('VALIDATION_FAILED', normalized.reason);

      const outcome = await upsertAnnouncement(sql, {
        normalized: normalized.value,
        origin: entry.origin,
        // No source row: an operator entry has provenance but no automated
        // source behind it, and inventing one would put a fetch target in the
        // registry that nobody fetches.
        sourceId: null,
        audience: {
          schemeId: entry.audience?.schemeId ?? null,
          branchId: entry.audience?.branchId ?? null,
          branchName: entry.audience?.branchName ?? null,
          collegeId: entry.audience?.collegeId ?? null,
          collegeName: entry.audience?.collegeName ?? null,
          semester: entry.audience?.semester ?? null,
        },
      });

      res.setHeader('Cache-Control', 'private, no-store');
      res.status(201).json({ ...outcome, published: false });
    },
  );

  /**
   * Verify and publish. The act that makes a notice student-visible.
   *
   * Separate from entry ON PURPOSE: storing a notice and vouching for it are
   * different decisions, and collapsing them would mean anything typed in was
   * published by the act of typing it.
   */
  router.post(
    '/api/v1/announcements/:id/publish',
    operator,
    express.json({ limit: '4kb' }),
    async (req: Request, res: Response) => {
      const id = subjectIdSchema.parse(req.params.id);
      const body = req.body as { verifiedBy?: unknown };
      const verifiedBy =
        typeof body.verifiedBy === 'string' && body.verifiedBy.trim() !== ''
          ? body.verifiedBy.trim().slice(0, 120)
          : null;

      // An unattributed verification is not a verification.
      if (verifiedBy === null) {
        throw new ApiError('VALIDATION_FAILED', 'Say who is verifying this announcement.');
      }

      const ok = await publishAnnouncement(sql, id, verifiedBy);
      if (!ok) throw notFound(`No announcement with id "${id}".`);

      res.setHeader('Cache-Control', 'private, no-store');
      res.json({ id, published: true, verifiedBy });
    },
  );

  return router;
}
