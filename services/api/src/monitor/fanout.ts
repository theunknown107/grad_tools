/**
 * Materializing notifications server-side, for students who are not here.
 *
 * Authority: Phase 7B.3.1 §2–§5, §14–§16, §20–§24, §31–§34, §44–§49, §71–§73
 *
 * ---------------------------------------------------------------------------
 * THE ONE THING B.3 COULD NOT DO
 * ---------------------------------------------------------------------------
 *
 * B.3's projection ran inside the student's own session. Correct, RLS-safe, and
 * unable to do the job the product exists for: a student asleep when VTU
 * postpones their examination cannot run a projection, so the notice waited for
 * them to happen to open the app. This runs with nobody signed in.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS PROCESS CAN REACH, IN FULL
 * ---------------------------------------------------------------------------
 *
 * Two views and one INSERT (Supabase 0009). It cannot read a name, a USN, a
 * grade, an attendance count or a timetable slot; it cannot read a notification
 * back, not even one it just wrote; it cannot mark anything read or delete
 * anything. Every transaction opens with `SET LOCAL ROLE gradtools_monitor`, so
 * whatever the connecting role may be granted elsewhere, the work runs as the
 * narrow one.
 *
 * That is the answer to "why not service_role": there was a smaller mechanism,
 * so the large one is not used (§46).
 *
 * ---------------------------------------------------------------------------
 * ONCE PER SOURCE, ONCE PER STUDENT, AND IDEMPOTENT
 * ---------------------------------------------------------------------------
 *
 * The item was acquired, hashed, versioned and classified ONE time, by the run
 * that stored it (§15). Nothing here fetches, parses or normalises anything —
 * it reads rows that already exist and decides who they concern.
 *
 * Every insert is `ON CONFLICT DO NOTHING` against the unique index on
 * `(auth_user_id, external_id, content_hash)`. So a worker that dies halfway
 * through ten students and is re-run creates the remaining five and duplicates
 * none of the first five (§71), two workers racing produce one row (§34), and
 * a rerun of an unchanged snapshot produces nothing at all (§21). None of that
 * depends on this code being careful; it depends on the index.
 */

import { randomUUID } from 'node:crypto';
import type { Sql } from '../db/client.js';
import { publish, type NotificationCreated } from './realtime.js';
import { applicabilityOf, type Applicability, type StudentAudience } from './applicability.js';
import type { Importance, SourceCategory } from './classify.js';
import type { PublishedItem } from './store.js';

/** One student, as much of them as this process is permitted to know. */
export interface Recipient {
  readonly userId: string;
  readonly audience: StudentAudience;
}

/**
 * How important an item must be before anybody is interrupted about it.
 *
 * §54, and the reason it is a floor rather than a switch. The six families
 * carry a great deal that is true, official and none of a student's business —
 * housekeeping tenders, committee constitutions — and an app that interrupts
 * people about those teaches them to dismiss the notification that says their
 * examination moved. `low` items are still stored, versioned and reviewable;
 * they simply do not wake anybody up.
 */
export const IMPORTANCE_RANK: Readonly<Record<Importance, number>> = {
  low: 0,
  medium: 1,
  high: 2,
};

export interface FanoutOptions {
  /** Nothing below this is materialized. Default `medium` (§54). */
  readonly floor?: Importance;
  /** Students read per round trip. Never "all of them" (§72). */
  readonly batchSize?: number;
  /** Decide everything, write nothing (§43). */
  readonly dryRun?: boolean;
  /** Categories to skip entirely, for a caller that knows better. */
  readonly skipCategories?: readonly SourceCategory[];
}

/** One decision, kept so a dry run can show its work (§43, §78). */
export interface FanoutDecision {
  readonly userId: string;
  readonly externalId: string;
  readonly category: SourceCategory;
  readonly importance: Importance;
  readonly verdict: Applicability['verdict'];
  readonly matched: readonly string[];
  readonly reason: string;
  readonly outcome: 'created' | 'already_held' | 'not_applicable' | 'unresolved' | 'below_floor';
}

export interface FanoutResult {
  readonly usersConsidered: number;
  readonly itemsConsidered: number;
  readonly created: number;
  readonly alreadyHeld: number;
  readonly notApplicable: number;
  readonly unresolved: number;
  readonly belowFloor: number;
  /** §111. Delivery is counted apart from creation, because they fail apart. */
  readonly deliveryAttempted: number;
  readonly deliverySucceeded: number;
  /** Populated only for a dry run; a real run would hold millions of these. */
  readonly decisions: readonly FanoutDecision[];
}

/**
 * Drops to the monitor role for the life of one transaction.
 *
 * `SET LOCAL`, so it cannot leak into the next piece of work that borrows the
 * same pooled connection — the same reasoning as `withUser`, and the same
 * failure it is avoiding.
 */
export async function asMonitor<T>(sql: Sql, work: (tx: Sql) => Promise<T>): Promise<T> {
  return sql.begin(async (tx) => {
    await tx`SELECT set_config('role', 'gradtools_monitor', true)`;
    return work(tx as unknown as Sql);
  }) as Promise<T>;
}

/**
 * One page of students, ordered so paging is stable.
 *
 * KEYSET, NOT OFFSET. `auth_user_id > $after` reads an index; `OFFSET 50000`
 * reads fifty thousand rows and throws them away, and does it again for every
 * subsequent page. The ordering column is the profile table's own unique key,
 * so a student created mid-run cannot cause another to be skipped.
 */
export async function recipientBatch(
  tx: Sql,
  after: string | null,
  limit: number,
): Promise<Recipient[]> {
  const profiles = await tx<
    {
      auth_user_id: string;
      scheme_id: string;
      programme: string | null;
      branch: string | null;
      college_name: string | null;
      current_semester: number | null;
    }[]
  >`
    SELECT auth_user_id::text, scheme_id, programme, branch, college_name, current_semester
    FROM monitor_applicability_context
    WHERE ${after === null ? tx`true` : tx`auth_user_id::text > ${after}`}
    ORDER BY auth_user_id
    LIMIT ${limit}
  `;
  if (profiles.length === 0) return [];

  const ids = profiles.map((row) => row.auth_user_id);
  /*
   * ONE QUERY FOR THE WHOLE PAGE, not one per student. The per-student version
   * is the shape that works in a test with two users and falls over at two
   * thousand (§73).
   */
  const courses = await tx<{ auth_user_id: string; code: string; kind: string }[]>`
    SELECT auth_user_id::text, code, kind
    FROM monitor_course_context
    WHERE auth_user_id::text = ANY(${tx.array(ids)})
  `;

  const enrolled = new Map<string, string[]>();
  const backlog = new Map<string, string[]>();
  for (const row of courses) {
    const into = row.kind === 'backlog' ? backlog : enrolled;
    const held = into.get(row.auth_user_id);
    if (held === undefined) into.set(row.auth_user_id, [row.code]);
    else held.push(row.code);
  }

  return profiles.map((row) => ({
    userId: row.auth_user_id,
    audience: {
      scheme: row.scheme_id,
      programme: row.programme,
      branch: row.branch,
      /*
       * NOT REPRESENTED, AND HONESTLY NULL. No student record holds a
       * department or a stream, and deriving one from the branch name is the
       * guess §77 forbids. A notice scoped to either resolves to `unresolved`
       * for everybody, which is the correct answer to a question nobody
       * recorded — see docs/43 for why no column was added.
       */
      department: null,
      stream: null,
      college: row.college_name,
      semester: row.current_semester,
      enrolledCourses: enrolled.get(row.auth_user_id) ?? [],
      backlogCourses: backlog.get(row.auth_user_id) ?? [],
    },
  }));
}

/**
 * Tells everyone an item concerns, and nobody else.
 *
 * The engine is `applicabilityOf` — the same function the student's own session
 * calls, with the same seven axes and the same treatment of `unknown`. There is
 * no server-side variant and no loosened copy (§16, §139).
 */
export async function materialize(
  sql: Sql,
  runId: string,
  items: readonly PublishedItem[],
  options: FanoutOptions = {},
): Promise<FanoutResult> {
  const floor = options.floor ?? 'medium';
  const batchSize = options.batchSize ?? 500;
  const dryRun = options.dryRun ?? false;
  const skip = options.skipCategories ?? [];

  /*
   * The floor is applied ONCE, before any student is read. Filtering inside the
   * per-user loop would ask the same question of the same item for every
   * student in the database.
   */
  const eligible = items.filter(
    (item) =>
      IMPORTANCE_RANK[item.importance] >= IMPORTANCE_RANK[floor] && !skip.includes(item.category),
  );
  const belowFloorItems = items.length - eligible.length;

  let usersConsidered = 0;
  let created = 0;
  let alreadyHeld = 0;
  let notApplicable = 0;
  let unresolved = 0;
  const decisions: FanoutDecision[] = [];
  const pending: NotificationCreated[] = [];

  await asMonitor(sql, async (tx) => {
    let after: string | null = null;
    for (;;) {
      const batch: Recipient[] = await recipientBatch(tx, after, batchSize);
      if (batch.length === 0) break;
      usersConsidered += batch.length;

      for (const recipient of batch) {
        for (const item of eligible) {
          const verdict = applicabilityOf(item.audience, recipient.audience);

          if (verdict.verdict !== 'applicable') {
            if (verdict.verdict === 'unresolved') unresolved += 1;
            else notApplicable += 1;
            if (dryRun) {
              decisions.push({
                userId: recipient.userId,
                externalId: item.externalId,
                category: item.category,
                importance: item.importance,
                verdict: verdict.verdict,
                matched: verdict.matched,
                reason: verdict.reason,
                outcome: verdict.verdict === 'unresolved' ? 'unresolved' : 'not_applicable',
              });
            }
            continue;
          }

          if (dryRun) {
            decisions.push({
              userId: recipient.userId,
              externalId: item.externalId,
              category: item.category,
              importance: item.importance,
              verdict: 'applicable',
              matched: verdict.matched,
              reason: verdict.reason,
              outcome: 'created',
            });
            created += 1;
            continue;
          }

          /*
           * TWO DELIBERATE OMISSIONS, BOTH FORCED BY THE PRIVILEGE MODEL AND
           * BOTH FOUND BY RUNNING IT.
           *
           * No `RETURNING`: reading the inserted id back needs SELECT on this
           * table, and the role has none. The command tag says whether a row
           * appeared, which is all this needs to know.
           *
           * No conflict TARGET either — `ON CONFLICT DO NOTHING`, not
           * `ON CONFLICT (auth_user_id, external_id, content_hash)`. Naming the
           * arbiter columns makes PostgreSQL require SELECT on them, so the
           * explicit form fails with "permission denied" under exactly the
           * grants that make this design safe. The bare form takes any unique
           * constraint, and on this table that is the 0007 index plus a primary
           * key on a generated uuid — so what it swallows is the duplicate it
           * is meant to swallow. A future unique constraint here would widen
           * that silently, which is why the dedupe tests assert row counts
           * rather than trusting the clause.
           */
          /*
           * THE ID IS GENERATED HERE, not read back. `RETURNING` needs SELECT
           * and the role has none (above), so the only way to know which row
           * this is — which the realtime event needs — is to have chosen it.
           * On a conflict nothing is inserted and this id is simply discarded.
           */
          const id = randomUUID();
          const result = await tx`
            INSERT INTO source_notifications (
              id, auth_user_id, source_family, external_id, content_hash,
              category, importance, title, source_url, published_at, reason, run_id
            ) VALUES (
              ${id}::uuid, ${recipient.userId}::uuid, ${item.family}, ${item.externalId},
              ${item.contentHash}, ${item.category}, ${item.importance},
              ${item.title}, ${item.url}, ${item.publishedAt},
              ${verdict.reason}, ${runId}
            )
            ON CONFLICT DO NOTHING
          `;
          if (result.count === 0) {
            alreadyHeld += 1;
            continue;
          }
          created += 1;
          /*
           * COLLECTED, NOT SENT. The transaction has not committed, and an
           * event announcing a row that a rollback then removes is worse than
           * no event at all (§14, §37).
           */
          pending.push({
            type: 'notification.created',
            userId: recipient.userId,
            notificationId: id,
            category: item.category,
            importance: item.importance,
            title: item.title,
            sourceUrl: item.url,
            reason: verdict.reason,
          });
        }
      }

      after = batch[batch.length - 1]?.userId ?? null;
      if (batch.length < batchSize) break;
    }
  });

  /*
   * PERSIST, COMMIT, THEN RING THE DOORBELL (§14, §38). `asMonitor` has
   * returned, so every row below is committed and belongs to its student
   * whatever happens next. `publish` cannot throw, so a database that refuses
   * the notify — or a listener nobody is on the other end of — costs a
   * cosmetic delivery and not a monitoring run (§25, §110).
   */
  let deliveryAttempted = 0;
  let deliverySucceeded = 0;
  for (const event of pending) {
    deliveryAttempted += 1;
    if (await publish(sql, event)) deliverySucceeded += 1;
  }

  return {
    usersConsidered,
    itemsConsidered: eligible.length,
    created,
    alreadyHeld,
    notApplicable,
    unresolved,
    belowFloor: belowFloorItems,
    deliveryAttempted,
    deliverySucceeded,
    decisions,
  };
}
