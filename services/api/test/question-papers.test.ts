/**
 * The question-paper library: visibility, filters, search and the file route.
 *
 * Authority: docs/09 §9.17 · docs/13 §13.16 · docs/22 §22.16 · M8 §40
 *
 * A REAL DATABASE. Every rule worth testing here is a database guarantee — the
 * rights gate, the mutually-exclusive taxonomy, the publication state — and
 * none of them exists in a mock.
 *
 * SYNTHETIC CONTENT ONLY. Nothing in this file is a real question paper, and
 * no PDF is committed: the two bytes-bearing fixtures are generated inline.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createHash } from 'node:crypto';
import { loadConfig } from '../src/config.js';
import { createClient, type Sql } from '../src/db/client.js';
import { runMigrations } from '../src/db/migrate.js';
import { seed } from '../src/db/seed.js';
import { createApp } from '../src/http/app.js';
import { createLogger } from '../src/observability/logger.js';
import { MemoryObjectStore, storageKeyFor } from '../src/documents/storage.js';

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeDb = DATABASE_URL === undefined ? describe.skip : describe;

/** Enough of a PDF to be stored and served. Not a real paper. */
const PDF_BYTES = Buffer.from('%PDF-1.4\n% synthetic test fixture\n%%EOF\n', 'latin1');

interface Fixture {
  readonly title: string;
  readonly presentation: 'host' | 'link' | 'private' | 'blocked';
  readonly kind?: 'question_paper' | 'syllabus';
  readonly state?: 'validated' | 'quarantined' | 'rejected';
  readonly subjectCode?: string | null;
  readonly semester?: number | null;
  readonly examYear?: number | null;
  readonly examSession?: string | null;
  readonly format?: 'descriptive' | 'mcq' | 'unknown';
  readonly sourceUrl?: string | null;
  readonly useCatalogueSubject?: string;
}

describeDb('the question-paper library', () => {
  let sql: Sql;
  let app: Express;
  const store = new MemoryObjectStore();
  const logger = createLogger('silent', false);
  const ids = new Map<string, string>();

  async function insert(fixture: Fixture): Promise<string> {
    const held = fixture.presentation === 'host' || fixture.presentation === 'private';
    const sha256 = createHash('sha256').update(fixture.title).digest('hex');
    const storageKey = held ? storageKeyFor(sha256) : null;
    if (storageKey !== null) await store.put(storageKey, PDF_BYTES);

    const catalogued =
      fixture.useCatalogueSubject === undefined
        ? null
        : ((
            await sql<{ id: string }[]>`
              SELECT id::text FROM subjects WHERE code = ${fixture.useCatalogueSubject} LIMIT 1
            `
          )[0]?.id ?? null);

    const rights =
      fixture.presentation === 'private'
        ? 'user_private'
        : fixture.presentation === 'blocked'
          ? 'unknown'
          : 'permitted';

    const [row] = await sql<{ id: string }[]>`
      INSERT INTO documents (
        source_id, title, sha256, byte_size, mime_type, page_count, storage_key,
        state, extraction_status, rights_status, rights_determined_at, presentation,
        source_url, document_kind, paper_format,
        subject_id, subject_code, scheme_id, branch_id, semester, exam_year, exam_session
      ) VALUES (
        NULL, ${fixture.title}, ${sha256}, ${PDF_BYTES.length}, 'application/pdf', 2,
        ${storageKey}, ${fixture.state ?? 'validated'}, 'text_available',
        ${rights}, ${rights === 'permitted' ? new Date().toISOString() : null},
        ${fixture.presentation}, ${fixture.sourceUrl ?? null},
        ${fixture.kind ?? 'question_paper'}, ${fixture.format ?? 'descriptive'},
        ${catalogued}::uuid,
        ${catalogued === null ? (fixture.subjectCode ?? null) : null},
        ${catalogued === null ? 'vtu-2022' : null},
        ${catalogued === null ? 'cse' : null},
        ${catalogued === null ? (fixture.semester ?? null) : null},
        ${fixture.examYear ?? null}, ${fixture.examSession ?? null}
      )
      RETURNING id::text
    `;
    const id = row?.id as string;
    ids.set(fixture.title, id);
    return id;
  }

  beforeAll(async () => {
    sql = createClient(DATABASE_URL as string);
    await runMigrations(sql);
    await seed(sql);
    app = createApp(
      loadConfig({ DATABASE_URL, NODE_ENV: 'test', APP_ENV: 'test' }),
      sql,
      logger,
      store,
    );
  }, 60_000);

  afterAll(async () => {
    await sql.end();
  });

  beforeEach(async () => {
    await sql`DELETE FROM documents`;
    ids.clear();

    await insert({
      title: 'Hosted descriptive paper, 2025',
      presentation: 'host',
      subjectCode: 'BCS403',
      semester: 4,
      examYear: 2025,
      examSession: 'June/July 2025',
    });
    await insert({
      title: 'Hosted MCQ paper, 2024',
      presentation: 'host',
      subjectCode: 'BCS401',
      semester: 4,
      examYear: 2024,
      format: 'mcq',
    });
    await insert({
      title: 'Catalogued subject paper',
      presentation: 'host',
      useCatalogueSubject: 'BMATS101',
      examYear: 2023,
    });
    await insert({
      title: 'Paper with no year at all',
      presentation: 'host',
      subjectCode: 'BCS999',
      semester: 6,
      examYear: null,
      format: 'unknown',
    });
    await insert({
      title: 'Link-only paper, 2022',
      presentation: 'link',
      subjectCode: 'BCS303',
      semester: 3,
      examYear: 2022,
      sourceUrl: 'https://example.org/demo/bcs303-2022',
    });
    await insert({ title: 'Private paper', presentation: 'private', subjectCode: 'BCS402' });
    await insert({ title: 'Blocked paper', presentation: 'blocked', subjectCode: 'BCS404' });
    await insert({
      title: 'A syllabus document, not a paper',
      presentation: 'host',
      kind: 'syllabus',
      subjectCode: 'BCS403',
    });
  });

  /* ------------------------------------------------------------------------ */
  /* Visibility                                                               */
  /* ------------------------------------------------------------------------ */

  describe('what a student may see', () => {
    it('lists host and link papers and nothing else', async () => {
      const response = await request(app).get('/api/v1/question-papers').expect(200);
      const titles = (response.body.data as { title: string }[]).map((paper) => paper.title);

      expect(titles).toContain('Hosted descriptive paper, 2025');
      expect(titles).toContain('Link-only paper, 2022');
      expect(titles).not.toContain('Private paper');
      expect(titles).not.toContain('Blocked paper');
    });

    /*
     * A SYLLABUS IS NOT A QUESTION PAPER. It is publicly visible and would have
     * appeared in the library if the kind were guessed at rather than recorded.
     */
    it('excludes documents that are not question papers', async () => {
      const response = await request(app).get('/api/v1/question-papers').expect(200);
      const titles = (response.body.data as { title: string }[]).map((paper) => paper.title);
      expect(titles).not.toContain('A syllabus document, not a paper');
    });

    /*
     * Rights and safety are independent, and both are required (M5.1 §2). An
     * unvalidated paper cannot even be STORED as publicly visible, so the
     * library cannot show one — a stronger guarantee than filtering it out.
     */
    it('cannot store an unvalidated paper as publicly visible at all', async () => {
      await expect(
        sql`
          INSERT INTO documents (
            title, sha256, byte_size, mime_type, state, presentation, document_kind,
            rights_status, rights_determined_at, source_url
          ) VALUES (
            'Unvalidated but public', ${'f'.repeat(64)}, 10, 'application/pdf',
            'quarantined', 'link', 'question_paper', 'permitted', now(),
            'https://example.org/demo/unvalidated'
          )
        `,
      ).rejects.toThrow(/document_public_requires_validation/);
    });

    /*
     * NOT FOUND, NOT FORBIDDEN. "It exists but is not yours" is itself a
     * disclosure about someone else's document (M8 §29).
     */
    it('returns 404 for a private paper by id', async () => {
      await request(app)
        .get(`/api/v1/question-papers/${ids.get('Private paper') as string}`)
        .expect(404);
    });

    it('returns 404 for a blocked paper by id', async () => {
      await request(app)
        .get(`/api/v1/question-papers/${ids.get('Blocked paper') as string}`)
        .expect(404);
    });

    it('serves a host paper by id', async () => {
      const response = await request(app)
        .get(`/api/v1/question-papers/${ids.get('Hosted descriptive paper, 2025') as string}`)
        .expect(200);
      expect(response.body.availability).toBe('host');
      expect(response.body.subjectCode).toBe('BCS403');
    });
  });

  /* ------------------------------------------------------------------------ */
  /* The file route                                                           */
  /* ------------------------------------------------------------------------ */

  describe('opening a paper', () => {
    it('serves the bytes of a hosted paper', async () => {
      const response = await request(app)
        .get(`/api/v1/question-papers/${ids.get('Hosted descriptive paper, 2025') as string}/file`)
        .expect(200);

      expect(response.headers['content-type']).toContain('application/pdf');
      expect(response.headers['x-content-type-options']).toBe('nosniff');
      // A generated name, never the stored original filename.
      expect(response.headers['content-disposition']).toContain('inline; filename="paper-');
    });

    /* GRADTOOLS IS NOT A PROXY (M8 §15). A link paper has no bytes here. */
    it('refuses to serve a file for a link-only paper', async () => {
      await request(app)
        .get(`/api/v1/question-papers/${ids.get('Link-only paper, 2022') as string}/file`)
        .expect(404);
    });

    it('refuses to serve a private paper', async () => {
      await request(app)
        .get(`/api/v1/question-papers/${ids.get('Private paper') as string}/file`)
        .expect(404);
    });

    it('refuses to serve a blocked paper', async () => {
      await request(app)
        .get(`/api/v1/question-papers/${ids.get('Blocked paper') as string}/file`)
        .expect(404);
    });

    /*
     * PATH TRAVERSAL HAS NO INPUT TO WORK WITH (M8 §30). The only parameter is
     * a uuid, and anything that is not one is rejected before a storage key is
     * ever resolved.
     */
    it('refuses anything that is not an opaque id', async () => {
      for (const hostile of [
        '../../etc/passwd',
        '..%2f..%2fetc%2fpasswd',
        'C:%5CWindows%5Csystem32',
        'aa/bb/cc',
        'not-a-uuid',
        '00000000-0000-0000-0000-00000000000',
      ]) {
        const response = await request(app).get(`/api/v1/question-papers/${hostile}/file`);
        expect([400, 404]).toContain(response.status);
      }
    });

    /* A well-formed id for a paper that does not exist is a plain 404. */
    it('returns 404 for an unknown but well-formed id', async () => {
      await request(app)
        .get('/api/v1/question-papers/11111111-2222-4333-8444-555555555555/file')
        .expect(404);
    });

    /*
     * The app-wide policy is `frame-ancestors 'none'`. The file route is the
     * one narrow exception, and `X-Frame-Options` must not survive to override
     * it (M8 §14).
     */
    it('permits framing only from the configured origins', async () => {
      const response = await request(app)
        .get(`/api/v1/question-papers/${ids.get('Hosted descriptive paper, 2025') as string}/file`)
        .expect(200);

      expect(response.headers['content-security-policy']).toContain('frame-ancestors');
      expect(response.headers['content-security-policy']).not.toContain("frame-ancestors 'none'");
      expect(response.headers['x-frame-options']).toBeUndefined();
    });
  });

  /* ------------------------------------------------------------------------ */
  /* Search and filters                                                       */
  /* ------------------------------------------------------------------------ */

  describe('finding a paper', () => {
    it('searches by subject code, case-insensitively', async () => {
      const response = await request(app).get('/api/v1/question-papers?search=bcs403').expect(200);
      const titles = (response.body.data as { title: string }[]).map((paper) => paper.title);
      expect(titles).toEqual(['Hosted descriptive paper, 2025']);
    });

    it('searches by the sitting and by the year', async () => {
      const bySession = await request(app)
        .get('/api/v1/question-papers?search=June/July')
        .expect(200);
      expect(bySession.body.total).toBe(1);

      const byYear = await request(app).get('/api/v1/question-papers?search=2022').expect(200);
      expect((byYear.body.data as { title: string }[])[0]?.title).toBe('Link-only paper, 2022');
    });

    /*
     * `%` IS A CHARACTER, NOT A WILDCARD (M8 §9). Without escaping, a search
     * for `%` would match the entire library, which is the opposite of what a
     * student asked for.
     */
    it('treats wildcard characters in a search as literal text', async () => {
      const response = await request(app).get('/api/v1/question-papers?search=%25').expect(200);
      expect(response.body.total).toBe(0);
    });

    it('finds nothing rather than everything for an unmatched search', async () => {
      const response = await request(app)
        .get('/api/v1/question-papers?search=zzzznotapaper')
        .expect(200);
      expect(response.body.total).toBe(0);
    });

    it('filters by semester, year and format, and composes them', async () => {
      const bySemester = await request(app).get('/api/v1/question-papers?semester=4').expect(200);
      expect(bySemester.body.total).toBe(2);

      const byFormat = await request(app).get('/api/v1/question-papers?format=mcq').expect(200);
      expect(byFormat.body.total).toBe(1);

      const composed = await request(app)
        .get('/api/v1/question-papers?semester=4&year=2024&format=mcq')
        .expect(200);
      expect(composed.body.total).toBe(1);
      expect((composed.body.data as { title: string }[])[0]?.title).toBe('Hosted MCQ paper, 2024');
    });

    /*
     * A stale or hand-edited URL should show the library, not an error page
     * (M8 §28). This is deliberately different from the announcement category,
     * which is a closed set a client should never get wrong.
     */
    it('ignores an out-of-range filter rather than failing', async () => {
      const response = await request(app).get('/api/v1/question-papers?semester=99').expect(200);
      expect(response.body.total).toBeGreaterThan(0);
    });

    it('offers only filter values that would return something', async () => {
      const response = await request(app).get('/api/v1/question-papers/filters').expect(200);

      expect(response.body.semesters).toContain(4);
      // The private paper's subject must not leak through the filter list.
      const codes = (response.body.subjects as { code: string }[]).map((s) => s.code);
      expect(codes).not.toContain('BCS402');
      expect(codes).not.toContain('BCS404');
      // A year is a year. "Unknown" is not one of them.
      expect(response.body.years).not.toContain(null);
    });
  });

  /* ------------------------------------------------------------------------ */
  /* Metadata                                                                 */
  /* ------------------------------------------------------------------------ */

  describe('what a paper record says', () => {
    /* Taxonomy from the catalogue when the subject is in it (M8 §7). */
    it('takes scheme, branch and semester from a catalogued subject', async () => {
      const response = await request(app)
        .get(`/api/v1/question-papers/${ids.get('Catalogued subject paper') as string}`)
        .expect(200);

      expect(response.body.subjectId).not.toBeNull();
      expect(response.body.subjectCode).toBe('BMATS101');
      expect(response.body.subjectTitle).toBe('Mathematics-I for CSE Stream');
      expect(response.body.semester).toBe(1);
      expect(response.body.schemeId).toBe('vtu-2022');
    });

    /* UNKNOWN STAYS UNKNOWN (M8 §7). Nothing fills it in. */
    it('reports a missing year as null rather than guessing one', async () => {
      const response = await request(app)
        .get(`/api/v1/question-papers/${ids.get('Paper with no year at all') as string}`)
        .expect(200);

      expect(response.body.examYear).toBeNull();
      expect(response.body.examSession).toBeNull();
      expect(response.body.paperFormat).toBe('unknown');
    });

    /*
     * PROVENANCE AND RIGHTS ARE SEPARATE FIELDS (M8 §6). A link paper has a
     * source URL and is still not something GradTools may serve.
     */
    it('reports a link paper as link, with its original URL', async () => {
      const response = await request(app)
        .get(`/api/v1/question-papers/${ids.get('Link-only paper, 2022') as string}`)
        .expect(200);

      expect(response.body.availability).toBe('link');
      expect(response.body.sourceUrl).toBe('https://example.org/demo/bcs303-2022');
    });

    /* NULL YEARS SORT LAST, in both directions (M8 §11). */
    it('never puts an unknown year at the head of a year-ordered list', async () => {
      const oldest = await request(app).get('/api/v1/question-papers?sort=oldest').expect(200);
      const titles = (oldest.body.data as { title: string }[]).map((paper) => paper.title);

      expect(titles[0]).toBe('Link-only paper, 2022');
      expect(titles.at(-1)).toBe('Paper with no year at all');
    });

    it('orders newest sitting first by default', async () => {
      const response = await request(app).get('/api/v1/question-papers').expect(200);
      const years = (response.body.data as { examYear: number | null }[]).map(
        (paper) => paper.examYear,
      );
      expect(years[0]).toBe(2025);
    });
  });

  /* ------------------------------------------------------------------------ */
  /* The database's own rules                                                 */
  /* ------------------------------------------------------------------------ */

  describe('constraints', () => {
    /*
     * THE TAXONOMY IS STATED ONCE (docs/09 §9.17). If both homes could be set
     * they could disagree, and "which semester is this paper for" would have
     * two answers.
     */
    it('refuses a paper that names a subject both ways', async () => {
      const [subject] = await sql<{ id: string }[]>`
        SELECT id::text FROM subjects WHERE code = 'BMATS101' LIMIT 1
      `;
      await expect(
        sql`
          INSERT INTO documents (
            title, sha256, byte_size, mime_type, state, presentation, document_kind,
            subject_id, subject_code, semester
          ) VALUES (
            'Contradictory taxonomy', ${'c'.repeat(64)}, 10, 'application/pdf',
            'validated', 'blocked', 'question_paper',
            ${subject?.id as string}::uuid, 'BCS403', 4
          )
        `,
      ).rejects.toThrow(/document_subject_is_stated_once/);
    });

    /* Hosting requires a dated rights determination. OQ-008 is still open. */
    it('refuses to host a paper whose rights were never determined', async () => {
      await expect(
        sql`
          INSERT INTO documents (
            title, sha256, byte_size, mime_type, state, presentation, document_kind, rights_status
          ) VALUES (
            'Hosted without rights', ${'d'.repeat(64)}, 10, 'application/pdf',
            'validated', 'host', 'question_paper', 'unknown'
          )
        `,
      ).rejects.toThrow(/document_host_requires_rights/);
    });

    it('refuses a semester outside an eight-semester degree', async () => {
      await expect(
        sql`
          INSERT INTO documents (
            title, sha256, byte_size, mime_type, state, presentation, document_kind, semester
          ) VALUES (
            'Semester nine', ${'e'.repeat(64)}, 10, 'application/pdf',
            'validated', 'blocked', 'question_paper', 9
          )
        `,
      ).rejects.toThrow();
    });
  });

  /* ------------------------------------------------------------------------ */
  /* Privacy                                                                  */
  /* ------------------------------------------------------------------------ */

  describe('the library learns nothing about who is asking', () => {
    /*
     * NO STUDENT CONTEXT (M8 §25). A branch or semester parameter used for
     * personalisation is indistinguishable from one used for profiling, so
     * filters exist and personalisation does not — the same result comes back
     * whoever asks.
     */
    it('returns the same library whatever a caller claims about themselves', async () => {
      const plain = await request(app).get('/api/v1/question-papers').expect(200);
      const withClaims = await request(app)
        .get('/api/v1/question-papers?usn=1XX22CS001&branch=cse&profileId=abc')
        .expect(200);

      expect(withClaims.body.total).toBe(plain.body.total);
    });

    /* A search reflects a person; a shared cache is the wrong place for it. */
    it('does not allow a shared cache to hold a search result', async () => {
      const searched = await request(app).get('/api/v1/question-papers?search=BCS403').expect(200);
      expect(searched.headers['cache-control']).toBe('private, no-store');

      const plain = await request(app).get('/api/v1/question-papers').expect(200);
      expect(plain.headers['cache-control']).toContain('public');
    });
  });
});
