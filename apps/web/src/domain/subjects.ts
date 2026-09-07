/**
 * One subject, however many names it is written under.
 *
 * Authority: docs/08 §8.20 · docs/16 §8 · docs/32 OQ-051, DEC-041
 *
 * ---------------------------------------------------------------------------
 * THE CODE IS THE IDENTITY. THE TITLE IS NOT.
 * ---------------------------------------------------------------------------
 *
 * The five real academic artifacts settle this beyond argument. The same code
 * appears with different wording depending on who printed it:
 *
 *   BMATS101   timetable  "Mathematics-I for CSE Stream"
 *              result     "MATHEMATICS FOR CSE STREAM-I"
 *   BPHYS102   timetable  "Applied Physics for CSE stream"
 *              result     "PHYSICS FOR CSE STREAM"
 *
 * The second pair is the one that decides the design: no name comparison —
 * case-folded, token-sorted, edit-distance or otherwise — reliably calls
 * "Applied Physics for CSE stream" and "PHYSICS FOR CSE STREAM" the same thing
 * while still keeping "Mathematics-I" and "Mathematics-II" apart. A matcher
 * loose enough for the first is loose enough to merge the second.
 *
 * So nothing here compares titles at all. Identity is the code, and every title
 * ever seen for it is KEPT, attributed to the source that used it. Neither
 * source is corrected; neither is promoted to "the" name unless a verified
 * catalogue supplies one.
 *
 * ---------------------------------------------------------------------------
 * WHY NO NEW STORED ENTITY
 * ---------------------------------------------------------------------------
 *
 * Every student collection ALREADY keys on the code — results, attendance,
 * timetable slots, backlogs, planned subjects and question papers all carry
 * `subjectCode`. Nothing duplicates identity today; what was missing was a
 * place to see that they are the same subject, and one answer for what to call
 * it on a given screen.
 *
 * That is a READ-TIME question, so this is a read-time module: a pure index
 * built from records the app already holds. No new table, no migration, no sync
 * collection, and nothing new for a device to be offline from (M10A.1 §21).
 */

import type { Subject } from '@gradtools/shared-types';
import type {
  AttendanceRecord,
  BacklogRecord,
  SemesterResult,
  SemesterSubject,
  TimetableSlot,
} from './types.js';

/** Where a title was observed. Attribution, never a ranking of correctness. */
export const SUBJECT_SOURCES = [
  'catalogue',
  'result',
  'plan',
  'attendance',
  'timetable',
  'backlog',
  'paper',
] as const;
export type SubjectSource = (typeof SUBJECT_SOURCES)[number];

export interface SubjectTitle {
  readonly source: SubjectSource;
  readonly title: string;
}

export interface SubjectIdentity {
  /** The normalised code. This is the identity, and the only one. */
  readonly code: string;
  /**
   * The verified catalogue's wording, or null.
   *
   * NULL IS THE COMMON CASE AND IT IS FINE (M10A.1 §5). A canonical title is a
   * claim about what a subject is officially called, and only a verified
   * reference row can make it. Where the catalogue is silent — or where two
   * catalogue rows for the same code disagree — this stays null and the screen
   * uses a source title instead, which is honest about where the words came
   * from.
   */
  readonly canonicalTitle: string | null;
  /** Every distinct wording seen, with the source that used it. */
  readonly titles: readonly SubjectTitle[];
  /** Reference credits. Null unless a catalogue-backed source supplied them. */
  readonly credits: number | null;
  /**
   * Credits the STUDENT recorded for this code, anywhere in their own records.
   *
   * ---------------------------------------------------------------------------
   * WHY THIS IS A SEPARATE FIELD AND NOT A FALLBACK INSIDE `credits`
   * ---------------------------------------------------------------------------
   *
   * `credits` is a claim about what the university says a course is worth, and
   * only a verified catalogue row can make it. A number the student typed is a
   * different kind of fact: good enough to compute their own SGPA with, not
   * good enough to present as the scheme's answer.
   *
   * Keeping them apart is what lets the interface say WHERE a figure came from
   * instead of flattening both into one unattributed number — and it is why
   * this could be added without weakening the rule the catalogue tier enforces.
   *
   * ---------------------------------------------------------------------------
   * AND WHY IT HAD TO EXIST
   * ---------------------------------------------------------------------------
   *
   * Without it, credits the student had already entered — on their semester
   * plan, on a result row they typed by hand — were read by nothing. Importing
   * a card for a subject they had already described left the credits blank and
   * the SGPA unavailable, and the only way out was to type the same number
   * again. Automatic organisation means a fact is given once.
   */
  readonly studentCredits: number | null;
  /** Reference SEE applicability. Three-valued; null means unknown (DEC-037). */
  readonly hasSee: boolean | null;
  /** Every semester this code was seen in, ascending. Usually one. */
  readonly semesters: readonly number[];
  /** Which parts of the app know about this subject. */
  readonly sources: readonly SubjectSource[];
}

/**
 * The identity key for a subject code.
 *
 * TWO TRANSFORMATIONS, AND NO OTHERS: outer whitespace is trimmed, inner
 * whitespace is removed, and the result is upper-cased. A VTU code contains no
 * spaces, so `"bcs 301"` and `"BCS301"` are the same code typed two ways — and
 * treating them as two subjects would split one student's own record in half.
 *
 * That is the whole of it. There is no edit distance, no prefix matching, no
 * stripping of trailing letters, and no comparison of titles anywhere in this
 * module. `BESCK104B` and `BESCK104C` are two different electives and must stay
 * that way; a rule that "helpfully" folded the suffix would merge them
 * (M10A.1 §47).
 */
export function subjectKey(code: string): string {
  return code.replace(/\s+/g, '').toUpperCase();
}

/* -------------------------------------------------------------------------- */
/* Building the index                                                         */
/* -------------------------------------------------------------------------- */

export interface SubjectIndexInput {
  /** Verified reference rows, when the catalogue could be reached. May be empty. */
  readonly catalogue?: readonly Subject[];
  readonly results?: readonly SemesterResult[];
  readonly semesterSubjects?: readonly SemesterSubject[];
  readonly attendance?: readonly AttendanceRecord[];
  readonly timetable?: readonly TimetableSlot[];
  readonly backlogs?: readonly BacklogRecord[];
  /** Question papers, structurally: only the three fields identity needs. */
  readonly papers?: readonly {
    readonly subjectCode: string | null;
    readonly subjectTitle: string | null;
    readonly semester?: number | null;
  }[];
}

interface Draft {
  code: string;
  canonicalTitle: string | null;
  /** Set when two catalogue rows disagree, which forbids a canonical title. */
  canonicalConflict: boolean;
  titles: SubjectTitle[];
  credits: number | null;
  studentCredits: number | null;
  hasSee: boolean | null;
  semesters: Set<number>;
  sources: Set<SubjectSource>;
}

function draftFor(index: Map<string, Draft>, code: string): Draft | null {
  const key = subjectKey(code);
  if (key === '') return null;
  const existing = index.get(key);
  if (existing !== undefined) return existing;
  const created: Draft = {
    code: key,
    canonicalTitle: null,
    canonicalConflict: false,
    titles: [],
    credits: null,
    studentCredits: null,
    hasSee: null,
    semesters: new Set(),
    sources: new Set(),
  };
  index.set(key, created);
  return created;
}

/**
 * Records one sighting.
 *
 * A title is kept only if its exact wording is new. Two sources printing the
 * identical string are one wording seen twice, not two names — and listing it
 * twice would make the interface offer a "variant" that reads the same.
 */
function observe(
  draft: Draft,
  source: SubjectSource,
  title: string | null,
  semester: number | null,
): void {
  draft.sources.add(source);
  if (semester !== null && Number.isFinite(semester)) draft.semesters.add(semester);

  const trimmed = (title ?? '').trim();
  /*
   * A "title" that is just the code again is not a name. Several screens fall
   * back to the code when they have nothing else, and storing that as a title
   * would make a subject look like it had a wording when it has none.
   */
  if (trimmed === '' || subjectKey(trimmed) === draft.code) return;
  if (draft.titles.some((entry) => entry.title === trimmed)) return;
  draft.titles.push({ source, title: trimmed });
}

/**
 * Every subject the student's records and the catalogue know about.
 *
 * The catalogue is OPTIONAL and is the only source of a canonical title,
 * reference credits and reference SEE applicability. Everything else works
 * offline from records already on the device, so a student with no network
 * still gets one identity per code and a name on every screen (M10A.1 §21).
 */
export function buildSubjectIndex(input: SubjectIndexInput): Map<string, SubjectIdentity> {
  const drafts = new Map<string, Draft>();

  /*
   * The catalogue first, so its credits and SEE flag are in place before any
   * student record is read — and so a later source can never overwrite them.
   */
  for (const subject of input.catalogue ?? []) {
    const draft = draftFor(drafts, subject.code);
    if (draft === null) continue;
    observe(draft, 'catalogue', subject.title, subject.semester);
    draft.credits = subject.credits;
    draft.hasSee = subject.hasSee;

    /*
     * TWO VERIFIED ROWS THAT DISAGREE LEAVE NO CANONICAL TITLE (§5). Catalogue
     * uniqueness is (scheme, branch, code), so one code can legitimately carry
     * two rows with different wording across branches. Picking either would be
     * inventing an answer the reference data does not give.
     */
    const wording = subject.title.trim();
    if (draft.canonicalTitle === null && !draft.canonicalConflict) draft.canonicalTitle = wording;
    else if (draft.canonicalTitle !== wording) {
      draft.canonicalTitle = null;
      draft.canonicalConflict = true;
    }
  }

  for (const result of input.results ?? []) {
    for (const subject of result.subjects) {
      const draft = draftFor(drafts, subject.subjectCode);
      if (draft === null) continue;
      observe(draft, 'result', subject.subjectTitle, result.semester);
      /*
       * A result row's credits and SEE flag count as reference data ONLY when
       * they came from the catalogue. A hand-typed credit is a fact about that
       * row and must not become the answer on three other screens.
       */
      if (subject.provenance === 'catalogue') {
        draft.credits ??= subject.credits;
        draft.hasSee ??= subject.hasSee;
      } else {
        /*
         * A credit the student typed on a result row is theirs. It is recorded
         * so the same code never has to be described twice, and kept in the
         * student tier so it can never be presented as the catalogue's answer.
         */
        draft.studentCredits ??= subject.credits;
      }
    }
  }

  for (const subject of input.semesterSubjects ?? []) {
    const draft = draftFor(drafts, subject.code);
    if (draft === null) continue;
    observe(draft, 'plan', subject.title, subject.semester);
    /*
     * The semester plan is where a student states what they are taking and what
     * each course is worth. Those credits were previously read by nothing at
     * all — the plan supplied a title and was ignored for everything else — so
     * importing a card for a subject already on the plan asked for the credits
     * again. Zero is a legitimate credit value for a non-credit mandatory
     * course, so the guard is on null, not on falsiness.
     */
    if (draft.studentCredits === null && Number.isFinite(subject.credits)) {
      draft.studentCredits = subject.credits;
    }
  }

  for (const record of input.attendance ?? []) {
    const draft = draftFor(drafts, record.subjectCode);
    if (draft === null) continue;
    observe(draft, 'attendance', record.subjectTitle, record.semester);
  }

  /* A timetable slot carries a code and no title; it is a sighting all the same. */
  for (const slot of input.timetable ?? []) {
    const draft = draftFor(drafts, slot.subjectCode);
    if (draft === null) continue;
    observe(draft, 'timetable', null, null);
  }

  for (const record of input.backlogs ?? []) {
    const draft = draftFor(drafts, record.subjectCode);
    if (draft === null) continue;
    observe(draft, 'backlog', record.subjectTitle, record.originSemester);
  }

  for (const paper of input.papers ?? []) {
    if (paper.subjectCode === null) continue;
    const draft = draftFor(drafts, paper.subjectCode);
    if (draft === null) continue;
    observe(draft, 'paper', paper.subjectTitle, paper.semester ?? null);
  }

  const index = new Map<string, SubjectIdentity>();
  for (const [key, draft] of drafts) {
    index.set(key, {
      code: draft.code,
      canonicalTitle: draft.canonicalTitle,
      titles: draft.titles,
      credits: draft.credits,
      studentCredits: draft.studentCredits,
      hasSee: draft.hasSee,
      semesters: [...draft.semesters].sort((a, b) => a - b),
      sources: [...draft.sources],
    });
  }
  return index;
}

/** The identity for a code, or null. Never a partial guess. */
export function resolveSubject(
  index: ReadonlyMap<string, SubjectIdentity>,
  code: string,
): SubjectIdentity | null {
  return index.get(subjectKey(code)) ?? null;
}

/* -------------------------------------------------------------------------- */
/* Choosing what to show                                                      */
/* -------------------------------------------------------------------------- */

/**
 * What to call this subject on a screen belonging to `source`.
 *
 * THE VIEWING SCREEN'S OWN WORDING WINS. A student reading their results should
 * see the words their result card printed, and on the timetable the words the
 * timetable used — because that is what makes a row recognisable against the
 * paper document in front of them. The order after that:
 *
 *   1. this source's own title
 *   2. the verified catalogue's title
 *   3. any other source's title, oldest sighting first
 *   4. the code itself
 *
 * The catalogue is second rather than first deliberately. It is the most
 * authoritative wording and the least familiar one; overriding what a student's
 * own card says with it would make the screen harder to check, not easier — and
 * §23 forbids overwriting source text with a canonical string.
 *
 * Step 4 returns the code, which is honest: no title is known, and a subject
 * with no name is better shown as its code than as an empty cell.
 */
export function displayTitle(identity: SubjectIdentity | null, source: SubjectSource): string {
  if (identity === null) return '';
  const own = identity.titles.find((entry) => entry.source === source);
  if (own !== undefined) return own.title;
  if (identity.canonicalTitle !== null) return identity.canonicalTitle;
  return identity.titles[0]?.title ?? identity.code;
}

/**
 * The other wordings this subject is recorded under, excluding what is shown.
 *
 * For the one affordance this milestone earns: a quiet "also recorded as" line
 * where the same subject genuinely appears under different words, so a student
 * comparing two screens is not left wondering whether they are looking at two
 * subjects (M10A.1 §29). Empty — and so rendered as nothing — whenever every
 * source agrees, which is the ordinary case.
 */
export function otherTitles(identity: SubjectIdentity | null, shown: string): SubjectTitle[] {
  if (identity === null) return [];
  return identity.titles.filter((entry) => entry.title !== shown);
}

/* -------------------------------------------------------------------------- */
/* Credit resolution                                                          */
/* -------------------------------------------------------------------------- */

/** Where a credit figure came from. Never a ranking of correctness — a source. */
export type CreditsFrom = 'catalogue' | 'yours';

export interface ResolvedCredits {
  readonly credits: number | null;
  /** Null exactly when `credits` is null. */
  readonly from: CreditsFrom | null;
}

/**
 * The credits to use for a subject, and where they came from.
 *
 * ---------------------------------------------------------------------------
 * THE PROBLEM THIS SOLVES
 * ---------------------------------------------------------------------------
 *
 * A VTU result card prints no credits — the Scheme of Teaching and Evaluation
 * carries them — so an imported result has none unless something supplies them.
 * The only supplier used to be the reference catalogue over the network. With
 * an empty or unreachable catalogue every subject came back with `credits:
 * null`, and a null credit is one of the two things that makes an SGPA
 * unavailable. That is most of what "credits were unresolved" meant.
 *
 * ---------------------------------------------------------------------------
 * ORDER, AND WHY IT IS THIS ORDER
 * ---------------------------------------------------------------------------
 *
 * 1. THE CATALOGUE. A verified reference row is the university's own answer and
 *    outranks anything else, including a number the student typed earlier —
 *    which may well have been a guess made before the catalogue was reachable.
 *
 * 2. THE STUDENT'S OWN RECORDS. Their semester plan, or a result row they filled
 *    in by hand, for the SAME code. This is the "given once" rule: a student who
 *    has already said BCS401 is worth 4 credits is not asked again when the card
 *    for BCS401 arrives.
 *
 * 3. NOTHING. Null, and the screens say what is missing and which subject is
 *    missing it. No default, no scheme-wide average, no "most courses are 3".
 *    The handoff index for the supplied regulations is explicit about this:
 *    "Do not invent credits or grades… If authoritative metadata cannot be
 *    resolved, surface the unresolved state."
 *
 * The regulations DO state 20 credits per semester and 160 for the programme,
 * and that is deliberately not used here. A semester total cannot be divided
 * over its subjects without knowing each course's own weight, and splitting it
 * evenly would produce credit figures for individual courses that the
 * regulation never states. It is used for graduation progress, where a total is
 * genuinely the quantity in question, and nowhere else.
 */
export function creditsFor(identity: SubjectIdentity | null): ResolvedCredits {
  if (identity === null) return { credits: null, from: null };
  if (identity.credits !== null) return { credits: identity.credits, from: 'catalogue' };
  if (identity.studentCredits !== null) {
    return { credits: identity.studentCredits, from: 'yours' };
  }
  return { credits: null, from: null };
}
