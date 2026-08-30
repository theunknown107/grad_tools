/**
 * Deciding what to send, what to take, and what to ask about.
 *
 * Authority: docs/07 §7.16 · M9 §26, §28, §40, §68
 *
 * PURE FUNCTIONS ONLY. Nothing here fetches, stores or knows a provider exists,
 * which is what makes the difficult part — the conflict rules — testable
 * without a network or a database.
 *
 * ---------------------------------------------------------------------------
 * THE RULE THAT SHAPES EVERYTHING ELSE
 * ---------------------------------------------------------------------------
 *
 * **Nothing is discarded without a person deciding.** Not a local edit, not a
 * cloud record, not a deletion. Where two versions disagree the answer is a
 * question, not a winner (M9 §28).
 *
 * That sounds obvious and is the opposite of what almost every sync layer does,
 * because "last write wins" is one line and asking is a screen. It matters here
 * because the records are attendance counts and grades: a silently reverted
 * count does not look like a bug to the student who ends up short of 85%.
 */

import type { SyncConflict } from './auth.js';

/** What this device knows about one record's relationship to the cloud. */
export interface RecordSyncMeta {
  readonly collection: string;
  /** The revision the cloud had when this device last agreed with it. */
  readonly revision: number;
  /** A fingerprint of the data at that moment, to detect local edits. */
  readonly fingerprint: string;
}

export interface SyncBookkeeping {
  /** Server cursor. Null means this device has never pulled. */
  readonly cursor: string | null;
  readonly records: Readonly<Record<string, RecordSyncMeta>>;
  readonly lastSyncedAt: string | null;
}

export const EMPTY_BOOKKEEPING: SyncBookkeeping = {
  cursor: null,
  records: {},
  lastSyncedAt: null,
};

/**
 * A stable fingerprint of a record's synced fields.
 *
 * Key order is sorted, so two objects with the same content fingerprint the
 * same however they were built. Deliberately NOT a cryptographic hash: this
 * detects "did the student change this", not tampering, and a readable string
 * makes a failing test legible.
 */
export function fingerprint(data: Record<string, unknown>): string {
  return Object.keys(data)
    .filter((key) => key !== 'updatedAt' && key !== 'id')
    .sort()
    .map((key) => `${key}=${String(data[key] ?? '')}`)
    .join('|');
}

/* -------------------------------------------------------------------------- */
/* What to push                                                               */
/* -------------------------------------------------------------------------- */

export interface LocalRecord {
  readonly id: string;
  readonly collection: string;
  readonly data: Record<string, unknown>;
}

export interface PushCandidate {
  readonly id: string;
  readonly collection: string;
  readonly baseRevision: number | null;
  readonly deleted: boolean;
  readonly data: Record<string, unknown>;
}

/**
 * Which local records the cloud has not got, or has an older version of.
 *
 * A record is sent when it is NEW to the cloud, or when its fingerprint has
 * moved since this device last agreed with the cloud. An untouched record is
 * not sent — sending everything every time would turn every sync into a
 * conflict storm between two devices that agree.
 */
export function recordsToPush(
  local: readonly LocalRecord[],
  bookkeeping: SyncBookkeeping,
): PushCandidate[] {
  const candidates: PushCandidate[] = [];

  for (const record of local) {
    const meta = bookkeeping.records[record.id];
    const now = fingerprint(record.data);

    if (meta === undefined) {
      candidates.push({ ...record, baseRevision: null, deleted: false });
      continue;
    }
    if (meta.fingerprint !== now) {
      candidates.push({ ...record, baseRevision: meta.revision, deleted: false });
    }
  }

  /*
   * DELETIONS ARE PUSHED TOO. A record this device once synced and no longer
   * holds was deleted here, and without sending a tombstone the next pull would
   * hand it straight back (M9 §68).
   */
  const present = new Set(local.map((record) => record.id));
  for (const [id, meta] of Object.entries(bookkeeping.records)) {
    if (!present.has(id)) {
      candidates.push({
        id,
        collection: meta.collection,
        baseRevision: meta.revision,
        deleted: true,
        data: {},
      });
    }
  }

  return candidates;
}

/* -------------------------------------------------------------------------- */
/* What a push came back saying                                               */
/* -------------------------------------------------------------------------- */

export interface PushOutcome {
  readonly id: string;
  readonly collection: string;
  readonly status: 'applied' | 'conflict' | 'rejected';
  readonly server: {
    revision: number;
    data: Record<string, unknown>;
    deletedAt: string | null;
  } | null;
  readonly reason: string | null;
}

export interface ApplyResult {
  readonly bookkeeping: SyncBookkeeping;
  readonly conflicts: readonly SyncConflict[];
}

/**
 * Folds a push's outcomes back into what this device believes.
 *
 * An `applied` record's revision is recorded so the next push can be
 * incremental. A `conflict` or a `rejection` updates NOTHING — the local record
 * stays exactly as it is, and the disagreement is surfaced. Quietly accepting
 * the server's version here would be the silent overwrite this design exists to
 * avoid, just in the other direction.
 */
export function applyPushOutcomes(
  bookkeeping: SyncBookkeeping,
  outcomes: readonly PushOutcome[],
  local: readonly LocalRecord[],
): ApplyResult {
  const records = { ...bookkeeping.records };
  const conflicts: SyncConflict[] = [];
  const byId = new Map(local.map((record) => [record.id, record]));

  for (const outcome of outcomes) {
    if (outcome.status === 'applied') {
      if (outcome.server === null) {
        // A deletion the server accepted: stop tracking it entirely.
        delete records[outcome.id];
        continue;
      }
      if (outcome.server.deletedAt !== null) {
        delete records[outcome.id];
        continue;
      }
      records[outcome.id] = {
        collection: outcome.collection,
        revision: outcome.server.revision,
        fingerprint: fingerprint(outcome.server.data),
      };
      continue;
    }

    conflicts.push({
      id: outcome.id,
      collection: outcome.collection,
      reason: outcome.reason ?? 'This record changed somewhere else.',
      local: byId.get(outcome.id)?.data ?? null,
      server: outcome.server?.data ?? null,
    });
  }

  return { bookkeeping: { ...bookkeeping, records }, conflicts };
}

/* -------------------------------------------------------------------------- */
/* What to take from a pull                                                   */
/* -------------------------------------------------------------------------- */

export interface RemoteRecord {
  readonly id: string;
  readonly collection: string;
  readonly revision: number;
  readonly deletedAt: string | null;
  readonly data: Record<string, unknown>;
}

export interface PullPlan {
  /** Records to write into local storage. */
  readonly upserts: readonly RemoteRecord[];
  /** Record ids to remove locally, because the cloud says they are gone. */
  readonly deletions: readonly { id: string; collection: string }[];
  /** Records the cloud changed that this device had also changed. */
  readonly conflicts: readonly SyncConflict[];
}

/**
 * Decides what a pull may safely apply.
 *
 * THE CASE THAT MATTERS is a record changed in BOTH places since the last sync.
 * Taking the cloud's version would erase a local edit the student made and
 * never told them; taking the local one would erase the other device's. So it
 * becomes a conflict and both versions are kept until somebody chooses.
 *
 * A record changed only remotely is applied. A record changed only locally is
 * left alone — the next push will carry it up.
 */
export function planPull(
  remote: readonly RemoteRecord[],
  local: readonly LocalRecord[],
  bookkeeping: SyncBookkeeping,
): PullPlan {
  const upserts: RemoteRecord[] = [];
  const deletions: { id: string; collection: string }[] = [];
  const conflicts: SyncConflict[] = [];
  const byId = new Map(local.map((record) => [record.id, record]));

  for (const record of remote) {
    const meta = bookkeeping.records[record.id];
    const here = byId.get(record.id);
    const changedHere =
      here !== undefined && meta !== undefined && fingerprint(here.data) !== meta.fingerprint;

    if (record.deletedAt !== null) {
      /*
       * The cloud deleted it. If this device edited it since the last sync,
       * that is a genuine disagreement — "I deleted this" versus "I was still
       * using it" — and it is not ours to settle.
       */
      if (changedHere) {
        conflicts.push({
          id: record.id,
          collection: record.collection,
          reason: 'This was deleted on another device, but you changed it here.',
          local: here?.data ?? null,
          server: null,
        });
      } else {
        deletions.push({ id: record.id, collection: record.collection });
      }
      continue;
    }

    if (changedHere && fingerprint(record.data) !== fingerprint(here.data)) {
      conflicts.push({
        id: record.id,
        collection: record.collection,
        reason: 'This changed on another device and on this one.',
        local: here.data,
        server: record.data,
      });
      continue;
    }

    upserts.push(record);
  }

  return { upserts, deletions, conflicts };
}

/** Bookkeeping after a pull's upserts and deletions have been written. */
export function afterPull(
  bookkeeping: SyncBookkeeping,
  plan: PullPlan,
  cursor: string,
): SyncBookkeeping {
  const records = { ...bookkeeping.records };

  for (const record of plan.upserts) {
    records[record.id] = {
      collection: record.collection,
      revision: record.revision,
      fingerprint: fingerprint(record.data),
    };
  }
  for (const deletion of plan.deletions) {
    delete records[deletion.id];
  }

  return { cursor, records, lastSyncedAt: new Date().toISOString() };
}

/**
 * How a student resolves one conflict.
 *
 * Only two answers, and both are explicit. There is no "merge automatically"
 * because for a grade or an attendance count there is no arithmetic that is
 * right — 12 and 14 do not average to something meaningful (M9 §28).
 */
export type ConflictResolution = 'keep_mine' | 'take_theirs';
