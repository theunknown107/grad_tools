/**
 * Recording a scheme is not supporting it.
 *
 * Every listed VTU scheme can be recorded on a profile; only a scheme with a
 * verified, active rule set is `supported` — support is derived from the
 * registry, never declared.
 */
import { describe, expect, it } from 'vitest';
import { VTU_SCHEMES, getActiveRuleSetForScheme, getScheme, schemeSupport } from '../src/index.js';

describe('the VTU schemes', () => {
  it('lists each B.E./B.Tech regulation once, newest first, with its official source', () => {
    expect(VTU_SCHEMES.map((scheme) => scheme.id)).toEqual([
      'vtu-2025',
      'vtu-2022',
      'vtu-2021',
      'vtu-2018',
      'vtu-2017',
      'vtu-2015',
      'vtu-2010',
    ]);
    for (const scheme of VTU_SCHEMES) {
      expect(scheme.regulationUrl).toMatch(/^https:\/\/vtu\.ac\.in\//);
    }
    // VTU publishes no separate 2014 regulation; it is not invented here.
    expect(getScheme('vtu-2014')).toBeUndefined();
  });

  it('supports exactly the schemes whose verified rules are in this build', () => {
    // 2022 and 2025 have verified, active rule sets (22OB / 25OB official PDFs).
    for (const id of ['vtu-2022', 'vtu-2025']) {
      expect(schemeSupport(id)).toBe('supported');
      expect(getActiveRuleSetForScheme(id)).toBeDefined();
    }
    // The older schemes are recorded (can be chosen on a profile) but not yet
    // supported: their regulations are scanned image PDFs not verified here.
    for (const id of ['vtu-2021', 'vtu-2018', 'vtu-2017', 'vtu-2015', 'vtu-2010']) {
      expect(schemeSupport(id)).toBe('recognised');
      expect(getActiveRuleSetForScheme(id)).toBeUndefined();
    }
  });

  it('knows nothing of a scheme it has no record of', () => {
    expect(schemeSupport('vtu-1999')).toBe('unknown');
    expect(schemeSupport('')).toBe('unknown');
  });
});
