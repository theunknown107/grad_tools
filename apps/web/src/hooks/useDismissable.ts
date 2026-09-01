/**
 * Escape, outside-click and focus-return for transient surfaces.
 *
 * Authority: docs/27 §27.4 · M9.6B §33
 *
 * Written once because five surfaces need it — the theme panel, the
 * notification inbox, the row-action menu, the select and the search modal —
 * and because every one of them gets the same three details wrong when written
 * separately:
 *
 *   1. Escape must return focus to the trigger. Without it the tab order
 *      restarts at the top of the document and the person loses their place.
 *   2. The outside-click listener must be on `pointerdown`, not `click`. On
 *      `click` the surface is still open through the whole press, so a click
 *      on a button behind it both dismisses and activates.
 *   3. The listener must be removed when closed, not merely ignored. A dozen
 *      live document listeners is how a page starts feeling slow.
 */

import { useEffect, type RefObject } from 'react';

export interface DismissableOptions {
  readonly open: boolean;
  readonly onDismiss: () => void;
  /** The surface. A pointerdown inside it is not an outside click. */
  readonly surfaceRef: RefObject<HTMLElement | null>;
  /** Focus returns here on Escape. */
  readonly triggerRef?: RefObject<HTMLElement | null>;
  /**
   * Also dismiss when the window scrolls. Right for a popover anchored to a
   * trigger, wrong for a modal, which owns the screen and should stay put.
   */
  readonly closeOnScroll?: boolean;
}

export function useDismissable({
  open,
  onDismiss,
  surfaceRef,
  triggerRef,
  closeOnScroll = false,
}: DismissableOptions): void {
  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      // Stop here: a modal inside a modal must close one layer, not both.
      event.stopPropagation();
      onDismiss();
      triggerRef?.current?.focus();
    };

    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (surfaceRef.current?.contains(target) === true) return;
      // The trigger handles its own toggle; dismissing here too would close
      // and immediately reopen.
      if (triggerRef?.current?.contains(target) === true) return;
      onDismiss();
    };

    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('pointerdown', onPointerDown);
    if (closeOnScroll) window.addEventListener('scroll', onDismiss, { passive: true });

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('pointerdown', onPointerDown);
      if (closeOnScroll) window.removeEventListener('scroll', onDismiss);
    };
  }, [open, onDismiss, surfaceRef, triggerRef, closeOnScroll]);
}

/**
 * Keeps Tab inside a surface while it is open.
 *
 * Only for surfaces that OWN the screen — the search modal, the upload modal.
 * A popover must NOT trap focus: tabbing out of it is a legitimate way to
 * dismiss it, and trapping turns a convenience into a cage.
 */
export function useFocusTrap(open: boolean, surfaceRef: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Tab') return;
      const surface = surfaceRef.current;
      if (surface === null) return;

      const focusable = surface.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (focusable.length === 0) return;

      const first = focusable[0] as HTMLElement;
      const last = focusable[focusable.length - 1] as HTMLElement;
      const active = document.activeElement;

      if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, surfaceRef]);
}
