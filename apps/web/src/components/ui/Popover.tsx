/**
 * A popover — a small surface anchored to the control that opened it.
 *
 * Authority: docs/27 §27.4 · Phase 7B §2, §12
 * Provenance: behaviourally faithful shadcn/Radix implementation adapted to the
 * GradTools styling architecture. The behaviour is `@radix-ui/react-popover`.
 *
 * ---------------------------------------------------------------------------
 * POPOVER, NOT DIALOG, NOT MENU
 * ---------------------------------------------------------------------------
 *
 * The three are routinely confused and behave differently on purpose:
 *
 *   - a MENU is a list of commands; arrows move between them and typeahead
 *     jumps; picking one closes it,
 *   - a DIALOG is modal; the page behind is inert and Tab cannot leave,
 *   - a POPOVER is a non-modal surface holding arbitrary controls. Tab moves
 *     through it and then OUT of it, back into the page. Nothing in it is a
 *     "menu item", so arrow keys belong to whatever control has focus.
 *
 * Appearance settings are a popover: they contain a radio group and a set of
 * swatches, and the arrow keys have to reach the radio group rather than being
 * eaten by a menu implementation.
 *
 * Radix contributes the dismissal layer this is really for — outside pointer
 * down, Escape, focus leaving the surface, and restoring focus to the trigger —
 * plus collision-aware placement and the `aria-expanded` / `aria-controls`
 * wiring on the trigger.
 */

import type { ReactNode } from 'react';
import * as PopoverPrimitive from '@radix-ui/react-popover';
import styles from './Popover.module.css';

export const Popover = PopoverPrimitive.Root;
export const PopoverTrigger = PopoverPrimitive.Trigger;
export const PopoverClose = PopoverPrimitive.Close;
export const PopoverAnchor = PopoverPrimitive.Anchor;

export function PopoverContent({
  children,
  label,
  align = 'end',
  side = 'bottom',
  sideOffset = 8,
  padded = true,
}: {
  readonly children: ReactNode;
  /**
   * Names the surface. Required rather than optional: a popover is announced
   * as a dialog, and an unnamed dialog gives a screen-reader user nothing to
   * tell it apart from the page it opened over.
   */
  readonly label: string;
  readonly align?: 'start' | 'center' | 'end';
  readonly side?: 'top' | 'bottom' | 'left' | 'right';
  readonly sideOffset?: number;
  /** False where the content draws its own edge-to-edge rows — a list, a grid. */
  readonly padded?: boolean;
}): ReactNode {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        className={`${styles.panel ?? ''} surfacePanel`}
        aria-label={label}
        align={align}
        side={side}
        sideOffset={sideOffset}
        collisionPadding={8}
        data-padded={padded}
      >
        {children}
      </PopoverPrimitive.Content>
    </PopoverPrimitive.Portal>
  );
}
