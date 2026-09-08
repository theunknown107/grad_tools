/**
 * Option groups, aliases and conflicts, persisted.
 *
 * Authority: Phase 7D.2 §5–§20
 *
 * A real database, because the point of moving these out of memory is that the
 * SCHEMA holds them: a unique index over COALESCE, a cascade, a CHECK that a
 * resolved conflict explains itself. A mocked `sql` would assert that the code
 * sends the query it sends.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import postgres from 'postgres';
import { runMigrations } from '../src/db/migrate.js';
import {
  recordConflict,
  upsertAlias,
  upsertDocumentVersion,
  upsertOptionGroup,
  upsertStream,
  type OptionGroupInput,
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
  pageCount: 20,
  retrievedAt: '2026-09-08T00:00:00.000Z',
  extractionMethod: 'pdfjs-text-layer',
  extractionStatus: 'text' as const,
  parserVersion: '1.0.0',
  normalizationVersion: '1.0.0',
});

const group = (over: Partial<OptionGroupInput> = {}): OptionGroupInput => ({
  schemeYear: '2022',
  programmeName: null,
  streamId: null,
  semester: 3,
  slotCode: 'BQQ306x',
  kind: 'elective_slot',
  credits: 3,
  sha256: sha('a'),
  sourcePage: 4,
  members: [
    { code: 'BQQ306A', title: 'Option A', credits: 3, sourcePage: 6 },
    { code: 'BQQ306B', title: 'Option B', credits: 3, sourcePage: 6 },
  ],
  ...over,
});

const count = async (table: string): Promise<number> => {
  if (sql === null) return 0;
  const rows = await sql<{ n: string }[]>`SELECT count(*)::text AS n FROM ${sql(table)}`;
  return Number(rows[0]?.n ?? 0);
};

describeDb('the catalogue relations', () => {
  beforeAll(async () => {
    if (sql !== null) await runMigrations(sql);
  });

  beforeEach(async () => {
    if (sql === null) return;
    await sql`TRUNCATE catalogue_option_groups, catalogue_conflicts, catalogue_aliases,
      academic_streams, source_document_versions CASCADE`;
    await upsertDocumentVersion(sql, version('a'));
    await upsertDocumentVersion(sql, version('b'));
  });

  /* ---- Option groups --------------------------------------------------- */

  it('writes a slot and the courses that may fill it', async () => {
    if (sql === null) return;
    expect(await upsertOptionGroup(sql, group())).toBe('inserted');
    expect(await count('catalogue_option_groups')).toBe(1);
    expect(await count('catalogue_option_members')).toBe(2);
  });

  it('writes an OR pair as one group with its shared credits', async () => {
    if (sql === null) return;
    await upsertOptionGroup(
      sql,
      group({
        semester: 1,
        slotCode: 'BQQGK106',
        kind: 'alternative',
        credits: 1,
        members: [
          { code: 'BQQGK106', title: 'One', credits: 1, sourcePage: 2 },
          { code: 'BQQSK106', title: 'Two', credits: 1, sourcePage: 2 },
        ],
      }),
    );
    const rows = await sql<{ kind: string; credits: string }[]>`
      SELECT kind::text, credits::text FROM catalogue_option_groups`;
    expect(rows[0]).toMatchObject({ kind: 'alternative', credits: '1.0' });
  });

  it('keeps a group with no shared figure as having none', async () => {
    // §9: an option that inherited a figure is not evidence of what it
    // inherited from, so nothing is invented for the group.
    if (sql === null) return;
    await upsertOptionGroup(sql, group({ credits: null }));
    const rows = await sql<{ credits: string | null }[]>`
      SELECT credits::text FROM catalogue_option_groups`;
    expect(rows[0]?.credits).toBeNull();
  });

  it('separates the same slot in two streams', async () => {
    /*
     * §6: a group is scoped, never global. Two stream-wide first-year schemes
     * both print `BPLCK105x` in semester 1 with no programme; without the
     * stream in the key they would collide, exactly as the courses did.
     */
    if (sql === null) return;
    await upsertStream(sql, { id: 'cse-stream', name: 'CSE Stream', sourceUrl: null });
    await upsertStream(sql, { id: 'civil-stream', name: 'Civil Stream', sourceUrl: null });
    await upsertOptionGroup(sql, group({ streamId: 'cse-stream' }));
    await upsertOptionGroup(sql, group({ streamId: 'civil-stream' }));
    expect(await count('catalogue_option_groups')).toBe(2);
  });

  it('separates the same slot in two schemes', async () => {
    if (sql === null) return;
    await upsertOptionGroup(sql, group({ schemeYear: '2022' }));
    await upsertOptionGroup(sql, group({ schemeYear: '2025' }));
    expect(await count('catalogue_option_groups')).toBe(2);
  });

  it('runs twice over an unchanged document and changes nothing', async () => {
    // §35, and the reason the group has an identity at all.
    if (sql === null) return;
    await upsertOptionGroup(sql, group());
    expect(await upsertOptionGroup(sql, group())).toBe('unchanged');
    expect(await count('catalogue_option_groups')).toBe(1);
    expect(await count('catalogue_option_members')).toBe(2);
  });

  it('records an option once however often it is written', async () => {
    if (sql === null) return;
    await upsertOptionGroup(
      sql,
      group({
        members: [
          { code: 'BQQ306A', title: 'Option A', credits: 3, sourcePage: 6 },
          { code: 'BQQ306A', title: 'Option A again', credits: 3, sourcePage: 7 },
        ],
      }),
    );
    expect(await count('catalogue_option_members')).toBe(1);
  });

  it('drops an option the corrected document no longer lists', async () => {
    if (sql === null) return;
    await upsertOptionGroup(sql, group());
    await upsertOptionGroup(
      sql,
      group({ members: [{ code: 'BQQ306A', title: 'Option A', credits: 3, sourcePage: 6 }] }),
    );
    expect(await count('catalogue_option_members')).toBe(1);
  });

  it('refuses a group whose document it does not hold', async () => {
    if (sql === null) return;
    await expect(upsertOptionGroup(sql, group({ sha256: sha('z') }))).rejects.toThrow(
      /no document version/i,
    );
  });

  /* ---- Aliases --------------------------------------------------------- */

  it('persists an alias with the document that establishes it', async () => {
    // §11: this used to live only in the web app, where nothing else could
    // check it. An alias whose citation cannot be produced is not evidence.
    if (sql === null) return;
    await upsertAlias(sql, {
      schemeYear: '2022',
      variantCode: 'BCSL358D',
      canonicalCode: 'BCS358D',
      title: 'Data Visualization with Python',
      reason: 'The 2022 CSBS 3rd-4th semester syllabus gives this course the code BCS358D.',
      sha256: sha('a'),
      sourcePage: 44,
    });
    const rows = await sql<{ variant_code: string; version_id: string | null }[]>`
      SELECT variant_code, version_id FROM catalogue_aliases`;
    expect(rows[0]?.variant_code).toBe('BCSL358D');
    expect(rows[0]?.version_id).not.toBeNull();
  });

  it('does not write the same alias twice', async () => {
    if (sql === null) return;
    const alias = {
      schemeYear: '2022',
      variantCode: 'BCSL358D',
      canonicalCode: 'BCS358D',
      title: 'Data Visualization with Python',
      reason: 'The 2022 CSBS 3rd-4th semester syllabus gives this course the code BCS358D.',
      sha256: sha('a'),
      sourcePage: 44,
    };
    await upsertAlias(sql, alias);
    await upsertAlias(sql, alias);
    expect(await count('catalogue_aliases')).toBe(1);
  });

  it('refuses an alias from a code to itself', async () => {
    // A self-alias is not an equivalence, and the schema says so.
    if (sql === null) return;
    await expect(
      upsertAlias(sql, {
        schemeYear: '2022',
        variantCode: 'BCS358D',
        canonicalCode: 'BCS358D',
        title: 'Data Visualization with Python',
        reason: 'A reason long enough to satisfy the column constraint here.',
        sha256: sha('a'),
        sourcePage: null,
      }),
    ).rejects.toThrow();
  });

  it('keeps aliases of two scheme years apart', async () => {
    if (sql === null) return;
    const base = {
      variantCode: 'BCSL358D',
      canonicalCode: 'BCS358D',
      title: 'Data Visualization with Python',
      reason: 'The 2022 CSBS 3rd-4th semester syllabus gives this course the code BCS358D.',
      sha256: sha('a'),
      sourcePage: null,
    };
    await upsertAlias(sql, { ...base, schemeYear: '2022' });
    await upsertAlias(sql, { ...base, schemeYear: '2025' });
    expect(await count('catalogue_aliases')).toBe(2);
  });

  /* ---- Conflicts ------------------------------------------------------- */

  it('records a disagreement with both readings, and leaves it open', async () => {
    /*
     * THE BCHEC/BCHEE CASE (§16, §20). `BCHEC102.pdf` prints
     * "Course Code: BCHEC202 /202" in its own header. Neither reading is
     * corrected: nothing in this pipeline has the standing to decide which of
     * the university's statements about its own course is the mistaken one.
     */
    if (sql === null) return;
    expect(
      await recordConflict(sql, {
        entityType: 'syllabus',
        schemeYear: '2022',
        programmeName: null,
        semester: null,
        code: 'BCHEC102',
        field: 'code',
        readings: [
          { value: 'BCHEC202', sha256: sha('a'), sourcePage: 1 },
          { value: 'BCHEC102', sha256: sha('a'), sourcePage: null },
        ],
      }),
    ).toBe('opened');

    const rows = await sql<{ status: string; n: string }[]>`
      SELECT c.status::text, count(r.*)::text AS n
      FROM catalogue_conflicts c JOIN catalogue_conflict_readings r ON r.conflict_id = c.id
      GROUP BY c.id, c.status`;
    expect(rows[0]?.status).toBe('open');
    expect(Number(rows[0]?.n)).toBe(2);
  });

  it('accumulates readings into one conflict rather than a row per run', async () => {
    /*
     * THE DEFECT THIS CATCHES. `catalogue_conflicts` had no unique key, so
     * every sync that saw the same disagreement inserted it again — a log,
     * not a record.
     */
    if (sql === null) return;
    const conflict = {
      entityType: 'course' as const,
      schemeYear: '2022',
      programmeName: null,
      semester: 3,
      code: 'BQQ301',
      field: 'credits',
      readings: [{ value: '3', sha256: sha('a'), sourcePage: 1 }],
    };
    expect(await recordConflict(sql, conflict)).toBe('opened');
    expect(await recordConflict(sql, conflict)).toBe('existing');
    expect(
      await recordConflict(sql, {
        ...conflict,
        readings: [{ value: '4', sha256: sha('b'), sourcePage: 2 }],
      }),
    ).toBe('existing');

    expect(await count('catalogue_conflicts')).toBe(1);
    expect(await count('catalogue_conflict_readings')).toBe(2);
  });

  it('never resolves a conflict by seeing it again', async () => {
    // §18: only an explicit precedence decision or a human resolves one.
    if (sql === null) return;
    const conflict = {
      schemeYear: '2022',
      programmeName: null,
      semester: 3,
      code: 'BQQ301',
      field: 'credits',
      readings: [{ value: '3', sha256: sha('a'), sourcePage: 1 }],
    };
    await recordConflict(sql, conflict);
    await recordConflict(sql, conflict);
    const rows = await sql<{ status: string }[]>`SELECT status::text FROM catalogue_conflicts`;
    expect(rows.map((row) => row.status)).toEqual(['open']);
  });

  it('refuses a resolved conflict that does not say why', async () => {
    // The schema will not let a resolution be recorded without its reason.
    if (sql === null) return;
    await recordConflict(sql, {
      schemeYear: '2022',
      programmeName: null,
      semester: 3,
      code: 'BQQ301',
      field: 'credits',
      readings: [{ value: '3', sha256: sha('a'), sourcePage: 1 }],
    });
    await expect(
      sql`UPDATE catalogue_conflicts SET status = 'resolved' WHERE code = 'BQQ301'`,
    ).rejects.toThrow();
  });

  it('keeps a conflict about a course apart from one about a syllabus', async () => {
    if (sql === null) return;
    const base = {
      schemeYear: '2022',
      programmeName: null,
      semester: 3,
      code: 'BQQ301',
      field: 'code',
      readings: [{ value: 'BQQ301', sha256: sha('a'), sourcePage: 1 }],
    };
    await recordConflict(sql, { ...base, entityType: 'course' });
    await recordConflict(sql, { ...base, entityType: 'syllabus' });
    expect(await count('catalogue_conflicts')).toBe(2);
  });
});
