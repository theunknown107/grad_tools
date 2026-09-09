/**
 * The catalogue integrity gate, seen to fail.
 *
 * Authority: Phase 7D.2 §21–§32, §49
 *
 * A validator nobody has ever watched reject something is not a validator, so
 * every rule here is exercised by BUILDING the defect it is supposed to catch
 * in a real database. A green run on a healthy catalogue proves only that the
 * queries parse.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import postgres from 'postgres';
import { runMigrations } from '../src/db/migrate.js';
import { validateCatalogue, type Finding } from '../src/sources/catalogue-validate.js';
import {
  recordConflict,
  upsertAlias,
  upsertCourse,
  upsertDocumentVersion,
  upsertOptionGroup,
  upsertSourceReference,
  upsertSyllabus,
} from '../src/sources/catalogue-store.js';

const URL = process.env['TEST_DATABASE_URL'];
const describeDb = URL === undefined ? describe.skip : describe;
const sql = URL === undefined ? null : postgres(URL, { max: 1 });

afterAll(async () => {
  await sql?.end();
});

const SHA = 'c'.repeat(64);

/** A small catalogue that validates cleanly, for each test to then break. */
async function seed(): Promise<void> {
  if (sql === null) return;
  await upsertDocumentVersion(sql, {
    sha256: SHA,
    byteSize: 2048,
    mimeType: 'application/pdf',
    pageCount: 40,
    retrievedAt: '2026-09-08T00:00:00.000Z',
    extractionMethod: 'pdfjs-text-layer',
    extractionStatus: 'text',
    parserVersion: '1.0.0',
    normalizationVersion: '1.0.0',
  });
  const versions = await sql<{ id: string }[]>`
    SELECT id FROM source_document_versions WHERE sha256 = ${SHA}`;
  const versionId = versions[0]?.id ?? '';
  await upsertSourceReference(sql, versionId, {
    url: 'https://vtu.ac.in/pdf/2022_3to8/invented.pdf',
    linkText: 'Scheme',
    sourceId: null,
  });

  await upsertCourse(sql, {
    schemeYear: '2022',
    programmeName: 'Invented Programme',
    streamId: null,
    semester: 3,
    code: 'BQQ301',
    title: 'Invented Course',
    credits: 4,
    creditBasis: 'table',
    relatedCode: null,
    category: null,
    sha256: SHA,
    sourcePage: 2,
  });

  await upsertSyllabus(sql, {
    schemeYear: '2022',
    programmeName: 'Invented Programme',
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
    objectives: [],
    outcomes: [],
    sha256: SHA,
    sourcePage: 2,
    parserVersion: '1.0.0',
    extractionMethod: 'pdfjs-text-layer',
    modules: [
      {
        number: 1,
        title: 'One',
        hours: 8,
        content: 'Content.',
        sourcePage: 2,
        topics: [{ position: 1, title: 'A TOPIC', sourcePage: 2 }],
      },
    ],
  });

  await upsertOptionGroup(sql, {
    schemeYear: '2022',
    programmeName: 'Invented Programme',
    streamId: null,
    semester: 3,
    slotCode: 'BQQ306x',
    kind: 'elective_slot',
    credits: 3,
    sha256: SHA,
    sourcePage: 4,
    members: [
      { code: 'BQQ306A', title: 'A', credits: 3, sourcePage: 5 },
      { code: 'BQQ306B', title: 'B', credits: 3, sourcePage: 5 },
    ],
  });
}

const failures = (findings: readonly Finding[]): string[] =>
  findings.filter((finding) => finding.severity === 'fail').map((finding) => finding.message);

describeDb('validating the catalogue', () => {
  beforeAll(async () => {
    if (sql !== null) await runMigrations(sql);
  });

  beforeEach(async () => {
    if (sql === null) return;
    await sql`TRUNCATE source_document_versions, catalogue_courses, catalogue_syllabi,
      catalogue_option_groups, catalogue_conflicts, catalogue_aliases, academic_streams CASCADE`;
    await seed();
  });

  it('passes a catalogue with nothing wrong with it', async () => {
    if (sql === null) return;
    const result = await validateCatalogue(sql, { schemeYear: '2022' });
    expect(failures(result.findings)).toEqual([]);
    expect(result.passed).toBe(true);
  });

  it('fails a course whose provenance points at nothing', async () => {
    // §25. A value with no traceable source is indistinguishable from one
    // somebody typed.
    if (sql === null) return;
    await sql`DELETE FROM source_document_references`;
    await sql`ALTER TABLE catalogue_courses DROP CONSTRAINT catalogue_courses_version_id_fkey`;
    await sql`UPDATE catalogue_courses SET version_id = gen_random_uuid()`;
    const result = await validateCatalogue(sql, { schemeYear: '2022' });
    expect(failures(result.findings).join(' ')).toMatch(/source document is missing/i);
    expect(result.passed).toBe(false);
    /* The orphan goes before the constraint returns, or the ALTER rejects it. */
    await sql`DELETE FROM catalogue_courses`;
    await sql`ALTER TABLE catalogue_courses
      ADD CONSTRAINT catalogue_courses_version_id_fkey
      FOREIGN KEY (version_id) REFERENCES source_document_versions (id) ON DELETE RESTRICT`;
  });

  it('fails a topic whose module is gone', async () => {
    /*
     * §26. The foreign key should make this impossible, which is exactly why
     * it is checked: a cascade that quietly stops working is invisible until
     * something reads the wrong number off a join.
     */
    if (sql === null) return;
    await sql`ALTER TABLE catalogue_topics DROP CONSTRAINT catalogue_topics_module_id_fkey`;
    await sql`UPDATE catalogue_topics SET module_id = gen_random_uuid()`;
    const result = await validateCatalogue(sql, { schemeYear: '2022' });
    expect(failures(result.findings).join(' ')).toMatch(/topics whose module is gone/i);
    await sql`DELETE FROM catalogue_topics`;
    await sql`ALTER TABLE catalogue_topics
      ADD CONSTRAINT catalogue_topics_module_id_fkey
      FOREIGN KEY (module_id) REFERENCES catalogue_modules (id) ON DELETE CASCADE`;
  });

  it('fails a module with no provenance recorded', async () => {
    // §9: all four fields, on every extracted row.
    if (sql === null) return;
    await sql`ALTER TABLE catalogue_modules ALTER COLUMN parser_version DROP NOT NULL`;
    await sql`UPDATE catalogue_modules SET parser_version = ''`;
    const result = await validateCatalogue(sql, { schemeYear: '2022' });
    expect(failures(result.findings).join(' ')).toMatch(/missing provenance/i);
    await sql`UPDATE catalogue_modules SET parser_version = '1.0.0'`;
    await sql`ALTER TABLE catalogue_modules ALTER COLUMN parser_version SET NOT NULL`;
  });

  it('fails a duplicate course identity', async () => {
    // §25, §31. The unique index is over COALESCE; this is the statement it
    // exists to make, checked as data rather than trusted to the index.
    if (sql === null) return;
    await sql`DROP INDEX catalogue_courses_identity_idx`;
    await sql`INSERT INTO catalogue_courses
        (scheme_year, programme_name, stream_id, semester, code, title, credits,
         credit_basis, version_id, source_page)
      SELECT scheme_year, programme_name, stream_id, semester, code, title, credits,
             credit_basis, version_id, source_page
      FROM catalogue_courses`;
    const result = await validateCatalogue(sql, { schemeYear: '2022' });
    expect(failures(result.findings).join(' ')).toMatch(/duplicate course identities/i);
    await sql`DELETE FROM catalogue_courses c
      USING catalogue_courses d WHERE c.id > d.id AND c.code = d.code`;
    await sql`CREATE UNIQUE INDEX catalogue_courses_identity_idx
      ON catalogue_courses (scheme_year, COALESCE(programme_name, ''),
        COALESCE(stream_id, ''), semester, code)`;
  });

  it('fails an alias pointing at a code nothing in the catalogue names', async () => {
    // §28. An alias to nowhere silently drops the credits it was meant to find.
    if (sql === null) return;
    await upsertAlias(sql, {
      schemeYear: '2022',
      variantCode: 'BQQL301',
      canonicalCode: 'BQQ999',
      title: 'Invented Course',
      reason: 'An invented reason, long enough to satisfy the column constraint.',
      sha256: SHA,
      sourcePage: 1,
    });
    const result = await validateCatalogue(sql, { schemeYear: '2022' });
    expect(failures(result.findings).join(' ')).toMatch(/canonical code names nothing/i);
  });

  it('fails an alias chain', async () => {
    // A→B where B→C makes the answer depend on how many times you look it up.
    if (sql === null) return;
    const alias = (variant: string, canonical: string) => ({
      schemeYear: '2022',
      variantCode: variant,
      canonicalCode: canonical,
      title: 'Invented Course',
      reason: 'An invented reason, long enough to satisfy the column constraint.',
      sha256: SHA,
      sourcePage: 1,
    });
    await upsertAlias(sql, alias('BQQ100', 'BQQ200'));
    await upsertAlias(sql, alias('BQQ200', 'BQQ301'));
    const result = await validateCatalogue(sql, { schemeYear: '2022' });
    expect(failures(result.findings).join(' ')).toMatch(/alias chains/i);
  });

  it('fails an option group that offers no choice', async () => {
    // §27: a group of one is not a choice.
    if (sql === null) return;
    await sql`DELETE FROM catalogue_option_members WHERE code = 'BQQ306B'`;
    const result = await validateCatalogue(sql, { schemeYear: '2022' });
    expect(failures(result.findings).join(' ')).toMatch(/offering no choice/i);
  });

  it('fails a group that lists its own slot as an option', async () => {
    if (sql === null) return;
    await sql`INSERT INTO catalogue_option_members (group_id, code, credits, version_id, source_page)
      SELECT g.id, g.slot_code, g.credits, g.version_id, g.source_page
      FROM catalogue_option_groups g`;
    const result = await validateCatalogue(sql, { schemeYear: '2022' });
    expect(failures(result.findings).join(' ')).toMatch(/own slot as an option/i);
  });

  it('fails a course offered by two different slots in one semester', async () => {
    // §27: no scheme prints a course as an option for two slots at once.
    if (sql === null) return;
    await upsertOptionGroup(sql, {
      schemeYear: '2022',
      programmeName: 'Invented Programme',
      streamId: null,
      semester: 3,
      slotCode: 'BQQ307x',
      kind: 'elective_slot',
      credits: 3,
      sha256: SHA,
      sourcePage: 8,
      members: [
        { code: 'BQQ306A', title: 'A', credits: 3, sourcePage: 9 },
        { code: 'BQQ307B', title: 'B', credits: 3, sourcePage: 9 },
      ],
    });
    const result = await validateCatalogue(sql, { schemeYear: '2022' });
    expect(failures(result.findings).join(' ')).toMatch(/two different slots/i);
  });

  it('fails a conflict with no readings behind it', async () => {
    // §29: a conflict that cannot show what disagreed is an assertion.
    if (sql === null) return;
    await sql`INSERT INTO catalogue_conflicts (scheme_year, code, field)
      VALUES ('2022', 'BQQ301', 'credits')`;
    const result = await validateCatalogue(sql, { schemeYear: '2022' });
    expect(failures(result.findings).join(' ')).toMatch(/no readings behind them/i);
  });

  it('warns about an open conflict without failing on it', async () => {
    /*
     * §16, §18. Two of VTU's own documents disagreeing is not a defect in this
     * pipeline. Failing on it would mean the only way to go green is to pick a
     * side without evidence.
     */
    if (sql === null) return;
    await recordConflict(sql, {
      entityType: 'syllabus',
      schemeYear: '2022',
      programmeName: null,
      semester: null,
      code: 'BQQ301',
      field: 'code',
      readings: [
        { value: 'BQQ301', sha256: SHA, sourcePage: 1 },
        { value: 'BQQ302', sha256: SHA, sourcePage: 2 },
      ],
    });
    const result = await validateCatalogue(sql, { schemeYear: '2022' });
    expect(result.passed).toBe(true);
    expect(result.warnings).toBeGreaterThan(0);
    expect(
      result.findings.some(
        (finding) => finding.severity === 'warn' && /open source conflicts/i.test(finding.message),
      ),
    ).toBe(true);
  });

  it('fails a resolved conflict that does not say why', async () => {
    // §18: a resolution with no reason is indistinguishable from a dismissal.
    if (sql === null) return;
    await recordConflict(sql, {
      schemeYear: '2022',
      programmeName: null,
      semester: 3,
      code: 'BQQ301',
      field: 'credits',
      readings: [{ value: '4', sha256: SHA, sourcePage: 1 }],
    });
    await sql`ALTER TABLE catalogue_conflicts
      DROP CONSTRAINT catalogue_conflicts_resolution_is_explained`;
    await sql`UPDATE catalogue_conflicts SET status = 'resolved'`;
    const result = await validateCatalogue(sql, { schemeYear: '2022' });
    expect(failures(result.findings).join(' ')).toMatch(/do not say who resolved them/i);
    await sql`UPDATE catalogue_conflicts SET status = 'open'`;
    await sql`ALTER TABLE catalogue_conflicts
      ADD CONSTRAINT catalogue_conflicts_resolution_is_explained
      CHECK (status = 'open' OR resolution IS NOT NULL)`;
  });

  it('reports a semester total it cannot compare rather than passing it', async () => {
    /*
     * §30, §32. The seeded catalogue has no extracted scheme document behind
     * it, so there is no printed total to compare against. That is neither a
     * pass nor a failure, and calling it a tick would make the report worthless
     * exactly where it matters.
     */
    if (sql === null) return;
    const result = await validateCatalogue(sql, { schemeYear: '2022' });
    const totals = result.findings.filter((finding) => finding.area === 'semester totals');
    expect(totals.every((finding) => finding.severity === 'skip')).toBe(true);
    expect(totals[0]?.message).toMatch(/no document states a total/i);
  });

  it('fails a document no URL points at', async () => {
    // §22: a document with no reference cannot be re-fetched or cited.
    if (sql === null) return;
    await sql`DELETE FROM source_document_references`;
    const result = await validateCatalogue(sql, { schemeYear: '2022' });
    expect(failures(result.findings).join(' ')).toMatch(/no URL points at/i);
  });
});
