import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { GradToolsLogo } from '../src/brand/GradToolsLogo.js';

afterEach(cleanup);

describe('the GradTools logo', () => {
  it('is decorative by default, so a brand link keeps its own name', () => {
    render(<GradToolsLogo />);
    const logo = screen.getByTestId('gradtools-logo');
    expect(logo.getAttribute('aria-hidden')).toBe('true');
    expect(screen.queryByRole('img')).toBeNull();
  });

  it('is a named image when it stands alone', () => {
    render(<GradToolsLogo label="GradTools" />);
    expect(screen.getByRole('img', { name: 'GradTools' }).getAttribute('aria-hidden')).toBeNull();
  });

  it('draws one monochrome symbol that takes its colour from the theme tile', () => {
    render(<GradToolsLogo size={40} />);
    const logo = screen.getByTestId('gradtools-logo');
    expect(logo.style.width).toBe('40px');
    const svg = logo.querySelector('svg');
    expect(svg).not.toBeNull();
    expect(svg!.querySelector('g')?.getAttribute('fill')).toBe('currentColor');
    expect(logo.className).toMatch(/bg-brand-surface/);
    expect(logo.className).toMatch(/text-brand-mark/);
    expect(svg!.querySelector('text')).toBeNull();
  });
});
