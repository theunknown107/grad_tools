/**
 * What the question-paper corpus actually contains.
 *
 * Authority: docs/18 §18.x (M10B.3) · docs/32 OQ-045, OQ-048
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS BEFORE ANY SIMILARITY CODE
 * ---------------------------------------------------------------------------
 *
 * The question M10B.3 asks is whether GradTools can identify repeated or
 * near-repeated questions across real papers. That question has a precondition
 * that is easy to skip and fatal to skip: a repeat is a thing that happens
 * ACROSS SITTINGS OF THE SAME SUBJECT. If the corpus holds one sitting per
 * subject, the phenomenon is not rare in the data — it is structurally
 * unobservable, and any similarity engine measured against it would be
 * measuring nothing.
 *
 * So this profiles the corpus first and reports the one number that decides the
 * milestone: how many subjects have more than one sitting.
 *
 * It is a REPORT, not a fixture. Nothing here writes, and every figure is
 * counted from the database at the moment it runs, so re-running it after the
 * corpus grows re-answers the gate rather than repeating an old answer.
 *
 *   DATABASE_URL=... pnpm --filter @gradtools/api corpus:profile
 *
 * ---------------------------------------------------------------------------
 * CURRENT EXTRACTIONS ONLY
 * ---------------------------------------------------------------------------
 *
 * Everything below is scoped to `is_current = true`. Superseded parser
 * versions are counted separately and never mixed in: positional-v1 and
 * positional-v2 disagree about what a question IS (v1 stored a sub-question's
 * sentence twice, once as a pseudo-question), so pooling them would double-count
 * text and invent repeats that are an artefact of our own parser history.
 */

import type postgres from 'postgres';

export interface SubjectSitting {
  readonly subjectCode: string;
  readonly sittings: number;
  readonly papers: number;
  /**
   * Comparable texts, counting questions AND sub-questions.
   *
   * Both, because where the text lives depends on the parser. A native paper
   * stores prose on its SUB-questions and leaves the parent question empty as
   * a container (M10B.2, OQ-047); an OCR paper often puts it on the question.
   * Counting parents only reported the three native papers in this corpus as
   * having zero usable text when they hold 107 sub-question texts between them
   * — a metric that would have understated the corpus by half.
   */
  readonly usableTexts: number;
}

export interface CorpusProfile {
  readonly papers: number;
  readonly subjects: number;
  /** The number that decides whether similarity can be evaluated at all. */
  readonly multiSittingSubjects: number;
  readonly sittings: readonly { readonly sitting: string; readonly papers: number }[];
  readonly questions: number;
  readonly subQuestions: number;
  readonly mcqItems: number;
  /**
   * What the extraction RECORDED it found, against what is actually stored.
   *
   * These should agree. Where they do not, MCQ items were counted during
   * extraction and never persisted — which is a different failure from "this
   * paper has no MCQs", and the two must not be reported as the same thing
   * (OQ-048).
   */
  readonly mcqItemsDeclared: number;
  readonly emptyQuestions: number;
  readonly emptySubQuestions: number;
  /** Non-empty text that still yields no comparable tokens. */
  readonly nonTokenisable: number;
  readonly tokenisable: number;
  readonly bySource: readonly { readonly source: string; readonly papers: number }[];
  readonly byFormat: readonly { readonly format: string; readonly papers: number }[];
  readonly needsReviewPapers: number;
  readonly privatePapers: number;
  readonly supersededExtractions: number;
  readonly perSubject: readonly SubjectSitting[];
}

/**
 * The tokeniser the corpus report uses to decide "usable".
 *
 * Deliberately the same shape as `question-normalization-v1`'s: letters, marks
 * and digits, Unicode-aware so Kannada survives (its vowels are combining
 * marks, and a `\p{L}`-only class shatters every word). A record whose text is
 * non-empty but produces zero tokens — `"'* 7 / - ' / 7 7"` is a real example
 * from this corpus — is counted separately, because it is neither missing nor
 * comparable.
 */
export function tokenCount(text: string): number {
  const matches = text.match(/[\p{L}\p{M}\p{N}]+/gu);
  return matches === null ? 0 : matches.length;
}

export async function profileCorpus(sql: postgres.Sql): Promise<CorpusProfile> {
  const [papers] = await sql<{ n: number }[]>`
    select count(*)::int as n from documents where document_kind = 'question_paper'`;
  const [subjects] = await sql<{ n: number }[]>`
    select count(distinct subject_code)::int as n
    from documents where document_kind = 'question_paper' and subject_code is not null`;

  /*
   * A "sitting" is the pair (exam_session, exam_year). Either alone is wrong:
   * "June/July" repeats every year, and a year holds more than one sitting.
   */
  const perSubject = await sql<SubjectSitting[]>`
    with paper as (
      select d.id, d.subject_code,
             coalesce(d.exam_session, '?') || ' ' || coalesce(d.exam_year::text, '?') as sitting
      from documents d
      where d.document_kind = 'question_paper' and d.subject_code is not null
    ),
    usable as (
      select p.subject_code, count(*)::int as n
      from paper p
      join extracted_papers ep on ep.document_id = p.id and ep.is_current
      join extracted_questions q on q.paper_id = ep.id
      left join extracted_sub_questions s on s.question_id = q.id
      where btrim(coalesce(s.sub_text, q.question_text)) <> ''
      group by p.subject_code
    )
    select p.subject_code                       as "subjectCode",
           count(distinct p.sitting)::int       as sittings,
           count(distinct p.id)::int            as papers,
           coalesce(max(u.n), 0)::int           as "usableTexts"
    from paper p
    left join usable u on u.subject_code = p.subject_code
    group by p.subject_code
    order by count(distinct p.sitting) desc, p.subject_code`;

  const sittings = await sql<{ sitting: string; papers: number }[]>`
    select coalesce(exam_session, '?') || ' ' || coalesce(exam_year::text, '?') as sitting,
           count(*)::int as papers
    from documents where document_kind = 'question_paper'
    group by 1 order by 2 desc, 1`;

  const [counts] = await sql<
    {
      questions: number;
      subQuestions: number;
      mcqItems: number;
      emptyQuestions: number;
      emptySubQuestions: number;
    }[]
  >`
    with cur as (select id from extracted_papers where is_current)
    select
      (select count(*)::int from extracted_questions q join cur on cur.id = q.paper_id)
        as "questions",
      (select count(*)::int from extracted_sub_questions s
         join extracted_questions q on q.id = s.question_id
         join cur on cur.id = q.paper_id) as "subQuestions",
      (select count(*)::int from extracted_mcq_items m join cur on cur.id = m.paper_id)
        as "mcqItems",
      (select count(*)::int from extracted_questions q join cur on cur.id = q.paper_id
         where btrim(q.question_text) = '') as "emptyQuestions",
      (select count(*)::int from extracted_sub_questions s
         join extracted_questions q on q.id = s.question_id
         join cur on cur.id = q.paper_id
         where btrim(s.sub_text) = '') as "emptySubQuestions"`;

  /*
   * Tokenisability is computed in the application, not in SQL: the tokeniser
   * is the one the normaliser uses, and duplicating its Unicode classes in a
   * regex dialect that does not support \p{M} the same way is how the two
   * quietly disagree.
   */
  const texts = await sql<{ text: string }[]>`
    with cur as (select id from extracted_papers where is_current)
    select q.question_text as text from extracted_questions q join cur on cur.id = q.paper_id
    where btrim(q.question_text) <> ''
    union all
    select s.sub_text as text from extracted_sub_questions s
      join extracted_questions q on q.id = s.question_id
      join cur on cur.id = q.paper_id
    where btrim(s.sub_text) <> ''`;

  let tokenisable = 0;
  let nonTokenisable = 0;
  for (const row of texts) {
    if (tokenCount(row.text) > 0) tokenisable += 1;
    else nonTokenisable += 1;
  }

  const bySource = await sql<{ source: string; papers: number }[]>`
    select extraction_source::text as source, count(*)::int as papers
    from extracted_papers where is_current group by 1 order by 2 desc`;
  const byFormat = await sql<{ format: string; papers: number }[]>`
    select paper_format::text as format, count(*)::int as papers
    from extracted_papers where is_current group by 1 order by 2 desc`;

  const [mcqDeclared] = await sql<{ n: number }[]>`
    select coalesce(sum(mcq_item_count), 0)::int as n from extracted_papers where is_current`;

  const [flags] = await sql<
    { needsReviewPapers: number; privatePapers: number; supersededExtractions: number }[]
  >`
    select
      (select count(*)::int from extracted_papers where is_current and needs_review)
        as "needsReviewPapers",
      (select count(*)::int from documents
         where document_kind = 'question_paper' and presentation = 'private')
        as "privatePapers",
      (select count(*)::int from extracted_papers where not is_current)
        as "supersededExtractions"`;

  return {
    papers: papers?.n ?? 0,
    subjects: subjects?.n ?? 0,
    multiSittingSubjects: perSubject.filter((entry) => entry.sittings > 1).length,
    sittings,
    questions: counts?.questions ?? 0,
    subQuestions: counts?.subQuestions ?? 0,
    mcqItems: counts?.mcqItems ?? 0,
    mcqItemsDeclared: mcqDeclared?.n ?? 0,
    emptyQuestions: counts?.emptyQuestions ?? 0,
    emptySubQuestions: counts?.emptySubQuestions ?? 0,
    tokenisable,
    nonTokenisable,
    bySource,
    byFormat,
    needsReviewPapers: flags?.needsReviewPapers ?? 0,
    privatePapers: flags?.privatePapers ?? 0,
    supersededExtractions: flags?.supersededExtractions ?? 0,
    perSubject,
  };
}

/**
 * Whether similarity can be evaluated at all.
 *
 * The gate is NOT a row count. A corpus of ten thousand questions from one
 * sitting per subject still cannot demonstrate a repeat, and a corpus of two
 * papers of one subject across two sittings can. What matters is cross-sitting
 * diversity within a subject, so that is what this reports.
 */
export function similarityGate(profile: CorpusProfile): {
  readonly eligible: boolean;
  readonly reason: string;
  readonly eligibleSubjects: readonly SubjectSitting[];
} {
  const eligibleSubjects = profile.perSubject.filter(
    (entry) => entry.sittings > 1 && entry.usableTexts > 0,
  );
  if (eligibleSubjects.length > 0) {
    return {
      eligible: true,
      reason: `${String(eligibleSubjects.length)} subject(s) have more than one sitting with usable question text.`,
      eligibleSubjects,
    };
  }
  return {
    eligible: false,
    reason:
      profile.multiSittingSubjects > 0
        ? 'A subject has multiple sittings, but none of them carry usable question text.'
        : `No subject has more than one sitting. ${String(profile.subjects)} subject(s) across ${String(profile.sittings.length)} sitting(s) — a repeat is unobservable, not rare.`,
    eligibleSubjects: [],
  };
}
