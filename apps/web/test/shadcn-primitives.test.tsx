/**
 * The primitives ported from shadcn source.
 *
 * Authority: docs/22 §22.33 (M9.6D) · docs/27
 *
 * Both are about what assistive technology receives, because both are the kind
 * of component that looks finished and announces nothing.
 */

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { Skeleton } from '../src/components/ui/Skeleton.js';
import { Tooltip } from '../src/components/ui/Tooltip.js';

afterEach(cleanup);

describe('Skeleton', () => {
  it('announces itself as busy rather than hiding', () => {
    render(<Skeleton lines={3} label="Loading papers" />);
    const status = screen.getByRole('status', { name: 'Loading papers' });
    // aria-hidden would leave a screen-reader user on a silent empty region
    // wondering whether the page had broken.
    expect(status.getAttribute('aria-busy')).toBe('true');
  });

  it('draws one bar per line so the placeholder matches what replaces it', () => {
    const { container } = render(<Skeleton lines={6} />);
    expect(container.querySelectorAll('[data-slot="skeleton"]')).toHaveLength(6);
  });

  it('shortens the last line only when there is more than one', () => {
    const { container } = render(<Skeleton lines={1} />);
    const only = container.querySelector('[data-slot="skeleton"]') as HTMLElement;
    // A single bar ending at 62% would read as a broken row, not a paragraph.
    expect(only.style.inlineSize).toBe('');
  });
});

describe('Tooltip', () => {
  it('describes its trigger whether or not it is ever shown', () => {
    render(
      <Tooltip content="Below the 85% requirement.">
        <button type="button">73.9%</button>
      </Tooltip>,
    );

    const trigger = screen.getByRole('button', { name: '73.9%' });
    const described = trigger.getAttribute('aria-describedby');
    expect(described).toBeTruthy();
    // The description must resolve to real text in the document, or the
    // attribute is decoration.
    expect(document.getElementById(described as string)?.textContent).toBe(
      'Below the 85% requirement.',
    );
  });

  it('opens immediately on keyboard focus', async () => {
    const user = userEvent.setup();
    render(
      <Tooltip content="At or above the requirement.">
        <button type="button">88%</button>
      </Tooltip>,
    );

    await user.tab();
    // No delay on focus: a hover delay stops tooltips firing as a pointer
    // crosses a toolbar, but someone who tabbed here asked for it.
    await waitFor(() => {
      expect(screen.getByRole('tooltip')).toBeTruthy();
    });
  });

  it('closes on Escape while focus stays put', async () => {
    const user = userEvent.setup();
    render(
      <Tooltip content="Explanation.">
        <button type="button">Figure</button>
      </Tooltip>,
    );

    await user.tab();
    await waitFor(() => expect(screen.getByRole('tooltip')).toBeTruthy());

    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('tooltip')).toBeNull());
    // Escape dismisses the tooltip, not the focus — the trigger is still where
    // the person is.
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Figure' }));
  });

  it('does not show anything before it is asked to', () => {
    render(
      <Tooltip content="Explanation.">
        <button type="button">Figure</button>
      </Tooltip>,
    );
    expect(screen.queryByRole('tooltip')).toBeNull();
  });
});
