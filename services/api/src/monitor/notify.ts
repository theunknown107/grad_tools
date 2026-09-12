/**
 * Telling one student about a source item — once.
 *
 * Authority: Phase 7B.3 §33–§35, §49–§57, §65, §125–§131 · M9 §15, §16, §44
 *
 * ---------------------------------------------------------------------------
 * WHY THE FANOUT RUNS IN THE STUDENT'S OWN SESSION
 * ---------------------------------------------------------------------------
 *
 * The obvious shape is a worker that loops over every student and writes each
 * of them a row. This codebase cannot do that, and the reason is not an
 * oversight to work around: student data is reachable ONLY through `withUser`,
 * as the `authenticated` role, with `auth.uid()` set from a verified token.
 * There is no service-role client and no unscoped query helper — not because
 * callers are trusted to avoid them, but because they do not exist (M9 §44).
 *
 * A worker-side fanout would need a connection that bypasses RLS, which would
 * turn every policy in the student schema into decoration for the sake of a
 * loop. So the work is split where the trust boundary already is:
 *
 *   THE WORKER   reads the source ONCE, classifies it once, versions it once,
 *                and writes it to the reference database. No student data is
 *                touched, and nothing is per-user (§64, §65).
 *
 *   THE SESSION  when a student's request arrives, this module reads those
 *                shared rows, decides applicability against THEIR profile, and
 *                inserts THEIR notifications — rows RLS permits precisely
 *                because they are their own.
 *
 * This is still one shared engine and one projection, which is what §49 and
 * §146 require. What moves is where the loop runs, and the cost is the same:
 * the source is parsed once for everybody either way. It is emphatically NOT
 * per-user crawling — no student's request causes a fetch of anything (§144).
 *
 * ---------------------------------------------------------------------------
 * DEDUPE IS A CONSTRAINT, NOT A HABIT
 * ---------------------------------------------------------------------------
 *
 * `(auth_user_id, external_id, content_hash)` is unique, and the insert is
 * `ON CONFLICT DO NOTHING`. Running this on every request is therefore safe by
 * construction rather than by the caller remembering: the second attempt writes
 * nothing and reports that it wrote nothing (§53).
 */

import type { Sql } from '../db/client.js';
import { applicabilityOf, type StudentAudience } from './applicability.js';
import type { SourceCategory } from './classify.js';
import type { PublishedItem } from './store.js';

/**
 * What the student is, from their own rows.
 *
 * READ, NEVER ASSUMED (§32). Every field can be null, and null here means the
 * student has not said — which the applicability engine treats as a reason not
 * to interrupt them rather than a reason to guess.
 *
 * `department` and `stream` have no column in the student schema and are
 * therefore honestly null. Inventing them from the branch name would be the
 * fuzzy inference §29 forbids, and an axis nobody recorded resolving to
 * `unresolved` is the correct outcome rather than a gap to paper over.
 *
 * `programme` has a column as of Supabase 0008, added because running the
 * fixtures showed that without it every programme-scoped notice — which is
 * nearly all of them — reached nobody at all.
 */
export async function readAudience(tx: Sql): Promise<StudentAudience | null> {
  const [profile] = await tx<
    {
      id: string;
      scheme_id: string;
      programme: string | null;
      branch: string | null;
      college_name: string | null;
      current_semester: number | null;
    }[]
  >`
    SELECT id, scheme_id, programme, branch, college_name, current_semester
    FROM student_profiles LIMIT 1
  `;
  if (profile === undefined) return null;

  const enrolled = await tx<{ code: string }[]>`
    SELECT code FROM semester_subjects
    WHERE deleted_at IS NULL
      AND (${profile.current_semester}::smallint IS NULL OR semester = ${profile.current_semester})
  `;
  const backlogs = await tx<{ subject_code: string }[]>`
    SELECT subject_code FROM backlog_records
    WHERE deleted_at IS NULL AND status <> 'cleared'
  `;

  return {
    scheme: profile.scheme_id,
    programme: profile.programme,
    branch: profile.branch,
    department: null,
    stream: null,
    college: profile.college_name,
    semester: profile.current_semester,
    enrolledCourses: enrolled.map((row) => row.code),
    backlogCourses: backlogs.map((row) => row.subject_code),
  };
}

export interface ProjectionResult {
  readonly created: number;
  /** Items that applied but were already on the student's record. */
  readonly alreadyHeld: number;
  /** Items that did not apply, or whose scope could not be resolved. */
  readonly notApplicable: number;
  readonly unresolved: number;
  readonly muted: number;
}

/**
 * Writes this student the notifications they are owed, and no others.
 *
 * §34 and §35 are one condition here: anything that is not a definite
 * `applicable` produces nothing. An item whose scope nobody could read is
 * counted, so an operator can see how many there are, and reaches no one — a
 * broadcast cannot be taken back, and "we were not sure" is not a reason to
 * wake up a few thousand people.
 */
export async function projectNotifications(
  tx: Sql,
  runId: string,
  items: readonly PublishedItem[],
  audience: StudentAudience,
  muted: readonly SourceCategory[] = [],
): Promise<ProjectionResult> {
  let created = 0;
  let alreadyHeld = 0;
  let notApplicable = 0;
  let unresolved = 0;
  let mutedCount = 0;

  for (const item of items) {
    const verdict = applicabilityOf(item.audience, audience);
    if (verdict.verdict === 'unresolved') {
      unresolved += 1;
      continue;
    }
    if (verdict.verdict === 'not_applicable') {
      notApplicable += 1;
      continue;
    }
    /*
     * MUTING SUPPRESSES THE INTERRUPTION, NOT THE RECORD. The item is stored
     * and findable; what the student turned off is being told about it (§56).
     */
    if (muted.includes(item.category)) {
      mutedCount += 1;
      continue;
    }

    const rows = await tx<{ id: string }[]>`
      INSERT INTO source_notifications (
        source_family, external_id, content_hash, category, importance,
        title, source_url, published_at, reason, run_id
      ) VALUES (
        ${item.family}, ${item.externalId}, ${item.contentHash}, ${item.category},
        ${item.importance}, ${item.title}, ${item.url}, ${item.publishedAt},
        ${verdict.reason}, ${runId}
      )
      ON CONFLICT (auth_user_id, external_id, content_hash) DO NOTHING
      RETURNING id
    `;
    if (rows.length === 0) alreadyHeld += 1;
    else created += 1;
  }

  return { created, alreadyHeld, notApplicable, unresolved, muted: mutedCount };
}
