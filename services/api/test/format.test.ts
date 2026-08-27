/**
 * Paper-format detection and OCR configuration.
 *
 * Authority: docs/17 §17.12 · M5A.3 §6, §7, §16
 *
 * Pure functions over text, so every branch is testable without a PDF, an OCR
 * engine or a database. The fixtures below are hand-written approximations of
 * the header blocks the qualification observed — including the OCR noise, which
 * is the point: this code runs on OCR output and cannot assume clean text.
 */

import { describe, expect, it } from 'vitest';
import {
  BASELINE_DPI,
  configFor,
  detectFormat,
  hasKannadaScript,
  looksMathematical,
} from '../src/documents/format.js';

/* Header text in the shape the qualification actually produced. */
const DESCRIPTIVE = `
  USN BCS403
  Fourth Semester B.E./B.Tech. Degree Examination, June/July 2024
  Database Management Systems
  Time: 3 hrs. Max. Marks: 100
  Note: 1. Answer any FIVE full questions, choosing ONE full question from each module.
  Module-1
  Q.1 a. Explain the three-schema architecture. 06 L2 CO1
  b. Discuss data independence. 07 L2 CO1
  Module-2
  Q.3 a. Draw an ER diagram. 08 L3 CO2
`;

const MCQ = `
  USN BENGK106 Question Paper Version : A
  First/Second Semester B.E./B.Tech. Degree Examination, June/July 2024
  Communicative English
  Time: 1 hr.] [Max. Marks: 50
  INSTRUCTIONS TO THE CANDIDATES
  1. Answer all the fifty questions, each question carries one mark.
  2. Use only Black ball point pen for writing / darkening the circles.
`;

/*
 * The Kannada MCQ paper, with the exact failure that broke an earlier detector:
 * OCR rendered "questions" as a Kannada glyph, so "fifty" is not followed by a
 * readable noun.
 */
const MCQ_KANNADA = `
  USN BKSKK107
  First/Second Semester B.E./B.Tech. Degree Examination, June/July 2024
  ಸಾಂಸ್ಕತಿಕ ಕನ್ನಡ
  Time: 1 hr.] [Max. Marks: 50
  ಸೂಚನೆಗಳು
  1. ಎಲ್ಲ ೫೦ ಪ್ರಶ್ನೆಗಳಿಗೂ ಉತ್ತರಿಸಿರಿ. ಪ್ರತಿ ಪ್ರಶ್ನೆಗೆ ಒಂದು ಅಂಕ.
  2. Answer all the fifty ಕೈತ, each question bags one mark.
`;

/* A DESCRIPTIVE paper worth 50 marks. Misclassified by any marks-total rule. */
const DESCRIPTIVE_50 = `
  Third Semester B.E. Degree Examination, June/July 2024
  Cyber Crime and Cyber Laws
  Time: 2 hrs. Max. Marks:50
  Note: 1. Answer any FIVE full questions, choosing ONE full question from each module.
  Module-1
  Module-2
  Q.1 a. Define cyber crime. 6 L2 CO1
`;

describe('format detection', () => {
  it('recognises a descriptive paper', () => {
    expect(detectFormat(DESCRIPTIVE).format).toBe('descriptive');
  });

  it('recognises an MCQ paper', () => {
    expect(detectFormat(MCQ).format).toBe('mcq');
  });

  /*
   * The first detector keyed on "Marks: 50 => MCQ" and got this wrong. Total
   * marks does not identify a format; the instruction line does.
   */
  it('recognises a DESCRIPTIVE paper worth 50 marks', () => {
    expect(detectFormat(DESCRIPTIVE_50).format).toBe('descriptive');
  });

  /*
   * The second failure: OCR rendered "questions" as a Kannada glyph, so a
   * detector requiring a readable noun after "fifty" rejected a document that
   * had been read correctly in every other respect.
   */
  it('recognises an MCQ paper whose keyword was mangled by OCR', () => {
    expect(detectFormat(MCQ_KANNADA).format).toBe('mcq');
  });

  /* The third failure: instructions in Kannada, so English cues never appear. */
  it('recognises an MCQ paper from Kannada cues alone', () => {
    const kannadaOnly = `
      ಸೂಚನೆಗಳು
      ಎಲ್ಲ ೫೦ ಪ್ರಶ್ನೆಗಳಿಗೂ ಉತ್ತರಿಸಿರಿ. ಪ್ರತಿ ಪ್ರಶ್ನೆಗೆ ಒಂದು ಅಂಕ.
    `;
    expect(detectFormat(kannadaOnly).format).toBe('mcq');
  });

  /*
   * `unknown` must be a real answer, never a fallback to the commoner format.
   * A paper matching no template is not a broken paper.
   */
  it('returns unknown rather than guessing', () => {
    expect(detectFormat('Some unrelated document with no exam structure.').format).toBe('unknown');
    expect(detectFormat('').format).toBe('unknown');
  });

  it('detects Kannada script', () => {
    expect(hasKannadaScript(MCQ_KANNADA)).toBe(true);
    expect(hasKannadaScript(DESCRIPTIVE)).toBe(false);
  });
});

describe('OCR configuration', () => {
  /* PSM values are the measured ones, not defaults (docs/17 §17.11d). */
  it('uses PSM 3 for descriptive papers', () => {
    expect(configFor(detectFormat(DESCRIPTIVE)).psm).toBe(3);
  });

  it('uses PSM 6 for MCQ papers', () => {
    expect(configFor(detectFormat(MCQ)).psm).toBe(6);
  });

  it('uses eng alone when there is no Kannada', () => {
    const config = configFor(detectFormat(DESCRIPTIVE));
    expect(config.languages).toBe('eng');
  });

  /*
   * `eng+kan`, never `kan` alone: `kan` destroys the Latin header, and applying
   * `eng+kan` everywhere would cost ~1.8x on every English paper for nothing.
   */
  it('uses eng+kan only where Kannada was actually seen', () => {
    expect(configFor(detectFormat(MCQ_KANNADA)).languages).toBe('eng+kan');
    expect(configFor(detectFormat(MCQ)).languages).toBe('eng');
  });

  it('never selects kan alone', () => {
    for (const text of [DESCRIPTIVE, MCQ, MCQ_KANNADA, 'nothing']) {
      expect(configFor(detectFormat(text)).languages).not.toBe('kan');
    }
  });

  it('uses the 150 DPI baseline and never raises it silently', () => {
    for (const text of [DESCRIPTIVE, MCQ, MCQ_KANNADA, 'nothing']) {
      expect(configFor(detectFormat(text)).dpi).toBe(BASELINE_DPI);
      expect(configFor(detectFormat(text)).dpi).toBe(150);
    }
  });

  /* An unknown format gets a safe configuration AND is flagged. */
  it('flags an unknown format for review with a readable reason', () => {
    const config = configFor(detectFormat('unrelated text'));
    expect(config.needsReview).toBe(true);
    expect(config.reviewReason).toMatch(/format could not be identified/i);
    expect(config.psm).toBe(3);
  });

  it('does not flag a recognised format', () => {
    expect(configFor(detectFormat(DESCRIPTIVE)).needsReview).toBe(false);
    expect(configFor(detectFormat(MCQ)).needsReview).toBe(false);
  });
});

describe('mathematics detection', () => {
  /*
   * Detected from subject and question stems, NOT from symbols — the symbols
   * are exactly what OCR destroys, so looking for them would find nothing on
   * precisely the papers that need flagging.
   */
  it('recognises a maths paper from its stems', () => {
    expect(
      looksMathematical(
        'Mathematics - I for CSE Stream. Find the radius of curvature at the point. ' +
          'Prove that the expansion of log(1+e) upto the term containing x.',
      ),
    ).toBe(true);
  });

  it('does not flag an ordinary paper', () => {
    expect(looksMathematical(DESCRIPTIVE)).toBe(false);
    expect(looksMathematical(MCQ)).toBe(false);
  });
});
