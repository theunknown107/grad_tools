/**
 * AI document reading: the contract between the extraction service and the app.
 *
 * WHAT THIS IS. A model reads a result card or a timetable and returns what
 * the document SAYS — nothing more. Every field here is a source value: the
 * text or number as printed, or null when the document does not state it.
 * There is deliberately no field for a grade point, an SGPA, a CGPA, a
 * percentage, a pass/fail conclusion, a credit the document does not print,
 * or anything from GradTools' catalogue. Those belong to the catalogue and to
 * the deterministic rules engine, which run AFTER this, on the device, and
 * say where each value came from.
 *
 * WHAT THE MODEL RETURNS IS UNTRUSTED INPUT. The server validates it against
 * `aiExtractionSchema` (strict: an unexpected key, type or value rejects the
 * whole response — it is never repaired), then a deterministic recognition
 * gate decides whether it is a supported document at all. Nothing is saved
 * until the student confirms it in review.
 */

import { z } from 'zod';

export const AI_DOCUMENT_TYPES = ['RESULT_CARD', 'TIMETABLE'] as const;
export type AiDocumentType = (typeof AI_DOCUMENT_TYPES)[number];

/** The formats the extraction endpoint accepts, by their content signature. */
export const AI_DOCUMENT_MIME_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
] as const;
export type AiDocumentMimeType = (typeof AI_DOCUMENT_MIME_TYPES)[number];

/** A result card or a timetable is a few megabytes at most. */
export const AI_DOCUMENT_MAX_BYTES = 8 * 1024 * 1024;

export const DOCUMENT_AI_ROUTES = {
  extract: '/api/v1/me/documents/extract',
} as const;

/** Printed text: trimmed, bounded, or null when the document does not say. */
const text = (max: number) => z.string().trim().min(1).max(max).nullable();
const mark = z.number().int().min(0).max(1000).nullable();
const clock = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
  .nullable();
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .nullable();

export const aiResultCourseSchema = z
  .object({
    sourceCourseCode: text(20),
    sourceCourseName: text(200),
    sourceInternalMarks: mark,
    sourceExternalMarks: mark,
    sourceTotalMarks: mark,
    /** Only when the document PRINTS credits; never supplied from knowledge. */
    sourceCredits: z.number().min(0).max(40).nullable(),
    sourceGrade: text(4),
    sourceResultStatus: text(4),
    /** The row as printed, for the student to compare against. */
    sourceText: text(400),
  })
  .strict();

export const aiResultCardSchema = z
  .object({
    institutionName: text(200),
    institutionCode: text(20),
    schemeText: text(80),
    programmeText: text(120),
    branchText: text(120),
    semester: z.number().int().min(1).max(12).nullable(),
    examinationSession: text(80),
    /** Whether a USN/seat number is printed. The number itself is never returned. */
    studentIdentifierPresent: z.boolean(),
    courses: z.array(aiResultCourseSchema).max(40),
  })
  .strict();

export const AI_WEEKDAYS = [
  'MONDAY',
  'TUESDAY',
  'WEDNESDAY',
  'THURSDAY',
  'FRIDAY',
  'SATURDAY',
  'SUNDAY',
] as const;

export const AI_ACTIVITY_TYPES = [
  'LECTURE',
  'TUTORIAL',
  'LAB',
  'PROJECT',
  'BREAK',
  'OTHER',
] as const;

export const aiTimetableSessionSchema = z
  .object({
    day: z.enum(AI_WEEKDAYS).nullable(),
    startTime: clock,
    endTime: clock,
    /** As printed in the cell: a code, if the cell prints one. */
    subjectCode: text(20),
    /** As printed in the cell: often initials such as "TOC" or "CN". */
    subjectName: text(200),
    batch: text(40),
    room: text(40),
    faculty: text(120),
    activityType: z.enum(AI_ACTIVITY_TYPES).nullable(),
    sourceText: text(200),
  })
  .strict();

/** The legend most timetables print: code, name and teacher of each subject. */
export const aiTimetableSubjectSchema = z
  .object({
    subjectCode: text(20),
    subjectName: text(200),
    faculty: text(120),
  })
  .strict();

export const aiTimetableSchema = z
  .object({
    institutionName: text(200),
    institutionCode: text(20),
    department: text(200),
    programme: text(120),
    /** The class as printed, e.g. "V (B)". */
    classText: text(40),
    semester: z.number().int().min(1).max(12).nullable(),
    academicYear: text(20),
    effectiveFrom: isoDate,
    effectiveTo: isoDate,
    sessions: z.array(aiTimetableSessionSchema).max(120),
    subjects: z.array(aiTimetableSubjectSchema).max(40),
  })
  .strict();

/**
 * The whole model response. One object, one shape, whatever the document:
 * `OTHER` is how the model says it is neither a result card nor a timetable.
 */
export const aiExtractionSchema = z
  .object({
    documentType: z.enum([...AI_DOCUMENT_TYPES, 'OTHER']),
    /** The document's heading lines, verbatim, for the deterministic gate. */
    headerText: text(800),
    resultCard: aiResultCardSchema.nullable(),
    timetable: aiTimetableSchema.nullable(),
  })
  .strict();

export type AiExtraction = z.infer<typeof aiExtractionSchema>;
export type AiResultCard = z.infer<typeof aiResultCardSchema>;
export type AiResultCourse = z.infer<typeof aiResultCourseSchema>;
export type AiTimetable = z.infer<typeof aiTimetableSchema>;
export type AiTimetableSession = z.infer<typeof aiTimetableSessionSchema>;

export const AI_RECOGNITION = ['RECOGNIZED', 'NEEDS_REVIEW', 'UNRECOGNIZED_DOCUMENT'] as const;
export type AiRecognition = (typeof AI_RECOGNITION)[number];

/** What the endpoint returns: the source layer, and what the gate found. */
export const aiReviewSchema = z
  .object({
    recognition: z.enum(AI_RECOGNITION),
    /** Why, in words: each piece of evidence the deterministic gate found. */
    evidence: z.array(z.string().max(200)).max(20),
    documentType: z.enum(AI_DOCUMENT_TYPES).nullable(),
    resultCard: aiResultCardSchema.nullable(),
    timetable: aiTimetableSchema.nullable(),
    /** The model that read it, so the review can say so. */
    model: z.string().min(1).max(60),
  })
  .strict();

export type AiReview = z.infer<typeof aiReviewSchema>;
