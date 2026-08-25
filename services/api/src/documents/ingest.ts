/**
 * The document lifecycle.
 *
 * Authority: docs/17 §17.1, §17.3, §17.10 · docs/12 · M5A §1, §7, §8
 *
 *   import -> hash -> validate -> (reject) | (QUARANTINE -> store -> validated)
 *                                              -> extract -> sections
 *
 * NOTHING IS STORED BEFORE IT IS VALIDATED. Bytes reach the object store only
 * after they have passed every check, so a hostile file never lands on disk at
 * all. A rejection still leaves a database row recording that something was
 * refused and why, which is what makes rejection auditable without keeping the
 * thing that was rejected.
 *
 * `quarantined` is the state a document is CREATED in, and it is real rather
 * than decorative: the row exists, trusted with nothing, before storage and
 * before any parser sees the file. Extraction refuses to run on a document that
 * has not left it.
 *
 * EVERYTHING ARRIVES PRIVATE. `rights_status` defaults to `user_private` and
 * `presentation` to `private`, and the database refuses to let a `user_private`
 * document be presented any other way. Nothing here can publish, and no
 * argument to any function in this file can make it (M5A §8).
 *
 * There is no path from this module to the network. Bytes are handed in by the
 * caller; nothing is fetched (M5A §4).
 */

import type { Sql } from '../db/client.js';
import type { ObjectStore } from './storage.js';
import { storageKeyFor } from './storage.js';
import { extractText, sectionize, EXTRACTOR_VERSION } from './extract.js';
import { safeFilename, validateDocument } from './validate.js';

export interface ImportRequest {
  readonly bytes: Buffer;
  /** As supplied. Sanitised for display; never used as a path. */
  readonly filename: string;
  /** Optional human title. Falls back to the sanitised filename. */
  readonly title?: string | undefined;
}

export type ImportOutcome =
  | { readonly kind: 'imported'; readonly id: string; readonly sha256: string }
  | { readonly kind: 'duplicate'; readonly id: string; readonly sha256: string }
  | {
      readonly kind: 'rejected';
      readonly id: string;
      readonly sha256: string;
      readonly code: string;
      readonly reason: string;
    };

/**
 * Imports one document.
 *
 * The order is deliberate and is the security property:
 *
 *   1. hash the bytes, and validate them — in memory, touching no storage
 *   2. stop if we already have this content: a duplicate is never re-stored and
 *      the existing row is left exactly as it is, so re-importing cannot reset
 *      a document that has already been processed or reviewed
 *   3. rejected -> write a row recording the refusal and its reason, and
 *      discard the bytes. Nothing hostile is ever written to the object store
 *   4. accepted -> create the row as `quarantined`, then store the bytes, then
 *      mark it `validated`
 *
 * Step 4's three-step write matters: if storage fails, the document is left
 * `quarantined` with no storage key, which extraction refuses to touch. The
 * failure mode is a document that cannot be processed, never a document that
 * looks validated but has no bytes behind it.
 *
 * Never throws on a bad document. A rejection is a RESULT: accepting uploads
 * means malformed input is expected traffic, not an exception.
 */
export async function importDocument(
  sql: Sql,
  store: ObjectStore,
  request: ImportRequest,
): Promise<ImportOutcome> {
  const displayName = safeFilename(request.filename);
  const title = (request.title ?? displayName).slice(0, 500);

  const verdict = validateDocument(request.bytes);
  const { sha256 } = verdict;

  /*
   * Duplicate detection by content address, before anything else is written.
   * The same bytes are one document however many times they arrive, and the
   * existing row's state and rights are left exactly as they are — a re-import
   * must never reset a document someone has already reviewed (M5A §8).
   */
  const existing = await sql<{ id: string }[]>`
    SELECT id::text FROM documents WHERE sha256 = ${sha256}
  `;
  const existingId = existing[0]?.id;
  if (existingId !== undefined) {
    return { kind: 'duplicate', id: existingId, sha256 };
  }

  if (!verdict.ok) {
    /*
     * Rejected. The row records THAT something was refused and why; the bytes
     * are not stored, so the rejected file never lives on our disk.
     *
     * Still `user_private` / `private`, not `blocked`: the document is the
     * uploader's own, and `document_user_private_stays_private` is right to
     * refuse any other presentation. `blocked` is for material we hold and may
     * not use; this is material we declined and do not hold at all.
     */
    const [row] = await sql<{ id: string }[]>`
      INSERT INTO documents (
        title, sha256, byte_size, mime_type, original_filename,
        state, rejection_reason, rights_status, presentation
      ) VALUES (
        ${title}, ${sha256}, ${verdict.byteSize}, 'application/octet-stream', ${displayName},
        'rejected', ${verdict.reason}, 'user_private', 'private'
      )
      RETURNING id::text
    `;
    return {
      kind: 'rejected',
      id: row?.id ?? '',
      sha256,
      code: verdict.code,
      reason: verdict.reason,
    };
  }

  /*
   * Created `quarantined`: validated in memory, but nothing is stored yet and
   * no parser has seen it. It becomes `validated` only once its bytes are
   * safely in the object store.
   */
  const [created] = await sql<{ id: string }[]>`
    INSERT INTO documents (
      title, sha256, byte_size, mime_type, page_count, original_filename,
      state, rights_status, presentation, license_note
    ) VALUES (
      ${title}, ${sha256}, ${verdict.byteSize}, ${verdict.mimeType}, ${verdict.pageCount},
      ${displayName}, 'quarantined', 'user_private', 'private',
      ${verdict.warnings.length > 0 ? verdict.warnings.join(' ') : null}
    )
    RETURNING id::text
  `;
  const id = created?.id ?? '';

  /*
   * The bytes have already passed validation, so what reaches the object store
   * has been checked. Storing first and validating afterwards would put an
   * unexamined file on disk, and a validator that runs after storage protects
   * nothing that matters.
   */
  const storageKey = storageKeyFor(sha256);
  await store.put(storageKey, request.bytes);

  await sql`
    UPDATE documents
       SET state = 'validated', storage_key = ${storageKey}, updated_at = now()
     WHERE id = ${id}::uuid
  `;

  return { kind: 'imported', id, sha256 };
}

export interface ProcessOutcome {
  readonly extractionStatus: string;
  readonly sectionCount: number;
  readonly durationMs: number;
  readonly extractorVersion: string;
}

/**
 * Extracts text and persists sections.
 *
 * Separate from import on purpose: extraction is the slow, parser-adjacent
 * step, and separating it means a re-run after an extractor upgrade does not
 * mean re-importing. Sections are replaced rather than appended, so
 * reprocessing is idempotent instead of accumulating duplicates.
 *
 * Refuses to run on a document that has not passed validation. Extraction is
 * the first thing that hands document bytes to a parser, so quarantine has to
 * hold here specifically (docs/17 §17.3).
 */
export async function processDocument(
  sql: Sql,
  store: ObjectStore,
  id: string,
): Promise<ProcessOutcome | null> {
  const [doc] = await sql<
    { state: string; storage_key: string | null; page_count: number | null }[]
  >`
    SELECT state, storage_key, page_count FROM documents WHERE id = ${id}::uuid
  `;

  if (doc === undefined) return null;
  if (doc.state !== 'validated' && doc.state !== 'extracted') {
    throw new Error(`Document ${id} is ${doc.state} and has not passed validation.`);
  }
  if (doc.storage_key === null) {
    throw new Error(`Document ${id} has no stored bytes to extract from.`);
  }

  const bytes = await store.get(doc.storage_key);
  const result = await extractText(bytes, doc.page_count ?? 1);
  const sections = result.status === 'text_available' ? sectionize(result.text) : [];

  await sql.begin(async (tx) => {
    // Replace, do not append: reprocessing the same document must not double
    // its sections.
    await tx`DELETE FROM document_sections WHERE document_id = ${id}::uuid`;

    for (const section of sections) {
      await tx`
        INSERT INTO document_sections (
          document_id, page_number, ordinal, content, extractor_version
        ) VALUES (
          ${id}::uuid, ${section.pageNumber}, ${section.ordinal},
          ${section.content}, ${EXTRACTOR_VERSION}
        )
      `;
    }

    await tx`
      UPDATE documents
         SET state = 'extracted', extraction_status = ${result.status}, updated_at = now()
       WHERE id = ${id}::uuid
    `;
  });

  return {
    extractionStatus: result.status,
    sectionCount: sections.length,
    durationMs: result.durationMs,
    extractorVersion: result.extractorVersion,
  };
}
