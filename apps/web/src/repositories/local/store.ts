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
  /** Sync bookkeeping: the cursor and the pending queue (M9 §40). */
  | 'syncState';

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
 * The auth user id goes in verbatim. It is a uuid from a verified token, never
 * anything a student typed, so it cannot contain a separator that would let one
 * scope read another's keys.
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
