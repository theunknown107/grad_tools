/**
 * Deterministic rounding.
 *
 * Authority: docs/16_ACADEMIC_RULES_ENGINE.md §16.8
 *   22OB 6.6(2b): "the SGPA and CGPA shall be rounded off to 2 decimal points"
 *
 * Applied ONCE, at the end. Intermediate values keep full precision (16 §16.2.4).
 */

import type { RoundingPolicy } from './types.js';

/**
 * Binary floating point cannot represent most decimal fractions exactly, so a
 * value that is mathematically 8.425 may compute as 8.424999999999999. Naive
 * half-up rounding would then produce 8.42 instead of 8.43.
 *
 * This tolerance nudges such values back onto the boundary before rounding.
 * It is safe for this domain because every value rounded here is a GPA (0–10)
 * or a percentage (0–100) derived from small integer-ish inputs, so a genuine
 * value never lands within 1e-9 of a rounding boundary.
 *
 * ponytail: absolute epsilon, adequate for 0–100 at 2dp. If a future rule set
 * needs high-precision rounding over a wider range, move to integer-scaled
 * arithmetic rather than widening this constant.
 */
const BOUNDARY_TOLERANCE = 1e-9;

/**
 * Rounds half away from zero at the given number of decimal places.
 *
 * All values in this engine are non-negative, so this is "half up" in the
 * everyday sense. Negative inputs are handled symmetrically rather than being
 * left to the surprising behaviour of Math.round (which rounds -0.5 to -0).
 */
export function roundHalfUp(value: number, decimalPlaces: number): number {
  if (!Number.isFinite(value)) {
    throw new RangeError('roundHalfUp requires a finite value');
  }
  if (!Number.isInteger(decimalPlaces) || decimalPlaces < 0 || decimalPlaces > 15) {
    throw new RangeError('decimalPlaces must be an integer between 0 and 15');
  }

  const factor = 10 ** decimalPlaces;
  const scaled = value * factor;
  const magnitude = Math.floor(Math.abs(scaled) + 0.5 + BOUNDARY_TOLERANCE);
  const result = (value < 0 ? -magnitude : magnitude) / factor;

  // Normalises -0 to 0 so that formatted output never shows "-0.00".
  return result === 0 ? 0 : result;
}

/** Applies a rule set's rounding policy. */
export function applyRounding(value: number, policy: RoundingPolicy): number {
  return roundHalfUp(value, policy.decimalPlaces);
}
