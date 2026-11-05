/**
 * The focused field and the line under it stay above the keyboard
 * (lib/viewport revealDelta; device test 2026-11-05, defect 7).
 */
import { describe, expect, it } from 'vitest';
import { FIELD_CLEARANCE_PX, revealDelta } from '../src/lib/viewport.js';

describe('revealing the focused field above the keyboard', () => {
  it('scrolls the emulator case clear: a field ending 3px under the keyboard edge', () => {
    // Measured on the Pixel 10a: field 552–590, visible height 587.
    expect(revealDelta({ top: 552, bottom: 590 }, 587)).toBe(590 + FIELD_CLEARANCE_PX - 587);
  });

  it('leaves a field that already clears the keyboard alone', () => {
    expect(revealDelta({ top: 200, bottom: 240 }, 587)).toBe(0);
  });

  it('never scrolls the field’s own top off the screen', () => {
    // A field taller than the space left: scroll only as far as its top allows.
    expect(revealDelta({ top: 40, bottom: 700 }, 587)).toBe(32);
  });
});
