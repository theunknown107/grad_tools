/**
 * Measures deterministic question similarity against the REAL local corpus.
 *
 * Authority: M10B §27, §45, §46, §50, §62
 *
 * This exists so that thresholds are chosen from evidence rather than from
 * taste, and so the AI decision gate at the end of M10B has numbers behind it.
 * It reads the local corpus database, which is gitignored and never leaves this
 * machine; it writes no files and changes nothing.
 *
 *   DATABASE_URL=postgres://gradtools@127.0.0.1:55432/gradtools_corpus \
 *     npx tsx scripts/measure-question-similarity.ts
 *
 * Every printed pair is real extracted text. Read them — the point of this
 * script is to look at what a threshold actually admits, not to produce a
 * single accuracy number. There is no labelled ground truth for this corpus
 * (the 71 historical adjudications were agent-made, not human), so an accuracy
 * figure would be a fiction (M10B §44, §46).
 *
 * ---------------------------------------------------------------------------
 * M10B.3: THREE CORRECTIONS
 * ---------------------------------------------------------------------------
 *
 * 1. SUB-QUESTIONS ARE INCLUDED. The original read `extracted_questions` only,
 *    and so compared 60 of this corpus's 202 usable texts. Native papers keep
 *    their prose on SUB-questions and leave the parent empty as a container
 *    (OQ-047) — the identical blind spot that made question search miss native
 *    papers entirely in M10B.2.
 *
 * 2. PAIRS ARE GROUPED BY SUBJECT. Comparing BCS403 against BMATS101 and
 *    calling a lexical overlap "similar" measures shared English, not a repeat
 *    (M10B.3 §10). Cross-subject pairs are still counted, but separately and
 *    only as a control.
 *
 * 3. CROSS-SITTING PAIRS ARE REPORTED SEPARATELY, and they are the only ones
 *    that can show a repeat. A pair from the same sitting is two different
 *    questions in one exam season; that is not the phenomenon.
 */

import postgres from 'postgres';
import {
  QUESTION_NORMALIZATION_VERSION,
  jaccard,
  normalizeQuestionText,
  tokenize,
} from '../src/intelligence/normalize.js';

interface Row {
  readonly id: string;
  readonly paper_id: string;
  readonly document_id: string;
  readonly paper_title: string | null;
  readonly question_number: string | null;
  readonly module: string | null;
  readonly marks: number | null;
  readonly confidence: string;
  readonly review_state: string;
  readonly text: string;
  /** Subject and sitting decide which comparisons are meaningful at all. */
  readonly subject_code: string | null;
  readonly sitting: string;
  readonly kind: 'question' | 'sub_question';
}

const url = process.env.DATABASE_URL;
if (url === undefined || url === '') {
  console.error('DATABASE_URL is required (point it at the local corpus database).');
  process.exit(1);
}

const sql = postgres(url, { onnotice: () => undefined });

const run = async (): Promise<void> => {
  /*
   * CURRENT EXTRACTIONS ONLY. Both parser versions live in this corpus — nine
   * papers on positional-v1 and nine on positional-v2 — and comparing across
   * them would report a paper as a repeat of itself (M10B §24).
   */
  const rows = (await sql`
    SELECT q.id,
           q.paper_id,
           p.document_id,
           d.title AS paper_title,
           q.question_number,
           COALESCE(q.reviewed_module, q.module)              AS module,
           COALESCE(q.reviewed_marks, q.marks)                AS marks,
           q.confidence::text                                 AS confidence,
           q.review_state::text                               AS review_state,
           COALESCE(q.reviewed_question_text, q.question_text) AS text,
           d.subject_code,
           COALESCE(d.exam_session, '?') || ' ' || COALESCE(d.exam_year::text, '?') AS sitting,
           'question' AS kind
      FROM extracted_questions q
      JOIN extracted_papers p ON p.id = q.paper_id
      JOIN documents d        ON d.id = p.document_id
     WHERE p.is_current = true
       AND COALESCE(q.reviewed_question_text, q.question_text) IS NOT NULL

    UNION ALL

    -- Sub-questions carry the text on native papers (OQ-047). Numbered
    -- "3(a)" so a printed pair still identifies itself on the page.
    SELECT s.id,
           q.paper_id,
           p.document_id,
           d.title AS paper_title,
           COALESCE(q.question_number, '?') || '(' || COALESCE(s.label, '?') || ')'
             AS question_number,
           COALESCE(q.reviewed_module, q.module) AS module,
           s.marks,
           q.confidence::text                    AS confidence,
           q.review_state::text                  AS review_state,
           s.sub_text                            AS text,
           d.subject_code,
           COALESCE(d.exam_session, '?') || ' ' || COALESCE(d.exam_year::text, '?') AS sitting,
           'sub_question' AS kind
      FROM extracted_sub_questions s
      JOIN extracted_questions q ON q.id = s.question_id
      JOIN extracted_papers p    ON p.id = q.paper_id
      JOIN documents d           ON d.id = p.document_id
     WHERE p.is_current = true
       AND s.sub_text IS NOT NULL
  `) as unknown as Row[];

  const prepared = rows.map((row) => {
    const normalized = normalizeQuestionText(row.text);
    return { row, normalized, tokens: tokenize(normalized) };
  });

  const usable = prepared.filter((entry) => entry.tokens.length > 0);

  console.log(`normalization      : ${QUESTION_NORMALIZATION_VERSION}`);
  console.log(`texts (current)    : ${String(prepared.length)}`);
  console.log(
    `  questions         : ${String(prepared.filter((e) => e.row.kind === 'question').length)}`,
  );
  console.log(
    `  sub-questions     : ${String(prepared.filter((e) => e.row.kind === 'sub_question').length)}`,
  );
  console.log(`  with usable tokens: ${String(usable.length)}`);
  console.log(
    `  low confidence    : ${String(prepared.filter((e) => e.row.confidence === 'low').length)}`,
  );
  console.log(
    `  reviewed text     : ${String(prepared.filter((e) => e.row.review_state !== 'unreviewed').length)}`,
  );

  /* --- Token length, which bounds what any lexical method can do ---------- */
  const lengths = usable.map((e) => e.tokens.length).sort((a, b) => a - b);
  const at = (q: number) => lengths[Math.floor((lengths.length - 1) * q)] ?? 0;
  console.log(
    `\ntokens per question : min ${String(lengths[0])}  p25 ${String(at(0.25))}  median ${String(at(0.5))}  p75 ${String(at(0.75))}  max ${String(lengths[lengths.length - 1])}`,
  );
  console.log(
    `questions under 5 tokens: ${String(usable.filter((e) => e.tokens.length < 5).length)} (too short to match on safely)`,
  );

  /* --- Exact normalized duplicates ---------------------------------------- */
  const byNormalized = new Map<string, typeof usable>();
  for (const entry of usable) {
    const bucket = byNormalized.get(entry.normalized) ?? [];
    bucket.push(entry);
    byNormalized.set(entry.normalized, bucket);
  }
  const exactGroups = [...byNormalized.values()].filter((group) => group.length > 1);
  console.log(`\nexact normalized duplicate groups: ${String(exactGroups.length)}`);
  for (const group of exactGroups.slice(0, 8)) {
    const where = group.map((e) => (e.row.paper_title ?? '?').slice(0, 34)).join('  ');
    console.log(`  x${String(group.length)}  ${where}`);
    console.log(`        "${group[0]?.normalized.slice(0, 110) ?? ''}"`);
  }

  /* --- Pairwise similarity ------------------------------------------------- */
  const buckets = new Map<string, number>();
  const samples = new Map<string, { a: string; b: string; score: number; same: boolean }[]>();

  /*
   * Pair classification (M10B.3 §10). A repeat can take exactly one shape:
   *
   *   SAME SUBJECT + DIFFERENT SITTING   the only eligible comparison
   *   SAME SUBJECT + SAME SITTING        two questions in one exam season
   *   DIFFERENT SUBJECT                  a control; shared English, not a repeat
   */
  let eligiblePairs = 0;
  let sameSubjectSameSitting = 0;
  let crossSubjectPairs = 0;

  for (let i = 0; i < usable.length; i += 1) {
    for (let j = i + 1; j < usable.length; j += 1) {
      const left = usable[i];
      const right = usable[j];
      if (left === undefined || right === undefined) continue;
      /* A question cannot repeat within the paper it is already in. */
      if (left.row.paper_id === right.row.paper_id) continue;

      const sameSubject =
        left.row.subject_code !== null && left.row.subject_code === right.row.subject_code;
      if (!sameSubject) crossSubjectPairs += 1;
      else if (left.row.sitting === right.row.sitting) sameSubjectSameSitting += 1;
      else eligiblePairs += 1;

      const score = jaccard(left.tokens, right.tokens);
      if (score < 0.3) continue;

      const band =
        score >= 0.9
          ? '0.90+'
          : score >= 0.7
            ? '0.70-0.89'
            : score >= 0.5
              ? '0.50-0.69'
              : '0.30-0.49';
      buckets.set(band, (buckets.get(band) ?? 0) + 1);

      const bucket = samples.get(band) ?? [];
      if (bucket.length < 4) {
        bucket.push({
          a: `${(left.row.paper_title ?? '?').slice(0, 28)} | ${left.normalized.slice(0, 88)}`,
          b: `${(right.row.paper_title ?? '?').slice(0, 28)} | ${right.normalized.slice(0, 88)}`,
          score,
          same: left.row.paper_title === right.row.paper_title,
        });
        samples.set(band, bucket);
      }
    }
  }

  /*
   * THE NUMBER THIS MILESTONE TURNS ON.
   *
   * With zero eligible pairs, no threshold measured on this corpus means
   * anything: a repeat is unobservable here, not absent. Every scoring pair
   * printed below is therefore same-sitting or cross-subject, and reading them
   * as "similar questions" would be reading shared English as evidence.
   */
  console.log(`\nELIGIBLE PAIRS (same subject, different sitting): ${String(eligiblePairs)}`);
  if (eligiblePairs === 0) {
    console.log('  A repeat cannot occur in this corpus. Any threshold below is unmeasured.');
  }
  console.log(`  same subject, same sitting : ${String(sameSubjectSameSitting)}`);
  console.log(`  different subject (control): ${String(crossSubjectPairs)}`);

  const pairs = (usable.length * (usable.length - 1)) / 2;
  console.log(`\npairs compared: ${String(pairs)}`);
  for (const band of ['0.90+', '0.70-0.89', '0.50-0.69', '0.30-0.49']) {
    console.log(`  jaccard ${band}: ${String(buckets.get(band) ?? 0)} pairs`);
    for (const sample of samples.get(band) ?? []) {
      console.log(
        `     ${sample.score.toFixed(2)} ${sample.same ? 'same-paper-title' : 'DIFFERENT PAPERS'}`,
      );
      console.log(`        A ${sample.a}`);
      console.log(`        B ${sample.b}`);
    }
  }

  await sql.end();
};

run().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
