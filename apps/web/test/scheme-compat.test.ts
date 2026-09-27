/**
 * A course code is compared with the student's scheme — and an equivalence
 * VTU notified is named as one, not called a mistake.
 */
import { describe, expect, it } from 'vitest';
import { parseRow } from '../src/domain/result-import.js';
import { codeScheme, schemeCompatibility } from '../src/domain/scheme-compat.js';

describe('the scheme a code belongs to', () => {
  it('reads each scheme family from the code’s own shape', () => {
    expect(codeScheme('1BMATC101')).toBe('vtu-2025');
    expect(codeScheme('BCS401')).toBe('vtu-2022');
    expect(codeScheme('21CS51')).toBe('vtu-2021');
    expect(codeScheme('18CS51')).toBe('vtu-2018');
    expect(codeScheme('17CS51')).toBe('vtu-2017');
    expect(codeScheme('15CS51')).toBe('vtu-2015');
    expect(codeScheme('10CS51')).toBe('vtu-2010');
  });

  it('says nothing about a shape it does not know', () => {
    expect(codeScheme('99CS51')).toBeNull();
    expect(codeScheme('MATDIP301')).toBeNull();
    expect(schemeCompatibility('MATDIP301', 'vtu-2022')).toEqual({
      status: 'unknown',
      message: null,
    });
  });
});

describe('compatibility with the profile', () => {
  it('is silent for the student’s own scheme', () => {
    expect(schemeCompatibility('BCS401', 'vtu-2022').status).toBe('same');
    expect(schemeCompatibility('18CS51', 'vtu-2018').status).toBe('same');
  });

  it('names VTU notification 4718 for a 2021 student’s 2022-scheme course', () => {
    const verdict = schemeCompatibility('BCS401', 'vtu-2021');
    expect(verdict.status).toBe('equivalence');
    expect(verdict.message).toMatch(/notification 4718/);
    expect(verdict.message).toMatch(/semester 1–4/);
  });

  it('names VTU notification 1812 for an older-scheme student’s 2018-scheme course', () => {
    for (const scheme of ['vtu-2010', 'vtu-2015', 'vtu-2017']) {
      expect(schemeCompatibility('18CS51', scheme)).toMatchObject({ status: 'equivalence' });
    }
    expect(schemeCompatibility('18CS51', 'vtu-2017').message).toMatch(/notification 1812/);
  });

  it('calls anything else a mismatch, and never re-maps the code', () => {
    expect(schemeCompatibility('1BQAS401', 'vtu-2022').status).toBe('mismatch');
    // 2018-scheme codes on a 2022 profile were not flagged at all before.
    expect(schemeCompatibility('18CS51', 'vtu-2022').status).toBe('mismatch');
    const row = parseRow({ text: '18CS51  MANAGEMENT  30  40  70  P', page: 1 }, 'vtu-2022');
    expect(row?.subjectCode).toBe('18CS51');
    expect(row?.warnings.map((warning) => warning.kind)).toEqual(['scheme_mismatch']);
  });

  it('keeps an equivalence course as printed, with the note attached', () => {
    const row = parseRow({ text: 'BCS401  ALGORITHMS  44  36  80  P', page: 1 }, 'vtu-2021');
    expect(row?.subjectCode).toBe('BCS401');
    expect(row?.warnings.map((warning) => warning.kind)).toEqual(['equivalence_course']);
  });
});
