import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { VTU_COLLEGES } from '@gradtools/vtu-catalogue/data';
import { useColleges } from '../src/hooks/useReference.js';

const PUBLISHED = {
  id: '00000000-0000-4000-8000-000000000001',
  universityId: 'vtu',
  name: 'Verified College',
  code: 'VC',
  isAutonomous: false,
  city: null,
  catalogueId: null,
};

const BUNDLED_ID = 'vtu-bengaluru-nocode-bgs-college-of-engineering-and-technology';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useColleges', () => {
  it('appends a published college with no catalogue match, keeping the whole bundled list', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ data: [PUBLISHED] })),
    );
    const { result } = renderHook(() => useColleges());
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.items).toHaveLength(VTU_COLLEGES.entries.length + 1);
    expect(result.current.items.at(-1)).toEqual({
      id: PUBLISHED.id,
      catalogueId: null,
      name: 'Verified College',
      code: 'VC',
      region: null,
      reviewed: true,
    });
    expect(result.current.items.slice(0, -1).every((c) => !c.reviewed)).toBe(true);
    expect(result.current.error).toBeNull();
  });

  it('lays a published row over its bundled row by catalogueId, hiding no other row', async () => {
    const bundled = VTU_COLLEGES.entries.find((e) => e.id === BUNDLED_ID)!;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({
          data: [{ ...PUBLISHED, name: bundled.name, code: null, catalogueId: BUNDLED_ID }],
        }),
      ),
    );
    const { result } = renderHook(() => useColleges());
    await waitFor(() => expect(result.current.loading).toBe(false));
    const items = result.current.items;
    expect(items).toHaveLength(VTU_COLLEGES.entries.length);
    const index = VTU_COLLEGES.entries.indexOf(bundled);
    /* Replaced in place; the region the API does not carry is kept. */
    expect(items[index]).toEqual({
      id: PUBLISHED.id,
      catalogueId: BUNDLED_ID,
      name: bundled.name,
      code: null,
      region: 'BENGALURU',
      reviewed: true,
    });
    expect(items.filter((c) => c.reviewed)).toHaveLength(1);
    /* Unpublished rows keep their printed metadata, including a missing code. */
    const unpublished = items.filter((c) => !c.reviewed);
    expect(unpublished.map((c) => [c.catalogueId, c.code, c.region])).toEqual(
      VTU_COLLEGES.entries.filter((e) => e.id !== BUNDLED_ID).map((e) => [e.id, e.code, e.region]),
    );
  });

  it('falls back to the bundled, unreviewed transcription when the API is unreachable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Promise.reject(new TypeError('offline'))),
    );
    const { result } = renderHook(() => useColleges());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.items).toHaveLength(VTU_COLLEGES.entries.length);
    expect(result.current.items.every((c) => !c.reviewed)).toBe(true);
    expect(result.current.error).toBeNull();
  });

  it('falls back to the bundle when the API publishes no colleges', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ data: [] })),
    );
    const { result } = renderHook(() => useColleges());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.items[0]).toMatchObject({ reviewed: false });
  });
});
