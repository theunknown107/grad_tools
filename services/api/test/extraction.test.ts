/**
 * Structured question persistence and human review, against real PostgreSQL.
 *
 * Authority: docs/09 §9.8 · docs/17 §17.17 · docs/22 §22.9 · M5A.5 §17
 *
 * A REAL DATABASE, NOT A MOCK. Everything worth testing here is a database
 * guarantee: the unique key that makes persistence idempotent, the composite
 * foreign key that stops a descriptive question attaching to an MCQ paper, the
 * partial index that permits exactly one current run, and the CHECKs that make
 * a review attributable. None of those exist in a fake.
 *
 * NO PDF AND NO OCR ENGINE. The parser is fed synthetic TSV built in
 * `fixtures/tsv.ts`, so the corpus — which is not in this repository and never
 * will be — is not needed to prove any of this.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { loadConfig } from '../src/config.js';
import { createClient, type Sql } from '../src/db/client.js';
import { runMigrations } from '../src/db/migrate.js';
import { seed } from '../src/db/seed.js';
import { createApp } from '../src/http/app.js';
import { createLogger } from '../src/observability/logger.js';
import { MemoryObjectStore } from '../src/documents/storage.js';
import { importDocument } from '../src/documents/ingest.js';
import { groupIntoLines, parseTsv } from '../src/documents/geometry.js';
import { extractStructure } from '../src/documents/structure.js';
import { persistExtraction, recordReview } from '../src/documents/persist.js';
import { PARSER_VERSION_V1, type PositionalExtraction } from '../src/documents/positional.js';
import * as queries from '../src/db/queries.js';
import { validPdf } from './fixtures/pdfs.js';
import { ocrTsv, row, PAGE_EDGE, type Word } from './fixtures/tsv.js';

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeDb = DATABASE_URL === undefined ? describe.skip : describe;

/* -------------------------------------------------------------------------- */
/* Fixture extractions                                                        */
/* -------------------------------------------------------------------------- */

function extractionFrom(
  words: readonly Word[],
  format: 'descriptive' | 'mcq' | 'unknown',
  source: 'native' | 'ocr' = 'ocr',
  // These fixtures exercise PERSISTENCE, not the parser, and they are built
  // from v1's extractor -- so they are labelled v1. Labelling v1 output as v2
  // would put a false parser version into the audit trail these tests check.
  parserVersion = PARSER_VERSION_V1,
): PositionalExtraction {
  const lines = groupIntoLines(parseTsv(ocrTsv(words), 'ocr', 150));
  return { source, parserVersion, paper: extractStructure(lines, format), durationMs: 1 };
}

/**
 * A two-column descriptive paper: two questions, sub-parts, and a right-hand
 * `marks | L | CO` table. The shape M5A.4 measured on real papers.
 */
function descriptiveWords(): Word[] {
  return [
    PAGE_EDGE,
    ...row(100, { body: 'Module-1' }),
    ...row(140, {
      label: 'Q.1',
      body: 'Explain the phases of a compiler',
      marks: 8,
      L: 'L2',
      co: 'CO1',
    }),
    ...row(180, { label: 'a', body: 'Describe lexical analysis', marks: 6, L: 'L2', co: 'CO1' }),
    ...row(220, { label: 'b', body: 'Describe syntax analysis', marks: 6, L: 'L3', co: 'CO1' }),
    ...row(300, { body: 'Module-2' }),
    ...row(340, {
      label: 'Q.2',
      body: 'Discuss normalization forms',
      marks: 10,
      L: 'L3',
      co: 'CO2',
    }),
  ];
}

/** A single-column MCQ flow: no modules, no marks column, no Bloom's level. */
function mcqWords(): Word[] {
  return [
    PAGE_EDGE,
    ...row(100, { body: '1. Which of these is a noun' }),
    ...row(140, { body: 'a) run' }),
    ...row(180, { body: 'b) table' }),
    ...row(220, { body: '2. Which of these is a verb' }),
    ...row(260, { body: 'a) walk' }),
  ];
}

describeDb('extracted question persistence', () => {
  let sql: Sql;
  let app: Express;
  let store: MemoryObjectStore;
  const logger = createLogger('silent', false);

  beforeAll(async () => {
    sql = createClient(DATABASE_URL as string);
    await runMigrations(sql);
    await seed(sql);
    store = new MemoryObjectStore();
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
    // Cascades through papers, questions, sub-questions and MCQ items.
    await sql`DELETE FROM documents WHERE original_filename LIKE 'extract-%'`;
  });

  let counter = 0;
  async function newDocument(): Promise<string> {
    counter += 1;
    const outcome = await importDocument(sql, store, {
      bytes: validPdf({ text: `extraction ${String(counter)} ${String(Date.now())}` }),
      filename: `extract-${String(counter)}.pdf`,
    });
    if (outcome.kind !== 'imported') throw new Error(`fixture import failed: ${outcome.kind}`);
    return outcome.id;
  }

  /* ---------------------------------------------------------------------- */
  /* Paper, question and sub-question persistence                            */
  /* ---------------------------------------------------------------------- */

  describe('persistence', () => {
    it('stores a paper, its questions and their sub-questions', async () => {
      const id = await newDocument();
      const outcome = await persistExtraction(
        sql,
        id,
        extractionFrom(descriptiveWords(), 'descriptive'),
      );

      expect(outcome.kind).toBe('persisted');
      expect(outcome.questionCount).toBe(2);
      expect(outcome.subQuestionCount).toBe(2);

      const paper = await queries.findCurrentPaper(sql, id);
      expect(paper?.paperFormat).toBe('descriptive');
      expect(paper?.questionCount).toBe(2);
      expect(paper?.extractionVersion).toBe(1);
      expect(paper?.isCurrent).toBe(true);

      const questions = await queries.listPaperQuestions(sql, paper?.id ?? '');
      expect(questions.map((q) => q.questionNumber)).toEqual(['1', '2']);
      expect(questions[0]?.subQuestions.map((s) => s.label)).toEqual(['a', 'b']);
    });

    /* The whole point of positional extraction: WHERE a record came from. */
    it('persists the bounding box and page of every record', async () => {
      const id = await newDocument();
      await persistExtraction(sql, id, extractionFrom(descriptiveWords(), 'descriptive'));
      const paper = await queries.findCurrentPaper(sql, id);
      const [first] = await queries.listPaperQuestions(sql, paper?.id ?? '');

      expect(first?.pageNumber).toBe(1);
      expect(first?.boundingBox.width).toBeGreaterThan(0);
      expect(first?.boundingBox.height).toBeGreaterThan(0);
      expect(first?.subQuestions[0]?.boundingBox.width).toBeGreaterThan(0);
    });

    it('persists the descriptive fields the format actually carries', async () => {
      const id = await newDocument();
      await persistExtraction(sql, id, extractionFrom(descriptiveWords(), 'descriptive'));
      const paper = await queries.findCurrentPaper(sql, id);
      const [first] = await queries.listPaperQuestions(sql, paper?.id ?? '');

      expect(first?.marks).toBe(8);
      expect(first?.bloomLevel).toBe('L2');
      expect(first?.courseOutcome).toBe('CO1');
      expect(first?.module).toBe('1');
    });

    it('persists structural confidence, never a numeric score', async () => {
      const id = await newDocument();
      await persistExtraction(sql, id, extractionFrom(descriptiveWords(), 'descriptive'));
      const paper = await queries.findCurrentPaper(sql, id);
      const questions = await queries.listPaperQuestions(sql, paper?.id ?? '');

      for (const question of questions) {
        expect(['high', 'medium', 'low', 'review_required']).toContain(question.confidence);
      }
      expect(paper?.confidenceSummary.high).toBeGreaterThan(0);
    });

    /* Both sources feed one parser, but which one produced a row is provenance. */
    it('records whether the geometry came from the text layer or from OCR', async () => {
      const nativeId = await newDocument();
      const ocrId = await newDocument();
      await persistExtraction(
        sql,
        nativeId,
        extractionFrom(descriptiveWords(), 'descriptive', 'native'),
      );
      await persistExtraction(sql, ocrId, extractionFrom(descriptiveWords(), 'descriptive', 'ocr'));

      expect((await queries.findCurrentPaper(sql, nativeId))?.extractionSource).toBe('native');
      expect((await queries.findCurrentPaper(sql, ocrId))?.extractionSource).toBe('ocr');
    });

    it('records the parser version that produced the rows', async () => {
      const id = await newDocument();
      await persistExtraction(sql, id, extractionFrom(descriptiveWords(), 'descriptive'));
      expect((await queries.findCurrentPaper(sql, id))?.parserVersion).toBe(PARSER_VERSION_V1);
    });
  });

  /* ---------------------------------------------------------------------- */
  /* Format                                                                  */
  /* ---------------------------------------------------------------------- */

  describe('paper format', () => {
    /*
     * MCQ is a SEPARATE shape, not a descriptive question with empty columns.
     * The format never had modules, Bloom's levels or per-question marks, and
     * inventing null placeholders would invite something downstream to read
     * "missing" where the truth is "not applicable" (M5A.5 §13).
     */
    it('stores MCQ items separately, with no descriptive fields', async () => {
      const id = await newDocument();
      const outcome = await persistExtraction(sql, id, extractionFrom(mcqWords(), 'mcq'));

      expect(outcome.mcqItemCount).toBeGreaterThan(0);
      expect(outcome.questionCount).toBe(0);

      const paper = await queries.findCurrentPaper(sql, id);
      const items = await queries.listPaperMcqItems(sql, paper?.id ?? '');
      expect(items[0]?.itemNumber).toBe(1);
      expect(items[0]?.options.length).toBeGreaterThan(0);
      expect(await queries.listPaperQuestions(sql, paper?.id ?? '')).toEqual([]);
    });

    /*
     * The database, not the application, refuses the mismatch. A rule that
     * lives only in code holds until someone writes different code.
     */
    it('refuses a descriptive question attached to an MCQ paper', async () => {
      const id = await newDocument();
      await persistExtraction(sql, id, extractionFrom(mcqWords(), 'mcq'));
      const paper = await queries.findCurrentPaper(sql, id);

      await expect(
        sql`
          INSERT INTO extracted_questions (
            paper_id, paper_format, ordinal, question_text, page_number,
            bbox_x, bbox_y, bbox_width, bbox_height, confidence
          ) VALUES (
            ${paper?.id ?? ''}::uuid, 'descriptive', 0, 'smuggled', 1, 0, 0, 1, 1, 'high'
          )
        `,
      ).rejects.toThrow();
    });

    /*
     * `unknown` is a real answer, not a fallback to the commoner format.
     * Guessing at a template is the error that scored four correctly-read
     * papers as failures during qualification (docs/17 §17.11d).
     */
    it('stores an unknown-format paper with no rows and a stated reason', async () => {
      const id = await newDocument();
      const outcome = await persistExtraction(
        sql,
        id,
        extractionFrom(descriptiveWords(), 'unknown'),
      );

      expect(outcome.questionCount).toBe(0);
      expect(outcome.mcqItemCount).toBe(0);

      const paper = await queries.findCurrentPaper(sql, id);
      expect(paper?.paperFormat).toBe('unknown');
      expect(paper?.needsReview).toBe(true);
      expect(paper?.reviewReason).toContain('could not be identified');
    });
  });

  /* ---------------------------------------------------------------------- */
  /* Idempotency and versioning                                              */
  /* ---------------------------------------------------------------------- */

  describe('idempotency', () => {
    it('does not duplicate questions when the same parser runs twice', async () => {
      const id = await newDocument();
      const first = await persistExtraction(
        sql,
        id,
        extractionFrom(descriptiveWords(), 'descriptive'),
      );
      const second = await persistExtraction(
        sql,
        id,
        extractionFrom(descriptiveWords(), 'descriptive'),
      );

      expect(first.kind).toBe('persisted');
      expect(second.kind).toBe('unchanged');
      expect(second.paperId).toBe(first.paperId);

      const [count] = await sql<{ n: number }[]>`
        SELECT count(*)::int AS n FROM extracted_questions WHERE paper_id = ${first.paperId ?? ''}::uuid
      `;
      expect(count?.n).toBe(2);
      expect((await queries.listPapersForDocument(sql, id)).length).toBe(1);
    });

    /*
     * Reprocessing must ADD a version, not overwrite one. The previous run and
     * anything a person recorded against it survive (M5A.5 §16).
     */
    it('creates a new version for a new parser version and keeps the old one', async () => {
      const id = await newDocument();
      const v1 = await persistExtraction(
        sql,
        id,
        extractionFrom(descriptiveWords(), 'descriptive', 'ocr', 'positional-test-v0'),
      );
      const v2 = await persistExtraction(
        sql,
        id,
        extractionFrom(descriptiveWords(), 'descriptive'),
      );

      expect(v2.kind).toBe('persisted');
      expect(v2.extractionVersion).toBe(2);

      const history = await queries.listPapersForDocument(sql, id);
      expect(history.map((p) => p.parserVersion)).toEqual([
        PARSER_VERSION_V1,
        'positional-test-v0',
      ]);
      expect(history.filter((p) => p.isCurrent).map((p) => p.id)).toEqual([v2.paperId]);

      // The superseded run's rows are still there.
      const [old] = await sql<{ n: number }[]>`
        SELECT count(*)::int AS n FROM extracted_questions WHERE paper_id = ${v1.paperId ?? ''}::uuid
      `;
      expect(old?.n).toBe(2);
    });

    it('a human review on an old version survives reprocessing', async () => {
      const id = await newDocument();
      const v1 = await persistExtraction(
        sql,
        id,
        extractionFrom(descriptiveWords(), 'descriptive', 'ocr', 'positional-test-v0'),
      );
      const [question] = await queries.listPaperQuestions(sql, v1.paperId ?? '');
      await recordReview(sql, 'question', question?.id ?? '', {
        action: 'accept',
        reviewedBy: 'operator',
      });

      await persistExtraction(sql, id, extractionFrom(descriptiveWords(), 'descriptive'));

      const [after] = await queries.listPaperQuestions(sql, v1.paperId ?? '');
      expect(after?.reviewState).toBe('accepted');
    });

    /* One current run per document, enforced by a partial unique index. */
    it('permits exactly one current paper per document', async () => {
      const id = await newDocument();
      await persistExtraction(sql, id, extractionFrom(descriptiveWords(), 'descriptive'));
      await persistExtraction(
        sql,
        id,
        extractionFrom(descriptiveWords(), 'descriptive', 'ocr', 'positional-test-v2'),
      );

      const [count] = await sql<{ n: number }[]>`
        SELECT count(*)::int AS n FROM extracted_papers
         WHERE document_id = ${id}::uuid AND is_current
      `;
      expect(count?.n).toBe(1);
    });
  });

  /* ---------------------------------------------------------------------- */
  /* Human review                                                            */
  /* ---------------------------------------------------------------------- */

  describe('review', () => {
    async function aQuestion(): Promise<{ documentId: string; paperId: string; id: string }> {
      const documentId = await newDocument();
      const outcome = await persistExtraction(
        sql,
        documentId,
        extractionFrom(descriptiveWords(), 'descriptive'),
      );
      const [question] = await queries.listPaperQuestions(sql, outcome.paperId ?? '');
      return { documentId, paperId: outcome.paperId ?? '', id: question?.id ?? '' };
    }

    it('starts every record unreviewed', async () => {
      const { id } = await aQuestion();
      expect((await queries.findQuestion(sql, id))?.reviewState).toBe('unreviewed');
    });

    it('accepting leaves the machine value standing', async () => {
      const { id } = await aQuestion();
      await recordReview(sql, 'question', id, { action: 'accept', reviewedBy: 'operator' });

      const question = await queries.findQuestion(sql, id);
      expect(question?.reviewState).toBe('accepted');
      expect(question?.reviewed).toBeNull();
      expect(question?.marks).toBe(8);
      expect(question?.reviewedBy).toBe('operator');
    });

    /*
     * THE CENTRAL RULE (M5A.5 §9). A correction is stored BESIDE the machine
     * value, never over it. An audit that cannot see what the machine said is
     * not an audit.
     */
    it('a correction is stored beside the machine value, never over it', async () => {
      const { id } = await aQuestion();
      await recordReview(sql, 'question', id, {
        action: 'correct',
        reviewedBy: 'operator',
        note: 'The marks column was misread.',
        corrections: { marks: 10, text: 'Explain the phases of a compiler.' },
      });

      const question = await queries.findQuestion(sql, id);
      expect(question?.reviewState).toBe('corrected');
      expect(question?.marks).toBe(8); // machine value, untouched
      expect(question?.reviewed?.marks).toBe(10); // human value, alongside
      expect(question?.reviewNote).toBe('The marks column was misread.');
    });

    it('corrects a sub-question label independently of its question', async () => {
      const { paperId } = await aQuestion();
      const [question] = await queries.listPaperQuestions(sql, paperId);
      const sub = question?.subQuestions[0];

      await recordReview(sql, 'sub-question', sub?.id ?? '', {
        action: 'correct',
        reviewedBy: 'operator',
        corrections: { label: 'c' },
      });

      const [after] = await queries.listPaperQuestions(sql, paperId);
      expect(after?.subQuestions[0]?.label).toBe('a');
      expect(after?.subQuestions[0]?.reviewed?.label).toBe('c');
      expect(after?.reviewState).toBe('unreviewed');
    });

    /* Rejecting is a judgement, not a delete: the evidence stays (M5A.5 §6). */
    it('rejecting keeps the row', async () => {
      const { id } = await aQuestion();
      await recordReview(sql, 'question', id, { action: 'reject', reviewedBy: 'operator' });

      const question = await queries.findQuestion(sql, id);
      expect(question?.reviewState).toBe('rejected');
      expect(question?.text).not.toBe('');
    });

    it('summarises review and confidence as separate counts', async () => {
      const { documentId, id } = await aQuestion();
      await recordReview(sql, 'question', id, { action: 'accept', reviewedBy: 'operator' });

      const paper = await queries.findCurrentPaper(sql, documentId);
      expect(paper?.reviewSummary.accepted).toBe(1);
      expect(paper?.reviewSummary.unreviewed).toBe(1);
      expect(
        (paper?.confidenceSummary.high ?? 0) + (paper?.confidenceSummary.medium ?? 0),
      ).toBeGreaterThan(0);
    });

    /* A human act must say who and when, or it is not attributable. */
    it('refuses a review state with no reviewer recorded', async () => {
      const { id } = await aQuestion();
      await expect(
        sql`UPDATE extracted_questions SET review_state = 'accepted' WHERE id = ${id}::uuid`,
      ).rejects.toThrow();
    });

    /* Corrections belong to a review; they cannot appear on an unreviewed row. */
    it('refuses a correction on an unreviewed row', async () => {
      const { id } = await aQuestion();
      await expect(
        sql`UPDATE extracted_questions SET reviewed_marks = 12 WHERE id = ${id}::uuid`,
      ).rejects.toThrow();
    });

    it('reports an unknown record rather than silently succeeding', async () => {
      const missing = await recordReview(sql, 'question', '00000000-0000-0000-0000-000000000000', {
        action: 'accept',
        reviewedBy: 'operator',
      });
      expect(missing).toBe(false);
    });
  });

  /* ---------------------------------------------------------------------- */
  /* Mathematics and Kannada                                                 */
  /* ---------------------------------------------------------------------- */

  describe('material that is not authoritative', () => {
    /*
     * Structure survives mathematics; content does not (docs/17 §17.16).
     *
     * The notation is stored EXACTLY as it was read. Repairing an equation
     * would be inventing data, and sending one to a model is forbidden for
     * this milestone (M5A.5 §11) — so what this proves is that the structure
     * is recovered and the text is left alone.
     *
     * The "this document contains mathematics" judgement is NOT made here. It
     * belongs to the OCR stage, which sees the whole text (docs/17 §17.15);
     * the parser reports only what the GEOMETRY agreed on, and conflating the
     * two would be exactly the collapse M5A.5 §7 forbids.
     */
    it('keeps the structure of a mathematical paper and stores the notation unrepaired', async () => {
      const id = await newDocument();
      const words: Word[] = [
        PAGE_EDGE,
        ...row(100, { body: 'Module-1' }),
        ...row(140, {
          label: 'Q.1',
          body: 'Evaluate the integral of sin theta',
          marks: 8,
          L: 'L3',
          co: 'CO1',
        }),
        ...row(180, { label: 'a', body: 'Find dy dx where y equals x squared' }),
      ];
      const outcome = await persistExtraction(sql, id, extractionFrom(words, 'descriptive'));

      expect(outcome.questionCount).toBe(1);
      const paper = await queries.findCurrentPaper(sql, id);
      const [question] = await queries.listPaperQuestions(sql, paper?.id ?? '');

      expect(question?.marks).toBe(8);
      expect(question?.subQuestions[0]?.label).toBe('a');
      // Stored as read: no repair, no normalisation, no model.
      expect(question?.subQuestions[0]?.text).toBe('Find dy dx where y equals x squared');
      // No marks column on that row, so the geometry agreed less. Not 'high'.
      expect(question?.subQuestions[0]?.confidence).toBe('medium');
    });

    /*
     * Kannada text is usable for discovery; its ITEM NUMBERING is not
     * authoritative — `8, 8, 8, 0, 20` was observed where consecutive numbers
     * belong (docs/17 §17.16). It is stored as read, marked, and left for a
     * person. Repairing it would be inventing data.
     */
    it('stores Kannada items as read, without repairing the numbering', async () => {
      const id = await newDocument();
      const words: Word[] = [
        PAGE_EDGE,
        ...row(100, { body: '8. ಕನ್ನಡ ಪ್ರಶ್ನೆ ಒಂದು' }),
        ...row(140, { body: 'a) ಉತ್ತರ' }),
        ...row(180, { body: '8. ಕನ್ನಡ ಪ್ರಶ್ನೆ ಎರಡು' }),
      ];
      const outcome = await persistExtraction(sql, id, extractionFrom(words, 'mcq'));
      const paper = await queries.findCurrentPaper(sql, id);
      const items = await queries.listPaperMcqItems(sql, paper?.id ?? '');

      expect(outcome.mcqItemCount).toBe(2);
      expect(items.map((item) => item.itemNumber)).toEqual([8, 8]);
      expect(items[0]?.text).toContain('ಕನ್ನಡ');
      expect(items.every((item) => item.reviewState === 'unreviewed')).toBe(true);
    });
  });

  /* ---------------------------------------------------------------------- */
  /* HTTP surface                                                            */
  /* ---------------------------------------------------------------------- */

  describe('routes', () => {
    async function persisted(): Promise<{ documentId: string; paperId: string }> {
      const documentId = await newDocument();
      const outcome = await persistExtraction(
        sql,
        documentId,
        extractionFrom(descriptiveWords(), 'descriptive'),
      );
      return { documentId, paperId: outcome.paperId ?? '' };
    }

    it('serves the current paper and its history', async () => {
      const { documentId } = await persisted();
      const response = await request(app).get(`/api/v1/documents/${documentId}/paper`);

      expect(response.status).toBe(200);
      expect(response.body.data.questionCount).toBe(2);
      expect(response.body.history.length).toBe(1);
      // Extraction results are private, like the documents they came from.
      expect(response.headers['cache-control']).toContain('no-store');
    });

    it('serves null rather than 404 for a document nobody has extracted', async () => {
      const documentId = await newDocument();
      const response = await request(app).get(`/api/v1/documents/${documentId}/paper`);
      expect(response.status).toBe(200);
      expect(response.body.data).toBeNull();
    });

    it('serves questions and one question', async () => {
      const { paperId } = await persisted();
      const list = await request(app).get(`/api/v1/papers/${paperId}/questions`);
      expect(list.status).toBe(200);
      expect(list.body.data.length).toBe(2);

      const one = await request(app).get(`/api/v1/questions/${list.body.data[0].id}`);
      expect(one.status).toBe(200);
      expect(one.body.subQuestions.length).toBe(2);
    });

    it('records a review through the narrow mutation', async () => {
      const { paperId } = await persisted();
      const list = await request(app).get(`/api/v1/papers/${paperId}/questions`);
      const id = list.body.data[0].id as string;

      const response = await request(app)
        .post(`/api/v1/extracted/question/${id}/review`)
        .send({ action: 'correct', reviewedBy: 'operator', corrections: { marks: 12 } });

      expect(response.status).toBe(200);
      const after = await queries.findQuestion(sql, id);
      expect(after?.reviewed?.marks).toBe(12);
      expect(after?.marks).toBe(8);
    });

    /* `kind` is an enum, never a table name. */
    it('refuses an unknown record kind', async () => {
      const response = await request(app)
        .post('/api/v1/extracted/documents/00000000-0000-0000-0000-000000000000/review')
        .send({ action: 'accept', reviewedBy: 'operator' });
      expect(response.status).toBe(400);
    });

    it('refuses a correction that changes nothing', async () => {
      const { paperId } = await persisted();
      const list = await request(app).get(`/api/v1/papers/${paperId}/questions`);
      const response = await request(app)
        .post(`/api/v1/extracted/question/${list.body.data[0].id}/review`)
        .send({ action: 'correct', reviewedBy: 'operator' });
      expect(response.status).toBe(400);
    });

    it('answers 404 for a review of a record that does not exist', async () => {
      const response = await request(app)
        .post('/api/v1/extracted/question/00000000-0000-0000-0000-000000000000/review')
        .send({ action: 'accept', reviewedBy: 'operator' });
      expect(response.status).toBe(404);
    });

    /*
     * Extracted text is DATA, never markup. It came out of a PDF that anyone
     * could have crafted, so it is served as a JSON string and rendered by
     * React as text — there is no path by which it becomes HTML (docs/13 §T-21).
     */
    it('serves hostile extracted text as data, not markup', async () => {
      const documentId = await newDocument();
      const words: Word[] = [
        PAGE_EDGE,
        ...row(140, {
          label: 'Q.1',
          body: '<script>alert(1)</script> explain',
          marks: 8,
          L: 'L2',
          co: 'CO1',
        }),
      ];
      const outcome = await persistExtraction(
        sql,
        documentId,
        extractionFrom(words, 'descriptive'),
      );
      const response = await request(app).get(`/api/v1/papers/${outcome.paperId ?? ''}/questions`);

      expect(response.headers['content-type']).toContain('application/json');
      expect(response.headers['x-content-type-options']).toBe('nosniff');

      // Stored and served verbatim: a reviewer must see what the PDF said.
      expect(response.body.data[0].text).toContain('<script>');

      // But the bytes on the wire are escaped, so the response is never valid
      // markup even if something mis-handles the content type.
      expect(response.text).not.toContain('<script>');
      expect(response.text).toContain('\\u003cscript\\u003e');
    });

    it('refuses to extract from a document that has not been read', async () => {
      const documentId = await newDocument();
      const response = await request(app).post(`/api/v1/documents/${documentId}/extract`);
      expect(response.status).toBe(400);
    });

    it('answers 404 for a paper that does not exist', async () => {
      const response = await request(app).get(
        '/api/v1/papers/00000000-0000-0000-0000-000000000000/questions',
      );
      expect(response.status).toBe(404);
    });
  });

  /* ---------------------------------------------------------------------- */
  /* Review workbench (M5A.6)                                               */
  /* ---------------------------------------------------------------------- */

  describe('review workbench', () => {
    async function descriptivePaper(): Promise<{ documentId: string; paperId: string }> {
      const documentId = await newDocument();
      const outcome = await persistExtraction(
        sql,
        documentId,
        extractionFrom(descriptiveWords(), 'descriptive'),
      );
      return { documentId, paperId: outcome.paperId ?? '' };
    }

    async function mcqPaper(): Promise<{ documentId: string; paperId: string }> {
      const documentId = await newDocument();
      const outcome = await persistExtraction(sql, documentId, extractionFrom(mcqWords(), 'mcq'));
      return { documentId, paperId: outcome.paperId ?? '' };
    }

    /* -- the fields 0008 added ------------------------------------------- */

    /*
     * A VTU paper's right-hand table has a row per SUB-PART. 0007 parsed the
     * sub-question's Bloom's level and CO and gave no way to fix them, which is
     * worse than not extracting them: the row looks reviewed once accepted,
     * with the wrong value underneath.
     */
    it("corrects a sub-question's Bloom's level and CO without touching the machine values", async () => {
      const { paperId } = await descriptivePaper();
      const [question] = await queries.listPaperQuestions(sql, paperId);
      const sub = question?.subQuestions[0];

      await recordReview(sql, 'sub-question', sub?.id ?? '', {
        action: 'correct',
        reviewedBy: 'operator',
        corrections: { bloomLevel: 'L4', courseOutcome: 'CO3' },
      });

      const [after] = await queries.listPaperQuestions(sql, paperId);
      const reviewed = after?.subQuestions[0];
      expect(reviewed?.bloomLevel).toBe('L2'); // machine, untouched
      expect(reviewed?.courseOutcome).toBe('CO1'); // machine, untouched
      expect(reviewed?.reviewed?.bloomLevel).toBe('L4');
      expect(reviewed?.reviewed?.courseOutcome).toBe('CO3');
      expect(reviewed?.reviewState).toBe('corrected');
    });

    /*
     * Options are the substance of an MCQ item. A correct stem with scrambled
     * options is not a usable record, and 0007 stored them with no way to fix
     * them.
     */
    it('corrects MCQ options and keeps the machine options beside them', async () => {
      const { paperId } = await mcqPaper();
      const [item] = await queries.listPaperMcqItems(sql, paperId);
      expect(item?.options.length).toBeGreaterThan(0);

      await recordReview(sql, 'mcq-item', item?.id ?? '', {
        action: 'correct',
        reviewedBy: 'operator',
        corrections: {
          options: [
            { label: 'a', text: 'run' },
            { label: 'b', text: 'table' },
          ],
        },
      });

      const [after] = await queries.listPaperMcqItems(sql, paperId);
      expect(after?.options).toEqual(item?.options); // machine, untouched
      expect(after?.reviewed?.options).toEqual([
        { label: 'a', text: 'run' },
        { label: 'b', text: 'table' },
      ]);
    });

    it('corrects an MCQ item number', async () => {
      const { paperId } = await mcqPaper();
      const [item] = await queries.listPaperMcqItems(sql, paperId);

      await recordReview(sql, 'mcq-item', item?.id ?? '', {
        action: 'correct',
        reviewedBy: 'operator',
        corrections: { itemNumber: 7 },
      });

      const [after] = await queries.listPaperMcqItems(sql, paperId);
      expect(after?.itemNumber).toBe(1);
      expect(after?.reviewed?.itemNumber).toBe(7);
    });

    /* -- re-review -------------------------------------------------------- */

    /*
     * "The machine was right" and "here is my replacement" are contradictory
     * claims. Accepting after correcting must therefore CLEAR the correction,
     * not leave a stale one sitting under an `accepted` badge.
     */
    it('accepting after correcting clears the correction', async () => {
      const { paperId } = await descriptivePaper();
      const [question] = await queries.listPaperQuestions(sql, paperId);
      const id = question?.id ?? '';

      await recordReview(sql, 'question', id, {
        action: 'correct',
        reviewedBy: 'operator',
        corrections: { marks: 12 },
      });
      expect((await queries.findQuestion(sql, id))?.reviewed?.marks).toBe(12);

      await recordReview(sql, 'question', id, { action: 'accept', reviewedBy: 'operator' });

      const after = await queries.findQuestion(sql, id);
      expect(after?.reviewState).toBe('accepted');
      expect(after?.reviewed).toBeNull();
      expect(after?.marks).toBe(8);
    });

    it('a second correction replaces the first rather than merging into it', async () => {
      const { paperId } = await descriptivePaper();
      const [question] = await queries.listPaperQuestions(sql, paperId);
      const id = question?.id ?? '';

      await recordReview(sql, 'question', id, {
        action: 'correct',
        reviewedBy: 'operator',
        corrections: { marks: 12, module: '3' },
      });
      await recordReview(sql, 'question', id, {
        action: 'correct',
        reviewedBy: 'operator',
        corrections: { marks: 14 },
      });

      const after = await queries.findQuestion(sql, id);
      expect(after?.reviewed?.marks).toBe(14);
      // The dropped field is CLEARED, not silently kept: an omitted field means
      // "the machine value stands", and a stale correction would contradict it.
      expect(after?.reviewed?.module).toBeNull();
    });

    /* -- parser-version isolation ---------------------------------------- */

    /*
     * Review belongs to the RUN it was recorded against. A reviewer's
     * conclusion about what parser A produced says nothing about parser B's
     * output, and carrying it across would fabricate agreement.
     */
    it('keeps review with its own parser version and does not carry it forward', async () => {
      const documentId = await newDocument();
      const v1 = await persistExtraction(
        sql,
        documentId,
        extractionFrom(descriptiveWords(), 'descriptive', 'ocr', 'positional-test-v0'),
      );
      const [oldQuestion] = await queries.listPaperQuestions(sql, v1.paperId ?? '');
      await recordReview(sql, 'question', oldQuestion?.id ?? '', {
        action: 'correct',
        reviewedBy: 'operator',
        corrections: { marks: 12 },
      });

      const v2 = await persistExtraction(
        sql,
        documentId,
        extractionFrom(descriptiveWords(), 'descriptive'),
      );

      const [newQuestion] = await queries.listPaperQuestions(sql, v2.paperId ?? '');
      expect(newQuestion?.reviewState).toBe('unreviewed');
      expect(newQuestion?.reviewed).toBeNull();

      // And the old run still has its review.
      const [stillOld] = await queries.listPaperQuestions(sql, v1.paperId ?? '');
      expect(stillOld?.reviewed?.marks).toBe(12);
    });

    /* -- the queue -------------------------------------------------------- */

    /*
     * ORDER, NOT SCORE (M5A.6 §7): review_required, low, medium, high. A number
     * would have to be invented and would blend two incomparable things.
     */
    it('orders the queue by how little the geometry agreed', async () => {
      const { paperId } = await descriptivePaper();
      await sql`
        UPDATE extracted_questions SET confidence = 'review_required'
         WHERE paper_id = ${paperId}::uuid AND ordinal = 1
      `;

      const queue = await queries.listReviewQueue(sql, 50);
      const forPaper = queue.filter((row) => row.paperId === paperId);

      expect(forPaper[0]?.confidence).toBe('review_required');
      const rank = { review_required: 0, low: 1, medium: 2, high: 3 };
      const ranks = forPaper.map((row) => rank[row.confidence]);
      expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
    });

    it('carries enough context to find the record without another request', async () => {
      const { paperId } = await descriptivePaper();
      const [row] = (await queries.listReviewQueue(sql, 50)).filter((q) => q.paperId === paperId);

      expect(row?.documentTitle).toContain('extract-');
      expect(row?.label).toMatch(/^Q\d|^Q\?|^Unnumbered/);
      expect(row?.pageNumber).toBe(1);
      expect(row?.extractionSource).toBe('ocr');
    });

    /* The queue is what nobody has looked at yet, not an archive. */
    it('drops a record from the queue once it has been reviewed', async () => {
      const { paperId } = await descriptivePaper();
      const before = (await queries.listReviewQueue(sql, 200)).filter((q) => q.paperId === paperId);
      const target = before[0];
      expect(target).toBeDefined();

      await recordReview(sql, target?.kind ?? 'question', target?.id ?? '', {
        action: 'accept',
        reviewedBy: 'operator',
      });

      const after = (await queries.listReviewQueue(sql, 200)).filter((q) => q.paperId === paperId);
      expect(after.some((q) => q.id === target?.id)).toBe(false);
      expect(after.length).toBe(before.length - 1);
    });

    it('includes sub-questions and MCQ items, not only questions', async () => {
      const descriptive = await descriptivePaper();
      const mcq = await mcqPaper();
      const queue = await queries.listReviewQueue(sql, 200);

      const kinds = new Set(
        queue
          .filter((q) => q.paperId === descriptive.paperId || q.paperId === mcq.paperId)
          .map((q) => q.kind),
      );
      expect(kinds.has('question')).toBe(true);
      expect(kinds.has('sub-question')).toBe(true);
      expect(kinds.has('mcq-item')).toBe(true);
    });

    /*
     * A superseded run's rows are kept for audit. Queueing them would ask a
     * person to review history.
     */
    it('queues only the current run', async () => {
      const documentId = await newDocument();
      const v1 = await persistExtraction(
        sql,
        documentId,
        extractionFrom(descriptiveWords(), 'descriptive', 'ocr', 'positional-test-v0'),
      );
      await persistExtraction(sql, documentId, extractionFrom(descriptiveWords(), 'descriptive'));

      const queue = await queries.listReviewQueue(sql, 200);
      expect(queue.some((row) => row.paperId === v1.paperId)).toBe(false);
      expect(queue.some((row) => row.documentId === documentId)).toBe(true);
    });

    it('bounds the queue by the requested limit', async () => {
      await descriptivePaper();
      expect((await queries.listReviewQueue(sql, 2)).length).toBeLessThanOrEqual(2);
    });

    /* -- the HTTP surface -------------------------------------------------- */

    it('serves the queue over HTTP, privately', async () => {
      await descriptivePaper();
      const response = await request(app).get('/api/v1/review/queue?limit=5');

      expect(response.status).toBe(200);
      expect(response.body.data.length).toBeGreaterThan(0);
      expect(response.body.data.length).toBeLessThanOrEqual(5);
      expect(response.headers['cache-control']).toContain('no-store');
    });

    /* A caller cannot ask for the whole table in one request. */
    it('caps the queue limit however large the caller asks for', async () => {
      await descriptivePaper();
      const response = await request(app).get('/api/v1/review/queue?limit=100000');
      expect(response.status).toBe(200);
      expect(response.body.data.length).toBeLessThanOrEqual(200);
    });

    it('ignores a nonsense limit rather than failing', async () => {
      await descriptivePaper();
      const response = await request(app).get('/api/v1/review/queue?limit=not-a-number');
      expect(response.status).toBe(200);
    });

    /*
     * The mutation is narrow BY CONSTRUCTION (M5A.6 §15). Unknown fields are
     * stripped by the schema rather than reaching a statement, so no caller can
     * name a column.
     */
    it('ignores a field that is not correctable rather than writing it', async () => {
      const { paperId } = await descriptivePaper();
      const list = await request(app).get(`/api/v1/papers/${paperId}/questions`);
      const id = list.body.data[0].id as string;

      const response = await request(app)
        .post(`/api/v1/extracted/question/${id}/review`)
        .send({
          action: 'correct',
          reviewedBy: 'operator',
          corrections: { marks: 9, confidence: 'high', review_state: 'accepted', id: 'x' },
        });

      expect(response.status).toBe(200);
      const after = await queries.findQuestion(sql, id);
      expect(after?.reviewed?.marks).toBe(9);
      // The machine's own confidence is not a reviewable field and did not move.
      expect(after?.confidence).toBe('high');
      expect(after?.reviewState).toBe('corrected');
    });

    it('refuses a correction whose type is wrong', async () => {
      const { paperId } = await descriptivePaper();
      const list = await request(app).get(`/api/v1/papers/${paperId}/questions`);

      const response = await request(app)
        .post(`/api/v1/extracted/question/${list.body.data[0].id}/review`)
        .send({ action: 'correct', reviewedBy: 'operator', corrections: { marks: 'lots' } });

      expect(response.status).toBe(400);
    });

    it('refuses a review with no reviewer', async () => {
      const { paperId } = await descriptivePaper();
      const list = await request(app).get(`/api/v1/papers/${paperId}/questions`);

      const response = await request(app)
        .post(`/api/v1/extracted/question/${list.body.data[0].id}/review`)
        .send({ action: 'accept' });

      expect(response.status).toBe(400);
    });

    it('refuses an action that is not accept, correct or reject', async () => {
      const { paperId } = await descriptivePaper();
      const list = await request(app).get(`/api/v1/papers/${paperId}/questions`);

      const response = await request(app)
        .post(`/api/v1/extracted/question/${list.body.data[0].id}/review`)
        .send({ action: 'delete', reviewedBy: 'operator' });

      expect(response.status).toBe(400);
    });

    it('records an MCQ option correction over HTTP', async () => {
      const { paperId } = await mcqPaper();
      const list = await request(app).get(`/api/v1/papers/${paperId}/mcq-items`);
      const id = list.body.data[0].id as string;

      const response = await request(app)
        .post(`/api/v1/extracted/mcq-item/${id}/review`)
        .send({
          action: 'correct',
          reviewedBy: 'operator',
          corrections: { options: [{ label: 'a', text: 'corrected option' }] },
        });

      expect(response.status).toBe(200);
      const [after] = await queries.listPaperMcqItems(sql, paperId);
      expect(after?.reviewed?.options).toEqual([{ label: 'a', text: 'corrected option' }]);
    });

    /* -- audit ------------------------------------------------------------- */

    /*
     * M5A.6 §17: for every reviewed record, answer what the machine produced,
     * what a person changed, when, and under which parser and extraction
     * version. All five come from the record and its paper.
     */
    it('answers the five audit questions for a corrected record', async () => {
      const { documentId, paperId } = await descriptivePaper();
      const [question] = await queries.listPaperQuestions(sql, paperId);
      await recordReview(sql, 'question', question?.id ?? '', {
        action: 'correct',
        reviewedBy: 'operator',
        note: 'Marks column was misread.',
        corrections: { marks: 10 },
      });

      const after = await queries.findQuestion(sql, question?.id ?? '');
      const paper = await queries.findCurrentPaper(sql, documentId);

      expect(after?.marks).toBe(8); // what the machine produced
      expect(after?.reviewed?.marks).toBe(10); // what a person changed it to
      expect(after?.reviewedAt).not.toBeNull(); // when
      expect(after?.reviewedBy).toBe('operator'); // who
      expect(after?.reviewNote).toBe('Marks column was misread.'); // why
      expect(paper?.parserVersion).toBe(PARSER_VERSION_V1); // which parser
      expect(paper?.extractionVersion).toBe(1); // which extraction
    });
  });
});
