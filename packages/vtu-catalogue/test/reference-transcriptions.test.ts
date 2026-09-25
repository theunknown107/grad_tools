import { describe, expect, it } from 'vitest';
import { VTU_BRANCHES_2022, VTU_COLLEGES } from '../data/index.js';
import pinnedIds from './college-ids.json' with { type: 'json' };

describe('transcribed VTU colleges', () => {
  const { source, entries } = VTU_COLLEGES;

  it('records provenance and stays unreviewed until a person checks it', () => {
    expect(source.url).toBe('https://vtu.ac.in/affiliated-institute/');
    expect(source.method).toBe('one-time transcription');
    expect(source.retrievedAt).toMatch(/^\d{4}-\d{2}-\d{2}/);
    expect(typeof source.reviewed).toBe('boolean');
    expect(source.note).toMatch(/autonomy/i);
  });

  it('has unique ids, and every duplicated code is a recorded anomaly', () => {
    expect(new Set(entries.map((e) => e.id)).size).toBe(entries.length);
    const byCode = new Map<string, string[]>();
    for (const e of entries) if (e.code) byCode.set(e.code, [...(byCode.get(e.code) ?? []), e.id]);
    const duplicates = Object.fromEntries([...byCode].filter(([, ids]) => ids.length > 1));
    expect(duplicates).toEqual(source.duplicateCodes);
  });

  it('lists no more colleges per region than the page reported, and the counts are recorded', () => {
    const listed: Record<string, number> = {};
    for (const e of entries) listed[e.region] = (listed[e.region] ?? 0) + 1;
    expect(listed).toEqual(source.countsByRegion);
    for (const [region, reported] of Object.entries(source.reportedCountsByRegion)) {
      expect(listed[region] ?? 0).toBeLessThanOrEqual(reported);
    }
    expect(entries.filter((e) => e.code === null).length).toBe(source.entriesWithoutCode);
  });

  it('keeps catalogue ids stable (the API upserts on them)', () => {
    for (const e of entries) expect(e.id).toMatch(/^vtu-[a-z]+-[a-z0-9-]+$/);
    /* Every id is pinned: a rename, addition or removal must be a deliberate
       edit of test/college-ids.json, since published rows point at these ids. */
    expect(entries.map((e) => e.id).sort()).toEqual(pinnedIds);
    expect(pinnedIds).toHaveLength(185);
  });

  it('asserts no autonomy and invents no fields', () => {
    for (const e of entries) {
      expect(e.isAutonomous).toBeNull();
      expect(Object.keys(e).sort()).toEqual(['code', 'id', 'isAutonomous', 'name', 'region']);
      expect(e.name.trim()).not.toBe('');
    }
  });
});

describe('transcribed 2022 branches', () => {
  const { source, entries } = VTU_BRANCHES_2022;

  it('keeps the existing cse key for Computer Science & Engineering', () => {
    expect(entries.find((b) => b.id === 'cse')?.labelAsPrinted).toBe(
      'Computer Science & Engineering',
    );
  });

  it('has unique ids, provenance, and scheme links only on vtu.ac.in', () => {
    expect(new Set(entries.map((b) => b.id)).size).toBe(entries.length);
    expect(source.url).toBe('https://vtu.ac.in/b-e-scheme-syllabus/');
    for (const b of entries) {
      if (b.schemeUrl !== null) expect(b.schemeUrl).toMatch(/^https:\/\/vtu\.ac\.in\//);
    }
  });
});

it('the data files contain no control characters', () => {
  // eslint-disable-next-line no-control-regex
  expect(/[\u0000-\u001f\u007f]/.test(JSON.stringify([VTU_COLLEGES, VTU_BRANCHES_2022]))).toBe(
    false,
  );
});
