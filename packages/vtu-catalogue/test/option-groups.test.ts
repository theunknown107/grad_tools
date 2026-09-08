/**
 * The choices a scheme offers, read as groups.
 *
 * Authority: Phase 7D.2 §5–§10
 */

import { describe, expect, it } from 'vitest';
import { optionGroupsOf } from '../src/option-groups.js';
import type { SchemeCourse } from '../src/scheme-import.js';

const course = (over: Partial<SchemeCourse> & Pick<SchemeCourse, 'code'>): SchemeCourse => ({
  title: 'Invented Course',
  credits: 3,
  semester: 3,
  page: 1,
  viaElectiveSlot: null,
  viaAlternativeTo: null,
  ...over,
});

describe('elective slots', () => {
  it('gathers the options of one slot into a group', () => {
    const groups = optionGroupsOf([
      course({ code: 'BQQ306x', credits: 3 }),
      course({ code: 'BQQ306A', viaElectiveSlot: 'BQQ306x' }),
      course({ code: 'BQQ306B', viaElectiveSlot: 'BQQ306x' }),
      course({ code: 'BQQ306C', viaElectiveSlot: 'BQQ306x' }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ slotCode: 'BQQ306x', kind: 'elective_slot', semester: 3 });
    expect(groups[0]?.members.map((member) => member.code)).toEqual([
      'BQQ306A',
      'BQQ306B',
      'BQQ306C',
    ]);
  });

  it('takes the shared credits from the slot row that prints them', () => {
    // §9: the slot's own row is the evidence. An option inherited the figure,
    // so the option is not evidence of what it inherited from.
    const groups = optionGroupsOf([
      course({ code: 'BQQ306x', credits: 3, page: 4 }),
      course({ code: 'BQQ306A', viaElectiveSlot: 'BQQ306x', page: 6 }),
    ]);
    expect(groups[0]).toMatchObject({ credits: 3, page: 4 });
  });

  it('states no shared credits when the document holds no slot row', () => {
    const groups = optionGroupsOf([course({ code: 'BQQ306A', viaElectiveSlot: 'BQQ306x' })]);
    expect(groups[0]?.credits).toBeNull();
  });

  it('keeps each option own credit figure beside the group figure', () => {
    const groups = optionGroupsOf([
      course({ code: 'BQQ306x', credits: 3 }),
      course({ code: 'BQQ306A', viaElectiveSlot: 'BQQ306x', credits: 3 }),
      course({ code: 'BQQ306B', viaElectiveSlot: 'BQQ306x', credits: 4 }),
    ]);
    expect(groups[0]?.members.map((member) => member.credits)).toEqual([3, 4]);
  });

  it('records an option once however often the document repeats it', () => {
    const groups = optionGroupsOf([
      course({ code: 'BQQ306x', credits: 3 }),
      course({ code: 'BQQ306A', viaElectiveSlot: 'BQQ306x' }),
      course({ code: 'BQQ306A', viaElectiveSlot: 'BQQ306x' }),
    ]);
    expect(groups[0]?.members).toHaveLength(1);
  });
});

describe('OR alternatives', () => {
  it('reads a pair sharing one printed row as one group', () => {
    /*
     * The first-year table prints "BENGK106 / OR / BPWSK106" with one set of
     * columns on the OR row. Both options are worth what that row says.
     */
    const groups = optionGroupsOf([
      course({ code: 'BQQGK106', semester: 1, credits: 1, viaAlternativeTo: 'BQQSK106' }),
      course({ code: 'BQQSK106', semester: 1, credits: 1, viaAlternativeTo: 'BQQGK106' }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ kind: 'alternative', credits: 1, semester: 1 });
    expect(groups[0]?.members.map((member) => member.code)).toEqual(['BQQGK106', 'BQQSK106']);
  });

  it('names the group by the lower code, so either reading order gives one group', () => {
    const forwards = optionGroupsOf([
      course({ code: 'BQQGK106', viaAlternativeTo: 'BQQSK106' }),
      course({ code: 'BQQSK106', viaAlternativeTo: 'BQQGK106' }),
    ]);
    const backwards = optionGroupsOf([
      course({ code: 'BQQSK106', viaAlternativeTo: 'BQQGK106' }),
      course({ code: 'BQQGK106', viaAlternativeTo: 'BQQSK106' }),
    ]);
    expect(forwards).toHaveLength(1);
    expect(forwards[0]?.slotCode).toBe('BQQGK106');
    expect(backwards).toEqual(forwards);
  });

  it('states no shared credits when the two readings disagree', () => {
    // One of them is wrong and nothing here can tell which, so the group
    // states no figure rather than picking the one read first.
    const groups = optionGroupsOf([
      course({ code: 'BQQGK106', credits: 1, viaAlternativeTo: 'BQQSK106' }),
      course({ code: 'BQQSK106', credits: 2, viaAlternativeTo: 'BQQGK106' }),
    ]);
    expect(groups[0]?.credits).toBeNull();
    expect(groups[0]?.members.map((member) => member.credits)).toEqual([1, 2]);
  });

  it('makes no group from half a pair', () => {
    // Half a choice is not a choice: recording it would assert a group of one.
    expect(optionGroupsOf([course({ code: 'BQQGK106', viaAlternativeTo: 'BQQSK106' })])).toEqual(
      [],
    );
  });
});

describe('what is not a group', () => {
  it('makes no group from ordinary courses', () => {
    expect(optionGroupsOf([course({ code: 'BQQ301' }), course({ code: 'BQQ302' })])).toEqual([]);
  });

  it('keeps the same slot code in two semesters apart', () => {
    // §6: a group is scoped, never global.
    const groups = optionGroupsOf([
      course({ code: 'BQQ306x', semester: 3, credits: 3 }),
      course({ code: 'BQQ306A', semester: 3, viaElectiveSlot: 'BQQ306x' }),
      course({ code: 'BQQ306x', semester: 4, credits: 3 }),
      course({ code: 'BQQ306B', semester: 4, viaElectiveSlot: 'BQQ306x' }),
    ]);
    expect(groups).toHaveLength(2);
    expect(groups.map((group) => group.semester)).toEqual([3, 4]);
  });

  it('returns groups in a stable order', () => {
    // §35: the catalogue must reproduce deterministically, and that includes
    // the order rows are written in.
    const input = [
      course({ code: 'BQQ405x', semester: 4, credits: 3 }),
      course({ code: 'BQQ405A', semester: 4, viaElectiveSlot: 'BQQ405x' }),
      course({ code: 'BQQ306x', semester: 3, credits: 3 }),
      course({ code: 'BQQ306A', semester: 3, viaElectiveSlot: 'BQQ306x' }),
    ];
    expect(optionGroupsOf(input).map((group) => group.slotCode)).toEqual(['BQQ306x', 'BQQ405x']);
  });
});

describe('a slot is not one of its own options', () => {
  it('leaves the placeholder code out of the group it names', () => {
    /*
     * THE DEFECT THIS CATCHES. `BPLCK105x` was stored as a member of the
     * `BPLCK105x` group, because the scheme repeats the placeholder code at
     * the head of the list it introduces. That says a student may choose the
     * placeholder, and makes the group's own credit figure look like a fifth
     * option.
     */
    const groups = optionGroupsOf([
      course({ code: 'BQQ105x', semester: 1, credits: 3 }),
      course({ code: 'BQQ105x', semester: 1, viaElectiveSlot: 'BQQ105x' }),
      course({ code: 'BQQ105A', semester: 1, viaElectiveSlot: 'BQQ105x' }),
      course({ code: 'BQQ105B', semester: 1, viaElectiveSlot: 'BQQ105x' }),
    ]);
    expect(groups[0]?.members.map((member) => member.code)).toEqual(['BQQ105A', 'BQQ105B']);
    expect(groups[0]?.credits).toBe(3);
  });
});
