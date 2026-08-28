/**
 * Announcement routes.
 *
 * Authority: docs/10 §10.14 · docs/13 §13.15 · M7 §12, §23, §40
 *
 * TWO PUBLIC READS AND ONE LOOPBACK WRITE.
 *
 * The reads take NO STUDENT CONTEXT — no branch, no semester, no profile, not
 * even an optional one. Relevance is computed in the browser from data that
 * never leaves the device, so this service cannot personalise a feed and
 * therefore cannot learn anything about who is asking (M7 §13, §40).
 *
 * The write is operator entry. There is no authentication in Stage 1, so it is
 * reachable only from the machine running the API — the same loopback boundary
 * the document routes rely on — and it CANNOT publish: an entry arrives
 * unverified like a fetched one and passes the same gate (M7 §12).
 */

import { Router, type Request, type Response } from 'express';
import express from 'express';
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

export function createAnnouncementRouter(sql: Sql): Router {
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
     * Public, and safe to cache briefly: this response is identical for every
     * visitor because it contains nothing about any of them.
     */
    res.setHeader('Cache-Control', 'public, max-age=60');
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

  /**
   * Operator entry.
   *
   * DELIBERATELY NOT A PUBLIC WRITE (M7 §12). Reachable only from the machine
   * running the API, and it accepts no verification or publication state: the
   * caller cannot publish, and the record it creates is invisible to students
   * until someone verifies it.
   */
  router.post(
    SOURCE_ROUTES.announcementEntry,
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
