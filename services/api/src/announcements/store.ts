/**
 * Announcement persistence, deduplication and the publication gate.
 *
 * Authority: docs/09 §9.16 · docs/14 §14.15 · M7 §10, §11, §12, §22
 *
 * ONE LOGICAL ANNOUNCEMENT PER NOTICE. Seeing the same item twice updates the
 * row; a genuine edit updates it and records the change. Neither produces a
 * second copy, and neither loses where it came from.
 *
 * NOTHING HERE PUBLISHES BY ITSELF. An announcement arrives unverified and
 * unpublished, exactly like a fetched one, and reaching a student is a separate
 * deliberate act guarded by a database CHECK (M7 §11).
 */

import type { Sql } from '../db/client.js';
import type { AnnouncementAudience, AnnouncementOrigin } from '@gradtools/shared-types';
import type { NormalizedAnnouncement } from './normalize.js';

export interface UpsertInput {
  readonly normalized: NormalizedAnnouncement;
  readonly origin: AnnouncementOrigin;
  readonly sourceId: string | null;
  readonly audience: Partial<AnnouncementAudience>;
}

export type UpsertOutcome =
  | { readonly kind: 'created'; readonly id: string }
  | { readonly kind: 'unchanged'; readonly id: string }
  | { readonly kind: 'updated'; readonly id: string };

/**
 * Stores one announcement, or recognises it as one already held.
 *
 * IDENTITY, IN ORDER OF STRENGTH:
 *
 *   1. `(source_id, external_id)` — the source's own identifier. Survives an
 *      edit to the content, which is what makes an update an update.
 *   2. `(source_id, content_hash)` — for a source that names nothing. The same
 *      words from the same source are the same notice.
 *
 * An operator entry has neither: it has no source, so every entry is a new
 * record. That is correct — a person typing a notice twice has typed two
 * notices, and silently merging them would hide a mistake rather than prevent
 * one.
 */
export async function upsertAnnouncement(sql: Sql, input: UpsertInput): Promise<UpsertOutcome> {
  const { normalized: n, origin, sourceId, audience } = input;

  const existing =
    sourceId === null
      ? []
      : n.externalId !== null
        ? await sql<{ id: string; content_hash: string }[]>`
            SELECT id::text, content_hash FROM announcements
             WHERE source_id = ${sourceId} AND external_id = ${n.externalId}
          `
        : await sql<{ id: string; content_hash: string }[]>`
            SELECT id::text, content_hash FROM announcements
             WHERE source_id = ${sourceId} AND external_id IS NULL
               AND content_hash = ${n.contentHash}
          `;

  const found = existing[0];

  if (found !== undefined) {
    /*
     * Seen again, unchanged. Only `last_seen_at` moves — the content, its
     * first sighting and any verification it has already been given all stand.
     * Re-verifying an unchanged notice on every poll would make the gate
     * meaningless.
     */
    if (found.content_hash === n.contentHash) {
      await sql`UPDATE announcements SET last_seen_at = now() WHERE id = ${found.id}::uuid`;
      return { kind: 'unchanged', id: found.id };
    }

    /*
     * The content genuinely changed.
     *
     * The row is updated in place, keeping its identity and its first sighting,
     * AND ITS VERIFICATION IS WITHDRAWN. Content that has changed has not been
     * checked, so it leaves the student feed until someone looks again — an
     * edited notice silently keeping its published status is how unreviewed
     * text reaches a student (M7 §11).
     */
    await sql`
      UPDATE announcements
         SET title = ${n.title}, body = ${n.body}, category = ${n.category},
             canonical_url = ${n.canonicalUrl}, published_at = ${n.publishedAt},
             event_start_at = ${n.eventStartAt}, deadline_at = ${n.deadlineAt},
             content_hash = ${n.contentHash}, parser_version = ${n.normalizerVersion},
             verification = 'draft', verified_at = NULL, verified_by = NULL,
             publication = 'unpublished',
             last_seen_at = now(), updated_at = now()
       WHERE id = ${found.id}::uuid
    `;
    return { kind: 'updated', id: found.id };
  }

  const [created] = await sql<{ id: string }[]>`
    INSERT INTO announcements (
      source_id, origin, publisher, title, body, category, canonical_url,
      published_at, event_start_at, deadline_at,
      scheme_id, branch_id, branch_name, college_id, college_name, semester,
      external_id, content_hash, parser_version
    ) VALUES (
      ${sourceId}, ${origin}, ${n.publisher}, ${n.title}, ${n.body}, ${n.category},
      ${n.canonicalUrl}, ${n.publishedAt}, ${n.eventStartAt}, ${n.deadlineAt},
      ${audience.schemeId ?? null}, ${audience.branchId ?? null}, ${audience.branchName ?? null},
      ${audience.collegeId ?? null}::uuid, ${audience.collegeName ?? null},
      ${audience.semester ?? null},
      ${n.externalId}, ${n.contentHash}, ${n.normalizerVersion}
    )
    RETURNING id::text
  `;
  return { kind: 'created', id: created?.id ?? '' };
}

/**
 * Verifies and publishes one announcement.
 *
 * A SEPARATE ACT FROM STORING IT. Nothing in the fetch or entry path calls
 * this; a person decides that a notice is right before a student sees it, and
 * the database refuses to publish anything unverified regardless (M7 §11).
 */
export async function publishAnnouncement(
  sql: Sql,
  id: string,
  verifiedBy: string,
): Promise<boolean> {
  const rows = await sql`
    UPDATE announcements
       SET verification = 'verified', verified_at = now(), verified_by = ${verifiedBy},
           publication = 'published', updated_at = now()
     WHERE id = ${id}::uuid
     RETURNING id
  `;
  return rows.length > 0;
}

/** Withdraws a notice from the student feed without deleting the record. */
export async function unpublishAnnouncement(sql: Sql, id: string): Promise<boolean> {
  const rows = await sql`
    UPDATE announcements
       SET publication = 'unpublished', updated_at = now()
     WHERE id = ${id}::uuid
     RETURNING id
  `;
  return rows.length > 0;
}
