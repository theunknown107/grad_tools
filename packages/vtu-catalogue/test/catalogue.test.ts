/**
 * The shipped catalogue, and how it is looked up.
 *
 * Authority: Phase 7D §18, §26, §27
 */
import { describe, expect, it } from 'vitest';
import { CATALOGUES, coursesForScheme, VTU_2022 } from '../data/index.js';

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
