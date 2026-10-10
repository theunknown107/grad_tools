import { describe, expect, it } from 'vitest';
import { checkMarks } from '../src/domain/marks-check.js';

describe('whether three marks agree', () => {
  it('accepts a row that adds up, and says nothing more', () => {
    expect(checkMarks(44, 36, 80)).toEqual({
      agreement: 'consistent',
      computedTotal: 80,
      candidate: null,
    });
  });

  it('reports a missing mark as missing, not as a disagreement', () => {
    expect(checkMarks(null, 36, 80).agreement).toBe('missing');
  });

  it('offers the one reading a lost digit explains — and changes nothing', () => {
    // "44" read as "4": only the internal mark is one digit from making it add up.
    expect(checkMarks(4, 36, 80)).toEqual({
      agreement: 'inconsistent',
      computedTotal: 40,
      candidate: { field: 'internal', read: 4, possible: 44 },
    });
    // A doubled digit in the total.
    expect(checkMarks(41, 30, 711).candidate).toEqual({ field: 'total', read: 711, possible: 71 });
  });

  it('offers nothing when no single digit explains it', () => {
    expect(checkMarks(38, 12, 57)).toMatchObject({ agreement: 'inconsistent', candidate: null });
  });

  it('offers nothing when more than one fix would explain it', () => {
    // 1 + 1 ≠ 11: internal 10 and external 10 are both one digit away.
    expect(checkMarks(1, 1, 11)).toMatchObject({ agreement: 'inconsistent', candidate: null });
  });
});
