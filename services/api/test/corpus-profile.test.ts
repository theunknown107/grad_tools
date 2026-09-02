/**
 * The similarity gate, and the tokeniser it counts with.
 *
 * Authority: docs/22 §22.38 (M10B.3) · docs/32 OQ-045
 *
 * The gate is the whole milestone in one function, so it is tested against the
 * cases that would let a false "eligible" through — because the cost of that
 * is not a broken build, it is a similarity engine reported as evaluated when
 * nothing was ever compared.
 */

import { describe, expect, it } from 'vitest';
import {
  similarityGate,
  tokenCount,
  type CorpusProfile,
} from '../src/intelligence/corpus-profile.js';

function profile(perSubject: CorpusProfile['perSubject']): CorpusProfile {
  return {
    papers: 0,
    subjects: perSubject.length,
    multiSittingSubjects: perSubject.filter((s) => s.sittings > 1).length,
    sittings: [],
    questions: 0,
    subQuestions: 0,
    mcqItems: 0,
    mcqItemsDeclared: 0,
    emptyQuestions: 0,
    emptySubQuestions: 0,
    tokenisable: 0,
    nonTokenisable: 0,
    bySource: [],
    byFormat: [],
    needsReviewPapers: 0,
    privatePapers: 0,
    supersededExtractions: 0,
    perSubject,
  };
}

describe('the similarity gate', () => {
  it('refuses a corpus of one sitting per subject, however large', () => {
    /*
     * THE CASE THIS WHOLE MILESTONE TURNS ON. Nine subjects with plenty of
     * usable text each, all from one sitting: a repeat is not rare here, it is
     * unobservable. A row-count threshold would have passed this.
     */
    const gate = similarityGate(
      profile(
        Array.from({ length: 9 }, (_, i) => ({
          subjectCode: `BSUB${String(i)}`,
          sittings: 1,
          papers: 1,
          usableTexts: 500,
        })),
      ),
    );

    expect(gate.eligible).toBe(false);
    expect(gate.eligibleSubjects).toEqual([]);
    expect(gate.reason).toMatch(/no subject has more than one sitting/i);
  });

  it('accepts a single subject with two sittings and usable text', () => {
    // Small but sufficient: two sittings of one subject is exactly the shape a
    // repeat can appear in.
    const gate = similarityGate(
      profile([{ subjectCode: 'BCS403', sittings: 2, papers: 2, usableTexts: 40 }]),
    );

    expect(gate.eligible).toBe(true);
    expect(gate.eligibleSubjects).toHaveLength(1);
  });

  it('refuses multiple sittings that carry no usable text', () => {
    // Two sittings of a paper GradTools failed to extract proves nothing, and
    // must not read as eligible just because the sitting count looks right.
    const gate = similarityGate(
      profile([{ subjectCode: 'BKSKK107', sittings: 3, papers: 3, usableTexts: 0 }]),
    );

    expect(gate.eligible).toBe(false);
    expect(gate.reason).toMatch(/none of them carry usable question text/i);
  });

  it('reports only the eligible subjects, not the whole corpus', () => {
    const gate = similarityGate(
      profile([
        { subjectCode: 'BCS403', sittings: 2, papers: 2, usableTexts: 40 },
        { subjectCode: 'BMATS101', sittings: 1, papers: 1, usableTexts: 90 },
      ]),
    );

    expect(gate.eligible).toBe(true);
    expect(gate.eligibleSubjects.map((s) => s.subjectCode)).toEqual(['BCS403']);
  });
});

describe('the corpus tokeniser', () => {
  it('counts ordinary words, splitting on the hyphen', () => {
    /*
     * Five, not four: a hyphen is outside the token class, so "three-schema"
     * counts as two. That is worth pinning rather than smoothing over —
     * "three-schema" and "three schema" therefore tokenise identically, which
     * is exactly the behaviour a near-repeat comparison wants and a surprise
     * if you assume a hyphen holds a word together.
     */
    expect(tokenCount('Explain the three-schema architecture.')).toBe(5);
  });

  it('finds no tokens in punctuation-and-digit noise', () => {
    /*
     * A real record from this corpus. It is non-empty, so it is not missing;
     * it yields nothing comparable, so it is not usable either. Counting it as
     * either one would misstate the corpus.
     */
    expect(tokenCount("'* 7 / - ' / 7 7")).toBeGreaterThan(0);
    expect(tokenCount("'* / - ' /")).toBe(0);
    expect(tokenCount('   ')).toBe(0);
  });

  it('keeps Kannada words whole', () => {
    /*
     * Kannada vowels are combining MARKS. A `\p{L}`-only class splits every
     * word at each vowel sign and inflates the token count, which would make a
     * Kannada paper look richer than it is.
     */
    const kannada = 'ಕನ್ನಡ ಭಾಷೆ';
    expect(tokenCount(kannada)).toBe(2);
  });

  it('treats a digit run as a token', () => {
    // Marks and question numbers are tokens; whether they are USEFUL is a
    // similarity question, not a tokenising one.
    expect(tokenCount('2024')).toBe(1);
  });
});
