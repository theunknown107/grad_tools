/**
 * The avatar is the person, never the app: real initials when there is a
 * name, a neutral person glyph when there is not — no "GT" monogram.
 */

import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Avatar, initialsOf } from '../src/components/ui/page.js';

afterEach(cleanup);

describe('the avatar', () => {
  it("keeps a real user's initials", () => {
    expect(initialsOf('Salman Aslam Kadalgi')).toBe('SK');
    expect(initialsOf('salman')).toBe('S');
    const { container } = render(<Avatar initials="S" />);
    expect(container.textContent).toBe('S');
  });

  it('shows a neutral person glyph, not the app monogram, when there is no name', () => {
    expect(initialsOf(null)).toBe('');
    expect(initialsOf('   ')).toBe('');
    const { container } = render(<Avatar initials={initialsOf(undefined)} />);
    expect(container.textContent).toBe('');
    expect(container.querySelector('svg')).not.toBeNull();
  });
});
