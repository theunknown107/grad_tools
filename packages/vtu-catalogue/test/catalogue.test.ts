/**
 * The shipped catalogue, and how it is looked up.
 *
 * Authority: Phase 7D §18, §26, §27
 */
import { describe, expect, it } from 'vitest';
import { CATALOGUES, coursesForBranch, coursesForScheme, VTU_2022 } from '../data/index.js';
import { courseKey } from '../src/types.js';

describe('the generated catalogue', () => {
  it('carries provenance on every course', () => {
    // §21: a credit with no source is indistinguishable from one somebody typed.
    for (const course of VTU_2022.courses) {
      expect(course.provenance.documentSha256).toMatch(/^[0-9a-f]{64}$/);
      expect(course.provenance.sourceUrl).toMatch(/^https:\/\/vtu\.ac\.in\//);
    }
  });

  it('is namespaced by scheme year, and answers to either spelling', () => {
    /*
     * The rule sets say `vtu-2022`; the documents say `2022`. Requiring an
     * exact match returned nothing for every real caller — and an empty
     * catalogue looks exactly like a scheme nobody has data for, so it failed
     * silently.
     */
    expect(coursesForScheme('2022').length).toBeGreaterThan(0);
    expect(coursesForScheme('vtu-2022').length).toBe(coursesForScheme('2022').length);
    expect(coursesForScheme('vtu-2025')).toHaveLength(0);
  });

  it('holds one row per course identity', () => {
    const keys = VTU_2022.courses.map((c) =>
      [c.schemeYear, c.programme ?? '(common)', c.semester, c.code].join(' '),
    );
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('states how each credit figure was established', () => {
    for (const course of VTU_2022.courses) {
      expect(['table', 'slot', 'alternative']).toContain(course.creditBasis);
      /* A borrowed figure names what it was borrowed from. */
      if (course.creditBasis !== 'table') expect(course.relatedCode).not.toBeNull();
    }
  });

  it('records conflicts rather than hiding them', () => {
    // §22: an empty list is a claim that nothing disagreed, not that nothing
    // was checked — the field exists either way.
    expect(Array.isArray(VTU_2022.conflicts)).toBe(true);
    for (const conflict of VTU_2022.conflicts) {
      expect(conflict.readings.length).toBeGreaterThan(1);
    }
  });

  it('ships at least the scheme this product was built against', () => {
    expect(CATALOGUES.length).toBeGreaterThan(0);
    expect(VTU_2022.normalizationVersion).toMatch(/^\d+\.\d+\.\d+$/);
  });
});

describe('two scheme years sharing one catalogue', () => {
  /*
   * -------------------------------------------------------------------------
   * WHY THESE ARE ASSERTED WITH ONLY ONE SCHEME SHIPPED
   * -------------------------------------------------------------------------
   *
   * No 2025 document has been supplied, so there is no 2025 catalogue to put
   * beside the 2022 one and no real course-code collision to point at. §33
   * asks for exactly this case: where no collision exists, prove the identity
   * key includes the scheme year anyway.
   *
   * That is worth more than it sounds. These are the properties that decide
   * whether a 2025 catalogue can be added LATER without disturbing the 2022
   * one, and they are cheaper to assert now than to debug after two schemes
   * are already interleaved.
   */

  it('makes the scheme year part of a course identity', () => {
    /*
     * The same code, programme and semester in two schemes are two different
     * courses. If the year were not in the key they would be one, and the
     * second to be written would silently replace the first.
     */
    const earlier = courseKey('2022', 'Computer Science & Business System', 3, 'BCS301');
    const later = courseKey('2025', 'Computer Science & Business System', 3, 'BCS301');
    expect(earlier).not.toBe(later);
    expect(earlier).toContain('2022');
    expect(later).toContain('2025');
  });

  it('never answers a query for one scheme with another scheme’s rows', () => {
    /*
     * §81. The lookup FILTERS by year rather than falling back, so a scheme
     * with no data returns nothing — not the nearest scheme that has some.
     * A fallback here would hand a 2022 student a 2025 course because the
     * titles matched, which is the high-priority regression of §55.
     */
    for (const course of coursesForScheme('2022')) expect(course.schemeYear).toBe('2022');

    expect(coursesForScheme('2025')).toHaveLength(0);
    expect(coursesForScheme('vtu-2025')).toHaveLength(0);
    expect(coursesForScheme('2026')).toHaveLength(0);
  });

  it('keeps every shipped catalogue internally single-year', () => {
    /*
     * A catalogue artifact is produced per scheme (§44), so a row carrying a
     * different year than its artifact would mean a normalization run had
     * mixed two sources. Checked because the check is what makes `2022 rows
     * before == 2022 rows after` (§5) a statement about something.
     */
    for (const catalogue of CATALOGUES) {
      const years = new Set(catalogue.courses.map((course) => course.schemeYear));
      expect([...years]).toHaveLength(1);
    }
  });

  it('holds the 2022 catalogue at the size it was published', () => {
    /*
     * §5's invariant, as a number a future run has to reproduce. This is NOT a
     * hardcoded academic value — no credit, grade or SGPA is asserted — it is
     * the row count of a published artifact, which is exactly the thing that
     * must not drift when another scheme is added beside it.
     */
    expect(VTU_2022.courses).toHaveLength(214);
    expect(VTU_2022.conflicts).toHaveLength(0);
    expect(VTU_2022.aliases).toHaveLength(1);
    expect(VTU_2022.documents).toHaveLength(19);
  });
});

describe('programme-scoped lookup', () => {
  const CSBS = 'Computer Science & Business System';

  it('filters coursesForScheme to one programme, and returns nothing for an unknown one', () => {
    const scoped = coursesForScheme('2022', CSBS);
    expect(scoped.length).toBeGreaterThan(0);
    expect(scoped.every((c) => c.programme === CSBS)).toBe(true);
    expect(scoped.length).toBeLessThan(coursesForScheme('2022').length);
    expect(coursesForScheme('2022', 'No Such Programme')).toHaveLength(0);
    // Omitting the programme keeps the original behaviour.
    expect(coursesForScheme('2022', undefined).length).toBe(coursesForScheme('2022').length);
  });

  it('coursesForBranch keeps the whole CSBS programme (no regression for the published branch)', () => {
    const forBranch = coursesForBranch('2022', CSBS);
    const all = coursesForScheme('2022');
    // Current data has only CSBS at sem 3+, so nothing is dropped for a CSBS student.
    expect(forBranch.length).toBe(all.length);
    for (const c of all.filter((x) => x.programme === CSBS)) expect(forBranch).toContain(c);
  });

  it('drops another programme sem 3+ rows: a Civil student does not get CSBS courses', () => {
    // Civil engineering's schemeUrl (civsch.pdf) matches no sem 3+ row in the
    // current data (which is all CSBS), so every CSBS sem 3+ row is dropped,
    // while the shared first-year rows stay.
    const forCivil = coursesForBranch('2022', 'Civil engineering');
    const csbs38 = coursesForScheme('2022').filter((c) => c.programme === CSBS && c.semester >= 3);
    expect(csbs38.length).toBeGreaterThan(0);
    for (const c of csbs38) expect(forCivil).not.toContain(c);
    const firstYear = coursesForScheme('2022').filter((c) => c.semester <= 2);
    for (const fy of firstYear) expect(forCivil).toContain(fy);
  });

  it('falls back to every course for a null or unlisted branch, dropping nothing', () => {
    expect(coursesForBranch('2022', null)).toHaveLength(coursesForScheme('2022').length);
    expect(coursesForBranch('2022', 'Unlisted College Branch')).toHaveLength(
      coursesForScheme('2022').length,
    );
  });

  it('is deterministic', () => {
    expect(coursesForBranch('2022', CSBS).map((c) => c.code)).toEqual(
      coursesForBranch('2022', CSBS).map((c) => c.code),
    );
  });
});
