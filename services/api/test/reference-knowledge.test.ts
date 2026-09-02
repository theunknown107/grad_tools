/**
 * What the catalogue is allowed to not know.
 *
 * Authority: docs/09 §9.21 · docs/32 OQ-052 · M10A.2 §4, §27
 *
 * ---------------------------------------------------------------------------
 * THE DEFECT THESE TESTS EXIST FOR
 * ---------------------------------------------------------------------------
 *
 * `subjects.has_see` was `NOT NULL DEFAULT true`. Every reference row therefore
 * asserted SEE applicability whether or not anyone had established it, and the
 * assertion pointed at the dangerous answer: a course that is really CIE-only,
 * recorded as having a SEE, produces a backlog claim against a student the
 * university passed (DEC-037).
 *
 * REAL POSTGRESQL, REAL MIGRATIONS, REAL SEED.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClient, type Sql } from '../src/db/client.js';
import { runMigrations } from '../src/db/migrate.js';
import { seed } from '../src/db/seed.js';
import { listSubjects } from '../src/db/queries.js';
import { subjectSchema } from '@gradtools/shared-types';

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeDb = DATABASE_URL === undefined ? describe.skip : describe;

describeDb('reference knowledge states', () => {
  let sql: Sql;

  beforeAll(async () => {
    sql = createClient(DATABASE_URL as string);
    await runMigrations(sql);
    await seed(sql);
  }, 60_000);

  afterAll(async () => {
    await sql.end();
  });

  it('lets a subject exist with its SEE applicability unknown', async () => {
    /*
     * The state that could not previously be written down. Not a gap left open:
     * "this subject exists, its code and title and credits are verified, and
     * nobody established whether it has a semester-end examination" is a real
     * and common situation, and it now has a representation.
     */
    const [row] = await sql<{ has_see: boolean | null }[]>`
      INSERT INTO subjects (
        scheme_id, branch_id, semester, code, title, credits, category,
        source_url, verification, publication
      ) VALUES (
        'vtu-2022', 'cse', 7, 'BTEST701', 'Unknown SEE Course', 3, 'core',
        'https://example.test/scheme.pdf', 'draft', 'unpublished'
      )
      RETURNING has_see
    `;
    expect(row?.has_see).toBeNull();
    await sql`DELETE FROM subjects WHERE code = 'BTEST701'`;
  });

  it('no longer defaults an omitted SEE flag to true', async () => {
    // THE WHOLE MIGRATION IN ONE ASSERTION. With the DEFAULT left in place, an
    // INSERT that omitted the column would go on asserting true, which is the
    // defect unchanged.
    const [column] = await sql<{ column_default: string | null; is_nullable: string }[]>`
      SELECT column_default, is_nullable
        FROM information_schema.columns
       WHERE table_name = 'subjects' AND column_name = 'has_see'
    `;
    expect(column?.column_default).toBeNull();
    expect(column?.is_nullable).toBe('YES');
  });

  it('lets credits be unknown without becoming zero', async () => {
    const [row] = await sql<{ credits: string | null }[]>`
      INSERT INTO subjects (
        scheme_id, branch_id, semester, code, title, category,
        source_url, verification, publication
      ) VALUES (
        'vtu-2022', 'cse', 7, 'BTEST702', 'Unknown Credits Course', 'core',
        'https://example.test/scheme.pdf', 'draft', 'unpublished'
      )
      RETURNING credits
    `;
    // NULL, not "0.0". A course carrying no weight and a course whose weight is
    // unrecorded are different facts, and only one of them is true here.
    expect(row?.credits).toBeNull();
    await sql`DELETE FROM subjects WHERE code = 'BTEST702'`;
  });

  it('carries an unknown SEE flag all the way out through the API contract', async () => {
    /*
     * The seeded semester-1 rows. Their `has_see` was asserted `true` as a
     * literal for the whole list rather than read per course, and M10A.2
     * retracted that — so every one of them is now honestly unknown, and the
     * contract has to be able to say so rather than failing to parse.
     */
    const subjects = await listSubjects(sql, { scheme: 'vtu-2022', branch: 'cse', semester: 1 });
    expect(subjects.length).toBeGreaterThan(0);

    for (const subject of subjects) {
      expect(subjectSchema.safeParse(subject).success).toBe(true);
      expect(subject.hasSee).toBeNull();
      // Credits ARE verified: the seed checked them against the document's own
      // printed total, which is the difference between the two fields.
      expect(subject.credits).not.toBeNull();
    }
  });

  it('still refuses to publish an unverified row', async () => {
    // The existing gate is untouched. Unknown FIELDS are now allowed through
    // publication; an unverified ROW is still not.
    await expect(
      sql`
        INSERT INTO subjects (
          scheme_id, branch_id, semester, code, title, credits, category,
          source_url, verification, publication
        ) VALUES (
          'vtu-2022', 'cse', 7, 'BTEST703', 'Unverified', 3, 'core',
          'https://example.test/scheme.pdf', 'draft', 'published'
        )
      `,
    ).rejects.toThrow(/subjects_publish_requires_verification/i);
  });

  it('keeps a subject visible even though one of its properties is unknown', async () => {
    /*
     * Publication is deliberately NOT conditional on has_see being known.
     * Hiding a subject entirely because one property of it is unestablished
     * would be worse for a student than showing it with one honest gap.
     */
    const subjects = await listSubjects(sql, { scheme: 'vtu-2022', branch: 'cse', semester: 1 });
    expect(subjects.map((subject) => subject.code)).toContain('BMATS101');
  });
});
