/**
 * The client's copy of the cloud's column allowlist must match the server's.
 *
 * useSync.ts sends only `SYNCED_FIELDS`; the server stores only
 * services/api/src/student/store.ts `COLLECTION_TABLES`. If they drift, a field
 * either never reaches the cloud or is pushed, dropped, and makes the record's
 * fingerprint disagree with the cloud forever (OQ-060). The expectation below
 * is that server list, written out by hand: change it only alongside store.ts.
 */

import { describe, expect, it } from 'vitest';
import { SYNCED_FIELDS } from '../src/features/auth/useSync.js';

/** store.ts COLLECTION_TABLES columns, excluding `resultSubjects` (sent by `subjectToRecord`). */
const SERVER_COLUMNS = {
  semesters: ['number', 'status', 'started_on', 'completed_on'],
  semesterSubjects: ['semester', 'code', 'title', 'credits', 'notes'],
  results: ['semester', 'scheme_id', 'rule_set_id', 'sgpa_asserted'],
  attendance: ['semester', 'subject_code', 'subject_title', 'attended', 'conducted'],
  timetable: ['day', 'start_time', 'end_time', 'subject_code', 'activity', 'room', 'faculty'],
  backlogs: [
    'subject_code',
    'subject_title',
    'origin_semester',
    'status',
    'attempts',
    'cleared_in_semester',
  ],
};

/** The server's `toColumn`: `startedOn` -> `started_on`. */
const toColumn = (field: string): string => field.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);

describe('SYNCED_FIELDS', () => {
  it('is exactly the columns the server stores, per collection', () => {
    const asColumns = Object.fromEntries(
      Object.entries(SYNCED_FIELDS).map(([collection, fields]) => [
        collection,
        fields.map(toColumn),
      ]),
    );
    expect(asColumns).toEqual(SERVER_COLUMNS);
  });
});
