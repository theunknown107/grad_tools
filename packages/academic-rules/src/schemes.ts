/**
 * The VTU B.E./B.Tech academic schemes a student can belong to — and which of
 * them GradTools can actually calculate for.
 *
 * Authority: VTU's regulations index, https://vtu.ac.in/en/be-btech/ (read
 * 2026-09-27), and each scheme's own regulation document below.
 *
 * ---------------------------------------------------------------------------
 * RECORDING A SCHEME IS NOT SUPPORTING IT
 * ---------------------------------------------------------------------------
 *
 * A 2018-scheme student is a real student, and their profile should say so.
 * But the schemes grade differently — 2010 is marks-only with no grade points;
 * 2015-16 uses O/S/A…E/F; 2017-18 and 2018-19 use S/A…E/F; 2021, 2022 and 2025
 * use O/A+/A/B+/B/C/P/F with different CIE/SEE splits — and GradTools holds
 * verified rules for one of them. Grading a 2018 student under 2022 rules
 * would produce a confident, wrong SGPA.
 *
 * So support is DERIVED, never stored: a scheme is `supported` exactly when a
 * verified, active rule set exists for it in the registry. Every other listed
 * scheme is `recognised` — recorded, shown, never calculated. There is no flag
 * here to drift out of step with the rules.
 *
 * Not listed: a separate "2014 scheme". VTU publishes no 2014 regulation; its
 * syllabus page groups "2010 & 2014" syllabi together. 2006 and 2002 are
 * listed on the index but are outside any student this product serves.
 */

import { getActiveRuleSetForScheme } from './rulesets/registry.js';

export interface AcademicScheme {
  /** The same spelling a RuleSet's `schemeId` uses. */
  readonly id: string;
  readonly label: string;
  /** The regulation's own clause prefix, where it has one (e.g. 22OB). */
  readonly regulationCode: string | null;
  /** The first admission year the regulation applies to. */
  readonly admittedFrom: string;
  readonly regulationUrl: string;
}

export const VTU_SCHEMES: readonly AcademicScheme[] = [
  {
    id: 'vtu-2025',
    label: '2025 scheme',
    regulationCode: '25OB',
    admittedFrom: '2025-26',
    regulationUrl: 'https://vtu.ac.in/wp-content/uploads/2026/05/B.E.B.Tech2025.pdf',
  },
  {
    id: 'vtu-2022',
    label: '2022 scheme',
    regulationCode: '22OB',
    admittedFrom: '2022-23',
    regulationUrl:
      'https://vtu.ac.in/wp-content/uploads/2023/05/Regulations-Clr-BE-BTECH-2022-611-02052023.pdf',
  },
  {
    id: 'vtu-2021',
    label: '2021 scheme',
    regulationCode: '21OB',
    admittedFrom: '2021-22',
    regulationUrl: 'https://vtu.ac.in/pdf/regulations2021/finalreg2021.pdf',
  },
  {
    id: 'vtu-2018',
    label: '2018 scheme (CBCS)',
    regulationCode: '18OB',
    admittedFrom: '2018-19',
    regulationUrl: 'https://vtu.ac.in/wp-content/uploads/2019/12/becbcs2018-19.pdf',
  },
  {
    id: 'vtu-2017',
    label: '2017 scheme (CBCS)',
    regulationCode: '17OB',
    admittedFrom: '2017-18',
    regulationUrl: 'https://vtu.ac.in/wp-content/uploads/2019/12/becbcs2017-18.pdf',
  },
  {
    id: 'vtu-2015',
    label: '2015 scheme (CBCS)',
    regulationCode: '15OB',
    admittedFrom: '2015-16',
    regulationUrl: 'https://vtu.ac.in/wp-content/uploads/2019/12/becbcs2015-16.pdf',
  },
  {
    id: 'vtu-2010',
    label: '2010 scheme',
    regulationCode: null,
    admittedFrom: '2010-11',
    regulationUrl: 'https://vtu.ac.in/wp-content/uploads/2025/04/Regulations-BE-BTech-2010-.pdf',
  },
];

export type SchemeSupport = 'supported' | 'recognised' | 'unknown';

export function getScheme(id: string): AcademicScheme | undefined {
  return VTU_SCHEMES.find((scheme) => scheme.id === id);
}

/**
 * `supported` when a verified, active rule set exists for the scheme;
 * `recognised` when it is a real VTU scheme without one; `unknown` otherwise.
 */
export function schemeSupport(id: string): SchemeSupport {
  if (getScheme(id) === undefined) return 'unknown';
  return getActiveRuleSetForScheme(id) === undefined ? 'recognised' : 'supported';
}
