/**
 * Local backup and restore: this device's copy of one workspace, as a file.
 *
 * Authority: docs/51 (the contract) · M9 §36–§38
 *
 * The per-class attendance ledger and date-specific timetable changes never
 * leave the device, and a student who never signs in has no server copy of
 * anything. Without this, the device's IndexedDB is the only copy.
 *
 * The rules, in short (docs/51 has them in full): validate everything before
 * writing anything; restore only into the SAME owner's workspace; never
 * overwrite records, only fill an empty workspace; and write it all in ONE
 * IndexedDB transaction so a failure leaves nothing behind.
 */

import { findRecordProblem } from './backup-records.js';
import { SCHEMA_VERSION } from './upgrade.js';
import {
  readValue,
  scopeHoldsRecords,
  writeScopeAtomically,
  type AccountScope,
  type StorageKey,
} from './store.js';

export const BACKUP_FORMAT = 'gradtools-local-backup';
/**
 * 2 added the grade-card and later-attempt collections (docs/53). A version 1
 * file is still read: it simply holds neither, which is what it always meant.
 */
export const BACKUP_FORMAT_VERSION = 2;
const READABLE_FORMAT_VERSIONS: readonly number[] = [1, 2];

/**
 * Every storage key, and whether it belongs in a backup. A `Record` over
 * `StorageKey`, so a new key does not compile until this decision is made.
 *
 * - `list`: an array of records, each with a string `id`.
 * - `object`: a single record.
 * - `envelope`: carried as the envelope's own field, not as a collection.
 * - `excluded`: device or cloud bookkeeping that must never cross devices.
 */
const BACKUP_POLICY: Readonly<Record<StorageKey, 'list' | 'object' | 'envelope' | 'excluded'>> = {
  profile: 'object',
  attendance: 'list',
  results: 'list',
  timetable: 'list',
  semesters: 'list',
  semesterSubjects: 'list',
  backlogs: 'list',
  notificationState: 'list',
  notificationPreferences: 'object',
  calendars: 'list',
  timetableImports: 'list',
  classMarks: 'list',
  attendanceLedger: 'list',
  timetableOverrides: 'list',
  schemeCourses: 'list',
  examTimetables: 'list',
  examEvents: 'list',
  gradeCards: 'list',
  courseAttempts: 'list',
  schemaVersion: 'envelope',
  /* Another device's cloud state, and this device's sync cursor/queue. */
  remoteSnapshots: 'excluded',
  syncState: 'excluded',
  /* Unsent problem reports: not academic data. */
  supportQueue: 'excluded',
};

const COLLECTIONS = (Object.keys(BACKUP_POLICY) as StorageKey[]).filter(
  (key) => BACKUP_POLICY[key] === 'list' || BACKUP_POLICY[key] === 'object',
);

/** Removed from the target on restore, so the next sync starts from this data. */
const RESET_ON_RESTORE: readonly StorageKey[] = ['syncState', 'remoteSnapshots'];

export type BackupOwner =
  { readonly kind: 'anon' } | { readonly kind: 'account'; readonly tag: string };

export interface LocalBackup {
  readonly format: typeof BACKUP_FORMAT;
  readonly formatVersion: number;
  readonly exportedAt: string;
  readonly owner: BackupOwner;
  readonly schemaVersion: number;
  readonly collections: Readonly<Partial<Record<StorageKey, unknown>>>;
}

/**
 * Whose workspace this is, without the id itself. SHA-256 of the auth user id,
 * so a file can be matched to its account and cannot be restored into another.
 */
async function ownerOf(scope: AccountScope): Promise<BackupOwner> {
  if (scope === null) return { kind: 'anon' };
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(`gradtools-backup:${scope}`),
  );
  const tag = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
  return { kind: 'account', tag };
}

/** The current workspace's local data, on the allowlist only. */
export async function buildBackup(scope: AccountScope, now = new Date()): Promise<LocalBackup> {
  const collections: Partial<Record<StorageKey, unknown>> = {};
  for (const key of COLLECTIONS) {
    const value = await readValue<unknown>(scope, key);
    if (value !== null) collections[key] = value;
  }
  return {
    format: BACKUP_FORMAT,
    formatVersion: BACKUP_FORMAT_VERSION,
    exportedAt: now.toISOString(),
    owner: await ownerOf(scope),
    schemaVersion: (await readValue<number>(scope, 'schemaVersion')) ?? 0,
    collections,
  };
}

export class BackupError extends Error {}

/** What each collection is called on screen: the confirmation step and error messages. */
export const BACKUP_COLLECTION_LABEL: Readonly<Partial<Record<StorageKey, string>>> = {
  profile: 'Profile',
  semesters: 'Semesters',
  semesterSubjects: 'Semester subjects',
  results: 'Results',
  backlogs: 'Backlogs',
  timetable: 'Weekly timetable',
  attendance: 'Attendance totals',
  attendanceLedger: 'Per-class attendance',
  timetableOverrides: 'Date-specific timetable changes',
  calendars: 'Academic calendars',
  timetableImports: 'Timetable imports',
  examTimetables: 'Exam timetables',
  examEvents: 'Exam dates',
  gradeCards: 'Grade-card SGPAs',
  courseAttempts: 'Later attempts',
  schemeCourses: 'Scheme courses',
  classMarks: 'Older attendance marks',
  notificationState: 'Announcement read state',
  notificationPreferences: 'Notification settings',
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Parses and validates a backup file's text. Throws `BackupError` with a message
 * a student can act on; writes nothing.
 */
export function parseBackup(text: string): LocalBackup {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new BackupError('This file is not a GradTools backup (it is not valid JSON).');
  }
  if (!isRecord(data) || data.format !== BACKUP_FORMAT) {
    throw new BackupError('This file is not a GradTools backup.');
  }
  if (
    typeof data.formatVersion !== 'number' ||
    !READABLE_FORMAT_VERSIONS.includes(data.formatVersion)
  ) {
    throw new BackupError(
      'This backup was made by a different version of GradTools and cannot be read here.',
    );
  }
  const { schemaVersion, owner, collections, exportedAt } = data;
  if (typeof schemaVersion !== 'number' || !Number.isInteger(schemaVersion) || schemaVersion < 0) {
    throw new BackupError('This backup is damaged (its data version is missing).');
  }
  if (schemaVersion > SCHEMA_VERSION) {
    throw new BackupError(
      'This backup was made by a newer version of GradTools. Update GradTools, then restore it.',
    );
  }
  if (typeof exportedAt !== 'string') throw new BackupError('This backup is damaged.');
  const validOwner =
    isRecord(owner) &&
    (owner.kind === 'anon' ||
      (owner.kind === 'account' &&
        typeof owner.tag === 'string' &&
        /^[0-9a-f]{64}$/.test(owner.tag)));
  if (!validOwner) throw new BackupError('This backup is damaged (it does not say whose it is).');
  if (!isRecord(collections))
    throw new BackupError('This backup is damaged (it holds no records).');

  for (const [key, value] of Object.entries(collections)) {
    const policy = (BACKUP_POLICY as Record<string, string | undefined>)[key];
    const shapeOk =
      policy === 'object'
        ? isRecord(value)
        : policy === 'list'
          ? Array.isArray(value) &&
            value.every((item) => isRecord(item) && typeof item.id === 'string')
          : false;
    if (!shapeOk)
      throw new BackupError('This backup is damaged and was not restored. Nothing was changed.');
  }

  /* Every record against its collection's contract, before anything is written. */
  const found = findRecordProblem(collections);
  if (found !== null) {
    const where =
      found.position === null
        ? BACKUP_COLLECTION_LABEL[found.collection]
        : `${BACKUP_COLLECTION_LABEL[found.collection]}, entry ${String(found.position)}`;
    throw new BackupError(
      `This backup was not restored because a record is damaged (${where}: ${found.problem}). Nothing was changed.`,
    );
  }

  return data as unknown as LocalBackup;
}

/** Record counts per collection, for the confirmation step. */
export function summarizeBackup(backup: LocalBackup): Partial<Record<StorageKey, number>> {
  const counts: Partial<Record<StorageKey, number>> = {};
  for (const [key, value] of Object.entries(backup.collections) as [StorageKey, unknown][]) {
    counts[key] = Array.isArray(value) ? value.length : 1;
  }
  return counts;
}

/**
 * Restores a validated backup into `scope`, all or nothing.
 *
 * Refused (a `BackupError`, nothing written) when the backup belongs to another
 * owner, or when the workspace already holds records: a restore fills an empty
 * workspace and never overwrites one.
 */
export async function restoreBackup(scope: AccountScope, backup: LocalBackup): Promise<void> {
  const owner = await ownerOf(scope);
  if (backup.owner.kind !== owner.kind) {
    throw new BackupError(
      backup.owner.kind === 'anon'
        ? 'This backup is from GradTools used without an account. Sign out to restore it.'
        : 'This backup belongs to an account. Sign in to that account to restore it.',
    );
  }
  if (
    backup.owner.kind === 'account' &&
    owner.kind === 'account' &&
    backup.owner.tag !== owner.tag
  ) {
    throw new BackupError(
      'This backup belongs to a different account, so it cannot be restored here.',
    );
  }
  if (await scopeHoldsRecords(scope)) {
    throw new BackupError(
      'GradTools already holds records here. Restoring never overwrites them, so nothing was changed.',
    );
  }

  const writes: [StorageKey, unknown][] = Object.entries(backup.collections) as [
    StorageKey,
    unknown,
  ][];
  // An older backup with no version keeps none, so the v0 -> v1 upgrade runs on first read.
  if (backup.schemaVersion > 0) writes.push(['schemaVersion', backup.schemaVersion]);
  await writeScopeAtomically(scope, [...COLLECTIONS, ...RESET_ON_RESTORE, 'schemaVersion'], writes);
}
