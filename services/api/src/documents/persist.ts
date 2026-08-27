/**
 * Persisting extracted structure, and recording human review.
 *
 * Authority: docs/08 §8.9 · docs/09 §9.8 · docs/17 §17.17 · M5A.5 §3–§6, §9, §16
 *
 * Two operations, deliberately in one place because they are the two halves of
 * the same rule: THE MACHINE WRITES ONCE AND A HUMAN WRITES BESIDE IT.
 *
 *   persistExtraction   the parser's output, written once, never updated
 *   recordReview        a person's conclusion, written alongside, never over
 *
 * NOTHING IS DELETED FOR BEING UNCERTAIN (M5A.5 §6). A low-confidence question
 * is stored exactly like a high-confidence one and marked; a rejected one keeps
 * its row. Discarding weak records would destroy the evidence a reviewer needs
 * to tell a parser bug from a bad scan.
 */

import type { Sql } from '../db/client.js';
import type { PersistOutcome, ReviewRequest, ReviewTarget } from '@gradtools/shared-types';
import type { PositionalExtraction } from './positional.js';

/** PostgreSQL unique-violation. A concurrent identical run, not a fault. */
const UNIQUE_VIOLATION = '23505';

/**
 * Stores one extraction run.
 *
 * IDEMPOTENT BY THE DATABASE, NOT BY GOOD BEHAVIOUR (M5A.5 §16). The unique key
 * on `(document_id, parser_version)` is what makes running this twice a no-op;
 * the pre-check below is only there to give a truthful answer without provoking
 * an error, and the caught unique violation covers the case where two callers
 * race past the check together.
 *
 * A NEW PARSER VERSION IS A NEW RUN, never an overwrite. The previous run's
 * rows — and any review a person recorded against them — survive untouched, and
 * only the `is_current` flag moves. That is the difference between reprocessing
 * and losing someone's work.
 *
 * A paper with ZERO questions is still persisted. "We ran the parser and it
 * found nothing" is a result worth keeping: it is what the worst scan in the
 * corpus produces (docs/17 §17.16), and an absent row could not be told apart
 * from a document nobody has tried yet.
 */
export async function persistExtraction(
  sql: Sql,
  documentId: string,
  extraction: PositionalExtraction,
): Promise<PersistOutcome> {
  const { paper, parserVersion, source } = extraction;
  const subQuestionCount = paper.questions.reduce((sum, q) => sum + q.subQuestions.length, 0);

  const unchanged = (paperId: string, version: number): PersistOutcome => ({
    kind: 'unchanged',
    paperId,
    extractionVersion: version,
    parserVersion,
    extractionSource: source,
    paperFormat: paper.format,
    questionCount: paper.questions.length,
    subQuestionCount,
    mcqItemCount: paper.mcqItems.length,
    durationMs: extraction.durationMs,
  });

  const [already] = await sql<{ id: string; extraction_version: number }[]>`
    SELECT id::text, extraction_version
      FROM extracted_papers
     WHERE document_id = ${documentId}::uuid AND parser_version = ${parserVersion}
  `;
  if (already !== undefined) return unchanged(already.id, already.extraction_version);

  try {
    const result = await sql.begin(async (tx) => {
      const [versionRow] = await tx<{ next: number }[]>`
        SELECT COALESCE(MAX(extraction_version), 0) + 1 AS next
          FROM extracted_papers WHERE document_id = ${documentId}::uuid
      `;
      const version = versionRow?.next ?? 1;

      // Only one run is current. The others stay queryable rather than being
      // removed, which is what makes an upgrade auditable.
      await tx`
        UPDATE extracted_papers SET is_current = false
         WHERE document_id = ${documentId}::uuid AND is_current
      `;

      const [created] = await tx<{ id: string }[]>`
        INSERT INTO extracted_papers (
          document_id, paper_format, extraction_source, parser_version,
          extraction_version, is_current, page_count, question_count,
          mcq_item_count, needs_review, review_reason
        ) VALUES (
          ${documentId}::uuid, ${paper.format}, ${source}, ${parserVersion},
          ${version}, true, ${paper.pages}, ${paper.questions.length},
          ${paper.mcqItems.length}, ${paper.needsReview}, ${paper.reviewReason}
        )
        RETURNING id::text
      `;
      const paperId = created?.id ?? '';

      for (const [ordinal, question] of paper.questions.entries()) {
        const [row] = await tx<{ id: string }[]>`
          INSERT INTO extracted_questions (
            paper_id, paper_format, ordinal, question_number, module, question_text,
            marks, bloom_level, course_outcome, page_number,
            bbox_x, bbox_y, bbox_width, bbox_height, confidence, needs_review
          ) VALUES (
            ${paperId}::uuid, 'descriptive', ${ordinal}, ${question.questionNumber},
            ${question.module}, ${question.text}, ${question.marks}, ${question.bloomLevel},
            ${question.courseOutcome}, ${question.page},
            ${question.boundingBox.x}, ${question.boundingBox.y},
            ${question.boundingBox.width}, ${question.boundingBox.height},
            ${question.confidence}, ${question.needsReview}
          )
          RETURNING id::text
        `;
        const questionId = row?.id ?? '';

        for (const [subOrdinal, sub] of question.subQuestions.entries()) {
          await tx`
            INSERT INTO extracted_sub_questions (
              question_id, ordinal, label, sub_text, marks, bloom_level, course_outcome,
              page_number, bbox_x, bbox_y, bbox_width, bbox_height, confidence, needs_review
            ) VALUES (
              ${questionId}::uuid, ${subOrdinal}, ${sub.label}, ${sub.text}, ${sub.marks},
              ${sub.bloomLevel}, ${sub.courseOutcome}, ${sub.page},
              ${sub.boundingBox.x}, ${sub.boundingBox.y},
              ${sub.boundingBox.width}, ${sub.boundingBox.height},
              ${sub.confidence}, ${sub.needsReview}
            )
          `;
        }
      }

      for (const [ordinal, item] of paper.mcqItems.entries()) {
        await tx`
          INSERT INTO extracted_mcq_items (
            paper_id, paper_format, ordinal, item_number, item_text, options,
            page_number, bbox_x, bbox_y, bbox_width, bbox_height, confidence, needs_review
          ) VALUES (
            ${paperId}::uuid, 'mcq', ${ordinal}, ${item.itemNumber}, ${item.text},
            ${tx.json([...item.options])}, ${item.page},
            ${item.boundingBox.x}, ${item.boundingBox.y},
            ${item.boundingBox.width}, ${item.boundingBox.height},
            ${item.confidence}, ${item.needsReview}
          )
        `;
      }

      return { paperId, version };
    });

    return {
      kind: 'persisted',
      paperId: result.paperId,
      extractionVersion: result.version,
      parserVersion,
      extractionSource: source,
      paperFormat: paper.format,
      questionCount: paper.questions.length,
      subQuestionCount,
      mcqItemCount: paper.mcqItems.length,
      durationMs: extraction.durationMs,
    };
  } catch (cause) {
    /*
     * Two callers ran the same parser over the same document at once. The
     * database refused the second, which is exactly what it is for. Report the
     * run that won rather than an error: nothing went wrong.
     */
    if (isUniqueViolation(cause)) {
      const [winner] = await sql<{ id: string; extraction_version: number }[]>`
        SELECT id::text, extraction_version
          FROM extracted_papers
         WHERE document_id = ${documentId}::uuid AND parser_version = ${parserVersion}
      `;
      if (winner !== undefined) return unchanged(winner.id, winner.extraction_version);
    }
    throw cause;
  }
}

function isUniqueViolation(cause: unknown): boolean {
  return (
    typeof cause === 'object' &&
    cause !== null &&
    'code' in cause &&
    (cause as { code?: unknown }).code === UNIQUE_VIOLATION
  );
}

/* -------------------------------------------------------------------------- */
/* Human review                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Records one person's conclusion about one extracted record.
 *
 * THE MACHINE COLUMNS ARE NEVER TOUCHED (M5A.5 §9). A correction is written to
 * the `reviewed_*` columns beside them, so the effective value is
 * `reviewed ?? machine` and both are always visible. An audit trail that cannot
 * show what the machine said is not an audit trail.
 *
 *   accept   the machine value stands; any earlier correction is cleared,
 *            because "the machine was right" and "here is my replacement" are
 *            contradictory claims
 *   correct  a person's values are recorded alongside
 *   reject   the record is judged spurious. The row STAYS: deleting it would
 *            lose the evidence that the parser produced it (M5A.5 §6)
 *
 * Returns false when there is no such record, so the caller can answer 404
 * rather than reporting a silent success.
 */
export async function recordReview(
  sql: Sql,
  target: ReviewTarget,
  id: string,
  review: ReviewRequest,
): Promise<boolean> {
  const reviewState =
    review.action === 'accept'
      ? 'accepted'
      : review.action === 'correct'
        ? 'corrected'
        : 'rejected';
  const corrections = review.action === 'correct' ? (review.corrections ?? {}) : {};
  const note = review.note ?? null;

  // `?? null` rather than leaving undefined: an omitted field must clear any
  // earlier correction, not silently keep it.
  const value = <T>(field: T | null | undefined): T | null => field ?? null;

  const rows =
    target === 'question'
      ? await sql`
          UPDATE extracted_questions
             SET review_state = ${reviewState},
                 reviewed_question_number = ${value(corrections.questionNumber)},
                 reviewed_module          = ${value(corrections.module)},
                 reviewed_question_text   = ${value(corrections.text)},
                 reviewed_marks           = ${value(corrections.marks)},
                 reviewed_bloom_level     = ${value(corrections.bloomLevel)},
                 reviewed_course_outcome  = ${value(corrections.courseOutcome)},
                 review_note = ${note}, reviewed_at = now(), reviewed_by = ${review.reviewedBy}
           WHERE id = ${id}::uuid
           RETURNING id
        `
      : target === 'sub-question'
        ? await sql`
            UPDATE extracted_sub_questions
               SET review_state = ${reviewState},
                   reviewed_label    = ${value(corrections.label)},
                   reviewed_sub_text = ${value(corrections.text)},
                   reviewed_marks    = ${value(corrections.marks)},
                   reviewed_bloom_level    = ${value(corrections.bloomLevel)},
                   reviewed_course_outcome = ${value(corrections.courseOutcome)},
                   review_note = ${note}, reviewed_at = now(), reviewed_by = ${review.reviewedBy}
             WHERE id = ${id}::uuid
             RETURNING id
          `
        : await sql`
            UPDATE extracted_mcq_items
               SET review_state = ${reviewState},
                   reviewed_item_number = ${value(corrections.itemNumber)},
                   reviewed_item_text   = ${value(corrections.text)},
                   reviewed_options     = ${
                     corrections.options === undefined || corrections.options === null
                       ? null
                       : sql.json([...corrections.options])
                   },
                   review_note = ${note}, reviewed_at = now(), reviewed_by = ${review.reviewedBy}
             WHERE id = ${id}::uuid
             RETURNING id
          `;

  return rows.length > 0;
}
