/**
 * The shipped catalogue, and how it is looked up.
 *
 * Authority: Phase 7D §18, §26, §27
 */
import { describe, expect, it } from 'vitest';
import { CATALOGUES, coursesForScheme, VTU_2022 } from '../data/index.js';
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
    expect(VTU_2022.courses).toHaveLength(187);
    expect(VTU_2022.conflicts).toHaveLength(0);
    expect(VTU_2022.aliases).toHaveLength(1);
    expect(VTU_2022.documents).toHaveLength(19);
  });
});
