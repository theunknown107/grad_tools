/**
 * Support and observability: the contract shared by the API and the app.
 *
 * Phase OBSERVABILITY-AND-SUPPORT-V1.
 *
 * This is an OPERATIONAL support system, not analytics. Every type here is
 * about answering "why is this student's GradTools broken?" from a Support ID
 * and an Incident ID — never about what the student's academic data contains.
 *
 * NOTHING HERE CARRIES ACADEMIC CONTENT. Event and report metadata is a small
 * allowlist of operational fields (route, status, error code, platform). Marks,
 * timetable rows, document text, AI output, tokens, emails and USNs are not in
 * any shape defined in this file, by construction.
 */

import { z } from 'zod';

/* -------------------------------------------------------------------------- */
/* Event taxonomy — only categories backed by a real code path                */
/* -------------------------------------------------------------------------- */

/**
 * The kinds of event worth persisting. Deliberately small: request-level logs
 * stay in Pino/Render, and only application/support/security events land here.
 * Each value maps to an actual failure or action in the codebase.
 */
export const SUPPORT_EVENT_TYPES = [
  // Authentication (Clerk or legacy Supabase — the API does not branch on which).
  'AUTH_SIGN_IN_FAILED',
  'AUTH_VERIFICATION_FAILED',
  // Sync (features/auth/useSync.ts).
  'SYNC_FAILED',
  // Document import / AI extraction (documents/router.ts).
  'IMPORT_FAILED',
  'AI_EXTRACTION_FAILED',
  'AI_UNAVAILABLE',
  // Generic API faults, classified by status.
  'API_5XX',
  'API_RATE_LIMITED',
  // Data operations.
  'SAVE_FAILED',
  'DELETE_FAILED',
  // Mobile / client runtime.
  'APP_RUNTIME_ERROR',
  'NATIVE_CALLBACK_FAILED',
  // Security-relevant (surfaced for operator review, never auto-enforced).
  'AUTH_TOKEN_REJECTED',
  'AUTHORIZATION_DENIED',
  'RATE_LIMIT_TRIGGERED',
  'INVALID_REQUEST',
  // A student-submitted problem report (its own row, carrying an incident).
  'USER_REPORT',
] as const;
export const supportEventTypeSchema = z.enum(SUPPORT_EVENT_TYPES);
export type SupportEventType = z.infer<typeof supportEventTypeSchema>;

/** Which event types are security-relevant (the operator security view). */
export const SECURITY_EVENT_TYPES = [
  'AUTH_TOKEN_REJECTED',
  'AUTHORIZATION_DENIED',
  'RATE_LIMIT_TRIGGERED',
  'INVALID_REQUEST',
] as const satisfies readonly SupportEventType[];

export const supportSeveritySchema = z.enum(['info', 'warning', 'error', 'security']);
export type SupportSeverity = z.infer<typeof supportSeveritySchema>;

/* -------------------------------------------------------------------------- */
/* Machine-readable application error codes                                   */
/* -------------------------------------------------------------------------- */

/**
 * Stable codes an operator can match on, distinct from the HTTP `ErrorCode`
 * envelope. The student sees the human message; the operator sees the code.
 * These never replace existing human-facing copy.
 */
export const APP_ERROR_CODES = [
  'DOCUMENT_AI_UNAVAILABLE',
  'DOCUMENT_UNRECOGNIZED',
  'DOCUMENT_TOO_LARGE',
  'DOCUMENT_INVALID',
  'SYNC_CONFLICT',
  'SYNC_UNAVAILABLE',
  'AUTH_INVALID',
  'AUTH_FORBIDDEN',
  'API_UNAVAILABLE',
  'RATE_LIMITED',
  'DATABASE_UNAVAILABLE',
  'INTERNAL_ERROR',
] as const;
export const appErrorCodeSchema = z.enum(APP_ERROR_CODES);
export type AppErrorCode = z.infer<typeof appErrorCodeSchema>;

/* -------------------------------------------------------------------------- */
/* Problem-report categories — derived from the app's real surfaces           */
/* -------------------------------------------------------------------------- */

export const SUPPORT_CATEGORIES = [
  'sign_in',
  'results',
  'timetable',
  'attendance',
  'sync',
  'import',
  'ai_document',
  'app_android',
  'other',
] as const;
export const supportCategorySchema = z.enum(SUPPORT_CATEGORIES);
export type SupportCategory = z.infer<typeof supportCategorySchema>;

export const SUPPORT_CATEGORY_LABEL: Record<SupportCategory, string> = {
  sign_in: 'Sign-in / Account',
  results: 'Results',
  timetable: 'Timetable',
  attendance: 'Attendance',
  sync: 'Sync',
  import: 'Import',
  ai_document: 'AI / Document reading',
  app_android: 'App / Android',
  other: 'Something else',
};

export const SUPPORT_REPORT_STATUSES = [
  'open',
  'acknowledged',
  'investigating',
  'resolved',
] as const;
export const supportReportStatusSchema = z.enum(SUPPORT_REPORT_STATUSES);
export type SupportReportStatus = z.infer<typeof supportReportStatusSchema>;

/* -------------------------------------------------------------------------- */
/* Safe diagnostic context attached to a report                              */
/* -------------------------------------------------------------------------- */

/**
 * The ONLY metadata a client may attach to a report. Strictly allowlisted and
 * length-bounded, so a client cannot smuggle academic content, tokens or free
 * text beyond the single short description field. The server ignores anything
 * not named here.
 */
export const supportContextSchema = z
  .object({
    platform: z.enum(['web', 'android']).optional(),
    appVersion: z.string().max(40).optional(),
    buildId: z.string().max(80).optional(),
    route: z.string().max(120).optional(),
    online: z.boolean().optional(),
    osFamily: z.string().max(40).optional(),
    browserFamily: z.string().max(40).optional(),
    errorCode: appErrorCodeSchema.optional(),
    httpStatus: z.number().int().min(100).max(599).optional(),
    requestId: z.string().max(64).optional(),
    incidentId: z.string().max(40).optional(),
    stage: z.string().max(40).optional(),
  })
  .strict();
export type SupportContext = z.infer<typeof supportContextSchema>;

/* -------------------------------------------------------------------------- */
/* Report request / response                                                  */
/* -------------------------------------------------------------------------- */

export const supportReportInputSchema = z
  .object({
    category: supportCategorySchema,
    /** Optional, short, free text. The only free text a student can submit. */
    description: z.string().trim().max(1000).optional(),
    context: supportContextSchema.optional(),
  })
  .strict();
export type SupportReportInput = z.infer<typeof supportReportInputSchema>;

export const supportReportSchema = z.object({
  incidentId: z.string(),
  supportId: z.string(),
  category: supportCategorySchema,
  status: supportReportStatusSchema,
  createdAt: z.string(),
});
export type SupportReport = z.infer<typeof supportReportSchema>;

export const supportReportListSchema = z.object({
  supportId: z.string(),
  reports: z.array(supportReportSchema),
});
export type SupportReportList = z.infer<typeof supportReportListSchema>;

/* -------------------------------------------------------------------------- */
/* Routes                                                                     */
/* -------------------------------------------------------------------------- */

export const SUPPORT_ROUTES = {
  /** Create and list the caller's own problem reports. Identity from the session only. */
  reports: '/api/v1/me/support-reports',
  /**
   * An UNAUTHENTICATED problem report, for someone who cannot sign in (the whole
   * reason they are reporting). No session, so no Support ID — just an Incident
   * ID back. Same strict input, same safe-context allowlist.
   */
  anonymousReport: '/api/v1/support-reports',
} as const;

/** The reply to an anonymous report: an Incident ID to quote, and no Support ID. */
export const anonymousSupportReportSchema = z.object({ incidentId: z.string() });
export type AnonymousSupportReport = z.infer<typeof anonymousSupportReportSchema>;

export const OPERATOR_SUPPORT_ROUTES = {
  /** Global operations dashboard (counts, top error codes). */
  overview: '/api/v1/operator/support/overview',
  /** Look up a user by Support ID: their recent events and reports. */
  user: '/api/v1/operator/support/users/:supportId',
  /** One incident's safe detail. */
  incident: '/api/v1/operator/support/incidents/:incidentId',
  /** Security-relevant events for review. */
  security: '/api/v1/operator/support/security',
} as const;
