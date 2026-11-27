/**
 * A callout's action sits BELOW its text on a phone and beside it only from
 * `sm` up. Beside it at phone width, "Sign out on this device" squeezed the
 * Account page's offline notice into a one-word column. jsdom cannot measure
 * layout, so this pins the responsive structure that produces it.
 */

import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Callout } from '../src/components/ui/feedback.js';

afterEach(cleanup);

describe('Callout layout', () => {
  it('stacks the action under the text on narrow screens, beside it from sm up', () => {
    const { container } = render(
      <Callout action={<button type="button">Sign out on this device</button>}>
        Your session could not be verified.
      </Callout>,
    );
    const box = container.firstElementChild as HTMLElement;
    const action = box.querySelector('[data-slot="callout-action"]') as HTMLElement;

    // Two columns (icon | text) by default; a third only from sm up.
    expect(box.className).toContain('grid-cols-[auto_minmax(0,1fr)]');
    expect(box.className).toContain('sm:grid-cols-[auto_minmax(0,1fr)_auto]');
    // Phone: under the text, in the text's column. sm+: its own column, first row.
    expect(action.className).toContain('col-start-2');
    expect(action.className).toContain('sm:col-start-3');
    expect(action.className).toContain('sm:row-start-1');
    // The text keeps its own unshrinkable track and precedes the action.
    expect(action.previousElementSibling?.textContent).toBe('Your session could not be verified.');
  });

  it('without an action, keeps the plain two-column layout', () => {
    const { container } = render(<Callout>Just a note.</Callout>);
    const box = container.firstElementChild as HTMLElement;
    expect(box.className).not.toContain('sm:grid-cols-[auto_minmax(0,1fr)_auto]');
    expect(box.querySelector('[data-slot="callout-action"]')).toBeNull();
  });
});
