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
import { normalizeResultSubject } from '../../domain/results.js';
import type { ResultSubject } from '../../domain/types.js';
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

async function collectLocal(repositories: RepositoryBundle): Promise<LocalRecord[]> {
  const records: LocalRecord[] = [];

  for (const [collection, key] of COLLECTIONS) {
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

        records.push({ id, collection, data: withoutSubjects });
        (subjects ?? []).forEach((subject, ordinal) => {
          records.push(subjectToRecord(id, subject, ordinal));
        });
        continue;
      }

      records.push({ id, collection, data: rest });
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
      const local = await collectLocal(repositories);

      /* ---- push first, so this device's work is safe before anything is
         overwritten by a pull (M9 §68) ---------------------------------- */
      const candidates = recordsToPush(local, stored);
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

      for (const record of parentsFirst) {
        if (record.collection === 'resultSubjects') {
          await applySubjectToResult(repositories, record.id, record.data, false);
          continue;
        }
        const entry = COLLECTIONS.find(([name]) => name === record.collection);
        if (entry === undefined) continue;
        await repositories[entry[1]].upsert({ id: record.id, ...record.data } as never);
      }

      for (const deletion of plan.deletions) {
        if (deletion.collection === 'resultSubjects') {
          await applySubjectToResult(repositories, deletion.id, {}, true);
          continue;
        }
        const entry = COLLECTIONS.find(([name]) => name === deletion.collection);
        if (entry === undefined) continue;
        await repositories[entry[1]].remove(deletion.id);
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
