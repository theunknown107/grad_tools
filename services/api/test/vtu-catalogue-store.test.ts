/**
 * Persisting the catalogue: identity, idempotency and applicability.
 *
 * Authority: Phase 7D.1 §3, §5, §6, §8, §9, §19, §36
 *
 * These need a real database, because what is under test is what the SCHEMA
 * enforces — a unique index over COALESCE, an `ON CONFLICT` target that
 * actually matches. A mocked `sql` would assert that the code sends the query
 * it sends.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import postgres from 'postgres';
import { runMigrations } from '../src/db/migrate.js';
import {
  upsertApplicability,
  upsertCourse,
  upsertDocumentVersion,
  upsertSourceReference,
  upsertStream,
} from '../src/sources/catalogue-store.js';

const URL = process.env['TEST_DATABASE_URL'];
const describeDb = URL === undefined ? describe.skip : describe;
const sql = URL === undefined ? null : postgres(URL, { max: 1 });

afterAll(async () => {
  await sql?.end();
});

const sha = (marker: string): string => marker.repeat(64).slice(0, 64);

const version = (marker: string) => ({
  sha256: sha(marker),
  byteSize: 1024,
  mimeType: 'application/pdf',
  pageCount: 4,
  retrievedAt: '2026-09-08T00:00:00.000Z',
  extractionMethod: 'pdfjs-text-layer',
  extractionStatus: 'text' as const,
  parserVersion: '1.0.0',
  normalizationVersion: '1.0.0',
});

const course = (over: Partial<Parameters<typeof upsertCourse>[1]> = {}) => ({
  schemeYear: '2022',
  programmeName: null,
  streamId: null,
  semester: 1,
  code: 'BQQ101',
  title: 'Invented Course',
  credits: 4,
  creditBasis: 'table' as const,
  relatedCode: null,
  category: null,
  sha256: sha('a'),
  sourcePage: 1,
  ...over,
});

describeDb('persisting the catalogue', () => {
  /* The suite's global setup drops the schema; each file builds what it needs. */
  beforeAll(async () => {
    if (sql !== null) await runMigrations(sql);
  });

  beforeEach(async () => {
    if (sql === null) return;
    await sql`TRUNCATE catalogue_courses, document_applicability,
      source_document_references, source_document_versions, academic_streams CASCADE`;
  });

  it('records a document version once, however often it is seen', async () => {
    if (sql === null) return;
    const first = await upsertDocumentVersion(sql, version('a'));
    const second = await upsertDocumentVersion(sql, version('a'));

    expect(first.inserted).toBe(true);
    expect(second.inserted).toBe(false);
    expect(second.id).toBe(first.id);
  });

  it('advances last_seen without moving first_seen', async () => {
    if (sql === null) return;
    await upsertDocumentVersion(sql, version('a'));
    const before = await sql<{ first_seen: Date; last_seen: Date }[]>`
      SELECT first_seen, last_seen FROM source_document_versions WHERE sha256 = ${sha('a')}`;
    await upsertDocumentVersion(sql, version('a'));
    const after = await sql<{ first_seen: Date; last_seen: Date }[]>`
      SELECT first_seen, last_seen FROM source_document_versions WHERE sha256 = ${sha('a')}`;

    expect(after[0]?.first_seen.getTime()).toBe(before[0]?.first_seen.getTime());
    expect(after[0]?.last_seen.getTime()).toBeGreaterThanOrEqual(
      before[0]?.last_seen.getTime() ?? 0,
    );
  });

  it('keeps many URLs against one document', async () => {
    // §6: the same PDF linked from six programme rows is one binary.
    if (sql === null) return;
    const { id } = await upsertDocumentVersion(sql, version('a'));
    const one = await upsertSourceReference(sql, id, {
      url: 'https://vtu.ac.in/a.pdf',
      linkText: 'Scheme',
      sourceId: null,
    });
    const two = await upsertSourceReference(sql, id, {
      url: 'https://vtu.ac.in/b.pdf',
      linkText: 'Scheme',
      sourceId: null,
    });
    const again = await upsertSourceReference(sql, id, {
      url: 'https://vtu.ac.in/a.pdf',
      linkText: 'Scheme',
      sourceId: null,
    });

    expect([one, two, again]).toEqual([true, true, false]);
    const rows = await sql`SELECT 1 FROM source_document_references WHERE version_id = ${id}`;
    expect(rows).toHaveLength(2);
  });

  it('does not insert the same applicability twice', async () => {
    /*
     * THE DEFECT THIS CATCHES. `ON CONFLICT (…, programme_name, stream_id)`
     * never matched, because NULL does not equal NULL in a unique constraint —
     * so every sync inserted the row again. The index is over COALESCE now,
     * and a second run adds nothing (§19).
     */
    if (sql === null) return;
    const { id } = await upsertDocumentVersion(sql, version('a'));
    const input = {
      scope: 'common' as const,
      programmeName: null,
      streamId: null,
      schemeYear: '2022',
      semesterFrom: 1,
      semesterTo: 2,
    };
    expect(await upsertApplicability(sql, id, input)).toBe(true);
    expect(await upsertApplicability(sql, id, input)).toBe(false);

    const rows = await sql`SELECT 1 FROM document_applicability WHERE version_id = ${id}`;
    expect(rows).toHaveLength(1);
  });

  it('separates a common document from an unclassified one', async () => {
    // §6: `common` is an answer; `unknown` is the absence of one.
    if (sql === null) return;
    const { id } = await upsertDocumentVersion(sql, version('a'));
    const base = {
      programmeName: null,
      streamId: null,
      schemeYear: '2022',
      semesterFrom: null,
      semesterTo: null,
    };
    await upsertApplicability(sql, id, { ...base, scope: 'common' });
    await upsertApplicability(sql, id, { ...base, scope: 'unknown' });

    const rows = await sql<{ scope: string }[]>`
      SELECT scope FROM document_applicability WHERE version_id = ${id} ORDER BY scope`;
    expect(rows.map((r) => r.scope)).toEqual(['common', 'unknown']);
  });

  it('gives two streams their own namespace for the same course code', async () => {
    /*
     * THE MEASURED DEFECT (§5, §7). Two stream-wide first-year schemes both
     * describe "semester 1" with no programme. Without the stream in the key
     * they shared an identity and overwrote each other — 57 courses read from
     * the Civil scheme, 4 kept.
     */
    if (sql === null) return;
    await upsertDocumentVersion(sql, version('a'));
    await upsertStream(sql, { id: 'cse-stream', name: 'CSE Stream', sourceUrl: null });
    await upsertStream(sql, { id: 'civil-stream', name: 'Civil Stream', sourceUrl: null });

    const a = await upsertCourse(sql, course({ streamId: 'cse-stream', credits: 4 }));
    const b = await upsertCourse(sql, course({ streamId: 'civil-stream', credits: 3 }));

    expect([a, b]).toEqual(['inserted', 'inserted']);
    const rows = await sql<{ credits: string }[]>`
      SELECT credits FROM catalogue_courses WHERE code = 'BQQ101' ORDER BY credits`;
    expect(rows).toHaveLength(2);
  });

  it('reports a rewrite of identical values as unchanged', async () => {
    // §19 asks for zero unwanted catalogue changes, which is only checkable if
    // the writer can tell "same" from "written again".
    if (sql === null) return;
    await upsertDocumentVersion(sql, version('a'));
    expect(await upsertCourse(sql, course())).toBe('inserted');
    expect(await upsertCourse(sql, course())).toBe('unchanged');
  });

  it('updates a corrected title without creating a second course', async () => {
    // §9: the title is deliberately NOT part of the identity.
    if (sql === null) return;
    await upsertDocumentVersion(sql, version('a'));
    await upsertCourse(sql, course());
    expect(await upsertCourse(sql, course({ title: 'Corrected Title' }))).toBe('updated');

    const rows = await sql`SELECT 1 FROM catalogue_courses WHERE code = 'BQQ101'`;
    expect(rows).toHaveLength(1);
  });

  it('refuses a course whose document it does not hold', async () => {
    // §10: provenance is NOT NULL, so a value with no source cannot be stored.
    if (sql === null) return;
    await expect(upsertCourse(sql, course({ sha256: sha('z') }))).rejects.toThrow(
      /no document version/i,
    );
  });

  it('refuses a borrowed credit that does not name its source', async () => {
    if (sql === null) return;
    await upsertDocumentVersion(sql, version('a'));
    await expect(
      upsertCourse(sql, course({ creditBasis: 'slot', relatedCode: null })),
    ).rejects.toThrow();
  });
});
