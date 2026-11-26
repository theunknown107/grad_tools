# Local backup and restore

Authority: deep-scan report 2026-10-22 §C1/§J · review of that report · M9 §36–§38 (account-bound storage)

## Why

Some student data never leaves the device: the per-class attendance ledger and
date-specific timetable changes don't sync, and a student who never signs in
has no server copy of anything. "Download my data" (`GET /api/v1/me/export`)
returns only what the server holds, and only when signed in. Before this, the
device's IndexedDB was the only copy.

## Where each collection lives

Every key is `gradtools:v1:<scope>:<key>` in IndexedDB (idb-keyval's default
database). `<scope>` is `anon` (signed out) or `u:<auth user id>`.

| Key | What | Synced to server? | In the backup? |
|---|---|---|---|
| `profile` | Student profile | Yes (signed in) | Yes |
| `semesters`, `semesterSubjects`, `results`, `backlogs` | Academic records | Yes (signed in) | Yes |
| `timetable` | Weekly timetable | Yes (signed in) | Yes |
| `attendance` | Attendance totals per subject | Yes (signed in) | Yes |
| `attendanceLedger` | Per-class record: openings, occurrences, adjustments | **No** | Yes |
| `timetableOverrides` | What one date did to the week | **No** | Yes |
| `calendars`, `timetableImports`, `examTimetables`, `examEvents`, `schemeCourses` | Imported or entered records | Device | Yes |
| `notificationState`, `notificationPreferences` | Read state and preferences | Device | Yes |
| `classMarks` | Legacy pre-ledger marks, read once by the v0→v1 upgrade | Device | Yes, if present |
| `schemaVersion` | Which data model the scope is on | — | As the envelope's `schemaVersion`, not as a collection |
| `remoteSnapshots` | Synced aggregates seen and not adopted | — | **No**: another device's cloud state |
| `syncState` | Sync cursor and pending queue | — | **No**: per-device bookkeeping |
| `supportQueue` | Unsent problem reports | — | **No**: not academic data |

The table is enforced in code: `BACKUP_POLICY` in
`apps/web/src/repositories/local/backup.ts` is a `Record<StorageKey, …>`, so a
new storage key does not compile until someone decides whether it belongs in a
backup.

No authentication material is stored under these keys (Clerk keeps its session
in its own storage), so none can enter a backup.

## What a backup contains

The backup holds **this device's copy of the current workspace**, whether
signed in or not. It never contains:

- another workspace's data (another account, or the signed-out workspace when
  signed in);
- server-only records that were never pulled to this device;
- the sync cursor, pending queue, remote snapshots or support queue.

For a signed-in student, the server export and the local backup are different
things, and the Account page labels them differently.

```json
{
  "format": "gradtools-local-backup",
  "formatVersion": 1,
  "exportedAt": "2026-10-22T10:00:00.000Z",
  "owner": { "kind": "anon" },
  "schemaVersion": 1,
  "collections": { "profile": { … }, "attendanceLedger": [ … ], … }
}
```

`owner` is `{ "kind": "anon" }` or `{ "kind": "account", "tag": "<hex>" }`.
The tag is a SHA-256 of the auth user id, so the file can tell whose it is
without carrying the id itself. The file is **plain JSON**: anyone who has it
can read the records. The Account page says so.

## Restore rules

1. **Validate everything before writing anything.** The file is rejected if
   `format`/`formatVersion` are not recognised, if `schemaVersion` is newer than
   this build understands, if a collection is not on the allowlist, or if a
   collection has the wrong shape (an array of objects with a string `id`, or a
   single object for `profile`/`notificationPreferences`), or if **any record**
   breaks its collection's contract (below). One bad record rejects the whole
   file.
2. **Same owner only.** A signed-out backup restores only while signed out. An
   account backup restores only into the same account (tag match). Records can
   never cross into another person's workspace, and so can never sync into
   their account.
3. **Never overwrite.** Restore only fills a workspace that holds no records
   (the same test `copyLegacyScope` uses). If records exist, the restore is
   refused and nothing is replaced. There is no merge.
4. **All or nothing.** Every delete and write happens in one IndexedDB
   transaction. On any failure the transaction is aborted and the workspace is
   exactly as it was.
5. **Fresh sync state.** The target's `syncState` and `remoteSnapshots` are
   removed in the same transaction, so a later sync treats the restored records
   as this device's own (the `copyLegacyScope` precedent). Older
   `schemaVersion` data runs the existing v0→v1 upgrade on first read.
6. The page reloads after a restore, so every screen reads the restored data.

## Record contracts

`apps/web/src/repositories/local/backup-records.ts` holds one contract per
collection. Each was taken from what the app actually writes and reads (the
writers in `features/` and `hooks/`, the v1 upgrade, `normalizeResultSubject`),
not from the TypeScript types alone:

- **Required fields** must be present with the right type. **Nullable fields**
  may be null, the right type, or absent, because older versions did not write
  them. **Unlisted fields** are kept as they are, since an older version may
  have written a field this one no longer reads.
- **Checked where every writer guarantees them:** enums (semester and backlog
  status, weekday, slot kind, occurrence status, attendance outcome, calendar
  category, exam cell kind, notification state, muted announcement categories),
  ISO dates `YYYY-MM-DD`, 24-hour times `HH:MM`, parseable timestamps,
  semesters 1–8 for the student's own records, and non-empty ids.
- **Derived ids:** a ledger occurrence and a day override are
  `${date}:${classId}`, and an opening balance is `opening:${subjectCode}`. A
  `replaced` override names its replacement; no other status does.
- **Across the file:** ids are unique within a collection, and every exam event
  belongs to an exam timetable in the same file (nothing removes one alone).
- **Deliberately not checked**, because the app does not guarantee them:
  - a result's status and grade letters (stored as printed, including letters
    GradTools has never seen);
  - `profileId` matching the profile (writers often store the literal
    `'local'`);
  - a result row's mark totals and maxima (that is the editor's check, and it
    depends on the rule set);
  - occurrence `classId` resolving to a current slot (history outlives the
    weekly template).

The format has one version (1). An older *data model* (`schemaVersion` 0,
pre-ledger counters, `classMarks`, slots without `classId`, results without
marks fields) validates and restores, and the existing v0→v1 upgrade migrates
it on first read. No new migration is added.

**Known limit:** a signed-in student whose workspace has already synced on a new
device cannot restore into it, because it already holds records and restore
never overwrites. Combining a local backup with synced data is a sync-conflict
question, deferred together with per-class sync.

## Persistent storage

After the first real record is written, the app calls
`navigator.storage.persist()` once per session (if the API exists and storage
isn't already persistent). The browser decides whether to grant it. The Account
page shows the actual answer from `navigator.storage.persisted()` and never
promises permanence. Persistence is a protection, not a backup, so the backup
file is still recommended. Context: WebKit does not expect a Home Screen web
app's first-party data to be deleted, but a Safari tab is subject to its
seven-day rule. The Android app is a Capacitor WebView whose storage is
app-private and not OS-backed-up (`allowBackup="false"`), so uninstalling
removes it.
