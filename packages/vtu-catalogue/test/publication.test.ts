/**
 * Publication scope and record-level exclusions.
 *
 * Authority: catalogue title-extraction audit (2026-10-24/25) §5, §6.
 */

import { describe, expect, it } from 'vitest';
import {
  PUBLICATION_SCOPE_2022,
  CATALOGUE_EXCLUSIONS_2022,
  inScope,
  exclusionFor,
  mergeCatalogue,
  suspectTitle,
  type PublicationIdentity,
  type CatalogueExclusion,
  type MergeRow,
} from '@gradtools/vtu-catalogue';

const id = (over: Partial<PublicationIdentity>): PublicationIdentity => ({
  schemeYear: '2022',
  code: 'BXXX101',
  programme: null,
  streamId: null,
  semester: 1,
  ...over,
});

describe('inScope', () => {
  it('admits a programme named in the scope', () => {
    expect(
      inScope(
        id({ programme: 'Computer Science & Business System', semester: 3 }),
        PUBLICATION_SCOPE_2022,
      ),
    ).toBe(true);
  });
  it('admits a first-year stream named in the scope', () => {
    expect(inScope(id({ streamId: 'cse-stream' }), PUBLICATION_SCOPE_2022)).toBe(true);
    expect(inScope(id({ streamId: 'civil-engineering-stream' }), PUBLICATION_SCOPE_2022)).toBe(
      true,
    );
  });
  it('rejects a programme or stream outside the scope', () => {
    expect(
      inScope(
        id({ programme: 'Robotics and Artificial Intelligence', semester: 8 }),
        PUBLICATION_SCOPE_2022,
      ),
    ).toBe(false);
    expect(inScope(id({ streamId: 'mechanical-engineering-stream' }), PUBLICATION_SCOPE_2022)).toBe(
      false,
    );
  });
  it('rejects another scheme year', () => {
    expect(
      inScope(id({ schemeYear: '2025', streamId: 'cse-stream' }), PUBLICATION_SCOPE_2022),
    ).toBe(false);
  });
});

describe('exclusionFor', () => {
  it('excludes the duplicate BITDK158 in any context', () => {
    expect(
      exclusionFor(
        id({ code: 'BITDK158', streamId: 'civil-engineering-stream' }),
        CATALOGUE_EXCLUSIONS_2022,
      ),
    ).not.toBeNull();
  });

  it('excludes an untitled NPTEL option placeholder (BCB801B)', () => {
    expect(
      exclusionFor(
        id({ code: 'BCB801B', programme: 'Computer Science & Business System', semester: 8 }),
        CATALOGUE_EXCLUSIONS_2022,
      ),
    ).not.toBeNull();
  });

  it('excludes BESCK104x ONLY in the CSE stream, keeping the clean civil record', () => {
    expect(
      exclusionFor(
        id({ code: 'BESCK104x', programme: 'CSE Stream Scheme (CSE/ISC/BT)' }),
        CATALOGUE_EXCLUSIONS_2022,
      ),
    ).not.toBeNull();
    expect(
      exclusionFor(
        id({ code: 'BESCK104x', programme: 'Civil Engineering Stream (CV/EV/TR/CC)' }),
        CATALOGUE_EXCLUSIONS_2022,
      ),
    ).toBeNull();
  });

  it('does not exclude a code no exclusion names (now-clean BCEDK103, BCIVC103)', () => {
    expect(
      exclusionFor(id({ code: 'BMATS101', streamId: 'cse-stream' }), CATALOGUE_EXCLUSIONS_2022),
    ).toBeNull();
    expect(
      exclusionFor(id({ code: 'BCEDK103', streamId: 'cse-stream' }), CATALOGUE_EXCLUSIONS_2022),
    ).toBeNull();
    expect(
      exclusionFor(
        id({ code: 'BCIVC103', streamId: 'civil-engineering-stream' }),
        CATALOGUE_EXCLUSIONS_2022,
      ),
    ).toBeNull();
  });

  it('carries a reason and evidence on every exclusion', () => {
    for (const exclusion of CATALOGUE_EXCLUSIONS_2022) {
      expect(exclusion.reason.length).toBeGreaterThan(10);
      expect(exclusion.evidence.length).toBeGreaterThan(10);
    }
  });
});

describe('mergeCatalogue', () => {
  const isClean = (t: string): boolean => suspectTitle(t) === null;
  const row = (over: Partial<MergeRow>): MergeRow => ({
    schemeYear: '2022',
    programme: 'P',
    semester: 3,
    code: 'BXX301',
    title: 'A Title',
    ...over,
  });
  const noExcl: readonly CatalogueExclusion[] = [];
  const actionFor = (res: ReturnType<typeof mergeCatalogue>, code: string) =>
    res.decisions.find((d) => d.key.endsWith(`|${code}`))?.action;

  it('keeps a clean baseline title over a different candidate reading (the PE case)', () => {
    const base = [
      row({ code: 'BPEK459', title: 'Physical Education (PE) (Sports and Athletics)' }),
    ];
    const cand = [
      row({
        code: 'BPEK459',
        title: 'Physical Education Physical Education (PE) (Sports and Athletics)',
      }),
    ];
    const res = mergeCatalogue(base, cand, noExcl, isClean);
    expect(res.merged).toHaveLength(1);
    expect(res.merged[0]?.title).toBe('Physical Education (PE) (Sports and Athletics)');
    expect(actionFor(res, 'BPEK459')).toBe('keep-baseline');
    expect(res.blockers).toHaveLength(0);
  });

  it('replaces a corrupted baseline title with a clean candidate', () => {
    const base = [
      row({ code: 'BCEDK103', title: 'Civil/Mech Computer-Aided Engineering Drawing Engg dept' }),
    ];
    const cand = [row({ code: 'BCEDK103', title: 'Computer-Aided Engineering Drawing' })];
    const res = mergeCatalogue(base, cand, noExcl, isClean);
    expect(res.merged[0]?.title).toBe('Computer-Aided Engineering Drawing');
    expect(actionFor(res, 'BCEDK103')).toBe('replace-with-candidate');
  });

  it('adds a new clean candidate, and drops a new corrupted one', () => {
    const cand = [
      row({ code: 'BNEW101', title: 'Engineering Physics' }),
      row({ code: 'BBAD101', title: 'Something Engg dept' }),
    ];
    const res = mergeCatalogue([], cand, noExcl, isClean);
    expect(res.merged.map((r) => r.code)).toEqual(['BNEW101']);
    expect(actionFor(res, 'BBAD101')).toBe('drop-candidate');
  });

  it('BLOCKS when neither baseline nor candidate title is clean (§4 Case F)', () => {
    const base = [row({ code: 'BCB801B', title: 'BCB801B' })];
    const cand = [row({ code: 'BCB801B', title: 'BCB801B' })];
    const res = mergeCatalogue(base, cand, noExcl, isClean);
    expect(res.blockers).toHaveLength(1);
    expect(res.merged).toHaveLength(0);
  });

  it('drops an excluded identity from both, never blocking on it', () => {
    const base = [row({ code: 'BCB801B', title: 'BCB801B' })];
    const res = mergeCatalogue(base, [], CATALOGUE_EXCLUSIONS_2022, isClean);
    expect(res.merged).toHaveLength(0);
    expect(actionFor(res, 'BCB801B')).toBe('drop-excluded');
    expect(res.blockers).toHaveLength(0);
  });

  it('is deterministic regardless of input order', () => {
    const base = [
      row({ code: 'BAAA1', title: 'Civil/Mech Something Engg dept' }),
      row({ code: 'BBBB1', title: 'Clean Title' }),
    ];
    const cand = [
      row({ code: 'BAAA1', title: 'Something Real' }),
      row({ code: 'BCCC1', title: 'Added Course' }),
    ];
    const forward = mergeCatalogue(base, cand, noExcl, isClean).merged.map((r) => r.code);
    const reversed = mergeCatalogue(
      [...base].reverse(),
      [...cand].reverse(),
      noExcl,
      isClean,
    ).merged.map((r) => r.code);
    expect(forward).toEqual(reversed);
  });
});
