/**
 * The unlayered `border-color` rule in index.css paints every coloured border
 * utility as the neutral hairline, so a dashed "help" underline drawn with
 * `border-b border-dashed border-ink-3` came out nearly invisible. It is a
 * text-decoration now, which that rule does not touch. jsdom has no cascade,
 * so this pins the mechanism, not the pixels.
 */
import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Unavailable } from '../src/components/ui/feedback.js';
import { renderWith } from './helpers.js';

describe('dashed help underline', () => {
  it('is a text-decoration, not a border the global rule would neutralise', () => {
    renderWith(<Unavailable reason="Credits unknown" />);
    const term = screen.getByLabelText('Unavailable: Credits unknown');
    expect(term.className).toMatch(/\bunderline\b/);
    expect(term.className).toContain('decoration-dashed');
    expect(term.className).not.toMatch(/\bborder-b\b/);
  });
});
