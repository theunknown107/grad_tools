/**
 * Source, rights and document contracts.
 *
 * Authority: docs/14 §14.3, §14.7, §14.10 · docs/17 §17.3, §17.11 · M5 §3–§5
 *
 * ONE source model, shared by both M5 tracks. The document pipeline and the
 * external-source pipeline do not get to invent their own notion of "where did
 * this come from" or "may we show it" (M5 §3).
 *
 * PROVENANCE AND RIGHTS ARE DIFFERENT QUESTIONS (M5 §4)
 *
 *   Provenance  "Where did this information come from?"
 *   Rights      "Are we allowed to store, display or redistribute it?"
 *
 * Knowing the answer to the first tells you nothing about the second. A VTU
 * question paper has impeccable provenance and completely unknown rights.
 * Attribution is not permission, and this module keeps the two in separate
 * fields so one can never quietly stand in for the other.
 */

import { z } from 'zod';

/* -------------------------------------------------------------------------- */
/* Source identity                                                            */
/* -------------------------------------------------------------------------- */

export const sourceKindSchema = z.enum([
  'announcements',
  'question_papers',
  'syllabus',
  'results',
  'other',
]);
export type SourceKind = z.infer<typeof sourceKindSchema>;

/** Who publishes it. `user` means a student's own upload, which has no external source. */
export const sourceAuthoritySchema = z.enum(['official', 'third_party', 'user']);
export type SourceAuthority = z.infer<typeof sourceAuthoritySchema>;

/**
 * How the source is reached.
 *
 * `none` is the default and means GradTools does not access it automatically at
 * all. Such a source exists in the registry so its status is recorded, not so
 * it is polled.
 */
export const accessMethodSchema = z.enum(['none', 'http_fetch', 'manual_upload', 'manual_entry']);
export type AccessMethod = z.infer<typeof accessMethodSchema>;

/* -------------------------------------------------------------------------- */
/* The two independent gates                                                  */
/* -------------------------------------------------------------------------- */

/**
 * What the site's robots.txt says about the paths we would read.
 *
 * `unknown` is the default and is NOT permission. A source cannot be enabled
 * from `unknown` any more than from `disallowed` (docs/14 §14.3).
 */
export const robotsStatusSchema = z.enum(['unknown', 'allowed', 'disallowed']);
export type RobotsStatus = z.infer<typeof robotsStatusSchema>;

/**
 * What a human review of the site's terms of use concluded.
 *
 * Independent of robots. A site whose robots.txt allows crawling may still
 * forbid reuse in its terms, and the reverse is possible too — so both gates
 * must pass, and passing one says nothing about the other.
 */
export const termsStatusSchema = z.enum(['unknown', 'permitted', 'restricted', 'prohibited']);
export type TermsStatus = z.infer<typeof termsStatusSchema>;

/* -------------------------------------------------------------------------- */
/* Rights                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Whether GradTools may redistribute the MATERIAL — distinct from whether it
 * may access the source (M5 §17).
 *
 * `unknown` is the default and permits metadata and a link, never a hosted
 * file. `user_private` is a student's own document, which is theirs and is
 * never redistributed to anyone regardless of what any other field says.
 */
export const rightsStatusSchema = z.enum([
  'unknown',
  'permitted',
  'restricted',
  'prohibited',
  'user_private',
]);
export type RightsStatus = z.infer<typeof rightsStatusSchema>;

/**
 * What the product actually does with the material — the user-visible
 * consequence of the rights answer (M5 §5).
 *
 *   host     we store the file and serve it
 *   link     we hold metadata and point at the original; we serve no file
 *   private  the uploader's own copy, visible to them alone
 *   blocked  the material cannot be used safely at all
 */
export const presentationModeSchema = z.enum(['host', 'link', 'private', 'blocked']);
export type PresentationMode = z.infer<typeof presentationModeSchema>;

export const sourceHealthSchema = z.enum(['unknown', 'healthy', 'degraded', 'failing']);
export type SourceHealth = z.infer<typeof sourceHealthSchema>;

/* -------------------------------------------------------------------------- */
/* Source                                                                     */
/* -------------------------------------------------------------------------- */

export const sourceSchema = z.object({
  id: z.string(),
  kind: sourceKindSchema,
  publisher: z.string(),
  canonicalUrl: z.string().url(),
  authority: sourceAuthoritySchema,
  accessMethod: accessMethodSchema,

  /** The gates. Every one must pass before `enabled` can be true. */
  robotsStatus: robotsStatusSchema,
  robotsCheckedAt: z.string().nullable(),
  robotsNote: z.string().nullable(),
  termsStatus: termsStatusSchema,
  termsReviewedAt: z.string().nullable(),
  termsNote: z.string().nullable(),
  rightsStatus: rightsStatusSchema,

  verification: z.enum(['draft', 'unverified', 'verified']),
  verifiedAt: z.string().nullable(),

  /** Defaults to false and cannot be true unless every gate above has passed. */
  enabled: z.boolean(),
  health: sourceHealthSchema,
  consecutiveFailures: z.number().int().min(0),
  lastCheckedAt: z.string().nullable(),
  parserVersion: z.string().nullable(),
  pollIntervalSeconds: z.number().int().nullable(),
  notes: z.string().nullable(),
});
export type Source = z.infer<typeof sourceSchema>;

/* -------------------------------------------------------------------------- */
/* Documents                                                                  */
/* -------------------------------------------------------------------------- */

export const documentStateSchema = z.enum(['quarantined', 'validated', 'rejected', 'extracted']);
export type DocumentState = z.infer<typeof documentStateSchema>;

/**
 * Whether usable text was obtained.
 *
 * `ocr_required` is a reported outcome, not a trigger: GradTools does not
 * silently OCR everything (M5 §15). A scanned paper is marked and left for a
 * later, explicit decision.
 */
export const extractionStatusSchema = z.enum([
  'pending',
  'text_available',
  'ocr_required',
  'extraction_failed',
]);
export type ExtractionStatus = z.infer<typeof extractionStatusSchema>;

/** Document metadata as served. The FILE is a separate, rights-gated concern. */
export const documentSchema = z.object({
  id: z.string(),
  sourceId: z.string().nullable(),
  title: z.string(),
  sha256: z.string().length(64),
  byteSize: z.number().int().positive(),
  mimeType: z.string(),
  pageCount: z.number().int().nullable(),
  state: documentStateSchema,
  extractionStatus: extractionStatusSchema,
  rightsStatus: rightsStatusSchema,
  presentation: presentationModeSchema,
  /** Where the original lives. Required for `link`, which is all `link` offers. */
  sourceUrl: z.string().url().nullable(),
  licenseNote: z.string().nullable(),
  rejectionReason: z.string().nullable(),
  createdAt: z.string(),
});
export type DocumentRecord = z.infer<typeof documentSchema>;

/* -------------------------------------------------------------------------- */
/* Source change events                                                       */
/* -------------------------------------------------------------------------- */

/**
 * A detected change is STORED, never delivered (M5 §14). Notification is a
 * later milestone; recording that something changed is this one.
 */
export const changeTypeSchema = z.enum(['new', 'modified', 'removed']);
export type ChangeType = z.infer<typeof changeTypeSchema>;

export const sourceChangeSchema = z.object({
  id: z.string(),
  sourceId: z.string(),
  externalId: z.string(),
  changeType: changeTypeSchema,
  title: z.string().nullable(),
  itemUrl: z.string().nullable(),
  payloadHash: z.string().length(64),
  parserVersion: z.string(),
  detectedAt: z.string(),
});
export type SourceChange = z.infer<typeof sourceChangeSchema>;

/* -------------------------------------------------------------------------- */
/* Routes                                                                     */
/* -------------------------------------------------------------------------- */

/** One extracted block of text, with its position in the document. */
export const documentSectionSchema = z.object({
  id: z.string(),
  documentId: z.string(),
  pageNumber: z.number().int().positive(),
  ordinal: z.number().int().min(0),
  content: z.string(),
  extractorVersion: z.string(),
});
export type DocumentSection = z.infer<typeof documentSectionSchema>;

/**
 * What an import attempt produced.
 *
 * `rejected` is a normal outcome, not an error: accepting documents means
 * malformed input is expected traffic. `duplicate` returns the existing
 * document untouched -- the same bytes are one document however often they
 * arrive, and a re-import never resets a document someone already reviewed.
 */
export const importOutcomeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('imported'), id: z.string(), sha256: z.string().length(64) }),
  z.object({ kind: z.literal('duplicate'), id: z.string(), sha256: z.string().length(64) }),
  z.object({
    kind: z.literal('rejected'),
    id: z.string(),
    sha256: z.string().length(64),
    code: z.string(),
    reason: z.string(),
  }),
]);
export type ImportOutcome = z.infer<typeof importOutcomeSchema>;

export const processOutcomeSchema = z.object({
  extractionStatus: extractionStatusSchema,
  sectionCount: z.number().int().min(0),
  durationMs: z.number(),
  extractorVersion: z.string(),
});
export type ProcessOutcome = z.infer<typeof processOutcomeSchema>;

export const SOURCE_ROUTES = {
  sources: '/api/v1/sources',
  source: (id: string) => `/api/v1/sources/${id}`,
  documents: '/api/v1/documents',
  document: (id: string) => `/api/v1/documents/${id}`,
  documentImport: '/api/v1/documents/import',
  documentSections: (id: string) => `/api/v1/documents/${id}/sections`,
  documentProcess: (id: string) => `/api/v1/documents/${id}/process`,
  /**
   * The private working set: documents the operator imported on this machine.
   *
   * Separate from `documents`, which is the PUBLIC listing. Merging them would
   * mean one endpoint whose visibility depends on a parameter, and that is
   * exactly the shape that leaks (M5A section 8).
   */
  documentsPrivate: '/api/v1/documents/private',
} as const;
