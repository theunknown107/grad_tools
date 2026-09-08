/**
 * Persisting the normalized catalogue, idempotently.
 *
 * Authority: Phase 7D.1 §2, §3, §8, §9, §10, §11, §12, §19
 *
 * ---------------------------------------------------------------------------
 * RUNNING IT TWICE MUST CHANGE NOTHING
 * ---------------------------------------------------------------------------
 *
 * §19 is the requirement that shapes this whole module. Every write is an
 * upsert against a stable identity, so a second sync over unchanged sources
 * produces no new document versions, no new courses, no new references and no
 * new applicability rows.
 *
 * The identities:
 *
 *   document version   its SHA-256, and nothing else
 *   source reference   (version, url)
 *   applicability      (version, scope, programme, stream)
 *   course             (scheme year, programme, stream, semester, code)
 *
 * THE STREAM BELONGS IN THAT KEY. Two stream-wide first-year schemes both
 * describe "semester 1" with no programme, and without the stream they shared
 * an identity and overwrote each other — 57 Civil courses read, 4 kept.
 *
 * A COURSE'S TITLE IS NOT PART OF ITS IDENTITY (§9). VTU corrects wording
 * between revisions, and a title in the key would turn every correction into a
 * second course sitting beside the first.
 */

import type { Sql } from 'postgres';

export interface DocumentVersionInput {
  readonly sha256: string;
  readonly byteSize: number;
  readonly mimeType: string;
  readonly pageCount: number | null;
  readonly retrievedAt: string;
  readonly extractionMethod: string | null;
  readonly extractionStatus: 'pending' | 'text' | 'no_text_layer' | 'failed';
  readonly parserVersion: string | null;
  readonly normalizationVersion: string | null;
}

export interface SourceReferenceInput {
  readonly url: string;
  readonly linkText: string | null;
  readonly sourceId: string | null;
}

export interface ApplicabilityInput {
  readonly scope: 'programme' | 'stream' | 'common' | 'unknown' | 'ambiguous';
  readonly programmeName: string | null;
  readonly streamId: string | null;
  readonly schemeYear: string | null;
  readonly semesterFrom: number | null;
  readonly semesterTo: number | null;
}

export interface CourseInput {
  readonly schemeYear: string;
  readonly programmeName: string | null;
  readonly streamId: string | null;
  readonly semester: number;
  readonly code: string;
  readonly title: string;
  readonly credits: number;
  readonly creditBasis: 'table' | 'slot' | 'alternative';
  readonly relatedCode: string | null;
  readonly category: string | null;
  readonly sha256: string;
  readonly sourcePage: number | null;
}

export interface PersistCounts {
  readonly versionsInserted: number;
  readonly versionsUpdated: number;
  readonly referencesInserted: number;
  readonly applicabilityInserted: number;
  readonly coursesInserted: number;
  readonly coursesUpdated: number;
  readonly coursesUnchanged: number;
}

/**
 * Records a document version, or refreshes the one already held.
 *
 * `last_seen` advances on every sighting so a document that stops appearing in
 * discovery becomes visibly stale (§32); `first_seen` never moves.
 */
export async function upsertDocumentVersion(
  sql: Sql,
  input: DocumentVersionInput,
): Promise<{ id: string; inserted: boolean }> {
  const rows = await sql<{ id: string; inserted: boolean }[]>`
    INSERT INTO source_document_versions (
      sha256, byte_size, mime_type, page_count, retrieved_at,
      extraction_method, extraction_status, parser_version, normalization_version
    )
    VALUES (
      ${input.sha256}, ${input.byteSize}, ${input.mimeType}, ${input.pageCount},
      ${input.retrievedAt}, ${input.extractionMethod}, ${input.extractionStatus},
      ${input.parserVersion}, ${input.normalizationVersion}
    )
    ON CONFLICT (sha256) DO UPDATE SET
      last_seen             = now(),
      updated_at            = now(),
      page_count            = COALESCE(EXCLUDED.page_count, source_document_versions.page_count),
      extraction_method     = COALESCE(EXCLUDED.extraction_method, source_document_versions.extraction_method),
      extraction_status     = EXCLUDED.extraction_status,
      parser_version        = COALESCE(EXCLUDED.parser_version, source_document_versions.parser_version),
      normalization_version = COALESCE(EXCLUDED.normalization_version, source_document_versions.normalization_version)
    RETURNING id, (xmax = 0) AS inserted
  `;
  const row = rows[0];
  if (row === undefined) throw new Error(`Could not record document ${input.sha256}.`);
  return row;
}

/** Every URL that has served these bytes. Many URLs to one version (§6). */
export async function upsertSourceReference(
  sql: Sql,
  versionId: string,
  input: SourceReferenceInput,
): Promise<boolean> {
  const rows = await sql<{ inserted: boolean }[]>`
    INSERT INTO source_document_references (version_id, source_id, url, link_text)
    VALUES (${versionId}, ${input.sourceId}, ${input.url}, ${input.linkText})
    ON CONFLICT (version_id, url) DO UPDATE SET
      last_seen = now(),
      link_text = COALESCE(EXCLUDED.link_text, source_document_references.link_text)
    RETURNING (xmax = 0) AS inserted
  `;
  return rows[0]?.inserted ?? false;
}

/**
 * Who a document is for.
 *
 * `common` and `unknown` are separate scopes on purpose (§6): a first-year
 * scheme that genuinely serves a whole stream is not the same fact as a
 * document nobody has classified, and `programme = null` could not tell them
 * apart.
 */
export async function upsertApplicability(
  sql: Sql,
  versionId: string,
  input: ApplicabilityInput,
): Promise<boolean> {
  const rows = await sql<{ inserted: boolean }[]>`
    INSERT INTO document_applicability (
      version_id, scope, programme_name, stream_id, scheme_year, semester_from, semester_to
    )
    VALUES (
      ${versionId}, ${input.scope}, ${input.programmeName}, ${input.streamId},
      ${input.schemeYear}, ${input.semesterFrom}, ${input.semesterTo}
    )
    ON CONFLICT (version_id, scope, COALESCE(programme_name, ''), COALESCE(stream_id, ''))
      DO NOTHING
    RETURNING (xmax = 0) AS inserted
  `;
  return rows[0]?.inserted ?? false;
}

/**
 * A course, by its identity rather than by its wording.
 *
 * Returns `unchanged` when every field already matches, so a sync report can
 * distinguish "nothing to do" from "rewrote the same values" — §19 asks for
 * zero unwanted catalogue changes, and that is only checkable if the writer
 * can tell the difference.
 */
export async function upsertCourse(
  sql: Sql,
  input: CourseInput,
): Promise<'inserted' | 'updated' | 'unchanged'> {
  const rows = await sql<{ action: string }[]>`
    WITH resolved AS (
      SELECT id AS version_id FROM source_document_versions WHERE sha256 = ${input.sha256}
    ),
    existing AS (
      SELECT id, title, credits, credit_basis, related_code, category, version_id, source_page
      FROM catalogue_courses
      WHERE scheme_year = ${input.schemeYear}
        AND COALESCE(programme_name, '') = COALESCE(${input.programmeName}::text, '')
        AND COALESCE(stream_id, '') = COALESCE(${input.streamId}::text, '')
        AND semester = ${input.semester}
        AND code = ${input.code}
    ),
    inserted AS (
      INSERT INTO catalogue_courses (
        scheme_year, programme_name, stream_id, semester, code,
        title, credits, credit_basis, related_code, category, version_id, source_page
      )
      SELECT
        ${input.schemeYear}, ${input.programmeName}, ${input.streamId},
        ${input.semester}, ${input.code}, ${input.title}, ${input.credits},
        ${input.creditBasis}::credit_basis, ${input.relatedCode}, ${input.category},
        resolved.version_id, ${input.sourcePage}
      FROM resolved
      WHERE NOT EXISTS (SELECT 1 FROM existing)
      RETURNING 'inserted' AS action
    ),
    updated AS (
      UPDATE catalogue_courses c SET
        title        = ${input.title},
        credits      = ${input.credits},
        credit_basis = ${input.creditBasis}::credit_basis,
        related_code = ${input.relatedCode},
        category     = ${input.category},
        version_id   = (SELECT version_id FROM resolved),
        source_page  = ${input.sourcePage},
        updated_at   = now()
      FROM existing e
      WHERE c.id = e.id
        AND (
          e.title <> ${input.title}
          OR e.credits <> ${input.credits}
          OR e.credit_basis <> ${input.creditBasis}::credit_basis
          OR COALESCE(e.related_code, '') <> COALESCE(${input.relatedCode}::text, '')
          OR COALESCE(e.category, '') <> COALESCE(${input.category}::text, '')
          OR e.version_id <> (SELECT version_id FROM resolved)
        )
      RETURNING 'updated' AS action
    )
    SELECT action FROM inserted
    UNION ALL SELECT action FROM updated
    UNION ALL SELECT 'unchanged' WHERE EXISTS (SELECT 1 FROM existing)
    LIMIT 1
  `;
  const action = rows[0]?.action;
  if (action === 'inserted' || action === 'updated') return action;
  if (action === 'unchanged') return 'unchanged';
  throw new Error(`No document version ${input.sha256} for course ${input.code}.`);
}

/** A stream, and the programmes the university's own list places in it. */
export async function upsertStream(
  sql: Sql,
  stream: { id: string; name: string; sourceUrl: string | null },
): Promise<void> {
  await sql`
    INSERT INTO academic_streams (id, name, source_url)
    VALUES (${stream.id}, ${stream.name}, ${stream.sourceUrl})
    ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name
  `;
}

export async function upsertStreamProgramme(
  sql: Sql,
  entry: {
    streamId: string;
    programmeCode: string;
    programmeName: string;
    sourceUrl: string | null;
  },
): Promise<void> {
  await sql`
    INSERT INTO academic_stream_programmes (stream_id, programme_code, programme_name, source_url)
    VALUES (${entry.streamId}, ${entry.programmeCode}, ${entry.programmeName}, ${entry.sourceUrl})
    ON CONFLICT (stream_id, programme_code) DO UPDATE SET
      programme_name = EXCLUDED.programme_name
  `;
}

/**
 * A disagreement between two official documents.
 *
 * Recorded, never resolved here (§11). Both readings are stored with the
 * document each came from; a resolution needs a documented precedence rule and
 * somebody to record having applied it.
 */
export async function recordConflict(
  sql: Sql,
  conflict: {
    schemeYear: string;
    programmeName: string | null;
    semester: number | null;
    code: string;
    field: string;
    readings: readonly { value: string; sha256: string; sourcePage: number | null }[];
  },
): Promise<void> {
  const rows = await sql<{ id: string }[]>`
    INSERT INTO catalogue_conflicts (scheme_year, programme_name, semester, code, field)
    VALUES (
      ${conflict.schemeYear}, ${conflict.programmeName}, ${conflict.semester},
      ${conflict.code}, ${conflict.field}
    )
    RETURNING id
  `;
  const id = rows[0]?.id;
  if (id === undefined) return;
  for (const reading of conflict.readings) {
    await sql`
      INSERT INTO catalogue_conflict_readings (conflict_id, version_id, value, source_page)
      SELECT ${id}, v.id, ${reading.value}, ${reading.sourcePage}
      FROM source_document_versions v WHERE v.sha256 = ${reading.sha256}
      ON CONFLICT DO NOTHING
    `;
  }
}

/** An equivalence the university's own documents establish (§12). */
export async function upsertAlias(
  sql: Sql,
  alias: {
    schemeYear: string;
    variantCode: string;
    canonicalCode: string;
    title: string;
    reason: string;
    sha256: string | null;
    sourcePage: number | null;
  },
): Promise<void> {
  await sql`
    INSERT INTO catalogue_aliases (
      scheme_year, variant_code, canonical_code, title, reason, version_id, source_page
    )
    VALUES (
      ${alias.schemeYear}, ${alias.variantCode}, ${alias.canonicalCode},
      ${alias.title}, ${alias.reason},
      (SELECT id FROM source_document_versions WHERE sha256 = ${alias.sha256}),
      ${alias.sourcePage}
    )
    ON CONFLICT (scheme_year, variant_code, canonical_code) DO UPDATE SET
      title  = EXCLUDED.title,
      reason = EXCLUDED.reason
  `;
}
