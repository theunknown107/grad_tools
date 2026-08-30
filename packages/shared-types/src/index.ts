/**
 * @gradtools/shared-types
 *
 * Zod schemas that ARE the API contract.
 *
 * Authority: docs/10_API_SPECIFICATION.md §10.1.3
 *
 * Both the API and the web app import these. A change that breaks the contract
 * fails to compile on both sides rather than failing silently at runtime, which
 * is the entire reason the package exists (docs/06 §6.5).
 *
 * Student record types arrived in M9, when cloud sync made them cross the
 * network for the first time — and only for students who signed in and said
 * yes. The local-first path is unchanged: without an account, nothing here is
 * ever sent (docs/12 §12.14).
 */

import { z } from 'zod';

/* -------------------------------------------------------------------------- */
/* Provenance                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Every reference record carries where it came from.
 *
 * Non-optional by design: a record without provenance is not publishable
 * (docs/14 §14.10). The API cannot emit one because the schema forbids it.
 */
export const provenanceSchema = z.object({
  sourceUrl: z.string().url(),
  sourceClause: z.string().nullable(),
  verifiedAt: z.string(),
  verifiedBy: z.string().nullable(),
});
export type Provenance = z.infer<typeof provenanceSchema>;

/**
 * Publication lifecycle for reference data.
 *
 * Only `published` records reach the public API, and a record can only become
 * `published` once it is verified (enforced by a database CHECK constraint,
 * see docs/09 §9.4 and services/api/src/db/migrations).
 */
export const verificationStateSchema = z.enum(['draft', 'unverified', 'verified']);
export type VerificationState = z.infer<typeof verificationStateSchema>;

export const publicationStateSchema = z.enum(['unpublished', 'published']);
export type PublicationState = z.infer<typeof publicationStateSchema>;

/* -------------------------------------------------------------------------- */
/* Reference entities                                                         */
/* -------------------------------------------------------------------------- */

export const universitySchema = z.object({
  id: z.string(),
  name: z.string(),
  shortName: z.string(),
});
export type University = z.infer<typeof universitySchema>;

export const schemeSchema = z.object({
  id: z.string(),
  universityId: z.string(),
  code: z.string(),
  regulationCode: z.string(),
  name: z.string(),
  effectiveFrom: z.string(),
  effectiveTo: z.string().nullable(),
  provenance: provenanceSchema,
});
export type Scheme = z.infer<typeof schemeSchema>;

export const branchSchema = z.object({
  id: z.string(),
  universityId: z.string(),
  code: z.string(),
  name: z.string(),
});
export type Branch = z.infer<typeof branchSchema>;

export const collegeSchema = z.object({
  id: z.string(),
  universityId: z.string(),
  name: z.string(),
  code: z.string().nullable(),
  isAutonomous: z.boolean(),
  city: z.string().nullable(),
});
export type College = z.infer<typeof collegeSchema>;

export const subjectCategorySchema = z.enum([
  'core',
  'elective',
  'lab',
  'mandatory',
  'non_credit',
  'project',
  'internship',
]);
export type SubjectCategory = z.infer<typeof subjectCategorySchema>;

export const subjectSchema = z.object({
  id: z.string(),
  schemeId: z.string(),
  branchId: z.string(),
  semester: z.number().int().min(1).max(8),
  code: z.string(),
  title: z.string(),
  credits: z.number(),
  category: subjectCategorySchema,
  cieMax: z.number(),
  seeMax: z.number(),
  hasSee: z.boolean(),
  /**
   * NULL when the syllabus structure has not been verified.
   *
   * Deliberately nullable rather than defaulted: five modules is the
   * 2022-scheme norm, not a verified property of any given subject, and
   * publishing a default next to an empty syllabus would state something the
   * source does not support (docs/08 §8.3, docs/14 §14.10).
   */
  moduleCount: z.number().int().min(1).max(10).nullable(),
  provenance: provenanceSchema,
});
export type Subject = z.infer<typeof subjectSchema>;

export const syllabusModuleSchema = z.object({
  id: z.string(),
  subjectId: z.string(),
  moduleNumber: z.number().int().min(1).max(10),
  title: z.string(),
  topics: z.array(z.string()),
  hours: z.number().int().nullable(),
  provenance: provenanceSchema,
});
export type SyllabusModule = z.infer<typeof syllabusModuleSchema>;

/**
 * Rule-set METADATA only.
 *
 * The database stores what the rules are; it does not implement them. Every
 * calculation stays in @gradtools/academic-rules, and the client calls that
 * package rather than asking the server to compute (docs/16, M5a §9).
 *
 * `formulaIds` are identifiers the rules engine resolves against its own
 * registry. The API never returns an evaluated formula or a computed figure.
 */
export const ruleSetMetaSchema = z.object({
  id: z.string(),
  schemeId: z.string(),
  collegeId: z.string().nullable(),
  version: z.number().int(),
  active: z.boolean(),
  effectiveFrom: z.string(),
  effectiveTo: z.string().nullable(),
  formulaIds: z.object({
    sgpa: z.string(),
    cgpa: z.string(),
    percentage: z.string(),
  }),
  thresholds: z.object({
    cieMax: z.number(),
    cieMinPct: z.number(),
    seeMax: z.number(),
    seeMinPct: z.number(),
    courseMax: z.number(),
    overallMinPct: z.number(),
    attendanceRequiredPct: z.number(),
    attendanceCondonablePct: z.number(),
    attendanceDxFloorPct: z.number(),
  }),
  provenance: provenanceSchema,
});
export type RuleSetMeta = z.infer<typeof ruleSetMetaSchema>;

/* -------------------------------------------------------------------------- */
/* Envelopes                                                                  */
/* -------------------------------------------------------------------------- */

/** Collection responses are wrapped so pagination can be added without a break. */
export function listResponseSchema<T extends z.ZodTypeAny>(item: T) {
  return z.object({ data: z.array(item) });
}

/**
 * The error envelope from docs/10 §10.3.
 *
 * `message` is safe to display. Internal detail never appears here; it is
 * logged against `reference` instead (docs/13 §T-16).
 */
export const errorCodeSchema = z.enum([
  'VALIDATION_FAILED',
  /**
   * No valid session (M9). Deliberately ONE code for every authentication
   * failure — absent, malformed, expired, wrong issuer, bad signature — so the
   * endpoint cannot be used as an oracle for which guess was closer.
   */
  'UNAUTHENTICATED',
  'NOT_FOUND',
  /** The record changed on another device. Carries both versions (M9 §28). */
  'CONFLICT',
  'RATE_LIMITED',
  'INTERNAL_ERROR',
  'DEPENDENCY_UNAVAILABLE',
  'PAYLOAD_TOO_LARGE',
]);
export type ErrorCode = z.infer<typeof errorCodeSchema>;

export const errorResponseSchema = z.object({
  error: z.object({
    code: errorCodeSchema,
    message: z.string(),
    details: z.array(z.object({ field: z.string(), issue: z.string() })).optional(),
    reference: z.string(),
  }),
});
export type ErrorResponse = z.infer<typeof errorResponseSchema>;

/* -------------------------------------------------------------------------- */
/* Health                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Liveness. Deliberately performs no dependency checks: a liveness probe that
 * fails when a non-essential dependency is down makes the platform restart a
 * working container (docs/10 §10.11).
 */
export const healthResponseSchema = z.object({ status: z.literal('ok') });
export type HealthResponse = z.infer<typeof healthResponseSchema>;

/** Readiness. Reports dependency reachability, and nothing more. */
export const readinessResponseSchema = z.object({
  status: z.enum(['ready', 'degraded']),
  checks: z.object({ database: z.enum(['up', 'down']) }),
});
export type ReadinessResponse = z.infer<typeof readinessResponseSchema>;

/* -------------------------------------------------------------------------- */
/* Request parameter schemas                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Reference identifiers are slugs (`vtu`, `vtu-2022`, `cse`) or UUIDs.
 * Constrained so a malformed identifier is rejected at the edge rather than
 * reaching the data layer (docs/13 §T-09).
 */
export const referenceIdSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9][a-z0-9-]*$/i, 'Identifier must be alphanumeric with hyphens.');

/**
 * A subject is addressed by its UUID, never by its code.
 *
 * Database uniqueness is `(scheme_id, branch_id, code)`, so a code alone does
 * not identify a subject — the same code recurs legitimately across branches and
 * schemes. Addressing by code forced a `LIMIT 1` that silently picked one of
 * several (M4.1 §2). To find a subject from a code, filter the collection.
 */
export const subjectIdSchema = z.string().uuid();

export const subjectQuerySchema = z.object({
  scheme: referenceIdSchema.optional(),
  branch: referenceIdSchema.optional(),
  semester: z.coerce.number().int().min(1).max(8).optional(),
});
export type SubjectQuery = z.infer<typeof subjectQuerySchema>;

/**
 * Optional college context for rule-set selection.
 *
 * A scheme may carry a scheme-wide rule set and college-specific overrides at
 * the same time. Without a college the caller gets the scheme-wide set; with
 * one, the college's set takes precedence if it exists (M4.1 §3).
 */
export const ruleSetQuerySchema = z.object({
  college: referenceIdSchema.optional(),
});
export type RuleSetQuery = z.infer<typeof ruleSetQuerySchema>;

/** Route paths, exported so the client cannot drift from the server. */
export const API_ROUTES = {
  health: '/health',
  ready: '/health/ready',
  universities: '/api/v1/universities',
  schemes: '/api/v1/schemes',
  scheme: (id: string) => `/api/v1/schemes/${id}`,
  schemeRules: (id: string, college?: string) =>
    college === undefined
      ? `/api/v1/schemes/${id}/rules`
      : `/api/v1/schemes/${id}/rules?college=${encodeURIComponent(college)}`,
  branches: '/api/v1/branches',
  colleges: '/api/v1/colleges',
  subjects: '/api/v1/subjects',
  subject: (id: string) => `/api/v1/subjects/${id}`,
  subjectSyllabus: (id: string) => `/api/v1/subjects/${id}/syllabus`,
} as const;

/* -------------------------------------------------------------------------- */
/* Sources, rights and documents (M5)                                         */
/* -------------------------------------------------------------------------- */

export * from './sources.js';

/* -------------------------------------------------------------------------- */
/* The student cloud (M9)                                                     */
/* -------------------------------------------------------------------------- */

export * from './student.js';
