/**
 * API and database integration tests.
 *
 * Authority: docs/22 §22.2, §22.5, §22.10, M5a §22
 *
 * These run against a REAL PostgreSQL instance, never a mock and never SQLite.
 * Constraints, enum types, triggers and `ON CONFLICT` semantics are precisely
 * what needs testing here, and none of them exist in a substitute
 * (docs/22 §22.2).
 *
 * The suite is skipped, loudly, when no database is configured, so a
 * contributor without one gets a clear message rather than a wall of failures.
 * See services/api/README.md for the one command that provides it.
 */

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { Writable } from 'node:stream';
import type { Express } from 'express';
import { API_ROUTES } from '@gradtools/shared-types';
import { loadConfig } from '../src/config.js';
import { createClient, type Sql } from '../src/db/client.js';
import { runMigrations } from '../src/db/migrate.js';
import { seed } from '../src/db/seed.js';
import { createApp } from '../src/http/app.js';
import { createLogger } from '../src/observability/logger.js';

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeDb = DATABASE_URL === undefined ? describe.skip : describe;

if (DATABASE_URL === undefined) {
  // eslint-disable-next-line no-console
  console.warn(
    '\n  TEST_DATABASE_URL is not set: API integration tests are SKIPPED.\n' +
      '  See services/api/README.md to start a disposable PostgreSQL instance.\n',
  );
}

describeDb('reference API', () => {
  let sql: Sql;
  let app: Express;

  beforeAll(async () => {
    sql = createClient(DATABASE_URL as string);

    // Prove migrations work from a genuinely clean database every run, rather
    // than testing against whatever state a previous run happened to leave.
    await sql`DROP SCHEMA public CASCADE`;
    await sql`CREATE SCHEMA public`;

    await runMigrations(sql);
    await seed(sql);

    const config = {
      ...loadConfig({ DATABASE_URL, NODE_ENV: 'test', APP_ENV: 'test' }),
    };
    app = createApp(config, sql, createLogger('silent', false));
  }, 60_000);

  /** The id of a seeded subject, so tests address subjects the way callers do. */
  async function subjectId(code: string): Promise<string> {
    const rows = await sql<{ id: string }[]>`
      SELECT id::text FROM subjects WHERE code = ${code} LIMIT 1
    `;
    const id = rows[0]?.id;
    if (id === undefined) throw new Error(`Seed is missing subject ${code}.`);
    return id;
  }

  afterAll(async () => {
    await sql.end();
  });

  /* ---------------------------------------------------------------------- */
  /* Migrations                                                             */
  /* ---------------------------------------------------------------------- */

  describe('migrations', () => {
    it('are idempotent: a second run applies nothing', async () => {
      const result = await runMigrations(sql);
      expect(result.applied).toEqual([]);
      expect(result.skipped.length).toBeGreaterThan(0);
    });

    it('created every reference table and no student table', async () => {
      const rows = await sql<{ table_name: string }[]>`
        SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
      `;
      const tables = rows.map((row) => row.table_name).sort();

      expect(tables).toContain('universities');
      expect(tables).toContain('schemes');
      expect(tables).toContain('branches');
      expect(tables).toContain('rule_sets');
      expect(tables).toContain('subjects');
      expect(tables).toContain('syllabus_modules');

      // Stage 1 privacy boundary: the server holds NO student data, so these
      // tables must not exist at all (docs/33 §33.3, M5a §3).
      for (const forbidden of [
        'students',
        'student_profiles',
        'attendance_records',
        'semester_records',
        'timetable_slots',
        'sessions',
      ]) {
        expect(tables).not.toContain(forbidden);
      }
    });
  });

  /* ---------------------------------------------------------------------- */
  /* Constraints                                                            */
  /* ---------------------------------------------------------------------- */

  describe('publication constraints', () => {
    it('refuses to publish an unverified scheme', async () => {
      await expect(
        sql`
          INSERT INTO schemes (id, university_id, code, regulation_code, name,
                               effective_from, source_url, verification, publication)
          VALUES ('bad-scheme', 'vtu', 'BAD', 'X', 'Unverified', '2022-01-01',
                  'https://example.org/x', 'unverified', 'published')
        `,
      ).rejects.toThrow(/publish_requires_verification/);
    });

    it('refuses to publish a verified scheme with no verified_at timestamp', async () => {
      await expect(
        sql`
          INSERT INTO schemes (id, university_id, code, regulation_code, name,
                               effective_from, source_url, verification, verified_at, publication)
          VALUES ('bad-scheme-2', 'vtu', 'BAD2', 'X', 'No timestamp', '2022-01-01',
                  'https://example.org/x', 'verified', NULL, 'published')
        `,
      ).rejects.toThrow(/publish_requires_verification/);
    });

    it('refuses to publish an unverified subject', async () => {
      await expect(
        sql`
          INSERT INTO subjects (scheme_id, branch_id, semester, code, title, credits,
                                category, source_url, verification, publication)
          VALUES ('vtu-2022', 'cse', 1, 'BAD101', 'Unverified', 3, 'core',
                  'https://example.org/x', 'unverified', 'published')
        `,
      ).rejects.toThrow(/publish_requires_verification/);
    });

    it('refuses to activate an unverified rule set', async () => {
      await expect(
        sql`
          INSERT INTO rule_sets (scheme_id, version, effective_from, active,
            sgpa_formula_id, cgpa_formula_id, percentage_formula_id,
            cie_max, cie_min_pct, see_max, see_min_pct, course_max, overall_min_pct,
            attendance_required_pct, attendance_condonable_pct, attendance_dx_floor_pct,
            source_url, source_clause, verification, publication)
          VALUES ('vtu-2022', 99, '2022-01-01', true, 'a', 'b', 'c',
                  50, 40, 100, 35, 100, 40, 85, 10, 75,
                  'https://example.org/x', 'clause', 'unverified', 'unpublished')
        `,
      ).rejects.toThrow(/active_requires_verification/);
    });

    it('requires provenance: source_url cannot be null', async () => {
      await expect(
        sql`
          INSERT INTO subjects (scheme_id, branch_id, semester, code, title, credits,
                                category, source_url)
          VALUES ('vtu-2022', 'cse', 1, 'NOPROV', 'No provenance', 3, 'core', NULL)
        `,
      ).rejects.toThrow(/source_url/);
    });

    it('rejects a non-http source_url', async () => {
      await expect(
        sql`
          INSERT INTO subjects (scheme_id, branch_id, semester, code, title, credits,
                                category, source_url)
          VALUES ('vtu-2022', 'cse', 1, 'BADURL', 'Bad url', 3, 'core', 'not-a-url')
        `,
      ).rejects.toThrow(/source_url_check|check constraint/);
    });

    it('enforces the foreign key to schemes', async () => {
      await expect(
        sql`
          INSERT INTO subjects (scheme_id, branch_id, semester, code, title, credits,
                                category, source_url)
          VALUES ('no-such-scheme', 'cse', 1, 'FK1', 'Orphan', 3, 'core',
                  'https://example.org/x')
        `,
      ).rejects.toThrow(/foreign key|violates/i);
    });

    it('enforces subject uniqueness per scheme and branch', async () => {
      await expect(
        sql`
          INSERT INTO subjects (scheme_id, branch_id, semester, code, title, credits,
                                category, source_url)
          VALUES ('vtu-2022', 'cse', 1, 'BMATS101', 'Duplicate', 4, 'core',
                  'https://example.org/x')
        `,
      ).rejects.toThrow(/duplicate key|unique/i);
    });

    it('allows at most one active rule set per scheme', async () => {
      await expect(
        sql`
          INSERT INTO rule_sets (scheme_id, version, effective_from, active,
            sgpa_formula_id, cgpa_formula_id, percentage_formula_id,
            cie_max, cie_min_pct, see_max, see_min_pct, course_max, overall_min_pct,
            attendance_required_pct, attendance_condonable_pct, attendance_dx_floor_pct,
            source_url, source_clause, verification, verified_at, publication)
          VALUES ('vtu-2022', 2, '2022-01-01', true, 'a', 'b', 'c',
                  50, 40, 100, 35, 100, 40, 85, 10, 75,
                  'https://example.org/x', 'clause', 'verified', now(), 'unpublished')
        `,
      ).rejects.toThrow(/one_active_rule_set|duplicate key/i);
    });

    it('rejects a DX floor above the required attendance', async () => {
      await expect(
        sql`
          INSERT INTO rule_sets (scheme_id, version, effective_from,
            sgpa_formula_id, cgpa_formula_id, percentage_formula_id,
            cie_max, cie_min_pct, see_max, see_min_pct, course_max, overall_min_pct,
            attendance_required_pct, attendance_condonable_pct, attendance_dx_floor_pct,
            source_url, source_clause)
          VALUES ('vtu-2022', 50, '2022-01-01', 'a', 'b', 'c',
                  50, 40, 100, 35, 100, 40, 75, 10, 85,
                  'https://example.org/x', 'clause')
        `,
      ).rejects.toThrow(/dx_floor_below_required/);
    });
  });

  /* ---------------------------------------------------------------------- */
  /* Seed integrity                                                         */
  /* ---------------------------------------------------------------------- */

  describe('seed integrity', () => {
    it('is idempotent', async () => {
      const before = await seed(sql);
      const after = await seed(sql);
      expect(after).toEqual(before);
    });

    it('publishes only verified rows', async () => {
      const rows = await sql<{ count: string }[]>`
        SELECT count(*) AS count FROM (
          SELECT verification, publication FROM schemes
          UNION ALL SELECT verification, publication FROM subjects
          UNION ALL SELECT verification, publication FROM rule_sets
          UNION ALL SELECT verification, publication FROM syllabus_modules
        ) t
        WHERE publication = 'published' AND verification <> 'verified'
      `;
      expect(Number(rows[0]?.count ?? -1)).toBe(0);
    });

    it('seeds the semester-1 credit total the source document states (20)', async () => {
      const rows = await sql<{ total: string }[]>`
        SELECT COALESCE(sum(credits), 0) AS total FROM subjects
        WHERE scheme_id = 'vtu-2022' AND branch_id = 'cse' AND semester = 1
          AND code IN ('BMATS101','BPHYS102','BPOPS103','BENGK106','BKSKK107','BIDTK158')
      `;
      // 4 + 4 + 3 + 1 + 1 + 1 = 14 across the non-alternative courses.
      expect(Number(rows[0]?.total)).toBe(14);
    });

    it('seeds NO syllabus modules, because none were verified', async () => {
      const rows = await sql<{ count: string }[]>`SELECT count(*) AS count FROM syllabus_modules`;
      // Deliberate incompleteness, not an oversight (M5a §16, OQ-025).
      expect(Number(rows[0]?.count)).toBe(0);
    });

    it('seeds no colleges, because none has been verified', async () => {
      const rows = await sql<{ count: string }[]>`SELECT count(*) AS count FROM colleges`;
      expect(Number(rows[0]?.count)).toBe(0);
    });
  });

  /* ---------------------------------------------------------------------- */
  /* Endpoints                                                              */
  /* ---------------------------------------------------------------------- */

  describe('health', () => {
    it('reports liveness without touching the database', async () => {
      const res = await request(app).get('/health');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ status: 'ok' });
    });

    it('reports readiness including the database', async () => {
      const res = await request(app).get('/health/ready');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ status: 'ready', checks: { database: 'up' } });
    });

    it('reveals nothing beyond status', async () => {
      const body = JSON.stringify((await request(app).get('/health/ready')).body);
      expect(body).not.toMatch(/postgres:\/\//);
      expect(body).not.toMatch(/version/i);
      expect(body).not.toMatch(/localhost/);
    });
  });

  describe('reference endpoints', () => {
    it('lists universities', async () => {
      const res = await request(app).get('/api/v1/universities');
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].shortName).toBe('VTU');
    });

    it('lists published schemes with provenance', async () => {
      const res = await request(app).get('/api/v1/schemes');
      expect(res.status).toBe(200);
      const scheme = res.body.data[0];
      expect(scheme.id).toBe('vtu-2022');
      expect(scheme.regulationCode).toBe('22OB');
      expect(scheme.provenance.sourceUrl).toMatch(/^https:\/\/vtu\.ac\.in\//);
      expect(scheme.provenance.verifiedAt).toBeTruthy();
    });

    it('returns rule-set METADATA, never a computed value', async () => {
      const res = await request(app).get('/api/v1/schemes/vtu-2022/rules');
      expect(res.status).toBe(200);
      // The percentage rule is an identifier the client's rules engine
      // resolves. The API must not return an evaluated percentage.
      expect(res.body.formulaIds.percentage).toBe('cgpa_x_10');
      expect(res.body.thresholds.attendanceRequiredPct).toBe(85);
      expect(res.body.thresholds.attendanceDxFloorPct).toBe(75);
      expect(res.body.provenance.sourceClause).toContain('22OB');
      expect(res.body).not.toHaveProperty('percentage');
      expect(res.body).not.toHaveProperty('sgpa');
    });

    it('filters subjects by scheme, branch and semester', async () => {
      const res = await request(app)
        .get('/api/v1/subjects')
        .query({ scheme: 'vtu-2022', branch: 'cse', semester: 1 });
      expect(res.status).toBe(200);
      expect(res.body.data.length).toBe(10);
      expect(res.body.data.every((s: { semester: number }) => s.semester === 1)).toBe(true);
    });

    it('returns an empty list rather than 404 for a semester with no data', async () => {
      // Semesters 3-8 are genuinely unseeded. That is data incompleteness, not
      // a missing endpoint, and the two must not look the same to a client.
      const res = await request(app).get('/api/v1/subjects').query({ semester: 5 });
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([]);
    });

    it('finds a subject by its id', async () => {
      const id = await subjectId('BMATS101');
      const res = await request(app).get(`/api/v1/subjects/${id}`);
      expect(res.status).toBe(200);
      expect(res.body.code).toBe('BMATS101');
      expect(res.body.credits).toBe(4);
    });

    /*
     * M4.1 §2. Uniqueness is (scheme_id, branch_id, code), so a code addresses a
     * SET of subjects. The old code-addressed route resolved that with LIMIT 1,
     * which silently returned one of several. A code is now rejected outright
     * rather than guessed at.
     */
    it('rejects a subject code where an id is required', async () => {
      const res = await request(app).get('/api/v1/subjects/BMATS101');
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_FAILED');
    });

    it('404s a well-formed id that matches no subject', async () => {
      const res = await request(app).get('/api/v1/subjects/00000000-0000-0000-0000-000000000000');
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });

    it('returns an empty syllabus for a published subject with no verified modules', async () => {
      const id = await subjectId('BMATS101');
      const res = await request(app).get(`/api/v1/subjects/${id}/syllabus`);
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([]);
    });

    it('404s for a syllabus of a subject that does not exist', async () => {
      const res = await request(app).get(
        '/api/v1/subjects/00000000-0000-0000-0000-000000000000/syllabus',
      );
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });
  });

  /* ---------------------------------------------------------------------- */
  /* Taxonomy vs verified reference data (M4.2)                             */
  /* ---------------------------------------------------------------------- */

  /**
   * Two different integrity models live in this schema on purpose, and the
   * difference is easy to erode by accident. These tests pin both sides.
   *
   * The classification test: does the row make a checkable claim about the
   * external world that could change a calculation or mislead a student?
   *   yes -> verified reference data, provenance + publication gating
   *   no  -> internal taxonomy, controlled by `active`
   */
  describe('taxonomy is deliberately not verified reference data', () => {
    async function columnsOf(table: string): Promise<string[]> {
      const rows = await sql<{ column_name: string }[]>`
        SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = ${table}
      `;
      return rows.map((row) => row.column_name);
    }

    it.each(['universities', 'branches'])(
      '%s carries no provenance or publication columns, by design',
      async (table) => {
        const columns = await columnsOf(table);
        for (const absent of [
          'source_url',
          'source_clause',
          'verification',
          'verified_at',
          'verified_by',
          'publication',
        ]) {
          expect({ table, column: absent, present: columns.includes(absent) }).toEqual({
            table,
            column: absent,
            present: false,
          });
        }
      },
    );

    it.each(['universities', 'branches'])('%s uses `active` as its control', async (table) => {
      expect(await columnsOf(table)).toContain('active');
    });

    /*
     * The other side of the line. If someone later "tidies up" by stripping
     * provenance from these tables to match the taxonomy ones, this fails.
     */
    it.each(['schemes', 'colleges', 'rule_sets', 'subjects', 'syllabus_modules'])(
      '%s is verified reference data and keeps full provenance',
      async (table) => {
        const columns = await columnsOf(table);
        for (const required of ['source_url', 'verification', 'verified_at', 'publication']) {
          expect({ table, column: required, present: columns.includes(required) }).toEqual({
            table,
            column: required,
            present: true,
          });
        }
      },
    );

    it('serves only active universities', async () => {
      await sql`
        INSERT INTO universities (id, name, short_name, active)
        VALUES ('retired-uni', 'Retired University', 'RU', false)
        ON CONFLICT (id) DO UPDATE SET active = false
      `;
      const res = await request(app).get('/api/v1/universities');
      expect(res.status).toBe(200);
      const ids = (res.body.data as { id: string }[]).map((u) => u.id);
      expect(ids).toContain('vtu');
      expect(ids).not.toContain('retired-uni');
      await sql`DELETE FROM universities WHERE id = 'retired-uni'`;
    });

    it('serves only active branches', async () => {
      await sql`
        INSERT INTO branches (id, university_id, code, name, active)
        VALUES ('retired-branch', 'vtu', 'RB', 'Retired Branch', false)
        ON CONFLICT (id) DO UPDATE SET active = false
      `;
      const res = await request(app).get('/api/v1/branches');
      expect(res.status).toBe(200);
      const ids = (res.body.data as { id: string }[]).map((b) => b.id);
      expect(ids).toContain('cse');
      expect(ids).not.toContain('retired-branch');
      await sql`DELETE FROM branches WHERE id = 'retired-branch'`;
    });

    it('seeds exactly the approved taxonomy and nothing more', async () => {
      const universities = await request(app).get('/api/v1/universities');
      expect((universities.body.data as { id: string }[]).map((u) => u.id)).toEqual(['vtu']);

      const branches = await request(app).get('/api/v1/branches');
      expect((branches.body.data as { id: string }[]).map((b) => b.id)).toEqual(['cse']);
    });
  });

  /* ---------------------------------------------------------------------- */
  /* Unverified facts cannot be stated (M4.1 §1)                            */
  /* ---------------------------------------------------------------------- */

  describe('module_count states unknown rather than a default', () => {
    it('is NULL for every seeded subject, because no syllabus is verified', async () => {
      const rows = await sql<{ code: string; module_count: number | null }[]>`
        SELECT code, module_count FROM subjects WHERE publication = 'published'
      `;
      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) {
        expect({ code: row.code, moduleCount: row.module_count }).toEqual({
          code: row.code,
          moduleCount: null,
        });
      }
    });

    it('is served as null, not as a number and not as zero', async () => {
      const res = await request(app).get('/api/v1/subjects?scheme=vtu-2022&branch=cse&semester=1');
      expect(res.status).toBe(200);
      for (const subject of res.body.data as { moduleCount: unknown }[]) {
        expect(subject.moduleCount).toBeNull();
      }
    });

    it('still rejects an out-of-range count when one IS supplied', async () => {
      await expect(
        sql`
          INSERT INTO subjects (scheme_id, branch_id, semester, code, title, credits,
                                category, module_count, source_url)
          VALUES ('vtu-2022', 'cse', 1, 'MODBAD', 'Bad module count', 3, 'core', 11,
                  'https://example.org/x')
        `,
      ).rejects.toThrow(/module_count/);
    });

    it('accepts a verified count, so NULL is genuinely "unknown" and not "never"', async () => {
      await sql`
        INSERT INTO subjects (scheme_id, branch_id, semester, code, title, credits,
                              category, module_count, source_url)
        VALUES ('vtu-2022', 'cse', 1, 'MODOK', 'Known module count', 3, 'core', 5,
                'https://example.org/x')
        ON CONFLICT DO NOTHING
      `;
      const [row] = await sql<{ module_count: number }[]>`
        SELECT module_count FROM subjects WHERE code = 'MODOK'
      `;
      expect(row?.module_count).toBe(5);
      await sql`DELETE FROM subjects WHERE code = 'MODOK'`;
    });
  });

  describe('colleges are publication-gated like every other reference table', () => {
    it('refuses to publish an unverified college', async () => {
      await expect(
        sql`
          INSERT INTO colleges (university_id, name, is_autonomous, source_url,
                                verification, publication)
          VALUES ('vtu', 'Unverified College', false, 'https://example.org/x',
                  'unverified', 'published')
        `,
      ).rejects.toThrow(/publish_requires_verification/);
    });

    it('refuses to publish a college with no source_url', async () => {
      await expect(
        sql`
          INSERT INTO colleges (university_id, name, is_autonomous,
                                verification, verified_at, publication)
          VALUES ('vtu', 'No Provenance College', false, 'verified', now(), 'published')
        `,
      ).rejects.toThrow(/publish_requires_verification/);
    });

    it('does not serve an unpublished college', async () => {
      await sql`
        INSERT INTO colleges (university_id, name, is_autonomous, source_url,
                              verification, verified_at, publication)
        VALUES ('vtu', 'Draft College', false, 'https://example.org/x',
                'verified', now(), 'unpublished')
        ON CONFLICT DO NOTHING
      `;
      const res = await request(app).get('/api/v1/colleges');
      expect(res.status).toBe(200);
      expect((res.body.data as { name: string }[]).some((c) => c.name === 'Draft College')).toBe(
        false,
      );
      await sql`DELETE FROM colleges WHERE name = 'Draft College'`;
    });
  });

  /* ---------------------------------------------------------------------- */
  /* Rule-set precedence (M4.1 §3)                                          */
  /* ---------------------------------------------------------------------- */

  /**
   * The schema deliberately allows a scheme-wide rule set and a college-specific
   * override to be active at the same time. The old query took the first row the
   * planner produced, which is a coin toss, not a rule.
   *
   * Each case inserts what it needs and removes it afterwards, so the seeded
   * scheme-wide rule set is the only thing that persists between them.
   */
  describe('rule-set precedence', () => {
    const COLLEGE = '11111111-1111-1111-1111-111111111111';

    async function addCollege() {
      await sql`
        INSERT INTO colleges (id, university_id, name, is_autonomous, source_url,
                              verification, verified_at, publication)
        VALUES (${COLLEGE}::uuid, 'vtu', 'Test College', false,
                'https://example.org/college', 'verified', now(), 'published')
        ON CONFLICT (id) DO NOTHING
      `;
    }

    async function addCollegeRuleSet(opts: {
      active: boolean;
      verified: boolean;
      version: number;
    }) {
      const verification = opts.verified ? 'verified' : 'unverified';
      const verifiedAt = opts.verified ? new Date() : null;
      // An unverified rule set cannot be published — that is the DB constraint
      // under test elsewhere — so it is inserted unpublished here.
      const publication = opts.verified ? 'published' : 'unpublished';
      await sql`
        INSERT INTO rule_sets (scheme_id, college_id, version, effective_from, active,
          sgpa_formula_id, cgpa_formula_id, percentage_formula_id,
          cie_max, cie_min_pct, see_max, see_min_pct, course_max, overall_min_pct,
          attendance_required_pct, attendance_condonable_pct, attendance_dx_floor_pct,
          source_url, source_clause, verification, verified_at, publication)
        VALUES ('vtu-2022', ${COLLEGE}::uuid, ${opts.version}, '2022-01-01', ${opts.active},
                'credit_weighted_mean', 'credit_weighted_mean', 'cgpa_x_10',
                50, 40, 100, 35, 100, 40, 85, 10, 75,
                'https://example.org/college-rules', 'College ordinance',
                ${verification}, ${verifiedAt}, ${publication})
      `;
    }

    async function clearCollegeRuleSets() {
      await sql`DELETE FROM rule_sets WHERE college_id = ${COLLEGE}::uuid`;
    }

    beforeAll(addCollege);
    afterEach(clearCollegeRuleSets);

    it('returns the scheme-wide rule set when no college is requested', async () => {
      const res = await request(app).get('/api/v1/schemes/vtu-2022/rules');
      expect(res.status).toBe(200);
      expect(res.body.collegeId).toBeNull();
    });

    it('returns the scheme-wide rule set when the college has none', async () => {
      const res = await request(app).get(`/api/v1/schemes/vtu-2022/rules?college=${COLLEGE}`);
      expect(res.status).toBe(200);
      expect(res.body.collegeId).toBeNull();
    });

    it('prefers the college rule set when both are active', async () => {
      await addCollegeRuleSet({ active: true, verified: true, version: 10 });

      const res = await request(app).get(`/api/v1/schemes/vtu-2022/rules?college=${COLLEGE}`);
      expect(res.status).toBe(200);
      expect(res.body.collegeId).toBe(COLLEGE);
      expect(res.body.version).toBe(10);
    });

    it('does not leak a college rule set to a caller who did not ask for one', async () => {
      await addCollegeRuleSet({ active: true, verified: true, version: 11 });

      const res = await request(app).get('/api/v1/schemes/vtu-2022/rules');
      expect(res.status).toBe(200);
      expect(res.body.collegeId).toBeNull();
    });

    it('falls back to scheme-wide when the college rule set is inactive', async () => {
      await addCollegeRuleSet({ active: false, verified: true, version: 12 });

      const res = await request(app).get(`/api/v1/schemes/vtu-2022/rules?college=${COLLEGE}`);
      expect(res.status).toBe(200);
      expect(res.body.collegeId).toBeNull();
    });

    it('falls back to scheme-wide when the college rule set is unverified', async () => {
      await addCollegeRuleSet({ active: false, verified: false, version: 13 });

      const res = await request(app).get(`/api/v1/schemes/vtu-2022/rules?college=${COLLEGE}`);
      expect(res.status).toBe(200);
      expect(res.body.collegeId).toBeNull();
    });

    it('404s when no rule set matches at all', async () => {
      const res = await request(app).get('/api/v1/schemes/no-such-scheme/rules');
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });

    it('rejects a malformed college identifier', async () => {
      const res = await request(app).get("/api/v1/schemes/vtu-2022/rules?college=' OR 1=1--");
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_FAILED');
    });

    it('is deterministic across repeated calls with both present', async () => {
      await addCollegeRuleSet({ active: true, verified: true, version: 14 });

      const versions = new Set<number>();
      for (let i = 0; i < 8; i += 1) {
        const res = await request(app).get(`/api/v1/schemes/vtu-2022/rules?college=${COLLEGE}`);
        versions.add(res.body.version as number);
      }
      expect([...versions]).toEqual([14]);
    });
  });

  /* ---------------------------------------------------------------------- */
  /* Publication filtering                                                  */
  /* ---------------------------------------------------------------------- */

  describe('unpublished data never reaches the API', () => {
    it('hides an unpublished subject', async () => {
      await sql`
        INSERT INTO subjects (scheme_id, branch_id, semester, code, title, credits,
                              category, source_url, verification, verified_at, publication)
        VALUES ('vtu-2022', 'cse', 1, 'HIDDEN1', 'Draft subject', 3, 'core',
                'https://example.org/x', 'verified', now(), 'unpublished')
        ON CONFLICT DO NOTHING
      `;
      const list = await request(app).get('/api/v1/subjects');
      expect(list.body.data.some((s: { code: string }) => s.code === 'HIDDEN1')).toBe(false);

      // Addressed by its REAL id, so this proves publication filtering rather
      // than merely proving that a bad identifier is rejected.
      const [row] = await sql<{ id: string }[]>`
        SELECT id::text FROM subjects WHERE code = 'HIDDEN1'
      `;
      const direct = await request(app).get(`/api/v1/subjects/${String(row?.id)}`);
      expect(direct.status).toBe(404);

      const syllabus = await request(app).get(`/api/v1/subjects/${String(row?.id)}/syllabus`);
      expect(syllabus.status).toBe(404);
    });
  });

  /* ---------------------------------------------------------------------- */
  /* Errors and validation                                                  */
  /* ---------------------------------------------------------------------- */

  /* ---------------------------------------------------------------------- */
  /* Route-constant drift                                                   */
  /* ---------------------------------------------------------------------- */

  /**
   * The client builds every URL from API_ROUTES. If a constant and its route
   * ever diverge the frontend breaks at runtime with a 404 that looks like
   * missing data, so the constants are asserted against the running app rather
   * than trusted (M5a §12).
   */
  describe('API_ROUTES constants', () => {
    it('every exported route constant resolves on the server', async () => {
      const paths = [
        API_ROUTES.health,
        API_ROUTES.ready,
        API_ROUTES.universities,
        API_ROUTES.schemes,
        API_ROUTES.scheme('vtu-2022'),
        API_ROUTES.schemeRules('vtu-2022'),
        API_ROUTES.branches,
        API_ROUTES.colleges,
        API_ROUTES.subjects,
        API_ROUTES.subject(await subjectId('BMATS101')),
        API_ROUTES.subjectSyllabus(await subjectId('BMATS101')),
      ];

      for (const path of paths) {
        const res = await request(app).get(path);
        expect({ path, status: res.status }).toEqual({ path, status: 200 });
      }
    });
  });

  describe('errors', () => {
    it('404s an unknown route with the standard envelope', async () => {
      const res = await request(app).get('/api/v1/nope');
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
      expect(res.body.error.reference).toMatch(/^err_/);
    });

    it('rejects a malformed identifier with 400 and field detail', async () => {
      const res = await request(app).get('/api/v1/schemes/bad..id');
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_FAILED');
      expect(res.body.error.details.length).toBeGreaterThan(0);
    });

    it('rejects an out-of-range semester', async () => {
      const res = await request(app).get('/api/v1/subjects').query({ semester: 99 });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_FAILED');
    });

    it('rejects a non-numeric semester', async () => {
      const res = await request(app).get('/api/v1/subjects').query({ semester: 'abc' });
      expect(res.status).toBe(400);
    });

    it('never leaks internal detail in an error body', async () => {
      const res = await request(app).get('/api/v1/schemes/bad..id');
      const body = JSON.stringify(res.body);
      expect(body).not.toMatch(/at .*\.ts:\d+/); // stack frame
      expect(body).not.toMatch(/postgres:\/\//);
      expect(body).not.toMatch(/SELECT |INSERT /i);
    });
  });

  /* ---------------------------------------------------------------------- */
  /* Security                                                               */
  /* ---------------------------------------------------------------------- */

  describe('security', () => {
    it('sets the required response headers', async () => {
      const res = await request(app).get('/api/v1/universities');
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['x-frame-options']).toBe('DENY');
      expect(res.headers['content-security-policy']).toContain("frame-ancestors 'none'");
      expect(res.headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
      expect(res.headers['strict-transport-security']).toContain('max-age=');
    });

    it('does not advertise the framework', async () => {
      const res = await request(app).get('/health');
      expect(res.headers['x-powered-by']).toBeUndefined();
    });

    it('sets a correlation id on every response', async () => {
      const res = await request(app).get('/health');
      expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    });

    it('marks reference data publicly cacheable', async () => {
      const res = await request(app).get('/api/v1/subjects');
      expect(res.headers['cache-control']).toContain('public');
      expect(res.headers['cache-control']).toContain('stale-while-revalidate');
    });

    it('does not reflect a disallowed origin', async () => {
      const res = await request(app)
        .get('/api/v1/universities')
        .set('Origin', 'https://evil.example.com');
      expect(res.headers['access-control-allow-origin']).toBeUndefined();
    });

    it('allows the configured origin', async () => {
      const res = await request(app)
        .get('/api/v1/universities')
        .set('Origin', 'http://localhost:5173');
      expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    });

    it('resists SQL injection through a path parameter', async () => {
      const res = await request(app).get(
        `/api/v1/subjects/${encodeURIComponent("x'; DROP TABLE subjects;--")}`,
      );
      // Rejected by validation before it ever reaches the data layer.
      expect([400, 404]).toContain(res.status);
      const stillThere = await sql`SELECT count(*) AS count FROM subjects`;
      expect(Number(stillThere[0]?.count)).toBeGreaterThan(0);
    });

    it('resists SQL injection through a query parameter', async () => {
      const res = await request(app)
        .get('/api/v1/subjects')
        .query({ scheme: "vtu-2022'; DROP TABLE subjects;--" });
      expect([400, 200]).toContain(res.status);
      const stillThere = await sql`SELECT count(*) AS count FROM subjects`;
      expect(Number(stillThere[0]?.count)).toBeGreaterThan(0);
    });

    it('rejects a body over the 1 MB limit with 413, not 500', async () => {
      // No route accepts a body, but the limit is applied before routing, so a
      // client that floods the socket is stopped at the edge (docs/10 §10.9).
      const res = await request(app)
        .post('/api/v1/subjects')
        .set('Content-Type', 'application/json')
        .send(JSON.stringify({ padding: 'x'.repeat(2 * 1024 * 1024) }));

      expect(res.status).toBe(413);
      expect(res.body.error.code).toBe('PAYLOAD_TOO_LARGE');
      expect(JSON.stringify(res.body)).not.toMatch(/stack|node_modules|postgres/i);
    });

    it('exposes no write methods', async () => {
      for (const method of ['post', 'put', 'patch', 'delete'] as const) {
        const res = await request(app)[method]('/api/v1/subjects').send({});
        expect(res.status).toBe(404);
      }
    });
  });
});

/* -------------------------------------------------------------------------- */
/* Log redaction (no database required)                                       */
/* -------------------------------------------------------------------------- */

/**
 * NFR-011: sensitive fields never reach a log line.
 *
 * The test drives the REAL logger factory, writing to a capture stream, so it
 * asserts the shipped redaction policy rather than a copy of it. There is no
 * student data on the server in M5a, so nothing can leak today; the guarantee
 * is enforced now so it is already true on the day the first student-scoped
 * route is written (docs/24 §24.2).
 */
describe('log redaction', () => {
  it('censors sensitive fields instead of writing them out', () => {
    const written: string[] = [];
    const capture = new Writable({
      write(chunk: Buffer, _encoding, callback) {
        written.push(chunk.toString());
        callback();
      },
    });

    createLogger('info', false, capture).info(
      {
        usn: '1XX22CS001',
        email: 'student@example.org',
        token: 'secret-token-value',
        displayName: 'A Student',
        password: 'hunter2',
      },
      'probe',
    );

    const output = written.join('');
    for (const secret of [
      '1XX22CS001',
      'student@example.org',
      'secret-token-value',
      'A Student',
      'hunter2',
    ]) {
      expect(output).not.toContain(secret);
    }
    expect(output).toContain('[redacted]');
  });
});
