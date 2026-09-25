/**
 * Running a sync.
 *
 * Authority: docs/07 §7.16 · docs/10 §10.16 · M9 §26, §40, §41, §68
 *
 * The thin layer between the pure rules (domain/sync.ts) and the network. It
 * decides nothing about conflicts — it carries what the rules decided.
 *
 * ---------------------------------------------------------------------------
 * NOTHING IS SENT WITHOUT A SESSION, AND THE SESSION IS THE PROOF
 * ---------------------------------------------------------------------------
 *
 * Every request carries the access token and NO user id (M9 §41). The server
 * derives ownership from the token; a client-supplied id would be a claim, and
 * this client never makes one.
 *
 * ---------------------------------------------------------------------------
 * OFFLINE IS A STATE, NOT A FAILURE
 * ---------------------------------------------------------------------------
 *
 * Local reads and writes never wait for the network (M9 §40). A sync that
 * cannot reach the server leaves every local record exactly where it is and
 * says `offline` — never `synced`, and never a silent discard (M9 §68).
 */

import { useCallback, useEffect, useState } from 'react';
import { STUDENT_ROUTES } from '@gradtools/shared-types';
import { apiBaseUrl } from '../../repositories/reference.js';
import { useRepositories } from '../../repositories/context.js';
import { useAuth } from './AuthContext.js';
import { IDLE_SYNC, type SyncState } from '../../domain/auth.js';
import {
  EMPTY_BOOKKEEPING,
  afterPull,
  applyPushOutcomes,
  planPull,
  recordsToPush,
  type LocalRecord,
  type SyncBookkeeping,
} from '../../domain/sync.js';
import { readValue, writeValue } from '../../repositories/local/store.js';
import { SCHEMA_VERSION } from '../../repositories/local/upgrade.js';
import { normalizeResultSubject } from '../../domain/results.js';
import {
  deriveCounts,
  noteSnapshot,
  reconcile,
  type ObservedAggregate,
} from '../../domain/attendance.js';
import type { AttendanceRecord, RemoteSnapshot, ResultSubject } from '../../domain/types.js';
import type { RepositoryBundle } from '../../repositories/types.js';

/** Which local repository backs each synced collection (M9 §53). */
const COLLECTIONS = [
  ['semesters', 'semesters'],
  ['semesterSubjects', 'semesterSubjects'],
  ['results', 'results'],
  ['attendance', 'attendance'],
  ['timetable', 'timetable'],
  ['backlogs', 'backlogs'],
] as const;

/**
 * A result's subject rows, as they travel.
 *
 * ---------------------------------------------------------------------------
 * THE SHAPE MISMATCH THIS BRIDGES (M9.1 §1)
 * ---------------------------------------------------------------------------
 *
 * Locally a `SemesterResult` CONTAINS its subjects — one object with an array
 * inside it, which is how the results screen reads and edits them. In the cloud
 * they are their own rows, because each needs its own revision: two devices
 * editing different subjects of the same result are not in conflict, and
 * nesting them would make every such edit look like one.
 *
 * So the array is flattened on the way up and reassembled on the way down.
 * Neither side changes shape to suit the other.
 */
type LocalResultSubject = ResultSubject;

/**
 * The subject fields that travel, and every one of them travels.
 *
 * Listed explicitly rather than spread, so that a field added to
 * `ResultSubject` fails the type check here instead of silently staying on one
 * device. A marks column that never reached the cloud would be worse than one
 * that never existed: the second device would show a result whose marks are
 * simply absent, and there is nothing on screen to distinguish that from a card
 * that printed none (OQ-049 §24).
 */
function subjectToRecord(
  resultId: string,
  subject: LocalResultSubject,
  ordinal: number,
): LocalRecord {
  return {
    id: subject.id,
    collection: 'resultSubjects',
    data: {
      resultId,
      subjectCode: subject.subjectCode,
      subjectTitle: subject.subjectTitle,
      catalogueCode: subject.catalogueCode,
      internal: subject.internal,
      external: subject.external,
      total: subject.total,
      resultStatus: subject.resultStatus,
      announcedOn: subject.announcedOn,
      gradeLetter: subject.gradeLetter,
      gradePoint: subject.gradePoint,
      credits: subject.credits,
      hasSee: subject.hasSee,
      provenance: subject.provenance,
      ordinal,
    },
  };
}

/**
 * ---------------------------------------------------------------------------
 * ONE WRITER PER PLACE (the rule that makes the ledger authoritative)
 * ---------------------------------------------------------------------------
 *
 * A ledger-authoritative device DOES NOT PUBLISH its attendance aggregate, and
 * does not let a pulled one into storage. That is not caution, it is the only
 * way the pair can settle: while two such devices each derive their own figure
 * and write it to the one shared row, every pull provokes a push and the row
 * alternates between them forever. Removing the second writer removes the loop
 * — on v1 no pull can cause a write to anything that syncs.
 *
 * What a pulled aggregate becomes instead is a `RemoteSnapshot`: an observation
 * the student is shown and decides about (domain/attendance). Nothing about it
 * changes a number on its own.
 *
 * A device still on schemaVersion 0 syncs attendance exactly as it always has.
 */
function ledgerAuthoritative(version: number): boolean {
  return version >= SCHEMA_VERSION;
}

/**
 * The fields the cloud stores for each collection — and so the only ones sent.
 *
 * A CLIENT COPY of services/api/src/student/store.ts `COLLECTION_TABLES`
 * (columns camelCased, as they travel). test/sync-allowlist.test.ts pins it to
 * that list; change both together.
 *
 * Why it matters (OQ-060): a pushed record is fingerprinted, and the cloud
 * echoes back only these columns. A local-only field in the payload
 * (`profileId`, `createdAt`, a slot's `classId`) meant the device's fingerprint
 * never matched the cloud's again: every sync re-pushed every record, and the
 * first pull reported a conflict with itself. An ALLOWLIST rather than a
 * denylist, so a local field added later stays local by default.
 */
export const SYNCED_FIELDS = {
  semesters: ['number', 'status', 'startedOn', 'completedOn'],
  semesterSubjects: ['semester', 'code', 'title', 'credits', 'notes'],
  results: ['semester', 'schemeId', 'ruleSetId', 'sgpaAsserted'],
  attendance: ['semester', 'subjectCode', 'subjectTitle', 'attended', 'conducted'],
  timetable: ['day', 'startTime', 'endTime', 'subjectCode', 'activity', 'room', 'faculty'],
  backlogs: [
    'subjectCode',
    'subjectTitle',
    'originSemester',
    'status',
    'attempts',
    'clearedInSemester',
  ],
} as const satisfies Record<(typeof COLLECTIONS)[number][0], readonly string[]>;

function syncedFields(
  collection: keyof typeof SYNCED_FIELDS,
  item: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(SYNCED_FIELDS[collection].map((field) => [field, item[field]]));
}

async function collectLocal(
  repositories: RepositoryBundle,
  version: number,
): Promise<LocalRecord[]> {
  const records: LocalRecord[] = [];

  for (const [collection, key] of COLLECTIONS) {
    if (collection === 'attendance' && ledgerAuthoritative(version)) continue;
    const items = await repositories[key].list();
    for (const item of items) {
      const { id, ...rest } = item as unknown as { id: string } & Record<string, unknown>;

      if (collection === 'results') {
        /*
         * `subjects` is dropped from the result's own payload and sent as its
         * own records. Leaving the array in would put it in the result's
         * fingerprint, so editing one grade would mark the whole result changed
         * — and the server would silently ignore the array anyway, since it is
         * not an allowlisted column.
         */
        const { subjects, ...withoutSubjects } = rest as {
          subjects?: readonly LocalResultSubject[];
        } & Record<string, unknown>;

        records.push({ id, collection, data: syncedFields(collection, withoutSubjects) });
        (subjects ?? []).forEach((subject, ordinal) => {
          records.push(subjectToRecord(id, subject, ordinal));
        });
        continue;
      }

      records.push({ id, collection, data: syncedFields(collection, rest) });
    }
  }

  return records;
}

/**
 * Writes a pulled subject row back into the result that owns it.
 *
 * A subject whose result this device has not pulled YET is skipped rather than
 * dropped: the result arrives in the same pull, and the next sync carries the
 * subject. Inventing a parent to hang it on would create a result the student
 * never entered.
 */
async function applySubjectToResult(
  repositories: RepositoryBundle,
  subjectId: string,
  data: Record<string, unknown>,
  remove: boolean,
): Promise<void> {
  const resultId = data.resultId;
  const results = await repositories.results.list();
  const parent = results.find((candidate) =>
    remove
      ? (candidate as unknown as { subjects?: LocalResultSubject[] }).subjects?.some(
          (subject) => subject.id === subjectId,
        ) === true
      : candidate.id === resultId,
  );
  if (parent === undefined) return;

  const existing =
    (parent as unknown as { subjects?: readonly LocalResultSubject[] }).subjects ?? [];
  const without = existing.filter((subject) => subject.id !== subjectId);

  /*
   * A pulled row is normalised through the same reader as stored rows, so a
   * null column arrives as null rather than as `Number(null) === 0` — which
   * would turn "this card printed no credits" into "this course is worth
   * nothing" on the receiving device.
   */
  const subjects = remove
    ? without
    : [...without, normalizeResultSubject({ ...data, id: subjectId })];

  await repositories.results.upsert({ ...parent, subjects } as never);
}

/**
 * Compares what was pulled with what the ledger derives, and rewrites the cache.
 *
 * The comparison NEVER touches the ledger. All it can write is the observation
 * list, which is device-local and never published — so it cannot provoke a
 * reaction on the device the figure came from, and repeated syncs cannot
 * oscillate.
 */
async function recordObservations(
  repositories: RepositoryBundle,
  observed: readonly ObservedAggregate[],
): Promise<void> {
  const entries = await repositories.attendanceLedger.list();
  const overrides = await repositories.timetableOverrides.list();
  const derived = deriveCounts(entries, overrides);
  const now = new Date().toISOString();

  if (observed.length > 0) {
    const before = await repositories.remoteSnapshots.list();
    let next: readonly RemoteSnapshot[] = before;
    for (const aggregate of observed) {
      next = noteSnapshot(next, aggregate, derived.get(aggregate.subjectCode), now);
    }
    const unchanged = new Map(before.map((snapshot) => [snapshot.id, snapshot]));
    for (const snapshot of next) {
      const previous = unchanged.get(snapshot.id);
      if (previous !== undefined && previous.status === snapshot.status) continue;
      await repositories.remoteSnapshots.upsert(snapshot);
    }
  }

  /* The cache is re-derived whatever arrived, so a pull cannot leave it stale. */
  const records = await repositories.attendance.list();
  for (const record of reconcile(records, derived, now)) {
    const previous = records.find((candidate) => candidate.id === record.id);
    if (previous === record) continue;
    await repositories.attendance.upsert(record);
  }
}

export interface SyncApi {
  readonly state: SyncState;
  readonly syncNow: () => Promise<void>;
  readonly exportData: () => Promise<boolean>;
  readonly deleteAccount: () => Promise<{ error: string | null }>;
}

export function useSync(): SyncApi {
  const { state: auth, adapter } = useAuth();
  const repositories = useRepositories();
  const [state, setState] = useState<SyncState>(IDLE_SYNC);

  const scope = auth.status === 'signed_in' ? auth.identity.userId : null;

  // Bookkeeping lives in the account's own scope, so two accounts on one
  // browser keep two independent cursors (M9 §37).
  useEffect(() => {
    let cancelled = false;
    void readValue<SyncBookkeeping>(scope, 'syncState').then((stored) => {
      if (cancelled) return;
      setState((current) => ({
        ...current,
        status: scope === null ? 'local_only' : current.status,
        cursor: stored?.cursor ?? null,
        lastSyncedAt: stored?.lastSyncedAt ?? null,
      }));
    });
    return () => {
      cancelled = true;
    };
  }, [scope]);

  const authorized = useCallback(
    async (path: string, init?: RequestInit): Promise<Response | null> => {
      if (adapter === null) return null;
      const token = await adapter.accessToken();
      if (token === null) return null;
      return fetch(`${apiBaseUrl()}${path}`, {
        ...init,
        headers: {
          ...(init?.headers ?? {}),
          Authorization: `Bearer ${token}`,
          ...(init?.body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
      });
    },
    [adapter],
  );

  const syncNow = useCallback(async () => {
    if (scope === null) {
      setState((current) => ({ ...current, status: 'local_only' }));
      return;
    }

    setState((current) => ({ ...current, status: 'syncing', error: null }));

    try {
      const stored = (await readValue<SyncBookkeeping>(scope, 'syncState')) ?? EMPTY_BOOKKEEPING;
      /*
       * Read through the ledger repository rather than the raw key, so the
       * v0 -> v1 upgrade has finished before this sync decides which rules
       * apply. A half-migrated device keeps the old behaviour, which is safe.
       */
      await repositories.attendanceLedger.list();
      const version = (await readValue<number>(scope, 'schemaVersion')) ?? 0;
      const local = await collectLocal(repositories, version);

      /* ---- push first, so this device's work is safe before anything is
         overwritten by a pull (M9 §68) ---------------------------------- */
      /*
       * A v1 device publishes NO attendance row — including no tombstone.
       *
       * `recordsToPush` sends a deletion for anything the bookkeeping knows
       * about that is no longer held locally, which is right for a record the
       * student deleted and catastrophic here: attendance is simply not
       * collected any more, so every synced row would look deleted and this
       * device would wipe the aggregate the other one is still using.
       */
      const candidates = recordsToPush(local, stored).filter(
        (candidate) => !(ledgerAuthoritative(version) && candidate.collection === 'attendance'),
      );
      let bookkeeping = stored;
      let conflicts = [...state.conflicts];

      if (candidates.length > 0) {
        const response = await authorized(STUDENT_ROUTES.meSync, {
          method: 'POST',
          body: JSON.stringify({ records: candidates }),
        });
        if (response === null || !response.ok) throw new Error('push failed');

        const body = (await response.json()) as { outcomes: never[] };
        const applied = applyPushOutcomes(bookkeeping, body.outcomes, local);
        bookkeeping = applied.bookkeeping;
        conflicts = [...conflicts, ...applied.conflicts];
      }

      /* ---- then pull ------------------------------------------------- */
      const query =
        bookkeeping.cursor === null ? '' : `?since=${encodeURIComponent(bookkeeping.cursor)}`;
      const pull = await authorized(`${STUDENT_ROUTES.meSync}${query}`);
      if (pull === null || !pull.ok) throw new Error('pull failed');

      const body = (await pull.json()) as {
        records: {
          id: string;
          collection: string;
          revision: number;
          deletedAt: string | null;
          data: Record<string, unknown>;
        }[];
        syncedAt: string;
      };

      const plan = planPull(body.records, local, bookkeeping);

      /*
       * Results are written BEFORE their subjects, so a subject arriving in the
       * same pull as its parent finds one to attach to.
       */
      const parentsFirst = [...plan.upserts].sort(
        (a, b) =>
          Number(a.collection === 'resultSubjects') - Number(b.collection === 'resultSubjects'),
      );

      const observed: ObservedAggregate[] = [];

      for (const record of parentsFirst) {
        if (record.collection === 'resultSubjects') {
          await applySubjectToResult(repositories, record.id, record.data, false);
          continue;
        }
        if (record.collection === 'attendance' && ledgerAuthoritative(version)) {
          /* Observed, never adopted. The local figure stays derived. */
          const data = record.data as unknown as Partial<AttendanceRecord>;
          if (typeof data.subjectCode === 'string') {
            observed.push({
              remoteRecordId: record.id,
              subjectCode: data.subjectCode,
              attended: Number(data.attended),
              conducted: Number(data.conducted),
              revision: record.revision,
            });
          }
          continue;
        }
        const entry = COLLECTIONS.find(([name]) => name === record.collection);
        if (entry === undefined) continue;
        /*
         * The pulled columns are MERGED onto the local record, never replace
         * it. A pull carries only what the cloud stores, so replacing the
         * object dropped every local-only field — a result's `subjects` (which
         * travel as their own rows; losing them made the next push tombstone
         * every subject on every device), a slot's `classId`, `profileId`,
         * `createdAt`. Keeping them is safe because `syncedFields` leaves them
         * out of the fingerprint. A result new to this device gets its rows
         * from `applySubjectToResult` below.
         */
        const previous = (await repositories[entry[1]].list()).find(
          (item) => item.id === record.id,
        );
        await repositories[entry[1]].upsert({
          ...previous,
          id: record.id,
          ...record.data,
        } as never);
      }

      for (const deletion of plan.deletions) {
        if (deletion.collection === 'resultSubjects') {
          await applySubjectToResult(repositories, deletion.id, {}, true);
          continue;
        }
        /*
         * A remote attendance row disappearing is not a statement that this
         * device's classes did not happen. The cache is derived and is rebuilt
         * below regardless.
         */
        if (deletion.collection === 'attendance' && ledgerAuthoritative(version)) continue;
        const entry = COLLECTIONS.find(([name]) => name === deletion.collection);
        if (entry === undefined) continue;
        await repositories[entry[1]].remove(deletion.id);
      }

      if (ledgerAuthoritative(version)) {
        await recordObservations(repositories, observed);
      }

      bookkeeping = afterPull(bookkeeping, plan, body.syncedAt);
      conflicts = [...conflicts, ...plan.conflicts];
      await writeValue(scope, 'syncState', bookkeeping);

      setState({
        // A sync that produced conflicts is NOT "synced" (M9 §55, §68).
        status: conflicts.length > 0 ? 'conflicts' : 'synced',
        cursor: bookkeeping.cursor,
        conflicts,
        lastSyncedAt: bookkeeping.lastSyncedAt,
        error: null,
      });
    } catch {
      setState((current) => ({
        ...current,
        status: navigator.onLine ? 'failed' : 'offline',
        error: navigator.onLine ? 'Could not sync. Your records are safe on this device.' : null,
      }));
    }
  }, [authorized, repositories, scope, state.conflicts]);

  /** Downloads the student's own data as a file (M9 §35). */
  const exportData = useCallback(async (): Promise<boolean> => {
    const response = await authorized(STUDENT_ROUTES.meExport);
    if (response === null || !response.ok) return false;

    const blob = new Blob([JSON.stringify(await response.json(), null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'gradtools-export.json';
    anchor.click();
    URL.revokeObjectURL(url);
    return true;
  }, [authorized]);

  const deleteAccount = useCallback(async (): Promise<{ error: string | null }> => {
    const response = await authorized(STUDENT_ROUTES.me, { method: 'DELETE' });
    if (response === null) return { error: 'You are not signed in.' };
    if (!response.ok) {
      return { error: 'Could not delete your account. Nothing was changed.' };
    }
    return { error: null };
  }, [authorized]);

  return { state, syncNow, exportData, deleteAccount };
}
