/**
 * What a run read, and what it decided — written down.
 *
 * Authority: Phase 7B.3 §16–§18, §60, §77, §133 · 0017_source_items.sql
 *
 * ---------------------------------------------------------------------------
 * THE LEDGER IS THE PRODUCT, NOT THE BYPRODUCT
 * ---------------------------------------------------------------------------
 *
 * A monitoring worker that reports "12 checked, 4 failed" and names none of
 * them has told an operator nothing they can act on. Everything here exists so
 * that after a run there is a row per item saying which source it came from,
 * which version of it we hold, what we classified it as, which phrases produced
 * that, and — where nothing came of it — why (§16).
 *
 * An item is stored whether or not it notified anybody, and a withdrawn item is
 * marked rather than deleted. Both follow from one rule: the record of what a
 * source said is not ours to discard because it became inconvenient.
 */

import type { Sql } from '../db/client.js';
import type { ChangeType, KnownItem, LedgerRow, SourceFamily, SourceItemInput } from './run.js';
import type { Importance, SourceCategory } from './classify.js';

/** One row as it goes into `source_items`: the item plus what we made of it. */
export interface StoredItem {
  readonly item: SourceItemInput;
  readonly contentHash: string;
  readonly change: ChangeType;
  readonly category: SourceCategory;
  readonly signals: readonly string[];
  readonly importance: Importance;
}

/**
 * What the last run left behind, keyed by the source's own id.
 *
 * The LATEST version of each item, and only the ones still being served. A
 * removed item is excluded so that a source restoring a post reads as `new`
 * rather than `unchanged` — the student never saw it, so it is news to them.
 */
export async function knownItems(sql: Sql, sourceId: string): Promise<Map<string, KnownItem>> {
  const rows = await sql<{ external_id: string; content_hash: string }[]>`
    SELECT DISTINCT ON (external_id) external_id, content_hash
    FROM source_items
    WHERE source_id = ${sourceId} AND removed_at IS NULL
    ORDER BY external_id, last_seen_at DESC
  `;
  return new Map(
    rows.map((row) => [
      row.external_id,
      { externalId: row.external_id, contentHash: row.content_hash, supersededBy: null },
    ]),
  );
}

/**
 * Writes the items a run read.
 *
 * ON CONFLICT touches only `last_seen_at` and `last_run_id`, because re-reading
 * an item is new information about WHEN, not about WHAT. Rewriting the title or
 * the classification on a collision would silently rewrite the history the
 * first run recorded (§18).
 */
export async function saveItems(
  sql: Sql,
  runId: string,
  sourceId: string,
  family: SourceFamily,
  items: readonly StoredItem[],
): Promise<void> {
  for (const stored of items) {
    const { item, contentHash } = stored;
    const who = item.audience;
    await sql`
      INSERT INTO source_items (
        source_id, family, external_id, content_hash, url, title, body,
        published_at, source_updated_at, supersedes,
        category, signals, importance,
        aud_scheme, aud_programme, aud_branch, aud_department, aud_stream,
        aud_college, aud_semester, aud_courses, aud_exam_cycle, unresolved_scope,
        change, first_run_id, last_run_id
      ) VALUES (
        ${sourceId}, ${family}, ${item.externalId}, ${contentHash}, ${item.url},
        ${item.title}, ${item.body},
        ${item.publishedAt}, ${item.updatedAt}, ${item.supersedes},
        ${stored.category}, ${sql.array([...stored.signals])}, ${stored.importance},
        ${who.scheme}, ${who.programme}, ${who.branch},
        ${who.department}, ${who.stream}, ${who.college},
        ${who.semester}, ${sql.array([...who.courses])}, ${who.examCycle},
        ${who.unresolvedScope},
        ${stored.change}, ${runId}, ${runId}
      )
      ON CONFLICT (source_id, external_id, content_hash) DO UPDATE SET
        last_seen_at = now(),
        last_run_id = EXCLUDED.last_run_id,
        removed_at = NULL
    `;
  }
}

/**
 * Marks the items a source has stopped serving.
 *
 * `removed_at`, never DELETE. The student may already have been told about it,
 * and a notification whose source row vanished is a notification nobody can
 * explain (§15, §77).
 */
export async function markRemoved(
  sql: Sql,
  runId: string,
  sourceId: string,
  externalIds: readonly string[],
): Promise<void> {
  if (externalIds.length === 0) return;
  await sql`
    UPDATE source_items
    SET removed_at = now(), last_run_id = ${runId}, change = 'removed'
    WHERE source_id = ${sourceId}
      AND external_id = ANY(${sql.array([...externalIds])})
      AND removed_at IS NULL
  `;
}

/** Opens a run row before any work happens, so a crash still leaves a trace. */
export async function startRun(
  sql: Sql,
  runId: string,
  family: SourceFamily,
  mode: 'live' | 'fixture' | 'supplied',
  dryRun: boolean,
): Promise<void> {
  await sql`
    INSERT INTO monitor_runs (run_id, family, mode, dry_run)
    VALUES (${runId}, ${family}, ${mode}, ${dryRun})
  `;
}

/**
 * Closes a run row.
 *
 * `outcome` is set even when the run was refused before it read anything.
 * §133's point is that a source nobody is allowed to fetch and a source that is
 * simply quiet must not produce the same operational picture.
 */
export async function finishRun(
  sql: Sql,
  runId: string,
  outcome: string,
  detail: string | null,
  ledger: readonly LedgerRow[],
): Promise<void> {
  const count = (change: ChangeType) => ledger.filter((row) => row.change === change).length;
  await sql`
    UPDATE monitor_runs SET
      finished_at = now(),
      outcome = ${outcome},
      detail = ${detail},
      discovered = ${ledger.length},
      items_new = ${count('new')},
      items_unchanged = ${count('unchanged')},
      items_updated = ${count('updated')},
      items_revised = ${count('revised')},
      items_removed = ${count('removed')},
      skipped = ${ledger.filter((row) => !row.notifiable).length}
    WHERE run_id = ${runId}
  `;
}

/** One stored item, as the per-student projection needs to read it back. */
export interface PublishedItem {
  readonly externalId: string;
  readonly contentHash: string;
  readonly family: string;
  readonly category: SourceCategory;
  readonly importance: Importance;
  readonly title: string;
  readonly url: string;
  readonly publishedAt: string | null;
  readonly audience: SourceItemInput['audience'];
}

/**
 * The items a student could be told about.
 *
 * Withdrawn and unclassifiable items are excluded HERE rather than in the
 * projection, because "could this notify anyone at all" is a property of the
 * item. Asking every student's session to re-derive it would be exactly the
 * per-user work §65 rules out.
 */
export async function publishedItems(
  sql: Sql,
  family: SourceFamily | null = null,
  limit = 200,
): Promise<PublishedItem[]> {
  const rows = await sql<
    {
      external_id: string;
      content_hash: string;
      family: string;
      category: string;
      importance: string;
      title: string;
      url: string;
      published_at: Date | string | null;
      aud_scheme: string | null;
      aud_programme: string | null;
      aud_branch: string | null;
      aud_department: string | null;
      aud_stream: string | null;
      aud_college: string | null;
      aud_semester: number | null;
      aud_courses: string[];
      aud_exam_cycle: string | null;
      unresolved_scope: boolean;
    }[]
  >`
    SELECT external_id, content_hash, family, category, importance, title, url,
           published_at, aud_scheme, aud_programme, aud_branch, aud_department,
           aud_stream, aud_college, aud_semester, aud_courses, aud_exam_cycle,
           unresolved_scope
    FROM source_items
    WHERE removed_at IS NULL
      AND category <> 'unresolved'
      AND unresolved_scope = false
      AND (${family}::text IS NULL OR family = ${family})
    ORDER BY published_at DESC NULLS LAST, first_seen_at DESC
    LIMIT ${limit}
  `;

  return rows.map((row) => ({
    externalId: row.external_id,
    contentHash: row.content_hash,
    family: row.family,
    category: row.category as SourceCategory,
    importance: row.importance as Importance,
    title: row.title,
    url: row.url,
    publishedAt:
      row.published_at === null
        ? null
        : row.published_at instanceof Date
          ? row.published_at.toISOString().slice(0, 10)
          : row.published_at,
    audience: {
      scheme: row.aud_scheme,
      programme: row.aud_programme,
      branch: row.aud_branch,
      department: row.aud_department,
      stream: row.aud_stream,
      college: row.aud_college,
      semester: row.aud_semester,
      courses: row.aud_courses,
      examCycle: row.aud_exam_cycle,
      unresolvedScope: row.unresolved_scope,
    },
  }));
}
