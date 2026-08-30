/**
 * The student's own data.
 *
 * Authority: docs/10 §10.16 · docs/13 §13.17 · M9 §14, §41, §42, §43
 *
 * ---------------------------------------------------------------------------
 * THERE IS NO IDENTIFIER IN ANY PATH HERE
 * ---------------------------------------------------------------------------
 *
 * Every route is `me`. The owner comes from a signature this server verified,
 * so there is nothing in a URL for a caller to substitute and no parameter that
 * could name somebody else's records (M9 §42). IDOR is not defended against on
 * these routes; it has no surface to attack.
 *
 * Ownership is then enforced a second time, by the database, because every
 * query runs inside `withUser` and every table is RLS-scoped to `auth.uid()`.
 * A mistake in this file returns the caller's own rows, not another student's.
 *
 * ---------------------------------------------------------------------------
 * THE PUBLIC/PRIVATE LINE
 * ---------------------------------------------------------------------------
 *
 * Reference data, announcements and the question-paper library stay public and
 * unauthenticated (docs/10 §10.14, §10.15). Everything in this file requires a
 * session, and nothing that used to be local has been made public by acquiring
 * a cloud copy (M9 §43).
 */

import { Router, type Request, type Response } from 'express';
import express from 'express';
import {
  STUDENT_ROUTES,
  profileInputSchema,
  syncPushSchema,
  type CloudProfile,
  type SyncOutcome,
  type SyncRecord,
} from '@gradtools/shared-types';
import type { Sql } from '../db/client.js';
import { withUser } from '../db/cloud.js';
import { requireSession, sessionOf, type Verifier } from '../auth/session.js';
import { ApiError, notFound } from '../http/errors.js';
import {
  COLLECTION_TABLES,
  pullChanges,
  pushRecord,
  readProfile,
  upsertProfile,
} from '../student/store.js';

export interface StudentRouterDeps {
  readonly cloud: Sql;
  readonly verify: Verifier;
  /** Present only where account deletion is possible. See `deleteAccount`. */
  readonly deleteAccount?: (userId: string) => Promise<void>;
}

export function createStudentRouter(deps: StudentRouterDeps): Router {
  const router = Router();
  const guard = requireSession(deps.verify);

  /*
   * Student data is NEVER cacheable, anywhere, by anyone. `no-store` on every
   * response in this file, set once so no individual handler can forget.
   */
  router.use('/api/v1/me', (_req, res, next) => {
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Vary', 'Authorization');
    next();
  });

  /* ---------------------------------------------------------------------- */
  /* Who am I                                                               */
  /* ---------------------------------------------------------------------- */

  /**
   * The signed-in student, and whether they have a profile yet.
   *
   * The email is echoed from the VERIFIED token for display only. It is not
   * read from the database and nothing is looked up by it (M9 §12).
   */
  router.get(STUDENT_ROUTES.me, guard, async (req: Request, res: Response) => {
    const session = sessionOf(req);
    const profile = await withUser(deps.cloud, session, (tx) => readProfile(tx));

    res.json({
      identity: {
        userId: session.userId,
        email: typeof session.claims.email === 'string' ? session.claims.email : null,
        provider:
          typeof (session.claims as { app_metadata?: { provider?: unknown } }).app_metadata
            ?.provider === 'string'
            ? (session.claims as { app_metadata: { provider: string } }).app_metadata.provider
            : null,
      },
      profile,
      /* A student with no cloud profile has not finished onboarding. */
      onboarded: profile !== null,
    });
  });

  /* ---------------------------------------------------------------------- */
  /* The profile                                                            */
  /* ---------------------------------------------------------------------- */

  /**
   * Create or update the profile.
   *
   * `baseRevision` is how a second device is stopped from silently overwriting
   * the first. Absent means "I am creating this"; present and stale means
   * CONFLICT, returned with the server's version so the student can choose
   * (M9 §28).
   */
  router.put(
    STUDENT_ROUTES.meProfile,
    guard,
    express.json({ limit: '32kb' }),
    async (req: Request, res: Response) => {
      const session = sessionOf(req);
      const input = profileInputSchema.parse(req.body);

      const outcome = await withUser(deps.cloud, session, (tx) => upsertProfile(tx, input));

      if (outcome.kind === 'conflict') {
        res.status(409).json({
          error: {
            code: 'CONFLICT',
            message: 'This profile changed on another device.',
          },
          server: outcome.server,
        });
        return;
      }

      res.json(outcome.profile satisfies CloudProfile);
    },
  );

  /* ---------------------------------------------------------------------- */
  /* Sync                                                                   */
  /* ---------------------------------------------------------------------- */

  /**
   * Pull everything that changed since a cursor.
   *
   * Tombstones are INCLUDED. A deletion is a change like any other, and a pull
   * that omitted them would resurrect deleted records on the next push
   * (M9 §68).
   */
  router.get(STUDENT_ROUTES.meSync, guard, async (req: Request, res: Response) => {
    const session = sessionOf(req);
    const rawSince = req.query.since;
    const since =
      typeof rawSince === 'string' && rawSince !== '' && !Number.isNaN(Date.parse(rawSince))
        ? new Date(rawSince).toISOString()
        : null;

    const result = await withUser(deps.cloud, session, async (tx) => ({
      profile: await readProfile(tx),
      records: await pullChanges(tx, since),
    }));

    res.json({
      ...result,
      // The cursor the client should send next time. Taken from the server's
      // clock, never the device's — a device with a fast clock would otherwise
      // skip records written in the gap.
      syncedAt: new Date().toISOString(),
    } satisfies { profile: CloudProfile | null; records: SyncRecord[]; syncedAt: string });
  });

  /**
   * Push local changes.
   *
   * EVERY RECORD GETS ITS OWN OUTCOME. A push is not all-or-nothing: one
   * conflicting attendance row must not prevent six other edits from landing,
   * and the student needs to be told precisely which record needs them.
   */
  router.post(
    STUDENT_ROUTES.meSync,
    guard,
    express.json({ limit: '2mb' }),
    async (req: Request, res: Response) => {
      const session = sessionOf(req);
      const push = syncPushSchema.parse(req.body);

      if (push.records.length > 500) {
        throw new ApiError('VALIDATION_FAILED', 'Too many records in one sync. Send fewer.');
      }

      const outcomes = await withUser(deps.cloud, session, async (tx) => {
        const profile = await readProfile(tx);
        if (profile === null) {
          throw new ApiError(
            'VALIDATION_FAILED',
            'Set up your profile before syncing academic records.',
          );
        }

        const results: SyncOutcome[] = [];
        for (const record of push.records) {
          results.push(await pushRecord(tx, profile.id, record));
        }
        return results;
      });

      res.json({ outcomes, syncedAt: new Date().toISOString() });
    },
  );

  /* ---------------------------------------------------------------------- */
  /* Export                                                                 */
  /* ---------------------------------------------------------------------- */

  /**
   * Everything the cloud holds about this student (M9 §35).
   *
   * Produced through the same RLS-scoped connection as every other read, so
   * "only their own records" is a database guarantee rather than a filter
   * somebody remembered to write. No token, no provider secret and no internal
   * identifier belonging to anyone else appears in it.
   */
  router.get(STUDENT_ROUTES.meExport, guard, async (req: Request, res: Response) => {
    const session = sessionOf(req);

    const payload = await withUser(deps.cloud, session, async (tx) => {
      const profile = await readProfile(tx);
      const records: Record<string, unknown[]> = {};
      for (const collection of Object.keys(COLLECTION_TABLES)) {
        const rows = await pullChanges(tx, null, collection);
        records[collection] = rows.map((row) => ({
          id: row.id,
          ...row.data,
          updatedAt: row.updatedAt,
          deletedAt: row.deletedAt,
        }));
      }
      return { profile, records };
    });

    res.setHeader('Content-Disposition', 'attachment; filename="gradtools-export.json"');
    res.json({
      exportedAt: new Date().toISOString(),
      format: 'gradtools.student.v1',
      identity: {
        userId: session.userId,
        email: typeof session.claims.email === 'string' ? session.claims.email : null,
      },
      ...payload,
    });
  });

  /* ---------------------------------------------------------------------- */
  /* Deletion                                                               */
  /* ---------------------------------------------------------------------- */

  /**
   * Delete the account and everything in it.
   *
   * COMPLETE DELETION IS THE DEFAULT and there is no retention exception
   * (M9 §34). Removing the `auth.users` row cascades through every student
   * table by foreign key, so there is no list of tables here to fall out of
   * date — the schema deletes itself.
   *
   * Local data on the device is NOT touched by this route, and the interface
   * says so: it is the student's copy, on their machine, and deleting the cloud
   * account is not consent to wipe their phone (M9 §36).
   */
  router.delete(STUDENT_ROUTES.me, guard, async (req: Request, res: Response) => {
    const session = sessionOf(req);
    const deleteAccount = deps.deleteAccount;

    if (deleteAccount === undefined) {
      throw new ApiError(
        'DEPENDENCY_UNAVAILABLE',
        'Account deletion is not available on this deployment. See docs/25 §25.15.',
      );
    }

    await deleteAccount(session.userId);
    res.status(200).json({ deleted: true });
  });

  return router;
}

/** Kept so a caller cannot import a not-found helper by accident. */
export { notFound };
