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
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useColleges', () => {
  it('serves the API list, marked reviewed, when the API has published colleges', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ data: [PUBLISHED] })),
    );
    const { result } = renderHook(() => useColleges());
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.items).toEqual([
      { id: PUBLISHED.id, name: 'Verified College', code: 'VC', region: null, reviewed: true },
    ]);
    expect(result.current.error).toBeNull();
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
