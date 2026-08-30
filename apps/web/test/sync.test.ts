/**
 * The sync rules.
 *
 * Authority: docs/07 §7.16 · M9 §28, §62, §68
 *
 * These guard the decisions that lose data when they are wrong. Every test
 * below fails loudly if somebody later "simplifies" the conflict handling into
 * last-write-wins, which is the change this design exists to prevent.
 */

import { describe, expect, it } from 'vitest';
import {
  EMPTY_BOOKKEEPING,
  afterPull,
  applyPushOutcomes,
  fingerprint,
  planPull,
  recordsToPush,
  type LocalRecord,
  type PushOutcome,
  type RemoteRecord,
  type SyncBookkeeping,
} from '../src/domain/sync.js';
import {
  IDLE_SYNC,
  SYNC_LABEL,
  mergeOptionsFor,
  scopeFor,
  type AuthState,
} from '../src/domain/auth.js';

const attendance = (id: string, attended: number): LocalRecord => ({
  id,
  collection: 'attendance',
  data: { semester: 5, subjectCode: 'BCS501', subjectTitle: 'DBMS', attended, conducted: 20 },
});

function booked(record: LocalRecord, revision: number): SyncBookkeeping {
  return {
    cursor: '2026-08-01T00:00:00.000Z',
    lastSyncedAt: '2026-08-01T00:00:00.000Z',
    records: {
      [record.id]: {
        collection: record.collection,
        revision,
        fingerprint: fingerprint(record.data),
      },
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Fingerprints                                                               */
/* -------------------------------------------------------------------------- */

describe('detecting a local change', () => {
  it('is stable across key order', () => {
    expect(fingerprint({ a: 1, b: 2 })).toBe(fingerprint({ b: 2, a: 1 }));
  });

  it('ignores fields the server owns', () => {
    expect(fingerprint({ a: 1, updatedAt: 'x' })).toBe(fingerprint({ a: 1, updatedAt: 'y' }));
  });

  it('changes when the student changes something', () => {
    expect(fingerprint({ attended: 12 })).not.toBe(fingerprint({ attended: 14 }));
  });
});

/* -------------------------------------------------------------------------- */
/* Push                                                                       */
/* -------------------------------------------------------------------------- */

describe('what gets pushed', () => {
  it('sends a record the cloud has never seen', () => {
    const record = attendance('r1', 12);
    const push = recordsToPush([record], EMPTY_BOOKKEEPING);

    expect(push).toHaveLength(1);
    expect(push[0]?.baseRevision).toBeNull();
  });

  /* A quiet device must not start a conflict storm with a device that agrees. */
  it('sends nothing when nothing changed', () => {
    const record = attendance('r1', 12);
    expect(recordsToPush([record], booked(record, 3))).toHaveLength(0);
  });

  it('sends an edited record with the revision it was edited from', () => {
    const original = attendance('r1', 12);
    const edited = attendance('r1', 14);
    const push = recordsToPush([edited], booked(original, 3));

    expect(push).toHaveLength(1);
    expect(push[0]?.baseRevision).toBe(3);
    expect(push[0]?.data.attended).toBe(14);
  });

  /* Without this, the next pull hands a deleted record straight back (M9 §68). */
  it('sends a tombstone for a record deleted here', () => {
    const record = attendance('r1', 12);
    const push = recordsToPush([], booked(record, 3));

    expect(push).toHaveLength(1);
    expect(push[0]?.deleted).toBe(true);
    expect(push[0]?.baseRevision).toBe(3);
  });

  it('does not send a tombstone for a record it never synced', () => {
    expect(recordsToPush([], EMPTY_BOOKKEEPING)).toHaveLength(0);
  });
});

describe('what a push’s answer does', () => {
  const record = attendance('r1', 14);

  it('records the new revision when the server took it', () => {
    const outcome: PushOutcome = {
      id: 'r1',
      collection: 'attendance',
      status: 'applied',
      server: { revision: 4, data: record.data, deletedAt: null },
      reason: null,
    };
    const result = applyPushOutcomes(booked(attendance('r1', 12), 3), [outcome], [record]);

    expect(result.bookkeeping.records.r1?.revision).toBe(4);
    expect(result.conflicts).toHaveLength(0);
  });

  /*
   * THE CENTRAL RULE. A conflict must not update bookkeeping, because doing so
   * would mean the next push considers the local edit "already sent" and it
   * would vanish without anyone being told (M9 §28).
   */
  it('changes nothing at all on a conflict, and reports it', () => {
    const before = booked(attendance('r1', 12), 3);
    const outcome: PushOutcome = {
      id: 'r1',
      collection: 'attendance',
      status: 'conflict',
      server: { revision: 9, data: { ...record.data, attended: 18 }, deletedAt: null },
      reason: 'This record changed on another device.',
    };

    const result = applyPushOutcomes(before, [outcome], [record]);

    expect(result.bookkeeping.records.r1).toEqual(before.records.r1);
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0]?.local?.attended).toBe(14);
    expect(result.conflicts[0]?.server?.attended).toBe(18);
  });

  /* A rejection is not silence either. The student is told which record. */
  it('reports a rejection with its reason', () => {
    const outcome: PushOutcome = {
      id: 'r1',
      collection: 'attendance',
      status: 'rejected',
      server: null,
      reason: 'Classes attended cannot be more than classes held.',
    };
    const result = applyPushOutcomes(EMPTY_BOOKKEEPING, [outcome], [record]);

    expect(result.conflicts[0]?.reason).toBe('Classes attended cannot be more than classes held.');
  });

  it('stops tracking a record whose deletion the server accepted', () => {
    const outcome: PushOutcome = {
      id: 'r1',
      collection: 'attendance',
      status: 'applied',
      server: { revision: 5, data: {}, deletedAt: '2026-08-02T00:00:00.000Z' },
      reason: null,
    };
    const result = applyPushOutcomes(booked(record, 3), [outcome], []);
    expect(result.bookkeeping.records.r1).toBeUndefined();
  });
});

/* -------------------------------------------------------------------------- */
/* Pull                                                                       */
/* -------------------------------------------------------------------------- */

describe('what a pull applies', () => {
  const remote = (attended: number, deletedAt: string | null = null): RemoteRecord => ({
    id: 'r1',
    collection: 'attendance',
    revision: 9,
    deletedAt,
    data: { semester: 5, subjectCode: 'BCS501', subjectTitle: 'DBMS', attended, conducted: 20 },
  });

  it('applies a record this device has never seen', () => {
    const plan = planPull([remote(18)], [], EMPTY_BOOKKEEPING);
    expect(plan.upserts).toHaveLength(1);
    expect(plan.conflicts).toHaveLength(0);
  });

  it('applies a record changed only in the cloud', () => {
    const here = attendance('r1', 12);
    const plan = planPull([remote(18)], [here], booked(here, 3));

    expect(plan.upserts).toHaveLength(1);
    expect(plan.conflicts).toHaveLength(0);
  });

  /*
   * BOTH SIDES CHANGED. Applying the cloud's version would erase the student's
   * local edit without telling them — the exact failure that makes an
   * attendance count go backwards.
   */
  it('refuses to overwrite a local edit, and asks instead', () => {
    const synced = attendance('r1', 12);
    const editedHere = attendance('r1', 14);
    const plan = planPull([remote(18)], [editedHere], booked(synced, 3));

    expect(plan.upserts).toHaveLength(0);
    expect(plan.conflicts).toHaveLength(1);
    expect(plan.conflicts[0]?.local?.attended).toBe(14);
    expect(plan.conflicts[0]?.server?.attended).toBe(18);
  });

  it('deletes locally when the cloud deleted and this device did not touch it', () => {
    const here = attendance('r1', 12);
    const plan = planPull([remote(12, '2026-08-02T00:00:00.000Z')], [here], booked(here, 3));

    expect(plan.deletions).toEqual([{ id: 'r1', collection: 'attendance' }]);
    expect(plan.conflicts).toHaveLength(0);
  });

  /* "I deleted this" versus "I was still using it" is not ours to settle. */
  it('asks when the cloud deleted a record this device had changed', () => {
    const synced = attendance('r1', 12);
    const editedHere = attendance('r1', 14);
    const plan = planPull(
      [remote(12, '2026-08-02T00:00:00.000Z')],
      [editedHere],
      booked(synced, 3),
    );

    expect(plan.deletions).toHaveLength(0);
    expect(plan.conflicts).toHaveLength(1);
    expect(plan.conflicts[0]?.server).toBeNull();
  });

  it('advances the cursor only over what it applied', () => {
    const plan = planPull([remote(18)], [], EMPTY_BOOKKEEPING);
    const next = afterPull(EMPTY_BOOKKEEPING, plan, '2026-08-03T00:00:00.000Z');

    expect(next.cursor).toBe('2026-08-03T00:00:00.000Z');
    expect(next.records.r1?.revision).toBe(9);
  });
});

/* -------------------------------------------------------------------------- */
/* Account scope                                                              */
/* -------------------------------------------------------------------------- */

describe('whose data is on screen', () => {
  const signedIn = (userId: string): AuthState => ({
    status: 'signed_in',
    identity: { userId, email: null, provider: null },
  });

  it('reads a signed-in student’s own scope', () => {
    expect(scopeFor(signedIn('user-a'))).toBe('user-a');
  });

  it('reads the anonymous scope when nobody is signed in', () => {
    expect(scopeFor({ status: 'signed_out' })).toBeNull();
  });

  /*
   * TWO ACCOUNTS ON ONE BROWSER MUST NEVER MEET (M9 §37). The scopes differ, so
   * one bundle is not looking at the other's keys at all.
   */
  it('gives two accounts two different scopes', () => {
    expect(scopeFor(signedIn('user-a'))).not.toBe(scopeFor(signedIn('user-b')));
  });

  /*
   * An expired session is not proof of identity. Continuing to show an
   * account's records on a shared browser because a token was once valid is the
   * leak §37 is about.
   */
  it('does not keep showing an account’s data after its session expires', () => {
    expect(scopeFor({ status: 'expired' })).toBeNull();
    expect(scopeFor({ status: 'restoring' })).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* First sign-in                                                              */
/* -------------------------------------------------------------------------- */

describe('the first sign-in offer', () => {
  /* NOTHING DESTRUCTIVE IS EVER RECOMMENDED (M9 §54). */
  it('recommends keeping both when both sides hold records', () => {
    const options = mergeOptionsFor({ localCount: 12, cloudCount: 8 });
    expect(options.recommended).toBe('merge');
    expect(options.available).toContain('stay_local');
  });

  it('recommends uploading when the account is empty', () => {
    expect(mergeOptionsFor({ localCount: 12, cloudCount: 0 }).recommended).toBe('upload_local');
  });

  it('recommends downloading when the device is empty', () => {
    expect(mergeOptionsFor({ localCount: 0, cloudCount: 8 }).recommended).toBe('use_cloud');
  });

  it('offers only staying local when there is nothing anywhere', () => {
    expect(mergeOptionsFor({ localCount: 0, cloudCount: 0 }).available).toEqual(['stay_local']);
  });

  /* Signing in is never, by itself, consent to upload (M9 §51). */
  it('always leaves staying local available', () => {
    for (const situation of [
      { localCount: 0, cloudCount: 0 },
      { localCount: 5, cloudCount: 0 },
      { localCount: 0, cloudCount: 5 },
      { localCount: 5, cloudCount: 5 },
    ]) {
      expect(mergeOptionsFor(situation).available).toContain('stay_local');
    }
  });
});

/* -------------------------------------------------------------------------- */
/* Honesty about state                                                        */
/* -------------------------------------------------------------------------- */

describe('what the student is told', () => {
  /* "Synced" must never appear after a failure (M9 §68). */
  it('has a distinct, non-reassuring label for every state', () => {
    expect(SYNC_LABEL.failed).toBe('Sync failed');
    expect(SYNC_LABEL.offline).toContain('saved here');
    expect(SYNC_LABEL.local_only).toBe('Saved on this device');
    expect(new Set(Object.values(SYNC_LABEL)).size).toBe(Object.keys(SYNC_LABEL).length);
  });

  it('starts as local-only rather than as synced', () => {
    expect(IDLE_SYNC.status).toBe('local_only');
    expect(IDLE_SYNC.lastSyncedAt).toBeNull();
  });
});
