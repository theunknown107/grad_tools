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

/** Detected question-paper format. `unknown` is a real outcome (docs/17 section 17.12). */
export const paperFormatSchema = z.enum(['descriptive', 'mcq', 'unknown']);
export type PaperFormat = z.infer<typeof paperFormatSchema>;
export type DocumentState = z.infer<typeof documentStateSchema>;

/**
 * Whether usable text was obtained.
 *
 * `ocr_required` is a reported outcome, not a trigger: GradTools does not
 * silently OCR everything (M5 §15). A scanned paper is marked and left for a
 * later, explicit decision.
 */
/**
 * The EXTRACTION lifecycle, which is not the document lifecycle.
 *
 *   documents.state             is this file safe, and have we processed it
 *   documents.extractionStatus  how we got the text, and how far we trust it
 *
 * Kept separate because they answer different questions: a scan reaches
 * `extracted` with no text at all, so one field cannot carry both facts
 * (M5A.3 section 3).
 *
 *   pending           validated, not yet read
 *   text_available    read directly from the PDF's own text layer -- the fast path
 *   ocr_required      no text layer; OCR is needed and has not been asked for
 *   ocr_queued        an OCR job exists and is waiting for a worker
 *   ocr_processing    a worker is reading it now
 *   ocr_extracted     OCR produced text that looks dependable
 *   ocr_needs_review  OCR produced text a person should look at before it is
 *                     trusted: unknown paper format, or mathematics
 *   extraction_failed nothing usable could be read
 */
export const extractionStatusSchema = z.enum([
  'pending',
  'text_available',
  'ocr_required',
  'ocr_queued',
  'ocr_processing',
  'ocr_extracted',
  'ocr_needs_review',
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

  /**
   * Detected paper format. Chooses the OCR configuration and nothing else in
   * this milestone -- it is not a parser. `unknown` is a real answer, not a
   * fallback to the commoner format.
   */
  paperFormat: paperFormatSchema.nullable(),

  /**
   * How the OCR was performed. Deliberately NO numeric accuracy score: there is
   * no ground truth, so a percentage would be invented rather than measured
   * (M5A.3 section 9). Qualitative state carries the meaning.
   */
  ocrEngine: z.string().nullable(),
  ocrEngineVersion: z.string().nullable(),
  ocrLanguages: z.string().nullable(),
  ocrPsm: z.number().int().nullable(),
  ocrDpi: z.number().int().nullable(),
  ocrDurationMs: z.number().int().nullable(),
  ocrCharCount: z.number().int().nullable(),

  /** True when the text should not be trusted without a human look. */
  needsReview: z.boolean(),
  reviewReason: z.string().nullable(),
});
export type DocumentRecord = z.infer<typeof documentSchema>;

/* -------------------------------------------------------------------------- */
/* The question-paper library (M8)                                            */
/* -------------------------------------------------------------------------- */

/**
 * What kind of document this is.
 *
 * `documents` was always generic. The library must not present a syllabus PDF
 * as an examination paper, and `unknown` is the honest default for anything
 * nobody has classified (M8 §7).
 */
export const documentKindSchema = z.enum(['question_paper', 'syllabus', 'other', 'unknown']);
export type DocumentKind = z.infer<typeof documentKindSchema>;

/**
 * A paper as the library presents it.
 *
 * EVERY TAXONOMY FIELD IS NULLABLE, and null means "nobody has said", never
 * "probably the usual value". A paper whose year is unknown shows no year
 * rather than a guess, because a wrong year on a past paper sends a student to
 * revise the wrong sitting (M8 §7).
 *
 * `availability` is `presentation` under the name a student would use for it,
 * and it is the field that decides which actions the interface offers.
 */
export const questionPaperSchema = z.object({
  id: z.string(),
  title: z.string(),

  /** Set when the subject is in the catalogue; the taxonomy then comes from it. */
  subjectId: z.string().nullable(),
  subjectCode: z.string().nullable(),
  subjectTitle: z.string().nullable(),
  schemeId: z.string().nullable(),
  branchId: z.string().nullable(),
  branchName: z.string().nullable(),
  semester: z.number().int().min(1).max(8).nullable(),

  examYear: z.number().int().nullable(),
  examSession: z.string().nullable(),

  /** `unknown` is a real format, not a fallback to the commoner one. */
  paperFormat: paperFormatSchema.nullable(),
  pageCount: z.number().int().nullable(),

  /**
   * PROVENANCE — where it came from. Never a statement about permission
   * (M8 §6): a paper can be perfectly attributed and still not redistributable.
   */
  sourceId: z.string().nullable(),
  sourceName: z.string().nullable(),
  sourceUrl: z.string().url().nullable(),

  /** RIGHTS — what GradTools may actually do with it. A separate question. */
  availability: presentationModeSchema,
  rightsStatus: rightsStatusSchema,

  /**
   * Extraction, when a parser has already run over this paper. Structural
   * counts only: nothing here claims the questions were read correctly, which
   * is what `needsReview` exists to say (M8 §20).
   */
  questionCount: z.number().int().nullable(),
  mcqItemCount: z.number().int().nullable(),
  extractionSource: z.enum(['native', 'ocr']).nullable(),
  parserVersion: z.string().nullable(),
  needsReview: z.boolean().nullable(),

  addedAt: z.string(),
});

export type QuestionPaper = z.infer<typeof questionPaperSchema>;

/** One page of library results. */
export const questionPaperPageSchema = z.object({
  data: z.array(questionPaperSchema),
  total: z.number().int().nonnegative(),
  limit: z.number().int().positive(),
  offset: z.number().int().nonnegative(),
});

/**
 * The filter values present in the library right now.
 *
 * Served rather than hard-coded so the interface can hide a control that
 * would return nothing whichever value is chosen (M8 §10).
 */
export const questionPaperFiltersSchema = z.object({
  subjects: z.array(z.object({ code: z.string(), title: z.string().nullable() })),
  schemes: z.array(z.string()),
  branches: z.array(z.object({ id: z.string(), name: z.string() })),
  semesters: z.array(z.number().int()),
  years: z.array(z.number().int()),
  formats: z.array(paperFormatSchema),
  sources: z.array(z.object({ id: z.string(), name: z.string() })),
});

export type QuestionPaperFilters = z.infer<typeof questionPaperFiltersSchema>;

/** How a library listing may be ordered. Nothing here claims importance (M8 §11). */
export const paperSortSchema = z.enum(['newest', 'oldest', 'recently_added']);
export type PaperSort = z.infer<typeof paperSortSchema>;

/** What a client polls while a document is being read. */
export const documentStatusSchema = z.object({
  id: z.string(),
  state: documentStateSchema,
  extractionStatus: extractionStatusSchema,
  paperFormat: paperFormatSchema.nullable(),
  needsReview: z.boolean(),
  reviewReason: z.string().nullable(),
  sectionCount: z.number().int().min(0),
  job: z
    .object({
      status: z.enum(['queued', 'processing', 'completed', 'failed']),
      attempts: z.number().int().min(0),
      maxAttempts: z.number().int().min(1),
    })
    .nullable(),
});
export type DocumentStatus = z.infer<typeof documentStatusSchema>;

/* -------------------------------------------------------------------------- */
/* Extracted question structure (M5A.5)                                       */
/* -------------------------------------------------------------------------- */

/**
 * Where the geometry came from.
 *
 * Both feed one parser (docs/17 §17.16), but the distinction is real
 * provenance: a native token stream is the publisher's own typesetting, an OCR
 * one is our best reading of an image.
 */
export const extractionSourceSchema = z.enum(['native', 'ocr']);
export type ExtractionSource = z.infer<typeof extractionSourceSchema>;

/**
 * STRUCTURAL confidence. Three things are deliberately kept apart (M5A.5 §7):
 *
 *   OCR confidence         how well the ENGINE read characters
 *   structural confidence  how much the GEOMETRY agreed -- this field
 *   review state           what a HUMAN concluded
 *
 * Any of them can be high while the next is low. A crisp scan of a table the
 * parser misread; a perfectly parsed row whose mathematics is nonsense. None of
 * them is a numeric accuracy score, because there is no ground truth to measure
 * one against (docs/32 ED-46).
 */
export const structuralConfidenceSchema = z.enum(['high', 'medium', 'low', 'review_required']);
export type StructuralConfidence = z.infer<typeof structuralConfidenceSchema>;

/**
 * What a PERSON concluded. Not the same field as the machine's `needsReview`.
 *
 *   unreviewed  nobody has looked
 *   accepted    a person read it and the machine value stands
 *   corrected   a person changed something; the corrections are alongside
 *   rejected    a person judged the record spurious. NOT deleted (M5A.5 §6)
 */
export const questionReviewStateSchema = z.enum([
  'unreviewed',
  'accepted',
  'corrected',
  'rejected',
]);
export type QuestionReviewState = z.infer<typeof questionReviewStateSchema>;

export const boundingBoxSchema = z.object({
  x: z.number().int(),
  y: z.number().int(),
  width: z.number().int().min(0),
  height: z.number().int().min(0),
});
export type BoundingBox = z.infer<typeof boundingBoxSchema>;

/** Human corrections to a question. `null` means the machine value stands. */
export const questionCorrectionSchema = z.object({
  questionNumber: z.string().nullable(),
  module: z.string().nullable(),
  text: z.string().nullable(),
  marks: z.number().int().nullable(),
  bloomLevel: z.string().nullable(),
  courseOutcome: z.string().nullable(),
});
export type QuestionCorrection = z.infer<typeof questionCorrectionSchema>;

export const subQuestionCorrectionSchema = z.object({
  label: z.string().nullable(),
  text: z.string().nullable(),
  marks: z.number().int().nullable(),
  /**
   * A VTU paper's right-hand table has a row per SUB-PART, not per question, so
   * a sub-question carries its own Bloom's level and CO. The parser read them
   * from the start; only the correction path was missing (migration 0008).
   */
  bloomLevel: z.string().nullable(),
  courseOutcome: z.string().nullable(),
});

export const mcqOptionSchema = z.object({ label: z.string(), text: z.string() });
export type McqOption = z.infer<typeof mcqOptionSchema>;

export const mcqCorrectionSchema = z.object({
  itemNumber: z.number().int().nullable(),
  text: z.string().nullable(),
  /**
   * Options are the substance of an MCQ item: a correct stem with scrambled
   * options is not a usable record. `null` means uncorrected, which is distinct
   * from `[]` meaning a person says this item has no options.
   */
  options: z.array(mcqOptionSchema).nullable(),
});

/**
 * A sub-question -- the a/b/c parts.
 *
 * The top-level fields are the MACHINE values and are never overwritten.
 * `reviewed` carries a human's corrections beside them, so the effective value
 * is `reviewed?.x ?? x` and the original is always still visible (M5A.5 §9).
 */
export const extractedSubQuestionSchema = z.object({
  id: z.string(),
  questionId: z.string(),
  ordinal: z.number().int().min(0),
  label: z.string().nullable(),
  text: z.string(),
  marks: z.number().int().nullable(),
  bloomLevel: z.string().nullable(),
  courseOutcome: z.string().nullable(),
  pageNumber: z.number().int().positive(),
  boundingBox: boundingBoxSchema,
  confidence: structuralConfidenceSchema,
  needsReview: z.boolean(),
  reviewState: questionReviewStateSchema,
  reviewed: subQuestionCorrectionSchema.nullable(),
  reviewNote: z.string().nullable(),
  reviewedAt: z.string().nullable(),
  reviewedBy: z.string().nullable(),
});
export type ExtractedSubQuestion = z.infer<typeof extractedSubQuestionSchema>;

export const extractedQuestionSchema = z.object({
  id: z.string(),
  paperId: z.string(),
  ordinal: z.number().int().min(0),

  /* Machine values. Immutable once written. */
  questionNumber: z.string().nullable(),
  module: z.string().nullable(),
  text: z.string(),
  marks: z.number().int().nullable(),
  bloomLevel: z.string().nullable(),
  courseOutcome: z.string().nullable(),

  /* Provenance: which page, and where on it (M5A.5 §4). */
  pageNumber: z.number().int().positive(),
  boundingBox: boundingBoxSchema,

  confidence: structuralConfidenceSchema,
  needsReview: z.boolean(),

  reviewState: questionReviewStateSchema,
  reviewed: questionCorrectionSchema.nullable(),
  reviewNote: z.string().nullable(),
  reviewedAt: z.string().nullable(),
  reviewedBy: z.string().nullable(),

  subQuestions: z.array(extractedSubQuestionSchema),
});
export type ExtractedQuestion = z.infer<typeof extractedQuestionSchema>;

/**
 * One hit from a cross-paper question search.
 *
 * Authority: M10B §6, §4, §23, §25
 *
 * A search result is a question PLUS the provenance needed to judge it. A
 * student looking at extracted text has to be able to see which paper it came
 * from, whether a person has checked it, and how much the parser trusted its
 * own structure — otherwise machine output reads as fact (M10B §4).
 *
 * `text` is the EFFECTIVE value: the reviewed text where a reviewer has written
 * one, the machine text otherwise. `isReviewed` says which, so the caller never
 * has to guess. The full machine/reviewed pair stays on the question's own
 * endpoint; carrying both through every search row would be weight without a
 * use, and the flag is what actually changes how a row should be read.
 */
export const questionSearchResultSchema = z.object({
  id: z.string(),
  paperId: z.string(),
  documentId: z.string(),

  /* Where it came from, so a hit can be traced to a paper (M10B §47). */
  paperTitle: z.string(),
  subjectCode: z.string().nullable(),
  subjectTitle: z.string().nullable(),
  semester: z.number().int().nullable(),
  examYear: z.number().int().nullable(),
  examSession: z.string().nullable(),

  questionNumber: z.string().nullable(),
  module: z.string().nullable(),
  marks: z.number().int().nullable(),
  text: z.string(),

  /** True when `text` came from a human/agent review rather than the parser. */
  isReviewed: z.boolean(),
  confidence: structuralConfidenceSchema,
  needsReview: z.boolean(),

  /* Extraction provenance. Versions are never merged (M10B §24). */
  paperFormat: paperFormatSchema,
  extractionSource: extractionSourceSchema,
  parserVersion: z.string(),
});
export type QuestionSearchResult = z.infer<typeof questionSearchResultSchema>;

export const questionSearchResponseSchema = z.object({
  data: z.array(questionSearchResultSchema),
  total: z.number().int().min(0),
  /** How the text was reduced before matching, so a caller can tell. */
  normalizationVersion: z.string(),
});
export type QuestionSearchResponse = z.infer<typeof questionSearchResponseSchema>;

/**
 * An MCQ item.
 *
 * A separate shape from a descriptive question, with no module, Bloom's level,
 * CO or marks -- the format never contained them (M5A.5 §13). Absent fields are
 * absent, not null placeholders inviting something downstream to read "missing"
 * where the truth is "not applicable".
 */
export const extractedMcqItemSchema = z.object({
  id: z.string(),
  paperId: z.string(),
  ordinal: z.number().int().min(0),
  itemNumber: z.number().int().nullable(),
  text: z.string(),
  options: z.array(mcqOptionSchema),
  pageNumber: z.number().int().positive(),
  boundingBox: boundingBoxSchema,
  confidence: structuralConfidenceSchema,
  needsReview: z.boolean(),
  reviewState: questionReviewStateSchema,
  reviewed: mcqCorrectionSchema.nullable(),
  reviewNote: z.string().nullable(),
  reviewedAt: z.string().nullable(),
  reviewedBy: z.string().nullable(),
});
export type ExtractedMcqItem = z.infer<typeof extractedMcqItemSchema>;

/** How many records sit in each state. What the UI shows as "review status". */
export const reviewSummarySchema = z.object({
  total: z.number().int().min(0),
  unreviewed: z.number().int().min(0),
  accepted: z.number().int().min(0),
  corrected: z.number().int().min(0),
  rejected: z.number().int().min(0),
  needsReview: z.number().int().min(0),
});
export type ReviewSummary = z.infer<typeof reviewSummarySchema>;

export const confidenceSummarySchema = z.object({
  high: z.number().int().min(0),
  medium: z.number().int().min(0),
  low: z.number().int().min(0),
  reviewRequired: z.number().int().min(0),
});
export type ConfidenceSummary = z.infer<typeof confidenceSummarySchema>;

/**
 * One deterministic extraction run over one document.
 *
 * A paper is the RESULT OF A RUN, not a description of the document: the
 * document's title, hash, rights and presentation are one join away and are
 * deliberately not copied here (M5A.5 §3).
 */
export const extractedPaperSchema = z.object({
  id: z.string(),
  documentId: z.string(),
  paperFormat: paperFormatSchema,
  extractionSource: extractionSourceSchema,
  parserVersion: z.string(),
  extractionVersion: z.number().int().positive(),
  isCurrent: z.boolean(),
  pageCount: z.number().int().min(0),
  questionCount: z.number().int().min(0),
  mcqItemCount: z.number().int().min(0),
  needsReview: z.boolean(),
  reviewReason: z.string().nullable(),
  createdAt: z.string(),
  reviewSummary: reviewSummarySchema,
  confidenceSummary: confidenceSummarySchema,
});
export type ExtractedPaper = z.infer<typeof extractedPaperSchema>;

/**
 * What persisting an extraction produced.
 *
 * `unchanged` is the idempotent case: this parser has already run over this
 * document, and its output -- along with any human review recorded against it
 * -- is left exactly as it is (M5A.5 §16).
 */
export const persistOutcomeSchema = z.object({
  kind: z.enum(['persisted', 'unchanged', 'no_structure']),
  paperId: z.string().nullable(),
  extractionVersion: z.number().int().nullable(),
  parserVersion: z.string(),
  extractionSource: extractionSourceSchema.nullable(),
  paperFormat: paperFormatSchema.nullable(),
  questionCount: z.number().int().min(0),
  subQuestionCount: z.number().int().min(0),
  mcqItemCount: z.number().int().min(0),
  durationMs: z.number(),
});
export type PersistOutcome = z.infer<typeof persistOutcomeSchema>;

/**
 * A single review action.
 *
 * `reviewedBy` is an operator label, never a student identity: these routes are
 * loopback-only for Stage 1 and there are no accounts (M5A.5 §8).
 */
export const reviewRequestSchema = z
  .object({
    action: z.enum(['accept', 'correct', 'reject']),
    reviewedBy: z.string().min(1).max(120),
    note: z.string().max(2000).optional(),
    /** Only read for `correct`. Any subset of the correctable fields. */
    corrections: z
      .object({
        questionNumber: z.string().max(16).nullish(),
        label: z.string().max(8).nullish(),
        module: z.string().max(16).nullish(),
        text: z.string().max(8000).nullish(),
        marks: z.number().int().min(1).max(100).nullish(),
        bloomLevel: z.string().max(16).nullish(),
        courseOutcome: z.string().max(16).nullish(),
        itemNumber: z.number().int().min(0).nullish(),
        /** MCQ options only. Capped, because a real item has four. */
        options: z
          .array(z.object({ label: z.string().max(8), text: z.string().max(2000) }))
          .max(12)
          .nullish(),
      })
      .optional(),
  })
  .refine(
    (value) =>
      value.action !== 'correct' ||
      Object.values(value.corrections ?? {}).some((field) => field !== undefined),
    { message: 'A correction must change at least one field.' },
  );
export type ReviewRequest = z.infer<typeof reviewRequestSchema>;

/**
 * One row of the review queue.
 *
 * Flattened on purpose. A reviewer works through RECORDS, not through a tree,
 * and three differently-shaped lists would make "what is left to check?" three
 * questions instead of one.
 */
export const reviewQueueItemSchema = z.object({
  kind: z.enum(['question', 'sub-question', 'mcq-item']),
  id: z.string(),
  paperId: z.string(),
  documentId: z.string(),
  documentTitle: z.string(),
  paperFormat: paperFormatSchema,
  extractionSource: extractionSourceSchema,
  /** `Q1`, `Q1 a`, `Item 4` — what to call it in a list. */
  label: z.string(),
  text: z.string(),
  pageNumber: z.number().int().positive(),
  confidence: structuralConfidenceSchema,
  needsReview: z.boolean(),
});
export type ReviewQueueItem = z.infer<typeof reviewQueueItemSchema>;

/** What a review may be recorded against. A closed set, never a table name. */
export const reviewTargetSchema = z.enum(['question', 'sub-question', 'mcq-item']);
export type ReviewTarget = z.infer<typeof reviewTargetSchema>;

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
/* Announcements (M7)                                                         */
/* -------------------------------------------------------------------------- */

export const announcementCategorySchema = z.enum([
  'results',
  'exam_timetable',
  'exam_registration',
  'backlog',
  'summer_semester',
  'revaluation',
  'fees',
  'holiday',
  'academic_calendar',
  'college_notice',
  'department_notice',
  'general',
]);
export type AnnouncementCategory = z.infer<typeof announcementCategorySchema>;

/**
 * HOW the record got here -- not the same question as who published it.
 *
 * `demo_fixture` is its own value rather than a flag so a synthetic notice can
 * never be mistaken for an official one by a screen that forgot to check
 * (M7 §36).
 */
export const announcementOriginSchema = z.enum([
  'external_source',
  'operator_entry',
  'demo_fixture',
]);
export type AnnouncementOrigin = z.infer<typeof announcementOriginSchema>;

/**
 * Who an announcement is for.
 *
 * NULL ON AN AXIS MEANS "NOT TARGETED ON THAT AXIS", never "unknown". Every
 * non-null constraint must match for a student to see it, and a targeted notice
 * is never silently broadened (M7 §14).
 *
 * Names accompany the identifiers because relevance is computed IN THE BROWSER
 * from the student's local profile, which holds a branch name and a college
 * name. The identifiers keep referential integrity; the names make matching
 * possible without sending the profile anywhere (M7 §13, §40).
 */
export const announcementAudienceSchema = z.object({
  schemeId: z.string().nullable(),
  branchId: z.string().nullable(),
  branchName: z.string().nullable(),
  collegeId: z.string().nullable(),
  collegeName: z.string().nullable(),
  semester: z.number().int().min(1).max(8).nullable(),
});
export type AnnouncementAudience = z.infer<typeof announcementAudienceSchema>;

/**
 * One academic notice, as served to a student.
 *
 * Only `publication = published` and `verification = verified` rows are ever
 * returned, so neither state appears here: everything a student receives has
 * already passed the gate, and carrying the field would invite a client to
 * decide for itself (M7 §11).
 *
 * FOUR DATES, KEPT APART. A publication date is not an exam date and neither is
 * a deadline. All are optional, and an announcement with no deadline has none --
 * nothing infers one from wording (M7 §18).
 */
export const announcementSchema = z.object({
  id: z.string(),
  /** The registry source, or null for an operator entry. */
  sourceId: z.string().nullable(),
  origin: announcementOriginSchema,
  /** Who ISSUED the notice. Always present. */
  publisher: z.string(),
  title: z.string(),
  /** PLAIN TEXT. Rendered as text, never as markup (docs/13 §T-21). */
  body: z.string().nullable(),
  category: announcementCategorySchema,
  canonicalUrl: z.string().nullable(),

  publishedAt: z.string().nullable(),
  eventStartAt: z.string().nullable(),
  deadlineAt: z.string().nullable(),

  audience: announcementAudienceSchema,

  /** When this notice was first and last seen at its source. */
  firstSeenAt: z.string(),
  lastSeenAt: z.string(),
  updatedAt: z.string(),
});
export type Announcement = z.infer<typeof announcementSchema>;

export const announcementPageSchema = z.object({
  data: z.array(announcementSchema),
  /** Total published announcements matching the filter, for paging. */
  total: z.number().int().min(0),
  limit: z.number().int().min(1),
  offset: z.number().int().min(0),
});
export type AnnouncementPage = z.infer<typeof announcementPageSchema>;

/**
 * What an operator may type in.
 *
 * DELIBERATELY NARROW, and loopback-only: there is no authentication, so this
 * must never become a public write surface (M7 §12). Verification and
 * publication are NOT accepted from the caller -- an entry arrives unverified
 * and unpublished like anything else, and passes the same gate.
 */
export const announcementEntrySchema = z.object({
  publisher: z.string().min(1).max(200),
  title: z.string().min(1).max(300),
  body: z.string().max(20000).optional(),
  category: announcementCategorySchema,
  /** Validated as http(s) here AND by a database CHECK. */
  canonicalUrl: z.string().url().nullish(),
  publishedAt: z.string().nullish(),
  eventStartAt: z.string().nullish(),
  deadlineAt: z.string().nullish(),
  audience: z
    .object({
      schemeId: z.string().nullish(),
      branchId: z.string().nullish(),
      branchName: z.string().nullish(),
      collegeId: z.string().nullish(),
      collegeName: z.string().nullish(),
      semester: z.number().int().min(1).max(8).nullish(),
    })
    .optional(),
  /** `demo_fixture` marks synthetic content that the UI labels as such. */
  origin: z.enum(['operator_entry', 'demo_fixture']).default('operator_entry'),
});
export type AnnouncementEntry = z.infer<typeof announcementEntrySchema>;

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
  /**
   * What the positional parser stored, or null when there was no text layer to
   * parse. Reported alongside the text extraction rather than as a separate
   * call because they read the same bytes in the same request (M5A.5 §1).
   */
  paper: persistOutcomeSchema.nullable(),
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
  documentOcr: (id: string) => `/api/v1/documents/${id}/ocr`,
  documentStatus: (id: string) => `/api/v1/documents/${id}/status`,
  /**
   * The private working set: documents the operator imported on this machine.
   *
   * Separate from `documents`, which is the PUBLIC listing. Merging them would
   * mean one endpoint whose visibility depends on a parameter, and that is
   * exactly the shape that leaks (M5A section 8).
   */
  documentsPrivate: '/api/v1/documents/private',

  /* -- Extracted question structure (M5A.5) -------------------------------- */

  /** Runs the positional parser over a document and persists the result. */
  documentExtract: (id: string) => `/api/v1/documents/${id}/extract`,
  /** The document's current extraction run, or null when it has none. */
  documentPaper: (id: string) => `/api/v1/documents/${id}/paper`,
  paperQuestions: (id: string) => `/api/v1/papers/${id}/questions`,
  paperMcqItems: (id: string) => `/api/v1/papers/${id}/mcq-items`,
  question: (id: string) => `/api/v1/questions/${id}`,
  /**
   * The one narrow mutation. `kind` is a closed set, never a table name, and
   * these routes are loopback-only for Stage 1 (M5A.5 §8).
   */
  review: (kind: string, id: string) => `/api/v1/extracted/${kind}/${id}/review`,
  /** Everything still waiting for a person, worst first. */
  reviewQueue: '/api/v1/review/queue',

  /* -- Announcements (M7) -------------------------------------------------- */

  /** Published, verified notices. The only announcement surface a student uses. */
  announcements: '/api/v1/announcements',
  announcement: (id: string) => `/api/v1/announcements/${id}`,
  /**
   * Operator entry. Loopback-only, like every other write in Stage 1, and it
   * cannot publish: an entry passes the same verification gate as a fetched one.
   */
  announcementEntry: '/api/v1/announcements/entry',

  /* -- The question-paper library (M8) ------------------------------------- */

  /**
   * Publicly visible question papers.
   *
   * A LIBRARY VIEW OVER `documents`, not a second document model (M8 §4). The
   * same publication and rights gates decide what appears here as decide the
   * document listing; this route adds taxonomy, search and paging on top.
   */
  questionPapers: '/api/v1/question-papers',
  questionPaper: (id: string) => `/api/v1/question-papers/${id}`,
  /** The filter values that would actually return something. */
  questionPaperFilters: '/api/v1/question-papers/filters',
  /** Cross-paper question search (M10B §6). Reference data only. */
  questionSearch: '/api/v1/questions/search',
  /**
   * The file itself, for `host` papers only.
   *
   * The id is opaque and the storage key is resolved server-side; no path,
   * key or filename is ever accepted from a client (M8 §30).
   */
  questionPaperFile: (id: string) => `/api/v1/question-papers/${id}/file`,
} as const;
