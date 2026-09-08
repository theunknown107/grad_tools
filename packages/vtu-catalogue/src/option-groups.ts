/**
 * The choices a scheme offers, as groups rather than scattered back-references.
 *
 * Authority: Phase 7D.2 §5–§10 · docs/38_VTU_INGESTION.md
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS NOT ALREADY IN THE PARSER
 * ---------------------------------------------------------------------------
 *
 * `parseScheme` reads rows, and a row can only say what it is: "this course
 * takes its credits from slot BCS306x", "this course is an alternative to
 * BPWSK106". A group is a fact about SEVERAL rows together, and it exists only
 * once every row has been read.
 *
 * Keeping it separate also means the group model can change without touching a
 * parser whose behaviour against seventeen real documents is verified.
 *
 * ---------------------------------------------------------------------------
 * MEMBERSHIP IS NOT ENROLMENT (§7)
 * ---------------------------------------------------------------------------
 *
 * A group says the curriculum offers a choice. It says nothing about which
 * course any student sat — that is on the result card, which names one. A
 * caller that treats every member as taken has misread this.
 */

import type { SchemeCourse } from './scheme-import.js';

export type OptionKind = 'elective_slot' | 'alternative';

export interface OptionMember {
  readonly code: string;
  readonly title: string | null;
  /** The option's own figure, where its row states one. */
  readonly credits: number | null;
  readonly page: number | null;
}

export interface OptionGroup {
  readonly semester: number;
  /**
   * What names the group.
   *
   * An elective slot has its own printed code — `BCS306x`. An OR pair has
   * none, so the LOWEST of its two option codes stands for it: derived from
   * the members alone, so reading the pair again in either order names the
   * same group rather than making a second one.
   */
  readonly slotCode: string;
  readonly kind: OptionKind;
  /** The figure stated once for the whole choice, or null if none is. */
  readonly credits: number | null;
  readonly page: number | null;
  readonly members: readonly OptionMember[];
}

/**
 * Every choice the courses of one scheme document describe.
 *
 * Two shapes, both read from what the parser already established:
 *
 *   elective slot   a placeholder row states the credits, and later pages list
 *                   the courses that may fill it
 *   alternative     two named courses share one printed set of columns, joined
 *                   by the word OR
 *
 * A course whose row states its own credits and belongs to no choice produces
 * no group, which is most of a scheme.
 */
export function optionGroupsOf(courses: readonly SchemeCourse[]): OptionGroup[] {
  const groups = new Map<string, OptionGroup>();
  const bySemesterAndCode = new Map<string, SchemeCourse>();
  for (const course of courses) bySemesterAndCode.set(`${course.semester}|${course.code}`, course);

  /* ---- Elective slots ---------------------------------------------------- */

  const slots = new Map<string, OptionMember[]>();
  for (const course of courses) {
    if (course.viaElectiveSlot === null) continue;
    /*
     * A SLOT IS NOT ONE OF ITS OWN OPTIONS.
     *
     * `BPLCK105x` reached the option list of `BPLCK105x`, because the scheme
     * repeats the placeholder code at the head of the list it introduces.
     * Storing it as a member would say a student may choose the placeholder,
     * and would make the group's own credit figure look like a fifth option.
     */
    if (course.code === course.viaElectiveSlot) continue;
    const key = `${course.semester}|${course.viaElectiveSlot}`;
    const members = slots.get(key);
    const member = memberOf(course);
    if (members === undefined) slots.set(key, [member]);
    else members.push(member);
  }
  for (const [key, members] of slots) {
    const [semester = '', slotCode = ''] = key.split('|');
    /*
     * The slot's own row is where the shared credit figure is PRINTED. When the
     * document does not carry that row, the group has no shared figure — §9
     * forbids inventing one from a member, because a member that inherited it
     * is not evidence of what it inherited from.
     */
    const slot = bySemesterAndCode.get(key);
    groups.set(key, {
      semester: Number(semester),
      slotCode,
      kind: 'elective_slot',
      credits: slot?.credits ?? null,
      page: slot?.page ?? members[0]?.page ?? null,
      members: sorted(members),
    });
  }

  /* ---- Alternatives ------------------------------------------------------ */

  for (const course of courses) {
    if (course.viaAlternativeTo === null) continue;
    const partner = bySemesterAndCode.get(`${course.semester}|${course.viaAlternativeTo}`);
    /*
     * A partner the document did not also yield is not a pair. It happens when
     * one side of an OR row failed its own checks, and half a choice is not a
     * choice — recording it would assert a group of one.
     */
    if (partner === undefined) continue;

    const slotCode = [course.code, partner.code].sort()[0] ?? course.code;
    const key = `${course.semester}|${slotCode}`;
    if (groups.has(key)) continue;
    groups.set(key, {
      semester: course.semester,
      slotCode,
      kind: 'alternative',
      /*
       * Both options are worth what the OR row says, so the pair agreeing is
       * the normal case. Where the two readings DISAGREE the group states no
       * shared figure: one of them is wrong and this cannot tell which.
       */
      credits: course.credits === partner.credits ? course.credits : null,
      page: course.page,
      members: sorted([memberOf(course), memberOf(partner)]),
    });
  }

  return [...groups.values()].sort(
    (a, b) => a.semester - b.semester || a.slotCode.localeCompare(b.slotCode),
  );
}

const memberOf = (course: SchemeCourse): OptionMember => ({
  code: course.code,
  title: course.title,
  credits: course.credits,
  page: course.page,
});

/** Deterministic member order, so the same document reads the same way twice. */
function sorted(members: readonly OptionMember[]): OptionMember[] {
  const seen = new Map<string, OptionMember>();
  for (const member of members) if (!seen.has(member.code)) seen.set(member.code, member);
  return [...seen.values()].sort((a, b) => a.code.localeCompare(b.code));
}
