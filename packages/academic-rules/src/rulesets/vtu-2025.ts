/**
 * VTU 2025 scheme (25OB) rule set.
 *
 * Source:   VTU Regulations Governing the UG Programmes B.E. and B.Tech. - 2025
 *           Visvesvaraya Technological University, Belagavi
 * URL:      https://vtu.ac.in/wp-content/uploads/2026/05/B.E.B.Tech2025.pdf
 * Retrieved 2026-10-02 (official VTU source), text extracted with `pdftotext -layout`.
 *           Document dated 22-05-2026; effective "from the academic year 2025-26
 *           onwards" (25OB preamble).
 *
 * Scope:    B.E./B.Tech, 2025 scheme, VTU-affiliated NON-AUTONOMOUS colleges.
 *           Autonomous colleges set their own internal rules and must not use
 *           this rule set (docs/16 §16.1).
 *
 * Every value below is transcribed from a numbered 25OB clause. Nothing is
 * inferred; values the document does not establish are marked unverified.
 *
 * The 25OB grading, assessment, attendance, SGPA/CGPA and class framework is, on
 * the points that this rule set carries, the same as 22OB — verified clause by
 * clause against the 2025 document, not copied. (The 2025 scheme does change
 * things this type does not model, e.g. degree credits 160/120 per 25OB4 and the
 * 16-credit vertical-progression ceiling per 25OB24.2 — recorded in the
 * regulations manifest, not here.)
 */

import type { RuleSet } from '../types.js';

export const VTU_2025_RULE_SET_ID = 'vtu-2025-v1';

export const vtu2025RuleSet: RuleSet = {
  id: VTU_2025_RULE_SET_ID,
  schemeId: 'vtu-2025',
  collegeId: null,
  version: 1,
  active: true,
  verifiedAt: '2026-10-02',
  sourceUrl: 'https://vtu.ac.in/wp-content/uploads/2026/05/B.E.B.Tech2025.pdf',
  sourceClause: '25OB',
  effectiveFrom: '2025-08-01', // "from the academic year 2025-26 onwards" (25OB preamble)
  effectiveTo: null,

  // 25OB Table-25OB22.0.1 — "Letter Grades and corresponding Grade Points on a
  // 10-Point Scale". Bands verified against the 2025 document; identical to 22OB.
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

  // 25OB23.0 — Table 25OB23.0.1 "Additional Letter Grades and Their Applicability".
  specialGrades: [
    {
      letter: 'DX',
      meaning: 'Attendance below 75% in a credit or non-credit course; the course must be repeated.',
      points: 0,
      pointsVerified: true,
      includedInGpa: false, // repeated course; not part of the 10-point scale (25OB23)
      clause: '25OB23.0',
    },
    {
      letter: 'PP',
      meaning: 'Pass grade in a non-credit course or an audit course.',
      points: 0,
      pointsVerified: true,
      // "not a part of 10-Point Scale" (25OB22(3)); audit courses "not included in
      // the computation of the SGPA or CGPA" (25OB def. 32).
      includedInGpa: false,
      clause: '25OB23.0',
    },
    {
      letter: 'NP',
      meaning: 'Did not satisfy the CIE requirements of a non-credit course.',
      points: 0,
      pointsVerified: true,
      includedInGpa: false,
      clause: '25OB23.0',
    },
    {
      /**
       * NS — new in 25OB: "Not satisfied the CIE requirement of a credit course."
       * The student cannot appear for the SEE and must re-register (25OB24.1(b)).
       * The document assigns NS no grade point, so its point value is unverified.
       */
      letter: 'NS',
      meaning: 'Did not satisfy the CIE requirement of a credit course; must re-register.',
      points: null,
      pointsVerified: false,
      includedInGpa: false,
      clause: '25OB23.0',
    },
    {
      /**
       * AB — Absent for the SEE of a course. As in 22OB, 25OB lists AB among the
       * additional grades but states no grade point and no SGPA/CGPA treatment for
       * it. Whether an AB course contributes 0 points (like F) or is excluded (like
       * DX) changes a CGPA materially, so GradTools refuses to compute rather than
       * guess (docs/32 OQ-018).
       */
      letter: 'AB',
      meaning: 'Absent for the SEE of the course. Grade-point behaviour is not established by 25OB.',
      points: null,
      pointsVerified: false,
      includedInGpa: false,
      clause: '25OB23.0',
    },
    {
      letter: 'W',
      meaning: 'Dropped or withdrawn from a registered course; must be re-registered in a later semester.',
      points: null,
      pointsVerified: false,
      includedInGpa: false,
      clause: '25OB23.0',
    },
  ],

  // 25OB8.2, 25OB11.1 and 25OB12.0
  cieMax: 50, // CIE carries 50% of the course maximum; CIE may be 50 or 100 (25OB11.1)
  cieMinPct: 40, // 25OB11.1 — minimum 40% of CIE max (20/50) to be eligible for SEE
  seeMax: 100, // SEE written for 100 marks (also 50/200 forms) (25OB12(i))
  seeMinPct: 35, // 25OB12(i) — minimum 35% of the SEE maximum
  courseMax: 100, // CIE and SEE each carry 50% weightage
  overallMinPct: 40, // 25OB12(ii) — combined CIE+SEE not less than 40/100

  // 25OB10.0 Attendance Requirement
  attendanceRequiredPct: 85, // 25OB10(4) — minimum 85% in each registered course
  attendanceCondonablePct: 10, // 25OB10(5) — shortage up to 10% condonable by the VC
  attendanceDxFloorPct: 75, // 85% required less 10% condonable; below this → DX (25OB23.0)

  sgpaFormulaId: 'credit_weighted_gp', // 25OB25(2a) — Σ(Ci·Gi)/ΣCi
  cgpaFormulaId: 'credit_weighted_sgpa', // 25OB25 — credit-weighted across semesters
  // 25OB26.0 — "Percentage marks (M) = CGPA × 10".
  percentageFormulaId: 'cgpa_x_10',

  // 25OB27.0 Passing Class Equivalence (bands on M = CGPA × 10). Overlap at the
  // boundaries resolved to the higher class, as in 22OB (assumption A-16.3).
  classBands: [
    { label: 'First Class with Distinction', shortLabel: 'FCD', minPct: 70, maxPct: 100 },
    { label: 'First Class', shortLabel: 'FC', minPct: 60, maxPct: 69.999999 },
    { label: 'Second Class', shortLabel: 'SC', minPct: 50, maxPct: 59.999999 },
    { label: 'Pass Class', shortLabel: 'P', minPct: 40, maxPct: 50 },
  ],

  // 25OB25 — "SGPA and CGPA shall be rounded off to two (2) decimal places".
  rounding: {
    decimalPlaces: 2,
    mode: 'half_up',
    stage: 'final_only',
  },
};
