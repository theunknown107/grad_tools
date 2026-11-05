/**
 * Browser storage adapter.
 *
 * Authority: docs/33 §33.3 · docs/12 §12.14 · M9 §37, §38
 *
 * The ONLY module in the app permitted to touch browser storage. Components
 * and hooks go through repositories; nothing calls idb-keyval or localStorage
 * directly (M3 continuation §21).
 *
 * IndexedDB via idb-keyval rather than localStorage because it is async (so
 * the repository boundary is honest, see ../types.ts), structured-clone based
 * (no JSON round-tripping), and not capped at ~5 MB.
 *
 * ---------------------------------------------------------------------------
 * STORAGE IS ACCOUNT-BOUND (M9 §38)
 * ---------------------------------------------------------------------------
 *
 * Before M9 there was one student per browser and one key per collection. With
 * accounts that is a data leak waiting to happen: two people sharing a laptop
 * would find each other's semesters, results and attendance under the same key.
 *
 * So every key now carries a SCOPE:
 *
 *     gradtools:v1:anon:profile              nobody is signed in
 *     gradtools:v1:u:<auth_user_id>:profile  this account, on this device
 *
 * Consequences that follow, and are tested:
 *
 * - Signing out does not delete anything. It changes which scope is read, and
 *   the signed-out student's data is still theirs, still here (M9 §36).
 * - A second account on the same browser reads a different scope and can never
 *   see the first one's records — not because a filter excludes them, but
 *   because it is not looking at them (M9 §37).
 * - Data written before anyone signed in lives under `anon` and stays there.
 *   It is offered for merge at first sign-in and never silently moved.
 */

import { del, get, keys, set } from 'idb-keyval';

const PREFIX = 'gradtools:v1:';

export type StorageKey =
  | 'profile'
  | 'attendance'
  | 'results'
  | 'timetable'
  | 'semesters'
  | 'semesterSubjects'
  | 'backlogs'
  | 'notificationState'
  | 'notificationPreferences'
  /** Academic calendars a student imported, as structured events (M10A.7). */
  | 'calendars'
  /** Which import produced the active timetable, and its revision (M10A.8). */
  | 'timetableImports'
  /**
   * LEGACY, READ ONCE. The pre-ledger duplicate guard (M10A.11). The v0 -> v1
   * upgrade migrates whatever is here into the ledger and then deletes it;
   * nothing in the app writes it any more.
   */
  | 'classMarks'
  /** The attendance ledger: openings, class occurrences and adjustments (v1). */
  | 'attendanceLedger'
  /** What one date did to the recurring week. Device-local. */
  | 'timetableOverrides'
  /** Synced aggregates seen and not adopted. Device-local, never published. */
  | 'remoteSnapshots'
  /**
   * Which data model this device is on.
   *
   * Absent or 0 is the pre-ledger device, which keeps syncing attendance
   * counters exactly as it always did. 1 means the ledger is authoritative
   * here, and is written LAST by the upgrade so a half-migrated device can
   * never start behaving as though it were finished.
   */
  | 'schemaVersion'
  | 'schemeCourses'
  | 'examTimetables'
  | 'examEvents'
  /** Sync bookkeeping: the cursor and the pending queue (M9 §40). */
  | 'syncState'
  /**
   * Problem reports written while offline, awaiting send (support V1 §17).
   * Minimal payloads only — category, optional short text, safe context. Never
   * a token or academic data.
   */
  | 'supportQueue';

/**
 * Whose data a read or write concerns.
 *
 * `null` means "nobody is signed in" — a real scope with real data in it, not
 * an absence. A student who never creates an account keeps everything here.
 */
export type AccountScope = string | null;

/**
 * The prefix for one account's data.
 *
 * The auth user id goes in verbatim. It is a subject from a verified session (a
 * Supabase uuid, or a Clerk `user_…` id), never anything a student typed, so it
 * cannot contain a separator that would let one scope read another's keys.
 */
export function scopePrefix(scope: AccountScope): string {
  return scope === null ? `${PREFIX}anon:` : `${PREFIX}u:${scope}:`;
}

function fullKey(scope: AccountScope, key: StorageKey): string {
  return `${scopePrefix(scope)}${key}`;
}

/**
 * Storage is best-effort by design.
 *
 * Private browsing, disabled site data and storage pressure all make
 * IndexedDB throw. The product must keep working when it does: calculators
 * are pure functions and need no persistence at all (docs/03 UF-02 edge
 * cases). A read failure therefore degrades to "nothing saved yet" rather
 * than crashing the screen.
 */
export async function readValue<T>(scope: AccountScope, key: StorageKey): Promise<T | null> {
  try {
    const value = await get<T>(fullKey(scope, key));
    return value ?? null;
  } catch {
    return null;
  }
}

/** Returns false when the write could not be persisted, so callers can warn. */
export async function writeValue<T>(
  scope: AccountScope,
  key: StorageKey,
  value: T,
): Promise<boolean> {
  try {
    await set(fullKey(scope, key), value);
    return true;
  } catch {
    return false;
  }
}

export async function deleteValue(scope: AccountScope, key: StorageKey): Promise<boolean> {
  try {
    await del(fullKey(scope, key));
    return true;
  } catch {
    return false;
  }
}

/**
 * Removes everything belonging to one scope.
 *
 * USED ONLY WHERE THE STUDENT ASKED FOR IT — signing out is not one of those
 * places (M9 §36). It exists for "remove my data from this device", which is a
 * separate, deliberate act with its own confirmation.
 */
export async function clearScope(scope: AccountScope): Promise<boolean> {
  try {
    const prefix = scopePrefix(scope);
    const all = await keys();
    await Promise.all(
      all
        .filter((key): key is string => typeof key === 'string' && key.startsWith(prefix))
        .map((key) => del(key)),
    );
    return true;
  } catch {
    return false;
  }
}

/** True when a scope holds anything at all. Drives the first-sync offer. */
export async function scopeHasData(scope: AccountScope): Promise<boolean> {
  try {
    const prefix = scopePrefix(scope);
    const all = await keys();
    return all.some((key) => typeof key === 'string' && key.startsWith(prefix));
  } catch {
    return false;
  }
}

/* -------------------------------------------------------------------------- */
/* Legacy account data (CLERK-PRE-PRODUCTION-VERIFICATION)                     */
/* -------------------------------------------------------------------------- */

/** A Supabase-era subject. Clerk ids are `user_…`, so the two never collide. */
const LEGACY_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Per-device bookkeeping that belongs to the OLD account's cloud state, never copied. */
const NOT_COPIED = new Set(['syncState', 'remoteSnapshots']);

/** Keys that say nothing about whether a scope holds a student's records. */
const NOT_RECORDS = new Set([
  'syncState',
  'remoteSnapshots',
  'schemaVersion',
  'notificationState',
  'notificationPreferences',
]);

const isEmptyValue = (value: unknown): boolean =>
  value === null ||
  value === undefined ||
  (Array.isArray(value) && value.length === 0) ||
  (typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0);

async function entriesOf(scope: AccountScope): Promise<[string, unknown][]> {
  const prefix = scopePrefix(scope);
  const owned = (await keys()).filter(
    (key): key is string => typeof key === 'string' && key.startsWith(prefix),
  );
  return Promise.all(
    owned.map(async (key) => [key.slice(prefix.length), await get(key)] as [string, unknown]),
  );
}

/**
 * True when a scope holds a student's records. Opening a page on a fresh
 * account writes empty placeholders (an empty ledger, a schema version); those
 * are not records.
 */
export async function scopeHoldsRecords(scope: AccountScope): Promise<boolean> {
  try {
    return (await entriesOf(scope)).some(
      ([key, value]) => !NOT_RECORDS.has(key) && !isEmptyValue(value),
    );
  } catch {
    return false;
  }
}

/**
 * Supabase-era account scopes on this device, other than `current`, that hold
 * records. After the Clerk cutover the same student signs in under a NEW id,
 * so their old records are here but under a scope nothing reads any more.
 */
export async function legacyScopesWithRecords(current: string): Promise<string[]> {
  try {
    const ids = new Set<string>();
    for (const key of await keys()) {
      if (typeof key !== 'string' || !key.startsWith(`${PREFIX}u:`)) continue;
      const id = key.slice(`${PREFIX}u:`.length).split(':')[0] ?? '';
      if (id !== current && LEGACY_ID.test(id)) ids.add(id);
    }
    const found: string[] = [];
    for (const id of ids) if (await scopeHoldsRecords(id)) found.push(id);
    return found;
  } catch {
    return [];
  }
}

/**
 * COPIES a legacy scope's records into an account scope that holds none.
 *
 * - A copy, never a move: the legacy scope is untouched, so nothing can be
 *   lost here. Removing it is a separate, confirmed act (`clearScope`).
 * - Refused when the target already holds records: there is no merge, so
 *   nothing of the new account can be overwritten.
 * - The old account's sync bookkeeping is NOT copied, so the next sync treats
 *   every copied record as new and uploads it to the new account.
 * - The legacy `schemaVersion` IS copied (or the target's removed), so
 *   pre-ledger data still runs its upgrade instead of being misread.
 * - All or nothing: on any failure the target is restored to what it was.
 */
export async function copyLegacyScope(from: string, to: string): Promise<number> {
  if (!LEGACY_ID.test(from) || from === to) throw new Error('Not a legacy account scope.');
  if (await scopeHoldsRecords(to)) throw new Error('This account already holds records.');

  const before = await entriesOf(to);
  const source = (await entriesOf(from)).filter(([key]) => !NOT_COPIED.has(key));
  const target = scopePrefix(to);
  try {
    if (!source.some(([key]) => key === 'schemaVersion')) await del(`${target}schemaVersion`);
    for (const [key, value] of source) await set(`${target}${key}`, value);
    return source.length;
  } catch (error) {
    await clearScope(to);
    for (const [key, value] of before) await set(`${target}${key}`, value);
    throw error;
  }
}

/** True when browser storage is usable. Drives the ephemeral-mode banner. */
export async function isStorageAvailable(): Promise<boolean> {
  try {
    await set(`${PREFIX}__probe`, 1);
    await del(`${PREFIX}__probe`);
    return true;
  } catch {
    return false;
  }
}
