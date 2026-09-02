/**
 * Reading a source document without letting it lie to us.
 *
 * Authority: docs/22 §22.45 · docs/32 OQ-053 · M10A.3 §8, §13, §14, §24
 *
 * ---------------------------------------------------------------------------
 * THE CASE THAT MATTERS
 * ---------------------------------------------------------------------------
 *
 * `1BMATC101` CONTAINS `BMATC101`. Both are real VTU codes from different
 * schemes, so a 2022 pattern matching the tail of a 2025 code produces a
 * plausible-looking attribution of a course to a catalogue it does not belong
 * to. The local corpus already holds three documents in exactly that state.
 *
 * No text below is a student record. These are course codes and paper headers.
 */

import { describe, expect, it } from 'vitest';
import {
  codesIn,
  declaredBy,
  filenameAgrees,
  isLaterFamily,
  speaksForScheme2022,
} from '../src/reference/source-scan.js';

describe('course codes on a page', () => {
  it('reads a later-scheme code whole, never as its 2022 tail', () => {
    // THE TRAP. Getting this wrong turns a 2025 course into a 2022 one.
    expect(codesIn('USN 1BMATC101 First Semester')).toEqual(['1BMATC101']);
    expect(codesIn('USN 1BMATC101')).not.toContain('BMATC101');
  });

  it('reads a 2022 code as itself', () => {
    expect(codesIn('BMATS101 Mathematics-I for CSE Stream')).toEqual(['BMATS101']);
    expect(isLaterFamily('BMATS101')).toBe(false);
    expect(isLaterFamily('1BMATC101')).toBe(true);
  });

  it('keeps every code a paper serves, not just the first', () => {
    /*
     * One examination, two semesters. Collapsing this to one code would throw
     * away the fact that the document speaks for both.
     */
    expect(codesIn('Elements of Chemical Engineering (1BECHE105/205)')).toEqual(['1BECHE105']);
    expect(codesIn('Communicative English BENGK106 / BENGK206')).toEqual(['BENGK106', 'BENGK206']);
  });

  it('deduplicates a code repeated down the page', () => {
    expect(codesIn('BCS403 ... BCS403 ... BCS403')).toEqual(['BCS403']);
  });

  it('keeps letter-suffixed electives apart', () => {
    // Real sibling electives. A looser pattern would fold them together.
    expect(codesIn('BESCK104B and BESCK104C')).toEqual(['BESCK104B', 'BESCK104C']);
  });

  it('finds nothing in a page that carries no code', () => {
    expect(codesIn('Answer any FIVE full questions, choosing ONE from each MODULE')).toEqual([]);
  });
});

describe('what a header declares', () => {
  /* A real model-paper header, reduced to its structure. */
  const modelPaper = [
    'Model Question Paper-I with effect from 2025-26',
    'USN                     1BMATC201',
    'Second Semester B.E./B.Tech. Degree Examination',
    'Differential Calculus and Numerical Methods',
    'TIME: 03Hours              Max.Marks:100',
  ].join('\n');

  it('reports the scheme year a document says it takes effect from', () => {
    const declaration = declaredBy(modelPaper);
    expect(declaration.effectFrom).toBe('2025-26');
    expect(declaration.isModelPaper).toBe(true);
    expect(declaration.semester).toBe('second');
    expect(declaration.isDegreeExam).toBe(true);
    expect(declaration.maxMarks).toBe(100);
  });

  it('leaves an unstated effect year null rather than assuming the current one', () => {
    expect(
      declaredBy('Model Question Paper- I\nFirst Semester B.E Degree Examination').effectFrom,
    ).toBeNull();
  });

  it('reads a semester written as a range by its first term', () => {
    // "First/ Second Semester" is one paper serving two semesters; the phrase is
    // reported as found rather than resolved to one of them.
    expect(declaredBy('First/ Second Semester B.E Degree Examination').semester).toBe('first');
  });
});

describe('whether a document can speak for the 2022 catalogue', () => {
  it('accepts a document whose every code is 2022-family', () => {
    expect(speaksForScheme2022(declaredBy('BMATS101 First Semester Degree Examination'))).toBe(
      true,
    );
  });

  it('refuses a document that declares any later-family code', () => {
    expect(speaksForScheme2022(declaredBy('1BPHYS102 Quantum Physics'))).toBe(false);
  });

  it('refuses a later-scheme paper that spells one of its codes without the prefix', () => {
    /*
     * BEING GENEROUS IS THE MISTAKE. This paper carries a 2025 code and a bare
     * one; admitting it to the 2022 catalogue because the second spelling
     * matched is precisely how a scheme boundary gets crossed unnoticed.
     */
    const declaration = declaredBy('Introduction to C Programming (1BPLC105E/205E)');
    expect(declaration.codes.some(isLaterFamily)).toBe(true);
    expect(speaksForScheme2022(declaration)).toBe(false);
  });

  it('refuses a document that declares no code at all', () => {
    // Nothing to attribute. An empty match is not a licence to guess from the
    // filename.
    expect(speaksForScheme2022(declaredBy('Answer any FIVE full questions'))).toBe(false);
  });
});

describe('filename against page', () => {
  it('reports agreement where the page carries the claimed code', () => {
    const declaration = declaredBy('1BMATC101 First Semester');
    expect(filenameAgrees('1BMATC101.pdf', declaration)).toEqual({
      claimed: '1BMATC101',
      agrees: true,
    });
  });

  it('reports disagreement, and does not resolve it', () => {
    /*
     * A real file in this workspace: `1BBEE105.pdf` whose page prints
     * `(BEE105)`. Neither side is authoritative enough to overrule the other,
     * so both are carried and a human decides (M10A.3 §14).
     */
    const declaration = declaredBy('Basic Electrical Engineering (BEE105)');
    const result = filenameAgrees('1BBEE105.pdf', declaration);
    expect(result.claimed).toBe('1BBEE105');
    expect(result.agrees).toBe(false);
    // The page's own code survives; nothing was rewritten to match the name.
    expect(declaration.codes).toEqual(['BEE105']);
  });

  it('treats a filename with no code as nothing to disagree with', () => {
    expect(filenameAgrees('DBMS SOLVED.pdf', declaredBy('BCS403')).agrees).toBe(true);
  });
});
