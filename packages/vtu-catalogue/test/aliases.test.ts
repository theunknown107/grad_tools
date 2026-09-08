/**
 * Course codes the university itself writes two ways.
 *
 * Authority: Phase 7D.2 §11–§15
 *
 * The rule under test is a NEGATIVE one as much as a positive: two codes are
 * the same course only when a document says so. Everything else — a shared
 * prefix, a near-identical title, a one-letter difference — resolves to
 * nothing, because a wrong course identity puts a wrong credit into a real
 * SGPA and does it silently.
 */

import { describe, expect, it } from 'vitest';
import { COURSE_ALIASES, aliasEvidence, aliasesOf, canonicalCodeOf } from '../src/aliases.js';

describe('the table itself', () => {
  it('cites a document for every entry', () => {
    // §14: an entry with no citation has no business being here.
    for (const alias of COURSE_ALIASES) {
      expect(alias.evidence.length).toBeGreaterThan(20);
      expect(alias.schemeYear).toMatch(/^20\d{2}$/);
      expect(alias.variant).not.toBe(alias.canonical);
    }
  });

  it('names no code twice with a different partner', () => {
    // A code that resolves two ways resolves to nothing usable.
    const seen = new Map<string, string>();
    for (const alias of COURSE_ALIASES) {
      const key = `${alias.schemeYear}|${alias.variant}`;
      expect(seen.get(key) ?? alias.canonical).toBe(alias.canonical);
      seen.set(key, alias.canonical);
    }
  });

  it('has no alias whose canonical code is itself an alias variant', () => {
    // A chain would make the answer depend on how many times you look it up.
    const variants = new Set(COURSE_ALIASES.map((alias) => alias.variant));
    for (const alias of COURSE_ALIASES) expect(variants.has(alias.canonical)).toBe(false);
  });
});

describe('looking a code up', () => {
  it('resolves the scheme spelling to the syllabus spelling', () => {
    expect(aliasesOf('BCSL358D')).toContain('BCS358D');
  });

  it('resolves the syllabus spelling back to the scheme spelling', () => {
    // Round trip: a catalogue row can be indexed under both without either
    // being declared "right" at index time.
    expect(aliasesOf('BCS358D')).toContain('BCSL358D');
  });

  it('always includes the code it was given', () => {
    // §12: the source spelling is never replaced, only joined.
    expect(aliasesOf('BCS358D')[0]).toBe('BCS358D');
    expect(aliasesOf('BQQ999')).toEqual(['BQQ999']);
  });

  it('names the canonical code, and leaves an unknown one alone', () => {
    expect(canonicalCodeOf('BCSL358D')).toBe('BCS358D');
    expect(canonicalCodeOf('BCS358D')).toBe('BCS358D');
    expect(canonicalCodeOf('BQQ999')).toBe('BQQ999');
  });

  it('resolves nothing for a code one letter away', () => {
    /*
     * §14. `BCS358C` is a real, different course. Any similarity rule that
     * connected it to BCS358D would put another course's credits into a real
     * SGPA, silently.
     */
    expect(aliasesOf('BCS358C')).toEqual(['BCS358C']);
    expect(aliasEvidence('BCS358C')).toBeNull();
    expect(canonicalCodeOf('BCS358C')).toBe('BCS358C');
  });

  it('resolves nothing for a code sharing a prefix', () => {
    expect(aliasesOf('BCSL358')).toEqual(['BCSL358']);
    expect(aliasesOf('BCS35')).toEqual(['BCS35']);
  });

  it('does not apply an alias outside the scheme year that established it', () => {
    // §6, §11: an equivalence read from a 2022 document says nothing about
    // what a 2025 document means by the same code.
    expect(aliasesOf('BCSL358D', '2022')).toContain('BCS358D');
    expect(aliasesOf('BCSL358D', '2025')).toEqual(['BCSL358D']);
    expect(canonicalCodeOf('BCSL358D', '2025')).toBe('BCSL358D');
  });

  it('cites its evidence for either spelling', () => {
    expect(aliasEvidence('BCSL358D')?.canonical).toBe('BCS358D');
    expect(aliasEvidence('BCS358D')?.variant).toBe('BCSL358D');
    expect(aliasEvidence('BQQ999')).toBeNull();
  });

  it('ignores spacing and case, and nothing else', () => {
    expect(aliasesOf('bcsl358d')).toContain('BCS358D');
    expect(aliasesOf('BCSL 358D')).toContain('BCS358D');
    // Not a different letter, not a missing digit.
    expect(aliasesOf('BCSL358E')).toEqual(['BCSL358E']);
  });
});
