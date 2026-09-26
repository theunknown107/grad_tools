/**
 * Where focus goes when a modal closes.
 *
 * Radix returns focus to a `Dialog.Trigger`, but most of this app's dialogs are
 * opened from state — a page button, a shortcut, a row's menu item — with no
 * trigger, so focus fell to <body> and a keyboard user was thrown back to the
 * top of the page. These handlers remember what was focused when the modal
 * opened and put focus back there.
 *
 * A dialog opened from a menu item is opened while the item has focus, and the
 * item is gone by the time the dialog closes; the menu's own trigger (which
 * Radix names the menu by) is the control to return to.
 *
 * If the opener itself is gone by close time (the action removed it — a
 * deleted row, a signed-out card), focus goes to the page's main landmark
 * rather than falling to <body>.
 */

import { useRef } from 'react';

function usable(element: Element | null): element is HTMLElement {
  return element instanceof HTMLElement && element !== document.body && element.isConnected;
}

function opener(): HTMLElement | null {
  const active = document.activeElement;
  const menu = active?.closest('[role="menu"]') ?? null;
  if (menu === null) return usable(active) ? active : null;
  const trigger = document.getElementById(menu.getAttribute('aria-labelledby') ?? '');
  return usable(trigger) ? trigger : null;
}

export function useReturnFocus() {
  const target = useRef<HTMLElement | null>(null);
  return {
    onOpenAutoFocus: () => {
      target.current = opener();
    },
    onCloseAutoFocus: (event: Event) => {
      const saved = target.current;
      if (saved === null) return;
      const element = saved.isConnected ? saved : document.getElementById('gt-main');
      if (!usable(element)) return;
      event.preventDefault();
      element.focus();
    },
  };
}
