/**
 * Deterministic reference-data seed.
 *
 * Authority: docs/09 §9.11, M5a §15-§16
 *
 * ===========================================================================
 * THE RULE THIS FILE OBEYS
 * ===========================================================================
 * Only VERIFIED data is seeded as published. Where a fact could not be
 * verified against a primary source, the row is simply absent. The seed is
 * deliberately incomplete rather than plausibly wrong, because a fabricated
 * subject list is worse than an empty one: the empty one is obviously
 * unfinished, the fabricated one looks finished and is trusted.
 *
 * Idempotent: re-running updates in place rather than duplicating, so
 * `pnpm seed` is safe to run repeatedly against a live database.
 *
 * ===========================================================================
 * WHAT IS VERIFIED, AND FROM WHERE
 * ===========================================================================
 *
 * 1. VTU 2022 regulation (22OB)
 *    https://vtu.ac.in/wp-content/uploads/2023/05/Regulations-Clr-BE-BTECH-2022-611-02052023.pdf
 *    Retrieved 2026-08-23, text extracted with `pdftotext -layout`.
 *    Source of the scheme row and every rule-set threshold, each cited to a
 *    numbered clause.
 *
 * 2. VTU 2022 CSE scheme of teaching and examinations
 *    https://vtu.ac.in/pdf/2022syll/csesch.pdf
 *    Retrieved 2026-08-24, text extracted with `pdftotext -layout`.
 *    Document header: "29052023/V10 scheme for Computer Science and
 *    Engineering and allied branches". Source of the semester-1 subject list.
 *
 * ===========================================================================
 * WHAT IS DELIBERATELY NOT SEEDED
 * ===========================================================================
 *
 * - **Colleges.** The target college has not been named, and the rule set
 *   applies scheme-wide (`college_id IS NULL`), so no college row is needed to
 *   make the data correct. Inventing one would put an unverified institution
 *   name into a reference table.
 *
 * - **Semester 2.** csesch.pdf covers semesters I AND II, so this one is the
 *   odd entry in this list: the source is already cited and already verified,
 *   and the subjects were simply never extracted. It is the only coverage gap
 *   here that needs no new source — and it still needs the DOCUMENT, not
 *   recall, so it stays empty until someone re-reads it (M10A.2 §1).
 *
 * - **Semesters 3 to 8.** csesch.pdf covers ONLY semesters I and II. Nothing
 *   in it supports a semester-3 subject list, so there is none here.
 *
 * - **Syllabus modules.** csesch.pdf is a scheme of TEACHING (course codes,
 *   credits, exam weightage). It contains no module or topic breakdown. The
 *   per-subject syllabus documents were not retrieved or verified, so
 *   `syllabus_modules` is seeded EMPTY. This is the single largest known gap
 *   and is tracked as OQ-025.
 *
 * - **Group course codes** (`BESCK104x`, `BETCK105x`, `BPLCK105x`). The `x`
 *   is a placeholder for a family of alternatives, not a real course code.
 *   Seeding them as concrete subjects would create courses that do not exist.
 */

import { pathToFileURL } from 'node:url';
import type { Sql } from './client.js';
import {
  SCHEME_DOCUMENT_SHA256,
  SCHEME_DOCUMENT_URL,
  SCHEME_DOCUMENT_VERSION,
  SCHEME_RETRIEVED_AT,
  SCHEME_ROWS,
} from './scheme-2022-cse.js';

const REGULATION_URL =
  'https://vtu.ac.in/wp-content/uploads/2023/05/Regulations-Clr-BE-BTECH-2022-611-02052023.pdf';
const VERIFIED_BY = 'project-lead (primary source, pdftotext extraction)';
const REGULATION_VERIFIED_AT = '2026-08-23';
/*
 * Re-verified on this date against the document itself, not carried forward.
 * M10A.4 downloaded csesch.pdf, hashed it, and read every subject row off a
 * numbered page — so the date on these rows is when a human-checkable reading
 * happened, not when the URL was first written down.
 */
const SCHEME_VERIFIED_AT = SCHEME_RETRIEVED_AT;

export interface SeedSummary {
  readonly universities: number;
  readonly schemes: number;
  readonly branches: number;
  readonly ruleSets: number;
  readonly subjects: number;
  readonly syllabusModules: number;
}

export async function seed(sql: Sql): Promise<SeedSummary> {
  await sql`
    INSERT INTO universities (id, name, short_name)
    VALUES ('vtu', 'Visvesvaraya Technological University', 'VTU')
    ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, short_name = EXCLUDED.short_name
  `;

  await sql`
    INSERT INTO schemes (
      id, university_id, code, regulation_code, name, effective_from,
      source_url, source_clause, verification, verified_at, verified_by, publication
    ) VALUES (
      'vtu-2022', 'vtu', '2022', '22OB',
      'VTU 2022 Scheme (B.E./B.Tech, Outcome Based Education)',
      '2022-08-01',
      ${REGULATION_URL}, '22OB', 'verified', ${REGULATION_VERIFIED_AT}, ${VERIFIED_BY}, 'published'
    )
    ON CONFLICT (id) DO UPDATE SET
      name = EXCLUDED.name,
      source_url = EXCLUDED.source_url,
      verification = EXCLUDED.verification,
      verified_at = EXCLUDED.verified_at,
      publication = EXCLUDED.publication
  `;

  // Only CSE is seeded: csesch.pdf is the only branch scheme retrieved and
  // verified. Other branches exist but their documents have not been read.
  await sql`
    INSERT INTO branches (id, university_id, code, name)
    VALUES ('cse', 'vtu', 'CS', 'Computer Science and Engineering')
    ON CONFLICT (id) DO UPDATE SET code = EXCLUDED.code, name = EXCLUDED.name
  `;

  /*
   * The rule set. Every value is transcribed from a numbered clause; see
   * docs/16 §16.3-§16.8 for the clause-by-clause table.
   *
   * college_id is NULL: these rules apply to every non-autonomous college
   * under the scheme, which is why no college row is required for the data to
   * be correct (docs/08 §RuleSet).
   *
   * percentage_formula_id is `cgpa_x_10` (22OB 6.7). It is an IDENTIFIER the
   * rules engine resolves, not an expression the database evaluates.
   */
  await sql`
    INSERT INTO rule_sets (
      scheme_id, college_id, version, effective_from, active,
      sgpa_formula_id, cgpa_formula_id, percentage_formula_id,
      cie_max, cie_min_pct, see_max, see_min_pct, course_max, overall_min_pct,
      attendance_required_pct, attendance_condonable_pct, attendance_dx_floor_pct,
      source_url, source_clause, verification, verified_at, verified_by, publication
    ) VALUES (
      'vtu-2022', NULL, 1, '2022-08-01', true,
      'credit_weighted_gp', 'credit_weighted_sgpa', 'cgpa_x_10',
      50, 40, 100, 35, 100, 40,
      85, 10, 75,
      ${REGULATION_URL}, '22OB 3.7, 4.1, 6.1, 6.2, 6.3, 6.6, 6.7, 6.8',
      'verified', ${REGULATION_VERIFIED_AT}, ${VERIFIED_BY}, 'published'
    )
    ON CONFLICT (
      scheme_id,
      COALESCE(college_id, '00000000-0000-0000-0000-000000000000'::uuid),
      version
    ) DO UPDATE SET
      percentage_formula_id = EXCLUDED.percentage_formula_id,
      verification = EXCLUDED.verification,
      verified_at = EXCLUDED.verified_at,
      publication = EXCLUDED.publication,
      active = EXCLUDED.active
  `;

  /*
   * SEMESTERS I AND II, READ OFF THE OFFICIAL SCHEME (M10A.4).
   *
   * `has_see` is TRUE here, and unlike the assertion M10A.2 retracted it is now
   * a reading: both semester tables carry a SEE Marks column and every row in
   * them prints 50. The rows, their hours, their credits and the page each came
   * from are in `scheme-2022-cse.ts`, together with the document's hash.
   */
  for (const subject of SCHEME_ROWS) {
    await sql`
      INSERT INTO subjects (
        scheme_id, branch_id, semester, code, title, credits, category,
        cie_max, see_max, has_see, module_count,
        scheme_lecture_hours, scheme_tutorial_hours, scheme_practical_hours,
        source_url, source_document_sha256, source_page, source_clause,
        verification, verified_at, verified_by, publication
      ) VALUES (
        'vtu-2022', 'cse', ${subject.semester}, ${subject.code}, ${subject.title},
        ${subject.credits}, ${subject.category},
        -- module_count is NULL: the scheme document gives credits and marks but
        -- no module breakdown, so the structure is unverified (OQ-025). Five is
        -- the scheme norm, not a verified fact about these subjects.
        50, 100, true, NULL,
        ${subject.l}, ${subject.t}, ${subject.p},
        ${SCHEME_DOCUMENT_URL}, ${SCHEME_DOCUMENT_SHA256}, ${subject.page},
        ${`Scheme of Teaching and Examinations 2022 (${SCHEME_DOCUMENT_VERSION}), page ${String(subject.page)}`},
        'verified', ${SCHEME_VERIFIED_AT}, ${VERIFIED_BY}, 'published'
      )
      ON CONFLICT (scheme_id, branch_id, code) DO UPDATE SET
        semester = EXCLUDED.semester,
        title = EXCLUDED.title,
        credits = EXCLUDED.credits,
        category = EXCLUDED.category,
        /*
         * Carried through the upsert deliberately. A database seeded before
         * M10A.2 holds an asserted TRUE; one seeded after it holds NULL. A seed
         * that only ever ADDED facts could neither retract the first nor supply
         * the second, and re-running it is how a machine catches up.
         */
        has_see = EXCLUDED.has_see,
        scheme_lecture_hours = EXCLUDED.scheme_lecture_hours,
        scheme_tutorial_hours = EXCLUDED.scheme_tutorial_hours,
        scheme_practical_hours = EXCLUDED.scheme_practical_hours,
        source_document_sha256 = EXCLUDED.source_document_sha256,
        source_page = EXCLUDED.source_page,
        source_clause = EXCLUDED.source_clause,
        verification = EXCLUDED.verification,
        verified_at = EXCLUDED.verified_at,
        publication = EXCLUDED.publication
    `;
  }

  /* ------------------------------------------------------------------------ */
  /* Source registry (M5)                                                     */
  /* ------------------------------------------------------------------------ */

  /*
   * Both rows are DISABLED, and the database constraint keeps them that way.
   *
   * The robots findings below were obtained by fetching each host's
   * /robots.txt on 2026-08-24 and are recorded verbatim. robots.txt is a
   * public policy file published precisely to be read, and reading it is the
   * only automated request GradTools has made to either host.
   *
   * The two hosts came back differently, which is exactly why the gates are
   * independent:
   *
   *   results.vtu.ac.in   "User-agent: *  Disallow: /"   -> everything refused
   *   vtu.ac.in           disallows only /wp-admin/      -> announcements not
   *                                                          refused by robots
   *
   * vtu.ac.in is STILL disabled, because robots is only one gate. Its terms of
   * use have never been reviewed (OQ-006), and a crawl policy is not a licence
   * to reuse content. Nothing here asserts permission that was not obtained.
   */
  await sql`
    INSERT INTO sources (
      id, kind, publisher, canonical_url, authority, access_method,
      robots_status, robots_checked_at, robots_note,
      terms_status, terms_note,
      rights_status, verification, verified_at, verified_by, enabled, notes
    ) VALUES (
      'vtu-announcements', 'announcements', 'Visvesvaraya Technological University',
      'https://vtu.ac.in/', 'official', 'none',
      'allowed', '2026-08-24',
      'https://vtu.ac.in/robots.txt fetched 2026-08-24: "User-agent: *" with "Disallow: /wp-admin/" and "Allow: /wp-admin/admin-ajax.php". Announcement paths are not disallowed.',
      'unknown',
      'Terms of use have NOT been reviewed. OQ-006 is open. Robots permitting access is not permission to reuse content.',
      'unknown', 'verified', ${SCHEME_VERIFIED_AT}, ${VERIFIED_BY}, false,
      'Adapter framework and fixtures exist; the source has never been fetched. Enabling requires a terms review (OQ-006).'
    )
    ON CONFLICT (id) DO UPDATE SET
      robots_status = EXCLUDED.robots_status,
      robots_checked_at = EXCLUDED.robots_checked_at,
      robots_note = EXCLUDED.robots_note,
      terms_status = EXCLUDED.terms_status,
      terms_note = EXCLUDED.terms_note,
      notes = EXCLUDED.notes
  `;

  await sql`
    INSERT INTO sources (
      id, kind, publisher, canonical_url, authority, access_method,
      robots_status, robots_checked_at, robots_note,
      terms_status, terms_reviewed_at, terms_note,
      rights_status, verification, verified_at, verified_by, enabled, notes
    ) VALUES (
      'vtu-results', 'results', 'Visvesvaraya Technological University',
      'https://results.vtu.ac.in/', 'official', 'none',
      'disallowed', '2026-08-24',
      'https://results.vtu.ac.in/robots.txt fetched 2026-08-24: "User-agent: *" / "Disallow: /". All automated access is refused by the site owner.',
      'prohibited', '2026-08-24',
      'Automated individual result retrieval is out of scope (DEC-004, DEC-011). No adapter exists.',
      'prohibited', 'verified', ${SCHEME_VERIFIED_AT}, ${VERIFIED_BY}, false,
      'Recorded so the finding is enforced rather than merely documented. The enable constraint makes this row impossible to switch on.'
    )
    ON CONFLICT (id) DO UPDATE SET
      robots_status = EXCLUDED.robots_status,
      robots_checked_at = EXCLUDED.robots_checked_at,
      robots_note = EXCLUDED.robots_note,
      terms_status = EXCLUDED.terms_status,
      terms_reviewed_at = EXCLUDED.terms_reviewed_at,
      terms_note = EXCLUDED.terms_note
  `;

  // syllabus_modules is intentionally left empty. See the header note.

  const [counts] = await sql<
    {
      universities: string;
      schemes: string;
      branches: string;
      rulesets: string;
      subjects: string;
      modules: string;
    }[]
  >`
    SELECT
      (SELECT count(*) FROM universities)      AS universities,
      (SELECT count(*) FROM schemes)           AS schemes,
      (SELECT count(*) FROM branches)          AS branches,
      (SELECT count(*) FROM rule_sets)         AS rulesets,
      (SELECT count(*) FROM subjects)          AS subjects,
      (SELECT count(*) FROM syllabus_modules)  AS modules
  `;

  return {
    universities: Number(counts?.universities ?? 0),
    schemes: Number(counts?.schemes ?? 0),
    branches: Number(counts?.branches ?? 0),
    ruleSets: Number(counts?.rulesets ?? 0),
    subjects: Number(counts?.subjects ?? 0),
    syllabusModules: Number(counts?.modules ?? 0),
  };
}

/** CLI entry point: `pnpm --filter @gradtools/api seed`. */
async function main(): Promise<void> {
  const { loadConfig } = await import('../config.js');
  const { createClient } = await import('./client.js');
  const config = loadConfig();
  const sql = createClient(config.DATABASE_URL);
  try {
    const summary = await seed(sql);
    // eslint-disable-next-line no-console
    console.log('seed complete:', summary);
    if (summary.syllabusModules === 0) {
      // eslint-disable-next-line no-console
      console.log(
        'note: 0 syllabus modules. csesch.pdf carries no module breakdown; ' +
          'per-subject syllabus documents are unverified (OQ-025).',
      );
    }
  } finally {
    await sql.end();
  }
}

/*
 * Run only when invoked directly, not when imported by a test.
 * pathToFileURL is used rather than string concatenation because a Windows
 * path produces `file:///D:/...` with three slashes, which a hand-built
 * `file://` prefix does not match.
 */
const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  main().catch((error: unknown) => {
    // eslint-disable-next-line no-console
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
