/**
 * Local backup and restore (docs/51).
 *
 * A REAL IndexedDB (fake-indexeddb), because what is under test is which keys
 * the data lands under, and that a failed restore leaves none behind. Synthetic
 * records only.
 */
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { clear, delMany, entries } from 'idb-keyval';
import {
  BackupError,
  buildBackup,
  parseBackup,
  restoreBackup,
  type LocalBackup,
} from '../src/repositories/local/backup.js';
import {
  readValue,
  scopePrefix,
  storagePersistence,
  writeValue,
  type AccountScope,
  type StorageKey,
} from '../src/repositories/local/store.js';
import { LocalBackupCard } from '../src/features/auth/LocalBackupCard.js';
import { AuthContextValueProvider } from './helpers/auth-harness.js';
import { createLocalRepositories } from '../src/repositories/local/index.js';

const T = '2026-10-20T09:00:00.000Z';
const PROFILE_ID = 'profile-1';

/**
 * One synthetic record per backed-up collection, shaped as the app's own writers
 * shape them (AttendancePage, ResultEditor, DateView, useMarkClass, the v1
 * upgrade, ExamReview) so the record contracts are exercised for real.
 */
const DATA: Readonly<Partial<Record<StorageKey, unknown>>> = {
  gradeCards: [
    {
      id: 'gc-1',
      profileId: 'local',
      semester: 1,
      sgpa: 8.43,
      creditsRegistered: 20,
      creditsEarned: 20,
      updatedAt: T,
    },
  ],
  courseAttempts: [
    {
      id: 'att-1-later',
      profileId: PROFILE_ID,
      semester: 3,
      subjectCode: 'BCS301',
      kind: 'makeup',
      session: 'Summer / Makeup - 2026',
      external: 30,
      total: 70,
      resultStatus: 'P',
      recordedAt: T,
    },
  ],
  profile: {
    id: PROFILE_ID,
    authUserId: null,
    displayName: 'Synthetic Student',
    usn: null,
    collegeName: null,
    schemeId: 'vtu-2022',
    programme: 'B.E.',
    branch: 'CSBS',
    currentSemester: 4,
    createdAt: T,
    updatedAt: T,
  },
  attendance: [
    {
      id: 'att-1',
      profileId: 'local', // AttendancePage writes the literal 'local', not the profile id
      semester: 4,
      subjectCode: 'BCS401',
      subjectTitle: 'Analysis & Design of Algorithms',
      attended: 10,
      conducted: 12,
      updatedAt: T,
    },
  ],
  results: [
    {
      id: 'res-1',
      profileId: PROFILE_ID,
      semester: 4,
      schemeId: 'vtu-2022',
      ruleSetId: 'vtu-2022-v1',
      sgpaAsserted: null,
      subjects: [
        {
          id: 'rs-1',
          subjectCode: 'BCS401',
          subjectTitle: 'Analysis & Design of Algorithms',
          internal: 40,
          external: 35,
          total: 75,
          resultStatus: 'P',
          announcedOn: '2026-08-01',
          gradeLetter: null,
          gradePoint: null,
          credits: 4,
          hasSee: true,
          provenance: 'catalogue',
          catalogueCode: 'BCS401',
        },
      ],
      source: { kind: 'document', sessionId: null, importedAt: T, parserVersion: '1' },
      createdAt: T,
      updatedAt: T,
    },
  ],
  timetable: [
    {
      id: 'slot-1',
      profileId: PROFILE_ID,
      classId: 'class-1',
      day: 'Mon',
      startTime: '09:00',
      endTime: '10:00',
      subjectCode: 'BCS401',
      activity: null,
      room: null,
      faculty: null,
      kind: 'course',
    },
  ],
  semesters: [
    {
      id: 'sem-4',
      profileId: PROFILE_ID,
      number: 4,
      status: 'in_progress',
      startedOn: null,
      completedOn: null,
      updatedAt: T,
    },
  ],
  semesterSubjects: [
    {
      id: 'sub-1',
      profileId: PROFILE_ID,
      semester: 4,
      code: 'BCS401',
      title: 'Analysis & Design of Algorithms',
      credits: 4,
      notes: null,
      updatedAt: T,
    },
  ],
  backlogs: [
    {
      id: 'bl-1',
      profileId: PROFILE_ID,
      subjectCode: 'BCS301',
      subjectTitle: 'Mathematics for CS',
      originSemester: 3,
      status: 'active',
      attempts: 0,
      clearedInSemester: null,
      updatedAt: T,
    },
  ],
  notificationState: [{ id: 'ann-1', state: 'read', seenVersion: T, updatedAt: T }],
  notificationPreferences: { muted: ['results'] },
  calendars: [
    {
      id: 'cal-1',
      semester: 4,
      academicYear: '2026-27',
      events: [
        {
          id: 'ev-1',
          startDate: '2026-09-07',
          endDate: null,
          title: 'Examinations commence',
          category: 'EXAM_PERIOD',
          sourceLine: 'Examinations commence 07.09.2026',
          page: 1,
        },
      ],
      fingerprint: 'fp-cal',
      importedAt: T,
      sourceKind: 'ocr',
    },
  ],
  timetableImports: [
    {
      id: 'imp-1',
      className: 'IV CSBS',
      semester: 4,
      academicYear: '2026-27',
      revision: 'R1',
      effectiveFrom: null,
      batch: null,
      fingerprint: 'fp-tt',
      importedAt: T,
      slotCount: 1,
    },
  ],
  classMarks: [
    {
      id: '2026-10-01:slot-1',
      date: '2026-10-01',
      slotId: 'slot-1',
      subjectCode: 'BCS401',
      outcome: 'attended',
      markedAt: T,
    },
  ],
  attendanceLedger: [
    {
      kind: 'opening',
      id: 'opening:BCS401',
      subjectCode: 'BCS401',
      attended: 8,
      conducted: 10,
      migratedFrom: { attended: 8, conducted: 10 },
      reconciliation: 'exact',
      unreconciledMarks: [],
      createdAt: T,
    },
    {
      kind: 'occurrence',
      id: '2026-10-20:class-1',
      classId: 'class-1',
      date: '2026-10-20',
      subjectCode: 'BCS401',
      subjectTitle: null,
      startTime: '09:00',
      endTime: '10:00',
      outcome: 'attended',
      markedAt: T,
    },
  ],
  timetableOverrides: [
    {
      id: '2026-10-22:class-1',
      profileId: PROFILE_ID,
      date: '2026-10-22',
      classId: 'class-1',
      status: 'cancelled',
      addition: null,
      replacedBy: null,
      createdAt: T,
    },
  ],
  schemeCourses: [
    {
      id: 'sc-1',
      profileId: PROFILE_ID,
      schemeYear: '2022',
      programme: null,
      semester: 4,
      code: 'BCS401',
      title: 'Analysis & Design of Algorithms',
      credits: 4,
      sourcePage: 3,
      updatedAt: T,
    },
  ],
  examTimetables: [
    {
      id: 'et-1',
      profileId: PROFILE_ID,
      examCycle: 'Dec 2026',
      publicationState: null,
      notification: null,
      fingerprint: 'fp-exam',
      fileName: null,
      importedAt: T,
      eventCount: 1,
    },
  ],
  examEvents: [
    {
      id: 'ee-1',
      profileId: PROFILE_ID,
      timetableId: 'et-1',
      examDate: '2026-12-01',
      weekday: 'Tue',
      session: null,
      startTime: null,
      endTime: null,
      scheme: '2022',
      semester: 4,
      printed: 'BCS401',
      kind: 'code',
      codes: ['BCS401'],
    },
  ],
};

async function seed(scope: AccountScope, schemaVersion = 1): Promise<void> {
  for (const [key, value] of Object.entries(DATA))
    await writeValue(scope, key as StorageKey, value);
  await writeValue(scope, 'schemaVersion', schemaVersion);
  await writeValue(scope, 'syncState', { cursor: 'sync-cursor-7f3', pending: [] });
  await writeValue(scope, 'remoteSnapshots', [{ id: 'snap-1' }]);
  await writeValue(scope, 'supportQueue', [{ id: 'sup-1', category: 'bug' }]);
}

/** Every raw key/value in one scope, for "unchanged" comparisons. */
async function dump(scope: AccountScope): Promise<Record<string, unknown>> {
  const prefix = scopePrefix(scope);
  const all = (await entries()) as [string, unknown][];
  return Object.fromEntries(all.filter(([key]) => key.startsWith(prefix)));
}

/** What a student's file actually is: JSON text, parsed back. */
async function exportAsFile(scope: AccountScope): Promise<LocalBackup> {
  return parseBackup(JSON.stringify(await buildBackup(scope)));
}

beforeEach(async () => {
  await clear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('export → wipe → restore', () => {
  it('restores every backed-up collection exactly, including per-class attendance and date overrides', async () => {
    await seed(null);
    const file = await exportAsFile(null);
    await clear();

    await restoreBackup(null, file);

    for (const [key, value] of Object.entries(DATA)) {
      expect(await readValue(null, key as StorageKey), key).toEqual(value);
    }
    expect(await readValue(null, 'attendanceLedger')).toHaveLength(2);
    expect(await readValue(null, 'timetableOverrides')).toEqual(DATA.timetableOverrides);
    expect(await readValue(null, 'schemaVersion')).toBe(1);
  });

  it('round-trips an account workspace into the same account', async () => {
    await seed('user_a');
    const file = await exportAsFile('user_a');
    await clear();

    await restoreBackup('user_a', file);
    expect(await readValue('user_a', 'attendanceLedger')).toEqual(DATA.attendanceLedger);
  });

  it('never touches another account or the signed-out workspace', async () => {
    await seed(null);
    await seed('user_b');
    const anonFile = await exportAsFile(null);
    const before = await dump('user_b');
    // Empty the signed-out workspace only, then restore it.
    await delMany(Object.keys(await dump(null)));

    await restoreBackup(null, anonFile);
    expect(await dump('user_b')).toEqual(before);
  });
});

describe('what the file contains', () => {
  it('leaves out sync bookkeeping, remote snapshots, the support queue and the raw account id', async () => {
    await seed('user_a');
    const text = JSON.stringify(await buildBackup('user_a'));
    const backup = JSON.parse(text) as LocalBackup;

    expect(Object.keys(backup.collections)).not.toContain('syncState');
    expect(Object.keys(backup.collections)).not.toContain('remoteSnapshots');
    expect(Object.keys(backup.collections)).not.toContain('supportQueue');
    expect(Object.keys(backup.collections)).not.toContain('schemaVersion');
    expect(text).not.toContain('user_a');
    expect(text).not.toContain('sync-cursor-7f3');
    expect(backup.owner).toEqual({ kind: 'account', tag: expect.stringMatching(/^[0-9a-f]{64}$/) });
  });

  it('starts sync bookkeeping afresh after a restore', async () => {
    await seed(null);
    const file = await exportAsFile(null);
    await clear();
    await writeValue(null, 'syncState', { cursor: 'stale', pending: [] }); // bookkeeping only, not a record

    await restoreBackup(null, file);
    expect(await readValue(null, 'syncState')).toBeNull();
    expect(await readValue(null, 'remoteSnapshots')).toBeNull();
  });

  it('a pre-ledger (schemaVersion 0) backup leaves no version, so the upgrade runs', async () => {
    await seed(null, 0);
    const file = await exportAsFile(null);
    expect(file.schemaVersion).toBe(0);
    await clear();
    await writeValue(null, 'schemaVersion', 1);

    await restoreBackup(null, file);
    expect(await readValue(null, 'schemaVersion')).toBeNull();
  });
});

describe('restore is refused, and nothing changes', () => {
  it('when the backup belongs to a different account', async () => {
    await seed('user_a');
    const file = await exportAsFile('user_a');
    await expect(restoreBackup('user_b', file)).rejects.toThrow(/different account/);
    expect(await dump('user_b')).toEqual({});
  });

  it('when an account backup meets the signed-out workspace, or the reverse', async () => {
    await seed('user_a');
    await seed(null);
    const accountFile = await exportAsFile('user_a');
    const anonFile = await exportAsFile(null);
    await clear();

    await expect(restoreBackup(null, accountFile)).rejects.toThrow(/Sign in to that account/);
    await expect(restoreBackup('user_a', anonFile)).rejects.toThrow(/Sign out to restore/);
    expect(await entries()).toEqual([]);
  });

  it('when the workspace already holds records: restore never overwrites', async () => {
    await seed(null);
    const file = await exportAsFile(null);
    await writeValue(null, 'results', [{ id: 'newer', total: 90 }]);
    const before = await dump(null);

    await expect(restoreBackup(null, file)).rejects.toThrow(/never overwrites/);
    expect(await dump(null)).toEqual(before);
  });

  it('as a whole when a write fails part-way: no collection is left behind', async () => {
    const valid = await buildBackup(null);
    const poisoned: LocalBackup = {
      ...valid,
      collections: {
        profile: { name: 'x' },
        results: [{ id: 'r', total: 1 }],
        // Not structured-cloneable: the put throws inside the transaction.
        examEvents: [{ id: 'bad', at: () => 0 }],
      },
    };

    await expect(restoreBackup(null, poisoned)).rejects.toThrow();
    expect(await entries()).toEqual([]);
  });
});

describe('parseBackup rejects what is not a valid backup', () => {
  const good = async () =>
    JSON.parse(JSON.stringify(await buildBackup(null))) as Record<string, unknown>;

  it.each([
    ['not JSON', async () => '{"format": "gradtools-local-backup", '],
    ['another format', async () => JSON.stringify({ ...(await good()), format: 'something-else' })],
    [
      'an unsupported format version',
      async () => JSON.stringify({ ...(await good()), formatVersion: 99 }),
    ],
    ['a newer data model', async () => JSON.stringify({ ...(await good()), schemaVersion: 99 })],
    ['no owner', async () => JSON.stringify({ ...(await good()), owner: null })],
    [
      'an unknown collection',
      async () => JSON.stringify({ ...(await good()), collections: { tokens: [] } }),
    ],
    [
      'an excluded collection',
      async () => JSON.stringify({ ...(await good()), collections: { syncState: {} } }),
    ],
    [
      'a record without an id',
      async () => JSON.stringify({ ...(await good()), collections: { results: [{ total: 1 }] } }),
    ],
    [
      'a list where one record is expected',
      async () => JSON.stringify({ ...(await good()), collections: { profile: [] } }),
    ],
  ])('%s', async (_label, text) => {
    const body = await text();
    expect(() => parseBackup(body)).toThrow(BackupError);
  });
});

describe('persistent storage', () => {
  it('asks once, after the first real record, and never for placeholders', async () => {
    vi.resetModules();
    const persist = vi.fn(async () => true);
    vi.stubGlobal('navigator', {
      ...navigator,
      storage: { persist, persisted: async () => false },
    });
    const store = await import('../src/repositories/local/store.js');

    await store.writeValue(null, 'attendanceLedger', []); // an empty placeholder
    await store.writeValue(null, 'schemaVersion', 1); // bookkeeping
    expect(persist).not.toHaveBeenCalled();

    await store.writeValue(null, 'results', [{ id: 'r' }]);
    await store.writeValue(null, 'results', [{ id: 'r' }, { id: 's' }]);
    await waitFor(() => expect(persist).toHaveBeenCalledTimes(1));
  });

  it('reports the browser’s actual answer, or unknown when it has none', async () => {
    vi.stubGlobal('navigator', { ...navigator, storage: undefined });
    expect(await storagePersistence()).toBe('unknown');
    vi.stubGlobal('navigator', { ...navigator, storage: { persisted: async () => true } });
    expect(await storagePersistence()).toBe('persistent');
    vi.stubGlobal('navigator', { ...navigator, storage: { persisted: async () => false } });
    expect(await storagePersistence()).toBe('best_effort');
  });
});

describe('LocalBackupCard', () => {
  function renderCard(onRestored = vi.fn()) {
    render(
      <MemoryRouter>
        <AuthContextValueProvider signedIn={false}>
          <LocalBackupCard onRestored={onRestored} />
        </AuthContextValueProvider>
      </MemoryRouter>,
    );
    return onRestored;
  }

  it('saves a backup file, then restores it into an empty workspace after confirmation', async () => {
    await seed(null);
    let saved = '';
    vi.spyOn(URL, 'createObjectURL').mockImplementation(() => 'blob:backup');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const RealBlob = Blob;
    vi.stubGlobal(
      'Blob',
      class extends RealBlob {
        constructor(parts: BlobPart[], options?: BlobPropertyBag) {
          super(parts, options);
          saved = String(parts[0]);
        }
      },
    );
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    const onRestored = renderCard();

    await userEvent.click(await screen.findByRole('button', { name: /save backup file/i }));
    await waitFor(() => expect(saved).toContain('gradtools-local-backup'));

    await clear();
    vi.unstubAllGlobals();
    const file = new File([saved], 'gradtools-backup.json', { type: 'application/json' });
    await userEvent.upload(screen.getByLabelText(/backup file to restore/i), file);

    expect(await screen.findByText(/Per-class attendance: 2/)).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: /^restore$/i }));

    await waitFor(() => expect(onRestored).toHaveBeenCalledTimes(1));
    expect(await readValue(null, 'attendanceLedger')).toEqual(DATA.attendanceLedger);
  });

  it('explains a file that is not a backup and writes nothing', async () => {
    renderCard();
    const file = new File(['not a backup'], 'notes.json', { type: 'application/json' });
    await userEvent.upload(await screen.findByLabelText(/backup file to restore/i), file);

    expect((await screen.findByRole('alert')).textContent).toMatch(/not a GradTools backup/);
    expect(await entries()).toEqual([]);
  });
});

/* -------------------------------------------------------------------------- */
/* Record-level validation (docs/51 "Record contracts")                       */
/* -------------------------------------------------------------------------- */

type Mutable = Record<string, unknown>;
type Collections = Record<string, unknown>;

/** A valid file's text, after `change` edits a deep copy of its collections. */
async function fileWith(change: (collections: Collections) => void): Promise<string> {
  await seed(null);
  const backup = JSON.parse(JSON.stringify(await buildBackup(null))) as {
    collections: Collections;
  };
  change(backup.collections);
  await clear();
  return JSON.stringify(backup);
}

const item = (list: unknown, index = 0): Mutable => (list as Mutable[])[index] as Mutable;

describe('every record is checked against its collection contract', () => {
  it.each<[string, (c: Collections) => void, RegExp]>([
    // A malformed NESTED record: the outer list passes, the subject inside does not.
    [
      'a result subject whose mark is text',
      (c) => {
        item(item(c.results).subjects).internal = 'forty';
      },
      /Results, entry 1: field “subjects” item 1 field “internal” is not a number/,
    ],
    [
      'a missing required field',
      (c) => {
        delete item(c.attendance).subjectCode;
      },
      /Attendance totals, entry 1: field “subjectCode” is not text/,
    ],
    [
      'a number stored as text',
      (c) => {
        item(c.semesters).number = '4';
      },
      /Semesters, entry 1: field “number” is not a whole number from 1 to 8/,
    ],
    [
      'a semester outside the degree',
      (c) => {
        item(c.backlogs).originSemester = 9;
      },
      /Backlogs, entry 1: field “originSemester”/,
    ],
    [
      'an unknown semester status',
      (c) => {
        item(c.semesters).status = 'done';
      },
      /field “status” is not one of planned, in_progress, completed/,
    ],
    [
      'an unknown override status',
      (c) => {
        item(c.timetableOverrides).status = 'postponed';
      },
      /Date-specific timetable changes, entry 1: field “status”/,
    ],
    [
      'an unknown ledger entry kind',
      (c) => {
        item(c.attendanceLedger).kind = 'mark';
      },
      /Per-class attendance, entry 1: is not an opening, occurrence or adjustment/,
    ],
    [
      'a weekday the timetable does not have',
      (c) => {
        item(c.timetable).day = 'Sun';
      },
      /Weekly timetable, entry 1: field “day”/,
    ],
    [
      'a muted category that does not exist',
      (c) => {
        (c.notificationPreferences as Mutable).muted = ['gossip'];
      },
      /Notification settings: field “muted” item 1/,
    ],
    [
      'a date in the wrong format',
      (c) => {
        const occurrence = item(c.attendanceLedger, 1);
        occurrence.date = '20-10-2026';
        occurrence.id = '20-10-2026:class-1';
      },
      /Per-class attendance, entry 2: field “date” is not a date/,
    ],
    [
      'a time in the wrong format',
      (c) => {
        item(c.timetable).startTime = '9am';
      },
      /field “startTime” is not a time \(HH:MM\)/,
    ],
    [
      'a timestamp that is not one',
      (c) => {
        item(c.semesterSubjects).updatedAt = 'yesterday';
      },
      /Semester subjects, entry 1: field “updatedAt” is not a timestamp/,
    ],
    [
      'an empty identifier',
      (c) => {
        item(c.backlogs).id = '  ';
      },
      /Backlogs, entry 1: field “id” is not a valid identifier/,
    ],
    [
      'an occurrence whose id does not match its date and class',
      (c) => {
        item(c.attendanceLedger, 1).id = '2026-10-21:class-1';
      },
      /Per-class attendance, entry 2: has an id that does not match its date and class/,
    ],
    [
      'an opening balance whose id does not match its subject',
      (c) => {
        item(c.attendanceLedger).id = 'opening:BCS999';
      },
      /Per-class attendance, entry 1: has an id that does not match its subject/,
    ],
    [
      'a replaced class that names no replacement',
      (c) => {
        item(c.timetableOverrides).status = 'replaced';
      },
      /has a replacement that does not match its status/,
    ],
    [
      'an exam date belonging to no exam timetable in the file',
      (c) => {
        item(c.examEvents).timetableId = 'et-missing';
      },
      /Exam dates, entry 1: belongs to an exam timetable that is not in the file/,
    ],
    [
      'a grade card with more credits earned than registered',
      (c) => {
        item(c.gradeCards).creditsEarned = 21;
      },
      /Grade-card SGPAs, entry 1: has more credits earned than registered/,
    ],
    [
      'a later attempt of an unknown kind',
      (c) => {
        item(c.courseAttempts).kind = 'revaluation';
      },
      /Later attempts, entry 1: field “kind”/,
    ],
    [
      'two records with the same id',
      (c) => {
        (c.semesters as Mutable[]).push({ ...item(c.semesters) });
      },
      /Semesters, entry 2: repeats an id already in the file/,
    ],
  ])('rejects %s, and says where', async (_label, change, where) => {
    const text = await fileWith(change);
    expect(() => parseBackup(text)).toThrow(BackupError);
    expect(() => parseBackup(text)).toThrow(where);
    expect(() => parseBackup(text)).toThrow(/Nothing was changed/);
  });

  it('rejects the WHOLE file when one record among valid ones is bad, and changes nothing', async () => {
    const text = await fileWith((c) => {
      // Two valid ledger entries are already there; the third is malformed.
      (c.attendanceLedger as Mutable[]).push({
        kind: 'occurrence',
        id: '2026-10-23:class-1',
        classId: 'class-1',
      });
    });
    await writeValue(null, 'syncState', { cursor: 'before', pending: [] });
    const before = await entries();

    let refused: unknown = null;
    try {
      await restoreBackup(null, parseBackup(text));
    } catch (error) {
      refused = error;
    }
    expect(refused).toBeInstanceOf(BackupError);
    expect(await entries()).toEqual(before);
  });

  it('accepts what the app really writes, where the types alone would say otherwise', async () => {
    const text = await fileWith((c) => {
      // A status letter GradTools has never seen is stored as printed (types.ts).
      item(item(c.results).subjects).resultStatus = 'Z';
      // Record owners are often the literal 'local' (AttendancePage, useMarkClass).
      item(c.timetableOverrides).profileId = 'local';
    });
    await restoreBackup(null, parseBackup(text));
    const [result] = (await readValue<Mutable[]>(null, 'results')) ?? [];
    expect(item(result?.subjects).resultStatus).toBe('Z');
  });

  it('keeps fields this version does not read, rather than dropping them', async () => {
    const text = await fileWith((c) => {
      item(c.semesters).legacyNote = 'written by an older version';
    });
    await restoreBackup(null, parseBackup(text));
    expect(item(await readValue(null, 'semesters')).legacyNote).toBe('written by an older version');
  });
});

describe('a failed restore leaves no partial records and no deletions', () => {
  it('keeps the workspace bookkeeping when the transaction fails part-way', async () => {
    // Not records (scopeHoldsRecords is false), so a restore is allowed to start.
    await writeValue(null, 'syncState', { cursor: 'kept', pending: [] });
    await writeValue(null, 'schemaVersion', 1);
    await writeValue(null, 'attendanceLedger', []);
    const before = await entries();

    const valid = parseBackup(JSON.stringify(await buildBackup(null)));
    const poisoned = {
      ...valid,
      collections: { profile: DATA.profile, examEvents: [{ id: 'x', at: () => 0 }] },
    } as LocalBackup;

    await expect(restoreBackup(null, poisoned)).rejects.toThrow();
    expect(await entries()).toEqual(before); // nothing written, nothing deleted
  });
});

describe('older backups keep working', () => {
  const OLD = '2026-01-01T00:00:00.000Z';

  /** A pre-ledger device's data, shaped as the v0 app wrote it (storage-migration fixtures). */
  const LEGACY = {
    format: 'gradtools-local-backup',
    formatVersion: 1,
    exportedAt: '2026-09-01T00:00:00.000Z',
    owner: { kind: 'anon' },
    schemaVersion: 0,
    collections: {
      // A profile saved before the identity fields existed.
      profile: {
        id: 'p-old',
        authUserId: null,
        displayName: null,
        usn: null,
        collegeName: null,
        schemeId: 'vtu-2022',
        programme: null,
        branch: null,
        currentSemester: 3,
        createdAt: OLD,
        updatedAt: OLD,
      },
      attendance: [
        {
          id: 'record-BCS301',
          profileId: 'p-old',
          semester: 3,
          subjectCode: 'BCS301',
          subjectTitle: 'BCS301 title',
          attended: 5,
          conducted: 6,
          updatedAt: OLD,
        },
      ],
      // A slot from before classId and kind existed.
      timetable: [
        {
          id: 'slot-a',
          profileId: 'p-old',
          day: 'Wed',
          startTime: '09:00',
          endTime: '10:00',
          subjectCode: 'BCS301',
          activity: null,
          room: null,
          faculty: null,
        },
      ],
      classMarks: [
        {
          id: '2026-08-05:slot-a',
          date: '2026-08-05',
          slotId: 'slot-a',
          subjectCode: 'BCS301',
          outcome: 'attended',
          markedAt: '2026-08-05T09:55:00.000Z',
        },
      ],
      // A result from before the marks fields (OQ-049) and before `source`.
      results: [
        {
          id: 'res-old',
          profileId: 'p-old',
          semester: 2,
          schemeId: 'vtu-2022',
          ruleSetId: null,
          sgpaAsserted: 8.1,
          subjects: [
            {
              id: 's1',
              subjectCode: 'BMATS201',
              subjectTitle: 'Maths',
              credits: 4,
              gradeLetter: 'A',
            },
          ],
          createdAt: OLD,
          updatedAt: OLD,
        },
      ],
    },
  };

  it('restores a pre-ledger backup, then the established v0 → v1 upgrade migrates it', async () => {
    await restoreBackup(null, parseBackup(JSON.stringify(LEGACY)));
    expect(await readValue(null, 'schemaVersion')).toBeNull();

    // The first ledger read runs the existing upgrade (repositories/local/upgrade.ts).
    const ledger = await createLocalRepositories(null).attendanceLedger.list();
    expect(ledger.some((entry) => entry.kind === 'opening' && entry.subjectCode === 'BCS301')).toBe(
      true,
    );
    expect(await readValue(null, 'schemaVersion')).toBe(1);
    expect(await readValue(null, 'classMarks')).toBeNull(); // the upgrade consumes it

    // The legacy result still reads, normalised as every older result is.
    const [result] = await createLocalRepositories(null).results.list();
    expect(result?.subjects[0]?.internal).toBeNull();
  });
});
