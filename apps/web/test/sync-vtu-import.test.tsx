/**
 * An imported result's provenance is local-only, and sync still settles.
 *
 * `SemesterResult.source` (where the result came from: a saved VTU result
 * page, the session the student named, the parser version) is NOT a synced
 * column. The cloud never stores it, so it must stay out of the pushed payload
 * and the fingerprint — or every sync would re-push the result and the first
 * pull would conflict with itself (OQ-060) — and a pull must keep it rather
 * than replace the local record with the cloud's columns.
 *
 * The fake cloud keeps what the real one keeps (services/api/src/student/
 * store.ts): only allowlisted columns, pulls after a cursor, and a push refused
 * as a conflict when its base revision is stale. Every value is synthetic.
 */

import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { useSync } from '../src/features/auth/useSync.js';
import { useAuth } from '../src/features/auth/AuthContext.js';
import { AuthContextValueProvider } from './helpers/auth-harness.js';
import { RepositoryProvider } from '../src/repositories/context.js';
import { createLocalRepositories } from '../src/repositories/local/index.js';
import { deleteValue, readValue, writeValue } from '../src/repositories/local/store.js';
import { normalizeResultSubject } from '../src/domain/results.js';
import { asStudentProfileId } from '../src/domain/identity.js';
import type { SyncState } from '../src/domain/auth.js';
import type { SemesterResult } from '../src/domain/types.js';

const SCOPE = 'bbbbbbbb-4444-4000-8000-00000000000b';

const ALLOWED: Record<string, readonly string[]> = {
  results: ['semester', 'schemeId', 'ruleSetId', 'sgpaAsserted'],
  resultSubjects: [
    'resultId',
    'subjectCode',
    'subjectTitle',
    'internal',
    'external',
    'total',
    'resultStatus',
    'announcedOn',
    'gradeLetter',
    'gradePoint',
    'credits',
    'hasSee',
    'provenance',
    'catalogueCode',
    'ordinal',
  ],
};

interface Row {
  id: string;
  collection: string;
  revision: number;
  updatedAt: string;
  deletedAt: string | null;
  data: Record<string, unknown>;
}

interface Pushed {
  id: string;
  collection: string;
  deleted: boolean;
  baseRevision: number | null;
  data: Record<string, unknown>;
}

function cloud() {
  const rows = new Map<string, Row>();
  const pushed: Pushed[] = [];
  let clock = Date.parse('2026-09-01T00:00:00.000Z');
  const tick = (): string => new Date((clock += 1000)).toISOString();
  const keep = (collection: string, data: Record<string, unknown>) =>
    Object.fromEntries((ALLOWED[collection] ?? []).map((key) => [key, data[key] ?? null]));

  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const ok = (body: unknown) =>
        Promise.resolve({ ok: true, json: () => Promise.resolve(body) } as Response);
      if (!url.includes('/me/sync')) return ok({});

      if (init?.method === 'POST') {
        const body = JSON.parse(String(init.body)) as { records: Pushed[] };
        pushed.push(...body.records);
        const outcomes = body.records.map((record) => {
          const previous = rows.get(record.id);
          const echo = (row: Row) => ({
            revision: row.revision,
            data: row.data,
            deletedAt: row.deletedAt,
          });
          if (
            previous === undefined
              ? record.baseRevision !== null
              : record.baseRevision !== previous.revision
          ) {
            return {
              id: record.id,
              collection: record.collection,
              status: 'conflict',
              reason: 'This record changed on another device.',
              server: previous === undefined ? null : echo(previous),
            };
          }
          const row: Row = {
            id: record.id,
            collection: record.collection,
            revision: (previous?.revision ?? 0) + 1,
            updatedAt: tick(),
            deletedAt: record.deleted ? new Date(clock).toISOString() : null,
            data: record.deleted ? (previous?.data ?? {}) : keep(record.collection, record.data),
          };
          rows.set(record.id, row);
          return {
            id: record.id,
            collection: record.collection,
            status: 'applied',
            reason: null,
            server: record.deleted ? null : echo(row),
          };
        });
        return ok({ outcomes });
      }

      const since = new URL(url, 'http://test.invalid').searchParams.get('since');
      const records = [...rows.values()]
        .filter((row) => since === null || row.updatedAt > since)
        .sort((a, b) => (a.updatedAt + a.id).localeCompare(b.updatedAt + b.id));
      return ok({ records, syncedAt: tick() });
    }),
  );

  return {
    pushed,
    /** Another device changes a synced column of the result. */
    write(id: string, collection: string, data: Record<string, unknown>) {
      const previous = rows.get(id);
      rows.set(id, {
        id,
        collection,
        revision: (previous?.revision ?? 0) + 1,
        updatedAt: tick(),
        deletedAt: null,
        data: keep(collection, { ...previous?.data, ...data }),
      });
    },
  };
}

const SOURCE = {
  kind: 'vtu-result-page',
  sessionId: 'synthetic-session',
  importedAt: '2026-09-01T00:00:00.000Z',
  parserVersion: 'vtu-result-card/1',
} as const;

const IMPORTED: SemesterResult = {
  id: 'imported-4',
  profileId: asStudentProfileId('22222222-2222-2222-2222-222222222222'),
  semester: 4,
  schemeId: 'vtu-2022',
  ruleSetId: 'vtu-2022-r1',
  sgpaAsserted: null,
  subjects: [
    normalizeResultSubject({
      id: 'sub-1',
      subjectCode: 'BQAS401',
      subjectTitle: 'ALGORITHMS',
      internal: 44,
      external: 36,
      total: 80,
      resultStatus: 'P',
      announcedOn: '2026-07-23',
      provenance: 'manual',
    }),
  ],
  source: SOURCE,
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z',
};

async function sync(): Promise<SyncState> {
  const repositories = createLocalRepositories(SCOPE);
  const Wrapper = ({ children }: { readonly children: ReactNode }) => (
    <AuthContextValueProvider signedIn>
      <RepositoryProvider repositories={repositories}>{children}</RepositoryProvider>
    </AuthContextValueProvider>
  );
  const { result, unmount } = renderHook(
    () => ({ auth: useAuth().state.status, sync: useSync() }),
    { wrapper: Wrapper },
  );
  await waitFor(() => {
    expect(result.current.auth).toBe('signed_in');
  });
  await act(async () => {
    await result.current.sync.syncNow();
  });
  const state = result.current.sync.state;
  unmount();
  return state;
}

async function localResult(): Promise<SemesterResult | undefined> {
  return (await createLocalRepositories(SCOPE).results.list())[0];
}

beforeEach(async () => {
  await writeValue(SCOPE, 'results', [IMPORTED]);
  await writeValue(SCOPE, 'timetable', []);
  await writeValue(SCOPE, 'schemaVersion', 1);
  await deleteValue(SCOPE, 'syncState');
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('a result imported from a VTU result page', () => {
  it('never sends its provenance, and settles: no re-push, no self-conflict', async () => {
    const server = cloud();

    const statuses = [(await sync()).status];
    const afterFirst = server.pushed.length;
    statuses.push((await sync()).status, (await sync()).status);

    expect(statuses).toEqual(['synced', 'synced', 'synced']);
    expect(afterFirst).toBeGreaterThan(0);
    expect(server.pushed).toHaveLength(afterFirst);
    for (const record of server.pushed) expect(record.data).not.toHaveProperty('source');
    expect((await localResult())?.source).toEqual(SOURCE);
  });

  it('keeps its provenance when a pull changes the result from another device', async () => {
    const server = cloud();
    await sync();

    server.write('imported-4', 'results', { sgpaAsserted: 8.5 });
    const pulled = await sync();
    const pushedAfterPull = server.pushed.length;
    const again = await sync();

    expect([pulled.status, again.status]).toEqual(['synced', 'synced']);
    expect(server.pushed).toHaveLength(pushedAfterPull);
    const result = await localResult();
    expect(result?.sgpaAsserted).toBe(8.5);
    expect(result?.source).toEqual(SOURCE);
    expect(result?.subjects).toHaveLength(1);
    expect(await readValue(SCOPE, 'results')).toHaveLength(1);
  });
});
