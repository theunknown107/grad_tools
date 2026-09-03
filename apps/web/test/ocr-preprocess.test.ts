/**
 * The one image adjustment made before OCR sees a photograph.
 *
 * Authority: docs/22 §22.52 · M10A.6B §14, §37
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS NOT A THRESHOLD
 * ---------------------------------------------------------------------------
 *
 * The obvious preprocessing step is to binarise: pick a cut point, everything
 * darker is ink, everything lighter is paper. On a phone photo of a result card
 * that is the step that loses marks. Lighting across a held page is uneven — a
 * shadow along one edge, a bright patch under the lamp — so a single global cut
 * puts one half of the table on the wrong side of it. Those rows do not arrive
 * misread, where a student would catch them. They do not arrive at all.
 *
 * So the adjustment here is a linear stretch between the observed 2nd and 98th
 * percentiles: faint print gets darker, but no pixel is ever DECLARED
 * background. Tesseract binarises locally, per region, which is the version of
 * that decision worth having — and it can only do it if it is handed grey.
 *
 * Every value here is synthetic.
 */

import { describe, expect, it } from 'vitest';
import { stretchGrey } from '../src/lib/ocr.js';

/** RGBA pixels from a list of grey levels. */
function pixels(levels: readonly number[]): number[] {
  return levels.flatMap((level) => [level, level, level, 255]);
}

/** The grey level of each pixel, after `stretchGrey` has run in place. */
function levels(data: readonly number[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < data.length; i += 4) out.push(data[i] as number);
  return out;
}

describe('greying', () => {
  it('collapses colour to one luma value per pixel', () => {
    // Rec. 601: green dominates, so a green pixel greys lighter than a blue one.
    const data = [0, 255, 0, 255, 0, 0, 255, 255];
    stretchGrey(data);
    const [green, blue] = levels(data) as [number, number];
    expect(green).toBeGreaterThan(blue);
  });

  it('leaves the alpha channel alone', () => {
    const data = [10, 10, 10, 128, 240, 240, 240, 255];
    stretchGrey(data);
    expect(data[3]).toBe(128);
    expect(data[7]).toBe(255);
  });
});

describe('stretching to the ink that is present', () => {
  it('pulls a low-contrast scan out to the full range', () => {
    /*
     * A washed-out photo: paper at 200, print at 120. Nothing is near black or
     * white, and Tesseract has little to separate. After the stretch the same
     * ORDER holds, over a much wider range.
     */
    const data = pixels([120, 140, 160, 180, 200]);
    expect(stretchGrey(data)).toBe(true);

    const after = levels(data);
    expect(after[0]).toBeLessThan(20);
    expect(after[4]).toBeGreaterThan(235);
    // Monotonic: the stretch reveals contrast, it does not reorder tones.
    for (let i = 1; i < after.length; i += 1) {
      expect(after[i] as number).toBeGreaterThan(after[i - 1] as number);
    }
  });

  it('never declares a pixel to be background', () => {
    /*
     * THE POINT OF THE WHOLE FILE. Under a threshold, the mid-tones here would
     * all collapse to 0 or 255. Under a stretch they stay distinguishable, so
     * faint print survives to where Tesseract can make that call locally.
     */
    const data = pixels([60, 90, 120, 150, 180, 210]);
    stretchGrey(data);

    const after = levels(data);
    const interior = after.slice(1, -1);
    expect(new Set(interior).size).toBe(interior.length);
    expect(interior.some((level) => level !== 0 && level !== 255)).toBe(true);
  });

  it('refuses to stretch a flat image rather than blowing it up', () => {
    /*
     * A photo of a blank wall, or a page so uniformly lit there is no range.
     * Dividing by a near-zero span would amplify sensor noise into a page of
     * confident black-and-white speckle, and OCR reads speckle as characters.
     */
    const data = pixels([128, 129, 130, 131]);
    expect(stretchGrey(data)).toBe(false);
    expect(levels(data)).toEqual([128, 129, 130, 131]);
  });

  it('is not thrown off by a small dark or bright patch', () => {
    /*
     * The percentile cut, not the min and max. One black speck and one blown
     * highlight would otherwise define the range and leave the actual page
     * squeezed into the middle of it — the failure the 2%/98% trim exists for.
     */
    const page = Array.from({ length: 200 }, (_, i) => 120 + (i % 40));
    const data = pixels([0, ...page, 255]);
    stretchGrey(data);

    const after = levels(data).slice(1, -1);
    expect(Math.min(...after)).toBeLessThan(30);
    expect(Math.max(...after)).toBeGreaterThan(225);
  });

  it('stays inside 0-255 for the pixels beyond the percentile cut', () => {
    // The outliers clamp; they must not wrap around into the opposite tone.
    const page = Array.from({ length: 200 }, (_, i) => 120 + (i % 40));
    const data = pixels([0, ...page, 255]);
    stretchGrey(data);

    const after = levels(data);
    expect(after[0]).toBe(0);
    expect(after[after.length - 1]).toBe(255);
    expect(after.every((level) => level >= 0 && level <= 255)).toBe(true);
  });

  it('handles an empty image without dividing by nothing', () => {
    const data: number[] = [];
    expect(stretchGrey(data)).toBe(false);
  });
});
