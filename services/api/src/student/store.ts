/**
 * Reading and writing one student's records.
 *
 * Authority: docs/08 §8.17 · docs/09 §9.18 · M9 §28, §29, §30
 *
 * EVERY FUNCTION HERE TAKES AN RLS-SCOPED TRANSACTION. None of them takes a
 * user id, because none of them needs one: the connection already knows who it
 * is, and a query that named an owner could be given the wrong one. The
 * absence of that parameter is the design (docs/13 §13.17).
 *
 * ---------------------------------------------------------------------------
 * CONFLICTS ARE DETECTED, NEVER RESOLVED SILENTLY
 * ---------------------------------------------------------------------------
 *
 * "Last write wins" is the default everyone reaches for and it is wrong for
 * academic records. A stale device pushing an attendance count of 12 over a
 * fresh 14 does not look like an error to anyone — the number simply goes
 * backwards, and the student finds out weeks later when the percentage is
 * wrong.
 *
 * So every write carries the revision the device last read, the database
 * compares, and a mismatch comes back as a CONFLICT carrying both versions.
 * The student chooses. Nothing here picks a winner (M9 §28).
 */

import type { Sql } from '../db/client.js';

/** The transaction handle `withUser` provides. Narrow, so nothing else leaks in. */
interface SavepointCapable {
  savepoint<T>(work: (tx: Sql) => Promise<T>): Promise<T>;
}
import type { CloudProfile, ProfileInput, SyncOutcome, SyncRecord } from '@gradtools/shared-types';

/* -------------------------------------------------------------------------- */
/* The collections                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Which table backs which collection, and which columns a client may write.
 *
 * AN ALLOWLIST, NOT A PASS-THROUGH. A record arrives as loose JSON, and only
 * the columns named here are ever written from it — so `auth_user_id`,
 * `revision` and the timestamps cannot be set by a client however the payload
 * is shaped (M9 §41).
 *
 * `parent` names the column the SERVER fills in from the session's profile.
 * `resultSubjects` is the one collection whose parent is another record rather
 * than the profile, so it is `null` there and `result_id` is client-supplied —
 * guarded by a composite foreign key rather than by trust (M9.1 §3).
 */
export const COLLECTION_TABLES = {
  semesters: {
    table: 'semester_records',
    parent: 'profile_id',
    columns: ['number', 'status', 'started_on', 'completed_on'],
  },
  semesterSubjects: {
    table: 'semester_subjects',
    parent: 'profile_id',
    columns: ['semester', 'code', 'title', 'credits', 'notes'],
  },
  results: {
    table: 'semester_results',
    parent: 'profile_id',
    // `sgpa_asserted` only. The COMPUTED value is never accepted from a device
    // and never stored: it is derived on read by @gradtools/academic-rules, and
    // taking a client's arithmetic would create a second engine that disagrees
    // (M9 §29, §30).
    columns: ['semester', 'scheme_id', 'rule_set_id', 'sgpa_asserted'],
  },

  /*
   * THE SUBJECT ROWS A RESULT IS MADE OF (M9.1 §1).
   *
   * Its parent is the RESULT, not the profile — so `result_id` is a column the
   * client supplies rather than one the server fills in. That is safe because
   * of the composite foreign key added in Supabase 0002: a subject row may only
   * point at a result owned by the same `auth_user_id`, and the database
   * refuses anything else (docs/09 §9.19).
   *
   * Without this collection a semester result could reach the cloud while the
   * codes, credits and grades it is made of could not — and an empty result
   * reads as a semester in which nothing was taken, which is worse than a
   * missing one.
   */
  resultSubjects: {
    table: 'result_subjects',
    parent: null,
    columns: ['result_id', 'subject_code', 'subject_title', 'credits', 'grade_letter', 'ordinal'],
  },
  attendance: {
    table: 'attendance_records',
    parent: 'profile_id',
    columns: ['semester', 'subject_code', 'subject_title', 'attended', 'conducted'],
  },
  timetable: {
    table: 'timetable_slots',
    parent: 'profile_id',
    columns: ['day', 'start_time', 'end_time', 'subject_code', 'room', 'faculty'],
  },
  backlogs: {
    table: 'backlog_records',
    parent: 'profile_id',
    columns: [
      'subject_code',
      'subject_title',
      'origin_semester',
      'status',
      'attempts',
      'cleared_in_semester',
    ],
  },
} as const;

export type CollectionName = keyof typeof COLLECTION_TABLES;

/** `startedOn` → `started_on`. The wire is camelCase; the database is not. */
function toColumn(key: string): string {
  return key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
}

function toField(column: string): string {
  return column.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
}

/* -------------------------------------------------------------------------- */
/* The profile                                                                */
/* -------------------------------------------------------------------------- */

const PROFILE_COLUMNS = (sql: Sql) => sql`
  id::text,
  display_name     AS "displayName",
  usn,
  college_name     AS "collegeName",
  scheme_id        AS "schemeId",
  branch,
  current_semester AS "currentSemester",
  revision,
  to_char(created_at, 'YYYY-MM-DD"T"HH24:MI:SS.MSOF') AS "createdAt",
  to_char(updated_at, 'YYYY-MM-DD"T"HH24:MI:SS.MSOF') AS "updatedAt"
`;

/**
 * This student's profile, or null.
 *
 * NO `WHERE auth_user_id = ...` CLAUSE, and that is not an omission. RLS makes
 * this query return exactly the caller's row; adding a predicate would imply
 * the query could return somebody else's without one.
 */
export async function readProfile(sql: Sql): Promise<CloudProfile | null> {
  const rows = await sql<CloudProfile[]>`
    SELECT ${PROFILE_COLUMNS(sql)} FROM student_profiles LIMIT 1
  `;
  return rows[0] ?? null;
}

export type ProfileOutcome =
  | { readonly kind: 'saved'; readonly profile: CloudProfile }
  | { readonly kind: 'conflict'; readonly server: CloudProfile };

export async function upsertProfile(sql: Sql, input: ProfileInput): Promise<ProfileOutcome> {
  const existing = await readProfile(sql);

  if (existing === null) {
    /*
     * `auth_user_id` is left to its DEFAULT of `auth.uid()`. The client never
     * supplies it, so there is no path by which a profile could be created
     * belonging to anyone but the caller — and the INSERT policy would refuse
     * it anyway.
     */
    const rows = await sql<CloudProfile[]>`
      INSERT INTO student_profiles (display_name, usn, college_name, scheme_id, branch, current_semester)
      VALUES (
        ${input.displayName ?? null}, ${input.usn ?? null}, ${input.collegeName ?? null},
        ${input.schemeId}, ${input.branch ?? null}, ${input.currentSemester ?? null}
      )
      RETURNING ${PROFILE_COLUMNS(sql)}
    `;
    return { kind: 'saved', profile: rows[0] as CloudProfile };
  }

  // A client that read revision 3 and writes while the server is at 4 is
  // working from something it has not seen. That is a conflict, not an update.
  if (input.baseRevision !== undefined && input.baseRevision !== existing.revision) {
    return { kind: 'conflict', server: existing };
  }

  const rows = await sql<CloudProfile[]>`
    UPDATE student_profiles SET
      display_name     = ${input.displayName ?? null},
      usn              = ${input.usn ?? null},
      college_name     = ${input.collegeName ?? null},
      scheme_id        = ${input.schemeId},
      branch           = ${input.branch ?? null},
      current_semester = ${input.currentSemester ?? null}
    RETURNING ${PROFILE_COLUMNS(sql)}
  `;
  return { kind: 'saved', profile: rows[0] as CloudProfile };
}

/* -------------------------------------------------------------------------- */
/* Pull                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Everything that changed since a cursor, tombstones included.
 *
 * `since === null` means "everything", which is what a new device needs.
 */
export async function pullChanges(
  sql: Sql,
  since: string | null,
  only?: string,
): Promise<SyncRecord[]> {
  const records: SyncRecord[] = [];

  for (const [collection, spec] of Object.entries(COLLECTION_TABLES)) {
    if (only !== undefined && only !== collection) continue;

    const rows = await sql<Record<string, unknown>[]>`
      SELECT * FROM ${sql(spec.table)}
      WHERE (${since}::timestamptz IS NULL OR updated_at > ${since}::timestamptz)
      ORDER BY updated_at, id
    `;

    for (const row of rows) {
      const data: Record<string, unknown> = {};
      for (const column of spec.columns) {
        data[toField(column)] = row[column] ?? null;
      }
      records.push({
        id: String(row.id),
        collection: collection as SyncRecord['collection'],
        revision: Number(row.revision),
        updatedAt: new Date(row.updated_at as string).toISOString(),
        deletedAt:
          row.deleted_at === null || row.deleted_at === undefined
            ? null
            : new Date(row.deleted_at as string).toISOString(),
        data,
      });
    }
  }

  return records;
}

/* -------------------------------------------------------------------------- */
/* Push                                                                       */
/* -------------------------------------------------------------------------- */

export interface PushInput {
  readonly id: string;
  readonly collection: string;
  readonly baseRevision: number | null;
  readonly deleted: boolean;
  readonly data: Record<string, unknown>;
}

/**
 * Applies one record, or reports why it could not be.
 *
 * The record's id is chosen by the DEVICE (a uuid), which is what lets a
 * student create records offline and sync them later without a round trip
 * (M9 §40). That is safe here because the row is still owned by `auth.uid()`
 * and RLS still applies: a device can choose an id, it cannot choose an owner.
 */
export async function pushRecord(
  sql: Sql,
  profileId: string,
  input: PushInput,
): Promise<SyncOutcome> {
  const spec = COLLECTION_TABLES[input.collection as CollectionName];
  if (spec === undefined) {
    return {
      id: input.id,
      collection: input.collection as SyncOutcome['collection'],
      status: 'rejected',
      server: null,
      reason: 'That is not a collection GradTools syncs.',
    };
  }

  const [current] = await sql<{ revision: number }[]>`
    SELECT revision FROM ${sql(spec.table)} WHERE id = ${input.id}::uuid
  `;

  /*
   * Three ways this can be a conflict, and all three are reported rather than
   * guessed at:
   *
   *   the device thinks it is new, but the server has it     → conflict
   *   the device names a revision the server has moved past  → conflict
   *   the device names a revision for a row that is gone     → conflict
   */
  if (current === undefined && input.baseRevision !== null) {
    return {
      id: input.id,
      collection: input.collection as SyncOutcome['collection'],
      status: 'conflict',
      server: null,
      reason: 'This record no longer exists in the cloud.',
    };
  }

  if (current !== undefined && input.baseRevision !== current.revision) {
    const server = await readOne(sql, input.collection as CollectionName, input.id);
    return {
      id: input.id,
      collection: input.collection as SyncOutcome['collection'],
      status: 'conflict',
      server,
      reason: 'This record changed on another device.',
    };
  }

  /*
   * DELETE BEFORE FIRST SYNC (M9.1 §2).
   *
   * A record created and deleted on one device before it ever reached the
   * cloud: the device thinks it is new (`baseRevision === null`) and is asking
   * for it to be gone. Falling through to the insert below would CREATE the row
   * — resurrecting, as a live record, something the student deleted.
   *
   * THE END STATE IS ABSENCE, NOT A TOMBSTONE. A tombstone marks a row other
   * devices have seen and must stop showing; no other device ever saw this one,
   * so writing a row in order to say it does not exist would be a row that
   * exists for no reader. Absence is also idempotent — a retried push finds
   * nothing again and answers the same way.
   *
   * Reported as `applied` because it is: the cloud now matches what the device
   * asked for. That is also what makes the client stop tracking it.
   */
  if (current === undefined && input.deleted) {
    return {
      id: input.id,
      collection: input.collection as SyncOutcome['collection'],
      status: 'applied',
      server: null,
      reason: null,
    };
  }

  // Only allowlisted columns, and only ones the payload actually carries.
  const entries = spec.columns
    .map((column) => [column, input.data[toField(column)]] as const)
    .filter(([, value]) => value !== undefined);

  /*
   * EACH RECORD GETS ITS OWN SAVEPOINT (M9.1 §1).
   *
   * A push is many records in one transaction, and a constraint violation
   * ABORTS a PostgreSQL transaction — every statement after it fails too, and
   * the commit fails even if the application caught the error. So one bad
   * record would silently take the whole push with it, which is the opposite of
   * the per-record outcomes this endpoint promises (docs/10 §10.16).
   *
   * A savepoint rolls back exactly the failed record and leaves the rest of the
   * transaction usable.
   */
  try {
    // `savepoint` exists on a transaction handle, which is what `withUser`
    // hands every caller here — the shared `Sql` alias just does not name it.
    await (sql as unknown as SavepointCapable).savepoint(async (tx: Sql) => {
      if (current === undefined) {
        /*
         * The id comes from the DEVICE and is written directly, which is what
         * lets a student create records offline and sync them later without a
         * round trip (M9 §40). Safe because a device can choose an id and cannot
         * choose an owner: `auth_user_id` defaults to `auth.uid()` and the INSERT
         * policy refuses anything else.
         */
        const row: Record<string, unknown> = { id: input.id };
        /*
         * The parent is the SERVER's to set for every collection whose parent is
         * the profile. `resultSubjects` is the exception: its parent is another
         * record, supplied in `data` and guaranteed by a composite foreign key to
         * belong to the same student (docs/09 §9.19).
         */
        if (spec.parent !== null) row[spec.parent] = profileId;
        for (const [column, value] of entries) row[column] = value;
        await tx`INSERT INTO ${tx(spec.table)} ${tx(row as Record<string, never>)}`;
      } else if (input.deleted) {
        await tx`UPDATE ${tx(spec.table)} SET deleted_at = now() WHERE id = ${input.id}::uuid`;
      } else {
        for (const [column, value] of entries) {
          await tx`UPDATE ${tx(spec.table)} SET ${tx(column)} = ${value as never} WHERE id = ${input.id}::uuid`;
        }
        await tx`UPDATE ${tx(spec.table)} SET deleted_at = NULL WHERE id = ${input.id}::uuid`;
      }
    });
  } catch (error) {
    /*
     * A CHECK constraint refusing the row is a REJECTION with a reason, never a
     * 500 and never a silent drop. The student needs to know their edit did not
     * land, and which one (M9 §68).
     */
    return {
      id: input.id,
      collection: input.collection as SyncOutcome['collection'],
      status: 'rejected',
      server: null,
      reason: reasonFor(error),
    };
  }

  return {
    id: input.id,
    collection: input.collection as SyncOutcome['collection'],
    status: 'applied',
    server: await readOne(sql, input.collection as CollectionName, input.id),
    reason: null,
  };
}

/** One record as it travels, or null when it is not this student's. */
async function readOne(
  sql: Sql,
  collection: CollectionName,
  id: string,
): Promise<SyncRecord | null> {
  const spec = COLLECTION_TABLES[collection];
  const [row] = await sql<Record<string, unknown>[]>`
    SELECT * FROM ${sql(spec.table)} WHERE id = ${id}::uuid
  `;
  if (row === undefined) return null;

  const data: Record<string, unknown> = {};
  for (const column of spec.columns) data[toField(column)] = row[column] ?? null;

  return {
    id: String(row.id),
    collection,
    revision: Number(row.revision),
    updatedAt: new Date(row.updated_at as string).toISOString(),
    deletedAt:
      row.deleted_at === null || row.deleted_at === undefined
        ? null
        : new Date(row.deleted_at as string).toISOString(),
    data,
  };
}

/**
 * A database error, in words a student can act on.
 *
 * The constraint name is NOT returned. It names internal schema detail, and
 * "attendance_attended_within_conducted" tells a student nothing that
 * "You cannot attend more classes than were held" does not say better
 * (M9 §46).
 */
function reasonFor(error: unknown): string {
  const message = error instanceof Error ? error.message : '';
  if (message.includes('attendance_attended_within_conducted')) {
    return 'Classes attended cannot be more than classes held.';
  }
  if (message.includes('timetable_slot_ends_after_it_starts')) {
    return 'A timetable slot has to end after it starts.';
  }
  if (message.includes('duplicate key')) {
    return 'A record like this already exists.';
  }
  /*
   * The composite key that ties a subject row to its result. A student can only
   * reach this by naming a result that is not theirs, so the message says what
   * is true without confirming that somebody else's result exists (M9.1 §3).
   */
  if (message.includes('result_subjects_belong_to_their_result')) {
    return 'That subject does not belong to one of your results.';
  }
  if (message.includes('foreign key')) {
    return 'That record refers to something that does not exist.';
  }
  return 'That record was not valid and was not saved.';
}

export { toColumn };
