/**
 * What a published catalogue artifact is allowed to say.
 *
 * Authority: Phase 7D §18, §21, §22, §29 · docs/47
 *
 * ---------------------------------------------------------------------------
 * THE ARTIFACT IS THE PRODUCT
 * ---------------------------------------------------------------------------
 *
 * `vtu-2022.json` ships inside the app and answers a student's credits with no
 * network and no database. Everything the ingestion pipeline proves about a
 * catalogue is proved about the DATABASE; the artifact is a separate
 * serialisation, and a defect that exists only on that side is invisible to
 * every check upstream of it.
 *
 * Three were. The first-year courses a student actually sits were resolved,
 * written to the database and never emitted, so the artifact carried the
 * PLACEHOLDERS instead — codes no result card prints. The two first-year
 * cycles collapsed into one namespace because the artifact had no field for
 * the stream. And the alias table went out whole regardless of which scheme
 * was asked for, so a 2022 equivalence rode inside a 2025 file with its year
 * stripped off on the way in.
 *
 * These assert the SHAPE the artifact must have for any of that to be
 * expressible. The emitted content is checked against the database by
 * `services/api/test/vtu-emit.test.ts`.
 */

import { describe, expect, it } from 'vitest';
import { CATALOGUES, VTU_2022 } from '../data/index.js';
import { courseKey, type CatalogueAlias, type CatalogueCourse } from '../src/types.js';

describe('a course identity in the artifact', () => {
  it('separates two rows that differ only by stream', () => {
    /*
     * THE FIRST-YEAR CYCLES, AND WHY THE FIELD EXISTS. A student takes physics
     * in semester I and chemistry in II, or the reverse. Both cycles put the
     * same mathematics in semester I, so the maths must stay ONE course; both
     * put a different science beside it, so those must stay TWO. Without the
     * stream in the key the artifact says semester I requires physics AND
     * chemistry, which is a first year nobody takes.
     */
    const physics = courseKey('2025', null, 1, '1BPHYS102', 'cse-physics-group');
    const chemistry = courseKey('2025', null, 1, '1BCHES102', 'cse-chemistry-group');
    const mathsInPhysicsCycle = courseKey('2025', null, 1, '1BMATS101', 'cse-physics-group');
    const mathsInChemistryCycle = courseKey('2025', null, 1, '1BMATS101', 'cse-chemistry-group');

    expect(physics).not.toBe(chemistry);
    expect(mathsInPhysicsCycle).not.toBe(mathsInChemistryCycle);
  });

  it('leaves the identity of a stream-less course exactly as it was', () => {
    /*
     * The stream defaults to none, so every caller that predates it keeps the
     * key it had. A programme-scoped 2022 row must not change identity because
     * a 2025 first-year document needed a new field.
     */
    expect(courseKey('2022', 'Computer Science & Business System', 3, 'BCS301')).toBe(
      courseKey('2022', 'Computer Science & Business System', 3, 'BCS301', null),
    );
    expect(courseKey('2022', null, 1, 'BMATS101')).not.toBe(
      courseKey('2022', null, 1, 'BMATS101', 'cse-physics-group'),
    );
  });

  it('still makes the scheme year part of the identity', () => {
    /* §18, unchanged by the new field. */
    expect(courseKey('2022', 'P', 3, 'BCS301', 's')).not.toBe(
      courseKey('2025', 'P', 3, 'BCS301', 's'),
    );
  });
});

describe('an alias in the artifact', () => {
  it('can state the scheme it belongs to', () => {
    /*
     * An alias is a statement about ONE scheme's codes. `BCSL358D` -> `BCS358D`
     * is a 2022 equivalence and its own evidence line says so; carried without
     * a year into a 2025 file, nothing downstream could tell it did not
     * belong. The field is what makes that detectable at all.
     */
    const alias: CatalogueAlias = {
      schemeYear: '2022',
      variant: 'BCSL358D',
      canonical: 'BCS358D',
      title: 'Invented Course',
      evidence: 'Invented evidence long enough to be worth recording.',
    };

    expect(alias.schemeYear).toBe('2022');
  });

  it('keeps every alias the 2022 catalogue already published', () => {
    /*
     * The shipped 2022 artifact is not regenerated — it predates both fields —
     * so its one alias stays exactly as it was published. A change to the
     * artifact SHAPE must not silently rewrite an artifact already out.
     */
    expect(VTU_2022.aliases).toHaveLength(1);
    expect(VTU_2022.aliases[0]).toMatchObject({
      variant: 'BCSL358D',
      canonical: 'BCS358D',
    });
  });
});

describe('the shipped catalogues', () => {
  it('carries 2022 at the size and version it was published', () => {
    /*
     * §5. The artifact schema gained fields in 1.2.0 and this file was NOT
     * regenerated to take them, which is the point: an older artifact stays
     * byte-identical and reads correctly under the newer type.
     */
    expect(VTU_2022.normalizationVersion).toBe('1.0.0');
    expect(VTU_2022.courses).toHaveLength(187);
    expect(VTU_2022.conflicts).toHaveLength(0);
    expect(VTU_2022.documents).toHaveLength(19);
  });

  it('ships no 2025 catalogue yet', () => {
    /* This phase fixes the artifact; publishing it is a separate decision. */
    expect(CATALOGUES).toHaveLength(1);
    expect(CATALOGUES.every((catalogue) => catalogue.courses.every((c) => c.schemeYear === '2022'))).toBe(
      true,
    );
  });

  it('gives every published course complete provenance', () => {
    /* §21: a credit with no source is indistinguishable from one somebody typed. */
    for (const catalogue of CATALOGUES) {
      for (const course of catalogue.courses) {
        expect(course.provenance.documentSha256).toMatch(/^[0-9a-f]{64}$/);
        expect(course.provenance.sourceUrl).toMatch(/^https:\/\/vtu\.ac\.in\//);
        expect(course.provenance.parserVersion.length).toBeGreaterThan(0);
      }
    }
  });

  it('never mixes scheme years inside one artifact', () => {
    for (const catalogue of CATALOGUES) {
      const years = new Set(catalogue.courses.map((course) => course.schemeYear));
      expect([...years]).toHaveLength(1);
      const aliasYears = new Set(
        catalogue.aliases.map((alias) => alias.schemeYear).filter((year) => year !== undefined),
      );
      for (const year of aliasYears) expect(years.has(year)).toBe(true);
    }
  });
});

describe('what a consumer can tell from a serialized row', () => {
  const row = (over: Partial<CatalogueCourse>): CatalogueCourse => ({
    schemeYear: '2025',
    programme: null,
    streamId: null,
    semester: 1,
    code: '1BQQQ101',
    title: 'Invented Course',
    credits: 3,
    creditBasis: 'table',
    relatedCode: null,
    provenance: {
      documentSha256: 'a'.repeat(64),
      sourceUrl: 'https://vtu.ac.in/pdf/invented.pdf',
      sourcePage: 1,
      parserVersion: '1.0.0',
      retrievedAt: '2026-01-01T00:00:00.000Z',
    },
    ...over,
  });

  it('tells an alternative from a requirement', () => {
    /*
     * The Kannada row prints two codes and one credit. Serialized, the second
     * must still say it is an ALTERNATIVE to the first and name it — otherwise
     * an offline reader sees two one-credit courses and charges the semester
     * twice.
     */
    const primary = row({ code: '1BKSK109', credits: 1, creditBasis: 'table' });
    const alternative = row({
      code: '1BKBK109',
      credits: 1,
      creditBasis: 'alternative',
      relatedCode: '1BKSK109',
    });

    expect(alternative.creditBasis).toBe('alternative');
    expect(alternative.relatedCode).toBe(primary.code);
  });

  it('tells a borrowed credit from a printed one', () => {
    /* §21: a resolved first-year course takes the placeholder row's figure. */
    const resolved = row({
      code: '1BMATS101',
      credits: 4,
      creditBasis: 'slot',
      relatedCode: '1BMATX101',
      streamId: 'cse-physics-group',
    });

    expect(resolved.creditBasis).toBe('slot');
    expect(resolved.relatedCode).toBe('1BMATX101');
    expect(resolved.streamId).toBe('cse-physics-group');
  });
});
