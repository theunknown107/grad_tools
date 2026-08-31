/**
 * Cross-paper question search.
 *
 * Authority: docs/18 (M10B) · M10B §6, §7, §8, §23, §24, §41, §42, §48, §49
 *
 * Runs against real PostgreSQL (M10B §48). The fixtures below deliberately
 * include the states the real corpus is full of: a document the library may not
 * show, a superseded parser version, a question with no text at all, and text
 * carrying markup and a bidirectional override.
 */

import { createHash } from 'node:crypto';
import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClient, type Sql } from '../src/db/client.js';
import { runMigrations } from '../src/db/migrate.js';
import { seed } from '../src/db/seed.js';
import { createApp } from '../src/http/app.js';
import { loadConfig } from '../src/config.js';
import { createLogger } from '../src/observability/logger.js';
import { MemoryObjectStore } from '../src/documents/storage.js';

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeDb = DATABASE_URL === undefined ? describe.skip : describe;

const PDF = Buffer.from('%PDF-1.4 test');

describeDb('question search', () => {
  let sql: Sql;
  let app: Express;
  const store = new MemoryObjectStore();

  /** Insert a document, one extraction, and its questions. */
  async function paper(options: {
    title: string;
    presentation?: 'host' | 'link' | 'private' | 'blocked';
    state?: string;
    subjectCode?: string;
    semester?: number;
    examYear?: number;
    parserVersion?: string;
    isCurrent?: boolean;
    questions: { number: string; text: string; module?: string; marks?: number }[];
  }): Promise<string> {
    const sha256 = createHash('sha256').update(options.title).digest('hex');
    const presentation = options.presentation ?? 'link';
    const rights =
      presentation === 'private'
        ? 'user_private'
        : presentation === 'blocked'
          ? 'unknown'
          : 'permitted';

    const [document] = await sql<{ id: string }[]>`
      INSERT INTO documents (
        source_id, title, sha256, byte_size, mime_type, page_count, storage_key,
        state, extraction_status, rights_status, rights_determined_at, presentation,
        source_url, document_kind, paper_format,
        subject_code, scheme_id, branch_id, semester, exam_year, exam_session
      ) VALUES (
        NULL, ${options.title}, ${sha256}, ${PDF.length}, 'application/pdf', 2, NULL,
        ${options.state ?? 'validated'}, 'text_available',
        ${rights}, ${rights === 'permitted' ? new Date().toISOString() : null},
        ${presentation}, 'https://example.org/p.pdf', 'question_paper', 'descriptive',
        ${options.subjectCode ?? 'BCS501'}, 'vtu-2022', 'cse',
        ${options.semester ?? 5}, ${options.examYear ?? 2024}, 'June/July'
      ) RETURNING id::text
    `;
    const documentId = document?.id as string;

    const [extraction] = await sql<{ id: string }[]>`
      INSERT INTO extracted_papers (
        document_id, paper_format, extraction_source, parser_version,
        extraction_version, is_current, page_count, question_count, mcq_item_count
      ) VALUES (
        ${documentId}::uuid, 'descriptive', 'native',
        ${options.parserVersion ?? 'positional-v2'},
        ${options.isCurrent === false ? 1 : 2}, ${options.isCurrent ?? true},
        2, ${options.questions.length}, 0
      ) RETURNING id::text
    `;
    const paperId = extraction?.id as string;

    let ordinal = 0;
    for (const question of options.questions) {
      await sql`
        INSERT INTO extracted_questions (
          paper_id, paper_format, ordinal, question_number, module, question_text,
          marks, page_number, bbox_x, bbox_y, bbox_width, bbox_height,
          confidence, needs_review, review_state
        ) VALUES (
          ${paperId}::uuid, 'descriptive', ${ordinal}, ${question.number},
          ${question.module ?? 'Module-1'}, ${question.text},
          ${question.marks ?? 10}, 1, 0, 0, 100, 20,
          'high', false, 'unreviewed'
        )
      `;
      ordinal += 1;
    }
    return documentId;
  }

  beforeAll(async () => {
    sql = createClient(DATABASE_URL as string);
    await runMigrations(sql);
    await seed(sql);
    app = createApp(
      loadConfig({ DATABASE_URL, NODE_ENV: 'test', APP_ENV: 'test' }),
      sql,
      createLogger('silent', false),
      store,
    );

    await sql`DELETE FROM documents WHERE title LIKE 'QS %'`;

    await paper({
      title: 'QS visible 2024',
      subjectCode: 'BCS501',
      examYear: 2024,
      questions: [
        { number: '1a', text: 'Explain duties of certifying authority.', marks: 8 },
        { number: '1b', text: 'Define embedded system and explain the classification', marks: 10 },
        /*
         * Empty extracted text, which is what the real corpus is full of: 65 of
         * its 126 current questions have a zero-length question_text. The
         * column is NOT NULL, so "no text" is '' rather than null.
         */
        { number: '2a', text: '' },
        { number: '2b', text: '   ' },
      ],
    });

    await paper({
      title: 'QS visible 2023',
      subjectCode: 'BCS502',
      semester: 5,
      examYear: 2023,
      questions: [{ number: '1a', text: 'State and prove Varignon theorem.', module: 'Module-3' }],
    });

    /* A superseded extraction of a visible document (M10B §24). */
    await paper({
      title: 'QS superseded',
      subjectCode: 'BCS503',
      parserVersion: 'positional-v1',
      isCurrent: false,
      questions: [{ number: '1a', text: 'Superseded parser question about routing.' }],
    });

    /* Not visible to the library at all (M10B §42). */
    await paper({
      title: 'QS private',
      presentation: 'private',
      subjectCode: 'BCS504',
      questions: [{ number: '1a', text: 'Private question about certifying authority.' }],
    });

    await paper({
      title: 'QS hostile',
      subjectCode: 'BCS505',
      questions: [
        {
          number: '1a',
          text: '<script>alert(1)</script> Explain ‮reversed‬ normalisation',
        },
      ],
    });
  });

  afterAll(async () => {
    await sql`DELETE FROM documents WHERE title LIKE 'QS %'`;
    await sql.end();
  });

  const search = (query: string) => request(app).get(`/api/v1/questions/search?${query}`);

  it('finds a question across papers and reports where it came from', async () => {
    const response = await search('search=certifying').expect(200);
    expect(response.body.total).toBe(1);

    const hit = response.body.data[0];
    expect(hit.text).toContain('certifying authority');
    /* Provenance: a hit must be traceable to its paper (M10B §47). */
    expect(hit.paperTitle).toBe('QS visible 2024');
    expect(hit.subjectCode).toBe('BCS501');
    expect(hit.examYear).toBe(2024);
    expect(hit.questionNumber).toBe('1a');
    expect(hit.parserVersion).toBe('positional-v2');
    expect(hit.extractionSource).toBe('native');
    expect(hit.isReviewed).toBe(false);
    expect(hit.confidence).toBe('high');
  });

  it('states which normalisation the caller is looking at', async () => {
    const response = await search('search=certifying').expect(200);
    expect(response.body.normalizationVersion).toBe('question-normalization-v1');
  });

  /* --- Visibility: the same rule as the library (M10B §42) ---------------- */

  it('never returns a question from a document the library may not show', async () => {
    const response = await search('search=certifying').expect(200);
    const titles = response.body.data.map((row: { paperTitle: string }) => row.paperTitle);
    expect(titles).not.toContain('QS private');
    // The private paper's question also matches "certifying" — so its absence
    // is the visibility rule working, not the search term missing it.
    expect(response.body.total).toBe(1);
  });

  /* --- Parser versions are isolated (M10B §24) ---------------------------- */

  it('searches only the current extraction, not a superseded one', async () => {
    const response = await search('search=Superseded').expect(200);
    expect(response.body.total).toBe(0);
  });

  /* --- Empty text is not a result (M10B §25) ------------------------------ */

  it('excludes questions with no extracted text', async () => {
    const response = await search('subject=BCS501').expect(200);
    // Four questions were inserted; two have null/empty text.
    expect(response.body.total).toBe(2);
  });

  /* --- Filters (M10B §6) --------------------------------------------------- */

  it('filters by subject, year and module', async () => {
    expect((await search('subject=BCS502').expect(200)).body.total).toBe(1);
    expect((await search('year=2023').expect(200)).body.total).toBe(1);
    expect((await search('module=Module-3').expect(200)).body.total).toBe(1);
    expect((await search('subject=BCS502&year=2024').expect(200)).body.total).toBe(0);
  });

  it('filters by marks', async () => {
    const response = await search('marks=8').expect(200);
    expect(response.body.total).toBe(1);
    expect(response.body.data[0].marks).toBe(8);
  });

  it('matches case-insensitively', async () => {
    expect((await search('search=CERTIFYING').expect(200)).body.total).toBe(1);
    expect((await search('search=certifying').expect(200)).body.total).toBe(1);
  });

  it('treats a wildcard in the query as a literal, not as a pattern', async () => {
    // '%' must not select everything.
    const response = await search('search=%25').expect(200);
    expect(response.body.total).toBe(0);
  });

  /* --- Bounded by construction (M10B §41) --------------------------------- */

  it('caps the page size however large a limit is asked for', async () => {
    const response = await search('limit=100000').expect(200);
    expect(response.body.limit).toBeLessThanOrEqual(100);
  });

  it('orders stably, so paging cannot duplicate or drop a row', async () => {
    const first = await search('limit=50').expect(200);
    const second = await search('limit=50').expect(200);
    expect(second.body.data.map((r: { id: string }) => r.id)).toEqual(
      first.body.data.map((r: { id: string }) => r.id),
    );
  });

  /* --- Untrusted text (M10B §8, §41, §55) --------------------------------- */

  it('returns hostile question text as data, neither executing nor stripping it', async () => {
    const response = await search('search=reversed').expect(200);
    expect(response.body.total).toBe(1);
    const text = response.body.data[0].text as string;
    // Stored verbatim: escaping belongs at render time, and silently rewriting
    // extracted text would be the invention M10B §9 forbids.
    expect(text).toContain('<script>');
    // The response is JSON, so the markup cannot execute on the way out.
    expect(response.headers['content-type']).toMatch(/application\/json/);
  });

  /* --- No student data crosses into reference search (M10B §42) ----------- */

  it('carries no student context in a reference-data result', async () => {
    const response = await search('search=certifying').expect(200);
    const keys = Object.keys(response.body.data[0] as Record<string, unknown>);
    for (const key of keys) {
      expect(key).not.toMatch(/profile|student|usn|account|attendance|sgpa|cgpa/i);
    }
  });

  it('does not cache a response that reflects what someone searched for', async () => {
    const withSearch = await search('search=certifying').expect(200);
    expect(withSearch.headers['cache-control']).toMatch(/private, no-store/);

    const withoutSearch = await search('subject=BCS501').expect(200);
    expect(withoutSearch.headers['cache-control']).toMatch(/public/);
  });
});
