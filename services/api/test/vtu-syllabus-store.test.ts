/**
 * Persisting a syllabus: structure, provenance and idempotency.
 *
 * Authority: Phase 7D.2 §3–§10, §35
 *
 * A real database, because what is under test is what the SCHEMA enforces — a
 * unique index over COALESCE, a NOT NULL on provenance, a cascade that removes
 * the topics of a removed module. A mocked `sql` would assert that the code
 * sends the query it sends.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import postgres from 'postgres';
import { runMigrations } from '../src/db/migrate.js';
import {
  upsertDocumentVersion,
  upsertSyllabus,
  type SyllabusInput,
} from '../src/sources/catalogue-store.js';

const URL = process.env['TEST_DATABASE_URL'];
const describeDb = URL === undefined ? describe.skip : describe;
const sql = URL === undefined ? null : postgres(URL, { max: 1 });

afterAll(async () => {
  await sql?.end();
});

const SHA = 'a'.repeat(64);

const version = {
  sha256: SHA,
  byteSize: 1024,
  mimeType: 'application/pdf',
  pageCount: 90,
  retrievedAt: '2026-09-08T00:00:00.000Z',
  extractionMethod: 'pdfjs-text-layer',
  extractionStatus: 'text' as const,
  parserVersion: '1.0.0',
  normalizationVersion: '1.0.0',
};

const syllabus = (over: Partial<SyllabusInput> = {}): SyllabusInput => ({
  schemeYear: '2022',
  programmeName: null,
  streamId: null,
  semester: 3,
  code: 'BQQ301',
  title: 'Invented Course',
  credits: 4,
  cieMarks: 50,
  seeMarks: 50,
  totalMarks: 100,
  examHours: 3,
  teachingHours: '3:0:0:0',
  unresolved: {},
  objectives: ['To do the thing.'],
  outcomes: ['CO1 Do the thing.'],
  sha256: SHA,
  sourcePage: 14,
  parserVersion: '1.0.0',
  extractionMethod: 'pdfjs-text-layer',
  modules: [
    {
      number: 1,
      title: null,
      hours: 8,
      content: 'INTRODUCTION TO DATA STRUCTURES: Data Structures, Classifications',
      sourcePage: 14,
      topics: [
        { position: 1, title: 'INTRODUCTION TO DATA STRUCTURES', sourcePage: 14 },
        { position: 2, title: 'STACKS', sourcePage: 14 },
      ],
    },
    {
      number: 2,
      title: 'Probability Distributions',
      hours: null,
      content: 'Review of basic probability theory.',
      sourcePage: 15,
      topics: [],
    },
  ],
  ...over,
});

const count = async (table: 'catalogue_syllabi' | 'catalogue_modules' | 'catalogue_topics') => {
  if (sql === null) return 0;
  const rows = await sql<{ n: string }[]>`SELECT count(*)::text AS n FROM ${sql(table)}`;
  return Number(rows[0]?.n ?? 0);
};

describeDb('persisting a syllabus', () => {
  beforeAll(async () => {
    if (sql !== null) await runMigrations(sql);
  });

  beforeEach(async () => {
    if (sql === null) return;
    await sql`TRUNCATE catalogue_syllabi, source_document_versions CASCADE`;
    await upsertDocumentVersion(sql, version);
  });

  it('writes the syllabus, its modules and its topics', async () => {
    if (sql === null) return;
    expect(await upsertSyllabus(sql, syllabus())).toBe('inserted');
    expect(await count('catalogue_syllabi')).toBe(1);
    expect(await count('catalogue_modules')).toBe(2);
    expect(await count('catalogue_topics')).toBe(2);
  });

  it('keeps module numbers as the headings print them', async () => {
    // §6: a document printing Module-1, Module-3, Module-4 has a gap, and
    // renumbering it to 1, 2, 3 would erase that.
    if (sql === null) return;
    const gapped = syllabus().modules.map((module, index) => ({
      ...module,
      number: index === 1 ? 4 : module.number,
    }));
    await upsertSyllabus(sql, syllabus({ modules: gapped }));

    const rows = await sql<{ number: number }[]>`
      SELECT number FROM catalogue_modules ORDER BY number`;
    expect(rows.map((row) => row.number)).toEqual([1, 4]);
  });

  it('stores a module with no topics as having none', async () => {
    /*
     * §8. A module written as continuous prose has no topics, and that is the
     * honest record — splitting its sentences would present our guesses as the
     * university's own structure.
     */
    if (sql === null) return;
    await upsertSyllabus(sql, syllabus());
    const rows = await sql<{ n: string }[]>`
      SELECT count(t.id)::text AS n
      FROM catalogue_modules m
      LEFT JOIN catalogue_topics t ON t.module_id = m.id
      WHERE m.number = 2`;
    expect(Number(rows[0]?.n)).toBe(0);
  });

  it('records what an impossible reading actually said', async () => {
    /*
     * "Credits 01 Exam Hours 100" is printed in a real VTU laboratory
     * syllabus. The column stays NULL so nothing can use it as a duration, and
     * `unresolved` keeps the figure for someone to look at (§5).
     */
    if (sql === null) return;
    await upsertSyllabus(
      sql,
      syllabus({
        examHours: null,
        unresolved: { examHours: { state: 'ambiguous', printed: 100 } },
      }),
    );
    const rows = await sql<{ exam_hours: number | null; unresolved: Record<string, unknown> }[]>`
      SELECT exam_hours, unresolved FROM catalogue_syllabi`;
    expect(rows[0]?.exam_hours).toBeNull();
    expect(rows[0]?.unresolved).toEqual({ examHours: { state: 'ambiguous', printed: 100 } });
  });

  it('runs twice over an unchanged document and changes nothing', async () => {
    // §35: the catalogue must reproduce deterministically.
    if (sql === null) return;
    await upsertSyllabus(sql, syllabus());
    const before = await sql<{ id: string }[]>`SELECT id FROM catalogue_topics ORDER BY title`;

    expect(await upsertSyllabus(sql, syllabus())).toBe('unchanged');
    expect(await count('catalogue_syllabi')).toBe(1);
    expect(await count('catalogue_modules')).toBe(2);

    const after = await sql<{ id: string }[]>`SELECT id FROM catalogue_topics ORDER BY title`;
    // Not merely the same COUNT: replacing rows wholesale would give every one
    // a new id, and anything that later cites a topic would be citing a moving
    // target.
    expect(after.map((row) => row.id)).toEqual(before.map((row) => row.id));
  });

  it('removes a module the corrected document no longer prints', async () => {
    if (sql === null) return;
    await upsertSyllabus(sql, syllabus());
    await upsertSyllabus(sql, syllabus({ modules: syllabus().modules.slice(0, 1) }));

    expect(await count('catalogue_modules')).toBe(1);
    // Its topics go with it rather than outliving their module.
    expect(await count('catalogue_topics')).toBe(2);
  });

  it('gives the same code in two semesters two syllabi', async () => {
    if (sql === null) return;
    await upsertSyllabus(sql, syllabus({ semester: 3 }));
    await upsertSyllabus(sql, syllabus({ semester: 4 }));
    expect(await count('catalogue_syllabi')).toBe(2);
  });

  it('does not duplicate a syllabus whose semester the document never stated', async () => {
    /*
     * THE DEFECT THIS CATCHES. `semester` is nullable — five first-year
     * science syllabi print none — and NULL never equals NULL in a unique
     * constraint, so a plain UNIQUE let every run insert the row again. The
     * index is over COALESCE.
     */
    if (sql === null) return;
    expect(await upsertSyllabus(sql, syllabus({ semester: null }))).toBe('inserted');
    expect(await upsertSyllabus(sql, syllabus({ semester: null }))).toBe('unchanged');
    expect(await count('catalogue_syllabi')).toBe(1);
  });

  it('updates a corrected title without creating a second syllabus', async () => {
    if (sql === null) return;
    await upsertSyllabus(sql, syllabus());
    expect(await upsertSyllabus(sql, syllabus({ title: 'Corrected Title' }))).toBe('updated');
    expect(await count('catalogue_syllabi')).toBe(1);
  });

  it('refuses a syllabus whose document it does not hold', async () => {
    // §9: provenance is NOT NULL, so nothing with no source can be stored.
    if (sql === null) return;
    await expect(upsertSyllabus(sql, syllabus({ sha256: 'b'.repeat(64) }))).rejects.toThrow(
      /no document version/i,
    );
  });

  it('carries provenance on every module and topic', async () => {
    // §9: document version, page, parser version and extraction method. All
    // four, on every extracted row, and the schema is what enforces it.
    if (sql === null) return;
    await upsertSyllabus(sql, syllabus());
    const rows = await sql<{ n: string }[]>`
      SELECT count(*)::text AS n FROM catalogue_topics t
      JOIN catalogue_modules m ON m.id = t.module_id
      WHERE t.version_id IS NOT NULL AND t.source_page > 0
        AND t.parser_version <> '' AND t.extraction_method <> ''
        AND m.version_id IS NOT NULL AND m.source_page > 0`;
    expect(Number(rows[0]?.n)).toBe(2);
  });
});
