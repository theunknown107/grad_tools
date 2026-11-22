/**
 * The title-quality signal that keeps a leaked column out of the catalogue.
 *
 * Authority: catalogue title-extraction audit (2026-10-24) §6.
 *
 * The expected answers are read off the titles by hand, not taken from the
 * detector — a title is a defect here because a person looking at it can see
 * the teaching column or a duplicated cell in it, and that is what the examples
 * are chosen to be.
 */

import { describe, expect, it } from 'vitest';
import { selectReading, suspectTitle } from '@gradtools/vtu-catalogue';

describe('suspectTitle', () => {
  it('flags teaching-department or staff text left in a title', () => {
    for (const title of [
      'Civil/Mech Computer-Aided Engineering Drawing Engg dept',
      'Applied Chemistry (Stream Specific CHE Dept Course)',
      'Introduction to AI and Applications Any Dept',
      'National Service Scheme (NSS) coordinator',
      'Physical Education Physical Education (PE) (Sports and Athletics) Director',
      'Respective Engineering Science Course-I Dept',
      // run-together form the extractor sometimes emits
      'Respective Engineering Science Course-II EnggDept',
      // the applicability phrase printed in the teaching column
      'ANY BRANCH Environmental Studies',
      'Respective Engg Engineering Science Course-I',
    ]) {
      expect(suspectTitle(title)).not.toBeNull();
    }
  });

  it('flags a word duplicated immediately, the mark of a duplicated cell', () => {
    for (const title of [
      'Textile/ Silk Silk Reeling Technology',
      'Aerial Robotics Robotics and Mechatronics',
      'Total Quality Management Management Information Systems',
    ]) {
      expect(suspectTitle(title)).toBe('a word repeated immediately');
    }
  });

  it('flags a bare course code standing in for a title', () => {
    // The elective pass falls back to the code when it reads no name; a code is
    // never a title.
    expect(suspectTitle('BESCK104x')).toBe('a course code where a title should be');
    expect(suspectTitle('BCB801B')).toBe('a course code where a title should be');
    expect(suspectTitle('')).toBe('a course code where a title should be');
  });

  it('flags a whole phrase duplicated immediately (every-other-word repeat)', () => {
    // "Physical Education Physical Education …" — the single-word rule misses it
    // because no two adjacent words are equal.
    expect(suspectTitle('Physical Education Physical Education (PE) (Sports and Athletics)')).toBe(
      'a phrase repeated immediately',
    );
  });

  it('passes real titles, including a word that recurs further along', () => {
    for (const title of [
      'Physical Education (PE) (Sports and Athletics)',
      'Computer-Aided Engineering Drawing',
      'Engineering Mathematics - I',
      'Applied Chemistry',
      'Programming in C',
      // "Engineering" must not trip the "Engg"/"Engg dept" signal
      'Introduction to Civil Engineering',
      'Engineering Mathematics - II',
      // a genuine repeat, not adjacent: must NOT be flagged
      'Community Project (Project-Based Learning) / Societal Project',
    ]) {
      expect(suspectTitle(title)).toBeNull();
    }
  });
});

describe('selectReading', () => {
  const r = (title: string) => ({ title });

  it('prefers a clean reading over a suspect one', () => {
    const records = [r('Civil/Mech Computer-Aided Engineering Drawing Engg dept'), r('Computer-Aided Engineering Drawing')];
    expect(selectReading(records).title).toBe('Computer-Aided Engineering Drawing');
  });

  it('prefers the title the most documents agree on, not the longest', () => {
    // A trailing teaching-column word the signal misses is a one-off and must
    // lose to the reading everyone else prints.
    const records = [
      r('Environmental Studies'),
      r('Environmental Studies'),
      r('Environmental Studies'),
      r('Environ/Che/Biotech.PSB: Environmental Studies'),
    ];
    expect(selectReading(records).title).toBe('Environmental Studies');
  });

  it('keeps the fuller official title when consensus agrees on it', () => {
    const records = [
      r('Physical Education (PE) (Sports and Athletics)'),
      r('Physical Education (PE) (Sports and Athletics)'),
      r('Physical Education'),
    ];
    expect(selectReading(records).title).toBe('Physical Education (PE) (Sports and Athletics)');
  });

  it('is deterministic and independent of record order', () => {
    const a = [r('Alpha Course'), r('Alpha Course'), r('Bravo Course')];
    const b = [r('Bravo Course'), r('Alpha Course'), r('Alpha Course')];
    expect(selectReading(a).title).toBe(selectReading(b).title);
    expect(selectReading(a).title).toBe('Alpha Course');
  });
});
