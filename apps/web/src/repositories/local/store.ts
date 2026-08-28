/**
 * Browser storage adapter.
 *
 * Authority: docs/33 §33.3, docs/12 (student data stays on the device)
 *
 * The ONLY module in the app permitted to touch browser storage. Components
 * and hooks go through repositories; nothing calls idb-keyval or localStorage
 * directly (M3 continuation §21).
 *
 * IndexedDB via idb-keyval rather than localStorage because it is async (so
 * the repository boundary is honest, see ../types.ts), structured-clone based
 * (no JSON round-tripping), and not capped at ~5 MB.
 */

import { del, get, set } from 'idb-keyval';

/** Namespaced so a future multi-profile or account mode cannot collide. */
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
  | 'notificationPreferences';

function fullKey(key: StorageKey): string {
  return `${PREFIX}${key}`;
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
export async function readValue<T>(key: StorageKey): Promise<T | null> {
  try {
    const value = await get<T>(fullKey(key));
    return value ?? null;
  } catch {
    return null;
  }
}

/** Returns false when the write could not be persisted, so callers can warn. */
export async function writeValue<T>(key: StorageKey, value: T): Promise<boolean> {
  try {
    await set(fullKey(key), value);
    return true;
  } catch {
    return false;
  }
}

export async function deleteValue(key: StorageKey): Promise<boolean> {
  try {
    await del(fullKey(key));
    return true;
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
