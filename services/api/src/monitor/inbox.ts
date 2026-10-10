/**
 * A student's own notifications, read and marked read by that student.
 *
 * Authority: Phase 7B.3.1 §19, §25–§28, §80–§84, §138
 *
 * ---------------------------------------------------------------------------
 * THE OTHER HALF OF THE FANOUT, AND THE ONLY ONE WITH A PERSON IN IT
 * ---------------------------------------------------------------------------
 *
 * `fanout.ts` writes these rows with nobody signed in, through a role that
 * cannot read them back. This reads them, through the student's own session,
 * where RLS answers the only question that matters: whose are they.
 *
 * The two halves share a table and nothing else. Neither can do the other's
 * job, which is the point — the worker cannot enumerate a student's inbox, and
 * a student's session cannot create a notification for anybody (§49).
 *
 * ---------------------------------------------------------------------------
 * ONE NOTIFICATION MODEL, NOT THREE
 * ---------------------------------------------------------------------------
 *
 * §19 and §138: there is no `ExamNotification` beside an
 * `AnnouncementNotification` beside a `CalendarNotification`. What differs
 * between an examination timetable and an academic calendar is the `category`
 * column, and a second physical table per kind would mean a second read path, a
 * second unread count and a second thing to forget to update.
 */

import type { Sql } from '../db/client.js';
import type { Importance, SourceCategory } from './classify.js';

export const NOTIFICATION_STATES = ['unread', 'read', 'dismissed'] as const;
export type NotificationState = (typeof NOTIFICATION_STATES)[number];

/**
 * A notification as the student sees it.
 *
 * WHAT IS NOT HERE: `run_id`, `content_hash`, `auth_user_id`. They are how the
 * system knows which version of what it told whom, and a student reading about
 * a postponed examination has no use for any of them (§28, §80). The row keeps
 * them; the response does not carry them.
 */
export interface InboxNotification {
  readonly id: string;
  readonly family: string;
  readonly category: SourceCategory;
  readonly importance: Importance;
  readonly title: string;
  /** The official document. Always the source's own URL (§26, §52, §84). */
  readonly sourceUrl: string;
  /** The date the SOURCE printed, never when we noticed (§55). */
  readonly publishedAt: string | null;
  /** Why this reached them, in their own terms (§27, §78). */
  readonly reason: string;
  readonly state: NotificationState;
  readonly createdAt: string;
}

const COLUMNS = (sql: Sql) => sql`
  id::text,
  source_family AS "family",
  category,
  importance,
  title,
  source_url AS "sourceUrl",
  to_char(published_at, 'YYYY-MM-DD') AS "publishedAt",
  reason,
  state,
  to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "createdAt"
`;

/**
 * This student's notifications, most important and most recent first.
 *
 * ORDERED BY IMPORTANCE BEFORE DATE, deliberately. A student opening the app
 * after a week wants the postponed examination above the syllabus revision,
 * and a strictly chronological list buries it under whatever arrived last.
 */
export async function readInbox(sql: Sql, limit = 100): Promise<InboxNotification[]> {
  return sql<InboxNotification[]>`
    SELECT ${COLUMNS(sql)}
    FROM source_notifications
    WHERE state <> 'dismissed'
    ORDER BY
      CASE importance WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END,
      created_at DESC
    LIMIT ${limit}
  `;
}

/** How many are still unread, for the badge the shell already shows. */
export async function unreadCount(sql: Sql): Promise<number> {
  const [row] = await sql<{ count: string }[]>`
    SELECT count(*)::text AS count FROM source_notifications WHERE state = 'unread'
  `;
  return Number(row?.count ?? '0');
}

/**
 * Sets the state of one notification.
 *
 * NO OWNER PREDICATE, AND THAT IS NOT AN OVERSIGHT. RLS scopes the statement to
 * the caller's own rows, so naming somebody else's id updates nothing and
 * returns nothing — the same answer as an id that does not exist, which is the
 * right one to give (§48). An application-level check would be a second lock on
 * a door the database already holds shut.
 */
export async function setNotificationState(
  sql: Sql,
  id: string,
  state: NotificationState,
): Promise<InboxNotification | null> {
  const rows = await sql<InboxNotification[]>`
    UPDATE source_notifications SET state = ${state}
    WHERE id = ${id}::uuid
    RETURNING ${COLUMNS(sql)}
  `;
  return rows[0] ?? null;
}

/** §83. Everything unread becomes read, and nothing else changes. */
export async function markAllRead(sql: Sql): Promise<number> {
  const result = await sql`
    UPDATE source_notifications SET state = 'read' WHERE state = 'unread'
  `;
  return result.count;
}
