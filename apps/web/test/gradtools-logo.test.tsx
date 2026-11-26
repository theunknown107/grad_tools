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

  it('shows the supplied brand asset, sized by its tile', () => {
    render(<GradToolsLogo size={40} />);
    const logo = screen.getByTestId('gradtools-logo');
    expect(logo.style.width).toBe('40px');
    const img = logo.querySelector('img');
    expect(img).not.toBeNull();
    // The one official asset, used as-is — not a hand-drawn vector.
    expect(img!.getAttribute('src')).toMatch(/gradtools-logo/);
    expect(logo.querySelector('svg')).toBeNull();
    expect(logo.querySelector('text')).toBeNull();
  });
});
