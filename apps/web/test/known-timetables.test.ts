/**
 * Stored, verified timetables: CSBS 5th semester V (A) and V (B) of 12.09.2026
 * (R0), and V (B) of 01.10.2026. Recognised from whatever the reader produced (Word text,
 * spreadsheet cells, OCR lines) and shown as stored.
 */
import { describe, expect, it } from 'vitest';
import { knownTimetables } from '../src/domain/timetable/known-timetables.js';
import { slotsForBatch } from '../src/domain/timetable/timetable-import.js';
import { buildSubjectIndex, displayTitle, resolveSubject } from '../src/domain/subjects.js';
import type { TimetableSlot } from '../src/domain/types.js';

const lines = (...texts: string[]) => texts.map((text) => ({ text }));

/* How each format reads the header (shape only; no real document here). */
const WORD = lines(
  'With effective from: 12.09.2026',
  'V (A) – Timetable for the Academic year 2026 -27 (R0)',
  'BCB501 Fundamentals of Management',
  'BCB515A Marketing Research & Marketing Management',
  'V (B) – Timetable for the Academic year 2026 -27 (R0)',
);
const PHOTO = lines(
  'Department of Computer Science and Business System',
  'V (A) - Timetable for the Academic year 2026 -27',
  'With effective from:12. 09. 2026',
);
const SHEET = lines(
  'V (B)',
  'Timetable for the Academic year 2026-27 (R0)',
  'Effective from 12/09/2026',
  'BCB501',
  'BCBL504',
);

describe('recognising the stored edition', () => {
  it('a Word file holding both sections loads both, in printed order', () => {
    expect(knownTimetables(WORD).map((s) => s.label)).toEqual(['CSBS 5A', 'CSBS 5B']);
  });

  it('a photo read by OCR loads its section', () => {
    expect(knownTimetables(PHOTO).map((s) => s.label)).toEqual(['CSBS 5A']);
  });

  it('a spreadsheet loads its section', () => {
    expect(knownTimetables(SHEET).map((s) => s.label)).toEqual(['CSBS 5B']);
  });

  it('a photo with the department header cut off still loads, by its CSBS-only course', () => {
    const cropped = lines(
      'With effective from: 12.09.2026',
      'V (B) — Timetable for the Academic year 2026 -27 (R0)',
      'FM MRMM T TOC Value added',
      'BCB515A Marketing Re h & Marketu',
    );
    expect(knownTimetables(cropped).map((s) => s.label)).toEqual(['CSBS 5B']);
  });

  it('V (B) of 01.10.2026 loads its own edition', () => {
    const later = lines('Business System', 'Date: 01.10.2026', 'V (B) – Timetable (R0)');
    const [b] = knownTimetables(later);
    expect(b?.label).toBe('CSBS 5B');
    expect(b?.timetable.context.effectiveFrom).toBe('2026-10-01');
    expect(b?.timetable.classes).toHaveLength(26);
  });

  it.each([
    ['an earlier edition', ['Business System', 'V (A)', 'effective from: 07.09.2026']],
    [
      'V (A) of 01.10.2026, not stored',
      ['Business System', 'V (A)', 'With effective from: 01. 10. 2026'],
    ],
    ['a single CSBS marker', ['V (B)', 'effective from: 12.09.2026', 'MRMM']],
    ['another revision', ['Business System', 'V (A) (R1)', 'effective from: 12.09.2026']],
    [
      'another department on the same date',
      ['Mechanical Engineering', 'V (A)', '12.09.2026', 'BME501'],
    ],
    ['no section', ['Business System', 'effective from: 12.09.2026']],
  ])('does not load for %s', (_label, texts) => {
    expect(knownTimetables(lines(...texts))).toEqual([]);
  });
});

describe('the stored timetables', () => {
  const [a, b] = knownTimetables(WORD).map((s) => s.timetable);

  it('hold 28 classes per section, every one named, timed and taught', () => {
    for (const t of [a, b]) {
      expect(t?.classes).toHaveLength(28);
      for (const c of t?.classes ?? []) {
        expect(c.title).toBeTruthy();
        expect(c.faculty).toBeTruthy();
        expect(c.start < c.end).toBe(true);
        if (c.subjectCode !== null)
          expect(t?.dictionary.some((d) => d.subjectCode === c.subjectCode)).toBe(true);
      }
    }
  });

  it('keep each section’s own faculty for the same course', () => {
    const toc = (t: typeof a) => t?.dictionary.find((d) => d.subjectCode === 'BCS503')?.faculty;
    expect(toc(a)).not.toEqual(toc(b));
  });

  it('save subject name, code, day, time, room and faculty for the chosen lab batch', () => {
    let n = 0;
    const slots = slotsForBatch(a!, 'A1', 'p', () => `s${String(++n)}`);
    expect(slots.some((s) => s.subjectCode === 'BCBL502')).toBe(true); // A1's lab hour
    const toc = slots.find((s) => s.day === 'Mon' && s.startTime === '10:00');
    expect(toc).toMatchObject({
      subjectCode: 'BCS503',
      subjectTitle: 'Theory of Computation',
      endTime: '10:55',
      room: 'LH-301',
    });
    expect(toc?.faculty).toBeTruthy();
    const nss = slots.find((s) => s.activity?.startsWith('NSS/PE/YOGA'));
    expect(nss?.activity).toContain('BNSK559 / BPEK559 / BYOK559');
    expect(nss?.faculty).toBeTruthy();
  });

  it('the week shows the timetable’s own subject name', () => {
    let n = 0;
    const slots = slotsForBatch(b!, 'B1', 'p', () => `s${String(++n)}`) as TimetableSlot[];
    const index = buildSubjectIndex({ catalogue: [], timetable: slots });
    expect(displayTitle(resolveSubject(index, 'BCS502'), 'timetable')).toBe(
      'Computer Networks(T/L)',
    );
  });
});
