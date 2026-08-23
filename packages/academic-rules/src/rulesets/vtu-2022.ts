/**
 * VTU 2022 scheme (22OB) rule set.
 *
 * Source:   Regulations Governing the Award of Bachelor of Engineering /
 *           Technology Degree, 2022 — Visvesvaraya Technological University
 * URL:      https://vtu.ac.in/wp-content/uploads/2023/05/Regulations-Clr-BE-BTECH-2022-611-02052023.pdf
 * Retrieved 2026-08-23, text extracted with `pdftotext -layout`
 *
 * Scope:    B.E./B.Tech, 2022 scheme, VTU-affiliated NON-AUTONOMOUS colleges.
 *           Autonomous colleges set their own internal rules and must not use
 *           this rule set (docs/16 §16.1).
 *
 * Every value below is transcribed from a numbered clause. Nothing is inferred.
 */

import type { RuleSet } from '../types.js';

export const VTU_2022_RULE_SET_ID = 'vtu-2022-v1';

export const vtu2022RuleSet: RuleSet = {
  id: VTU_2022_RULE_SET_ID,
  schemeId: 'vtu-2022',
  collegeId: null,
  version: 1,
  active: true,
  verifiedAt: '2026-08-23',
  sourceUrl:
    'https://vtu.ac.in/wp-content/uploads/2023/05/Regulations-Clr-BE-BTECH-2022-611-02052023.pdf',
  sourceClause: '22OB',
  effectiveFrom: '2022-08-01',
  effectiveTo: null,

  // 22OB 6.1 — note the irregular bands: B and C span 5 marks, the rest span 10.
  gradeBands: [
    { letter: 'O', descriptor: 'Outstanding', points: 10, minPct: 90, maxPct: 100 },
    { letter: 'A+', descriptor: 'Excellent', points: 9, minPct: 80, maxPct: 89 },
    { letter: 'A', descriptor: 'Very Good', points: 8, minPct: 70, maxPct: 79 },
    { letter: 'B+', descriptor: 'Good', points: 7, minPct: 60, maxPct: 69 },
    { letter: 'B', descriptor: 'Above Average', points: 6, minPct: 55, maxPct: 59 },
    { letter: 'C', descriptor: 'Average', points: 5, minPct: 50, maxPct: 54 },
    { letter: 'P', descriptor: 'Pass', points: 4, minPct: 40, maxPct: 49 },
    { letter: 'F', descriptor: 'Fail', points: 0, minPct: 0, maxPct: 39 },
  ],

  // 22OB 6.2
  specialGrades: [
    {
      letter: 'DX',
      meaning: 'Attendance below 75%; the course must be repeated.',
      points: 0,
      pointsVerified: true,
      // "Credits are not included in CGPA" — 22OB 6.2(1)
      includedInGpa: false,
      clause: '22OB 6.2(1)',
    },
    {
      letter: 'AU',
      meaning: 'Satisfactory in an audit course.',
      points: 0,
      pointsVerified: true,
      includedInGpa: false,
      clause: '22OB 6.2(2)',
    },
    {
      /**
       * AB — Absent for the course.
       *
       * UNRESOLVED (docs/32 OQ-018, docs/16 A-16.4).
       *
       * 22OB 6.2(3) lists AB among the letter grades but, unlike DX/AU/PP/NP,
       * states no grade point and no CGPA treatment for it. Whether an AB
       * course contributes 0 points with its credits counted (like F) or is
       * excluded from the ratio (like DX) changes a student's CGPA materially.
       *
       * GradTools therefore refuses to compute rather than guessing: any
       * calculation touching an AB grade returns `unverified_rule`. This value
       * is filled in only once the behaviour is verified against a real grade
       * card or an authoritative clause.
       */
      letter: 'AB',
      meaning: 'Absent for the course. Grade-point behaviour is not yet verified.',
      points: null,
      pointsVerified: false,
      includedInGpa: false,
      clause: '22OB 6.2(3)',
    },
    {
      letter: 'PP',
      meaning: 'Passed a non-credit course.',
      points: 0,
      pointsVerified: true,
      includedInGpa: false,
      clause: '22OB 6.2(4)',
    },
    {
      letter: 'NP',
      meaning: 'Not passed a non-credit course.',
      points: 0,
      pointsVerified: true,
      includedInGpa: false,
      clause: '22OB 6.2(5)',
    },
    {
      /**
       * IC — Incomplete. A placeholder that is later converted to a real grade
       * or to F. It has no grade point of its own, so it is not verified.
       */
      letter: 'IC',
      meaning: 'Incomplete; a placeholder converted later to a grade or to F.',
      points: null,
      pointsVerified: false,
      includedInGpa: false,
      clause: '22OB 6.2(6)',
    },
    {
      letter: 'W',
      meaning: 'Dropped or withdrawn; must be cleared in a later semester.',
      points: null,
      pointsVerified: false,
      includedInGpa: false,
      clause: '22OB 6.2(7)',
    },
  ],

  // 22OB 4.1(4)–(5) and 6.3
  cieMax: 50,
  cieMinPct: 40, // 22OB 6.3(1) — 40% of CIE maximum, i.e. 20/50
  seeMax: 100, // the SEE is written for 100 marks
  seeMinPct: 35, // 22OB 6.3(2) — 35% of the SEE scale
  courseMax: 100, // 22OB 4.1(4) — CIE and SEE carry 50% weightage each
  overallMinPct: 40, // 22OB 6.3(3)

  // 22OB 3.7(1) and 6.2(1)
  attendanceRequiredPct: 85,
  attendanceCondonablePct: 10,
  attendanceDxFloorPct: 75,

  sgpaFormulaId: 'credit_weighted_gp', // 22OB 6.6(2a)
  cgpaFormulaId: 'credit_weighted_sgpa', // 22OB 6.6(2b)
  /**
   * 22OB 6.7 — "Percentage of marks secured, M = CGPA Earned x 10",
   * with the regulation's own worked example: CGPA 8.20 -> 82.0%.
   *
   * NOT the (CGPA - 0.75) x 10 formula published by third-party calculators,
   * which does not appear in this regulation.
   */
  percentageFormulaId: 'cgpa_x_10',

  // 22OB 6.8 — the regulation's bands overlap at exactly M = 50; GradTools
  // resolves that to the higher class (assumption A-16.3).
  classBands: [
    { label: 'First Class with Distinction', shortLabel: 'FCD', minPct: 70, maxPct: 100 },
    { label: 'First Class', shortLabel: 'FC', minPct: 60, maxPct: 69.999999 },
    { label: 'Second Class', shortLabel: 'SC', minPct: 50, maxPct: 59.999999 },
    { label: 'Pass Class', shortLabel: 'P', minPct: 40, maxPct: 50 },
  ],

  // 22OB 6.6(2b) — "rounded off to 2 decimal points"
  rounding: {
    decimalPlaces: 2,
    mode: 'half_up',
    stage: 'final_only',
  },
};
