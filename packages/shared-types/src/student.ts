/**
 * The student cloud contract.
 *
 * Authority: docs/08 §8.17 · docs/10 §10.16 · M9 §13, §26, §28, §60
 *
 * ---------------------------------------------------------------------------
 * PROVIDER-AGNOSTIC BY CONSTRUCTION
 * ---------------------------------------------------------------------------
 *
 * Nothing here names Supabase. The domain knows `authUserId` — an opaque
 * identity string — and knows nothing about who issued it (M9 §61). Swapping
 * identity providers later is a change in one adapter, not a change to every
 * record shape in the product.
 *
 * ---------------------------------------------------------------------------
 * EVERY SYNCED RECORD CARRIES ITS REVISION
 * ---------------------------------------------------------------------------
 *
 * `revision` is what makes conflict detection possible and "last write wins"
 * avoidable. A client sends the revision it read; the server compares; a
 * mismatch is a CONFLICT the student is shown, not an overwrite they never
 * learn about (M9 §28).
 *
 * Timestamps cannot do this job. Two devices with skewed clocks produce a
 * confident, wrong winner — and for an attendance counter that means a count
 * silently going backwards.
 */

import { z } from 'zod';

/* -------------------------------------------------------------------------- */
/* Identity                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Who the signed-in person is, as the app is allowed to know them.
 *
 * `email` is DISPLAY ONLY and is never an identity key (M9 §12, §47). It can
 * change, it can be an Apple private relay address, and it can differ between
 * providers for the same human. `userId` is the only thing anything joins on.
 */
export const authIdentitySchema = z.object({
  userId: z.string().min(1),
  email: z.string().nullable(),
  /** `google`, `apple`, `email` — shown in account settings, never trusted. */
  provider: z.string().nullable(),
});

export type AuthIdentity = z.infer<typeof authIdentitySchema>;

/* -------------------------------------------------------------------------- */
/* The cloud profile                                                          */
/* -------------------------------------------------------------------------- */

/** NO DATE OF BIRTH, and none may be added (DEC-008). USN is optional (M9 §33). */
export const cloudProfileSchema = z.object({
  id: z.string(),
  displayName: z.string().nullable(),
  usn: z.string().nullable(),
  collegeName: z.string().nullable(),
  schemeId: z.string(),
  branch: z.string().nullable(),
  currentSemester: z.number().int().min(1).max(8).nullable(),
  revision: z.number().int().positive(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type CloudProfile = z.infer<typeof cloudProfileSchema>;

/** What a client may set. `revision` is the server's, never the client's. */
export const profileInputSchema = z.object({
  displayName: z.string().min(1).max(100).nullable().optional(),
  usn: z.string().min(1).max(20).nullable().optional(),
  collegeName: z.string().min(1).max(200).nullable().optional(),
  schemeId: z.string().min(1).max(40),
  branch: z.string().min(1).max(120).nullable().optional(),
  currentSemester: z.number().int().min(1).max(8).nullable().optional(),
  /** The revision the client read. Omitted only when creating. */
  baseRevision: z.number().int().positive().optional(),
});

export type ProfileInput = z.infer<typeof profileInputSchema>;

/* -------------------------------------------------------------------------- */
/* Synced collections                                                         */
/* -------------------------------------------------------------------------- */

/**
 * WHAT SYNCS, AND WHAT DELIBERATELY DOES NOT (M9 §53).
 *
 * These seven are the student's academic facts — the things that would be lost
 * with a broken phone and are worth carrying between devices.
 *
 * Not synced, on purpose:
 *   - notification read state and preferences. Per-device by design (docs/08
 *     §8.15); "read on my laptop" is not a fact about the student.
 *   - anything derived. SGPA, CGPA and attendance percentages are computed on
 *     read by @gradtools/academic-rules and would be a second, disagreeing
 *     source of truth (M9 §29).
 *   - UI state and cached reference data. Neither is student-owned.
 */
export const SYNC_COLLECTIONS = [
  'semesters',
  'semesterSubjects',
  'results',
  'attendance',
  'timetable',
  'backlogs',
] as const;

export type SyncCollection = (typeof SYNC_COLLECTIONS)[number];
export const syncCollectionSchema = z.enum(SYNC_COLLECTIONS);

/**
 * A record as it travels.
 *
 * `deletedAt` is a TOMBSTONE, not an absence. A row that simply vanished is
 * indistinguishable from one the other device has not seen yet, and would be
 * resurrected on the next pull (M9 §68).
 */
export const syncRecordSchema = z.object({
  id: z.string(),
  collection: syncCollectionSchema,
  revision: z.number().int().positive(),
  updatedAt: z.string(),
  deletedAt: z.string().nullable(),
  /** The record's own fields. Validated per collection on the server. */
  data: z.record(z.string(), z.unknown()),
});

export type SyncRecord = z.infer<typeof syncRecordSchema>;

/** What a device sends up. */
export const syncPushSchema = z.object({
  records: z.array(
    z.object({
      id: z.string().uuid(),
      collection: syncCollectionSchema,
      /** The revision this device last saw. Absent means "I believe this is new". */
      baseRevision: z.number().int().positive().nullable(),
      /** True when the device is deleting it. */
      deleted: z.boolean().default(false),
      data: z.record(z.string(), z.unknown()),
    }),
  ),
});

export type SyncPush = z.infer<typeof syncPushSchema>;

/**
 * What happened to each pushed record.
 *
 *   applied   the server took it
 *   conflict  the server's revision moved on; BOTH versions are returned and
 *             the student decides. Never resolved silently (M9 §28)
 *   rejected  the record did not validate. Also never silent
 */
export const syncOutcomeSchema = z.object({
  id: z.string(),
  collection: syncCollectionSchema,
  status: z.enum(['applied', 'conflict', 'rejected']),
  /** The server's current record, present on `applied` and on `conflict`. */
  server: syncRecordSchema.nullable(),
  /** Present on `rejected`, and written for a person to read. */
  reason: z.string().nullable(),
});

export type SyncOutcome = z.infer<typeof syncOutcomeSchema>;

export const syncPushResultSchema = z.object({
  outcomes: z.array(syncOutcomeSchema),
  /** Cursor to hand back on the next pull. */
  syncedAt: z.string(),
});

export type SyncPushResult = z.infer<typeof syncPushResultSchema>;

export const syncPullResultSchema = z.object({
  profile: cloudProfileSchema.nullable(),
  records: z.array(syncRecordSchema),
  syncedAt: z.string(),
});

export type SyncPullResult = z.infer<typeof syncPullResultSchema>;

/* -------------------------------------------------------------------------- */
/* Export                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Everything the cloud holds about one student, and nothing else (M9 §35).
 *
 * Deliberately absent: tokens, provider secrets, internal ids belonging to
 * anyone else, and any record not owned by the requester. The export is
 * produced by the same RLS-scoped connection as every other read, so "only
 * their own records" is enforced by the database rather than by remembering to
 * filter.
 */
export const studentExportSchema = z.object({
  exportedAt: z.string(),
  format: z.literal('gradtools.student.v1'),
  identity: z.object({
    userId: z.string(),
    email: z.string().nullable(),
  }),
  profile: cloudProfileSchema.nullable(),
  records: z.record(z.string(), z.array(z.record(z.string(), z.unknown()))),
});

export type StudentExport = z.infer<typeof studentExportSchema>;

/* -------------------------------------------------------------------------- */
/* Routes                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * EVERY STUDENT ROUTE IS `me`.
 *
 * There is no `/student/:id` and there may never be one (M9 §42). The server
 * resolves the owner from the verified token, so there is no identifier in any
 * path for a caller to substitute — the commonest shape of IDOR has no surface
 * here rather than a defence.
 */
export const STUDENT_ROUTES = {
  me: '/api/v1/me',
  meProfile: '/api/v1/me/profile',
  meSync: '/api/v1/me/sync',
  meExport: '/api/v1/me/export',
} as const;
