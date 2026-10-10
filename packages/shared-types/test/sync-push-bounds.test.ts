/**
 * Security regression for the Zod resource-allocation advisory
 * (SNYK-JS-ZOD-20510278, no upstream fix): the sync-push record array must be
 * bounded so a large malformed body cannot make Zod accumulate one issue per
 * element without limit. This is application-level MITIGATION, not an upstream
 * fix — the advisory still has no patched release.
 *
 * The bound must reject oversized input while accepting a realistic batch.
 */
import { describe, expect, it } from 'vitest';
import { syncPushSchema, MAX_SYNC_PUSH_RECORDS } from '../src/student.js';

const record = (i: number) => ({
  id: `00000000-0000-4000-8000-${i.toString().padStart(12, '0')}`,
  collection: 'results' as const,
  baseRevision: null,
  deleted: false,
  data: {},
});

const batch = (n: number) => ({ records: Array.from({ length: n }, (_, i) => record(i)) });

describe('syncPushSchema is bounded (zod $ZodArray mitigation)', () => {
  it('rejects a batch larger than the cap', () => {
    const result = syncPushSchema.safeParse(batch(MAX_SYNC_PUSH_RECORDS + 1));
    expect(result.success).toBe(false);
  });

  it('accepts a batch at the cap', () => {
    expect(syncPushSchema.safeParse(batch(MAX_SYNC_PUSH_RECORDS)).success).toBe(true);
  });

  it('accepts a realistic full-sync batch (well under the cap)', () => {
    // A heavy full first sync is low hundreds across all collections.
    expect(syncPushSchema.safeParse(batch(500)).success).toBe(true);
  });
});
