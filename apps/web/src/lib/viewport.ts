/**
 * What part of the screen a student can actually see and touch.
 *
 * Two questions, answered in one place so no screen answers them its own way:
 *
 *   isKeyboardOpen()     is a software keyboard (IME) on screen?
 *   collisionInsets()    how far must an anchored popup stay from each edge?
 *
 * ---------------------------------------------------------------------------
 * THE KEYBOARD, WITHOUT A PLUGIN
 * ---------------------------------------------------------------------------
 *
 * The web has no "keyboard is open" event. What it has is the Visual Viewport:
 * when an IME appears, the visible area shrinks — the visual viewport alone
 * (Chrome's default) or the whole layout viewport (an Android WebView that
 * resizes, which is what the physical-device test showed: the bottom bar rode
 * up on top of the keyboard). Either way the visible height drops well below
 * the tallest height seen at the same width.
 *
 * Shrinking alone is not enough — a browser toolbar hiding changes the height
 * too — so the keyboard counts as open only while an editable field has focus
 * AND the visible height is more than KEYBOARD_MIN_PX below that baseline.
 * Focus alone is not enough either: a hardware keyboard, or an IME the student
 * dismissed with the back gesture, leaves the field focused and the screen
 * whole, and the navigation must come back.
 *
 * ponytail: the baseline is the tallest height seen per viewport width, so
 * the first rotation made WITH the keyboard already open has no baseline for
 * the new width and reads as closed until the keyboard is reopened. A native
 * IME signal (@capacitor/keyboard) removes that edge if it ever matters.
 */

import { useSyncExternalStore } from 'react';

/** Smaller than any phone keyboard, larger than a collapsing browser toolbar. */
export const KEYBOARD_MIN_PX = 150;

/** Inputs that open no text keyboard. */
const NON_TEXT_INPUTS = new Set([
  'button',
  'checkbox',
  'color',
  'file',
  'hidden',
  'image',
  'radio',
  'range',
  'reset',
  'submit',
]);

function editableFocused(): boolean {
  const element = document.activeElement;
  if (!(element instanceof HTMLElement)) return false;
  if (element.isContentEditable) return true;
  if (element instanceof HTMLTextAreaElement) return !element.readOnly && !element.disabled;
  if (element instanceof HTMLInputElement) {
    return !element.readOnly && !element.disabled && !NON_TEXT_INPUTS.has(element.type);
  }
  return false;
}

function visible(): { readonly width: number; readonly height: number } {
  const viewport = window.visualViewport;
  return viewport === null || viewport === undefined
    ? { width: window.innerWidth, height: window.innerHeight }
    : { width: viewport.width, height: viewport.height };
}

/** The tallest visible height seen at each width (a rotation changes width). */
const baselines = new Map<number, number>();

export function isKeyboardOpen(): boolean {
  const { width, height } = visible();
  const key = Math.round(width);
  const baseline = Math.max(baselines.get(key) ?? 0, height);
  baselines.set(key, baseline);
  return editableFocused() && baseline - height > KEYBOARD_MIN_PX;
}

let open = false;
const listeners = new Set<() => void>();

function update(): void {
  const next = isKeyboardOpen();
  if (next === open) return;
  open = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  if (listeners.size === 0) {
    open = isKeyboardOpen();
    window.visualViewport?.addEventListener('resize', update);
    window.addEventListener('resize', update);
    document.addEventListener('focusin', update);
    document.addEventListener('focusout', update);
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size > 0) return;
    window.visualViewport?.removeEventListener('resize', update);
    window.removeEventListener('resize', update);
    document.removeEventListener('focusin', update);
    document.removeEventListener('focusout', update);
  };
}

/** Event-driven, never polled: it only runs when the viewport or focus changes. */
export function useKeyboardOpen(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => open,
    () => false,
  );
}

/*
 * ---------------------------------------------------------------------------
 * WHERE A POPUP MAY GO
 * ---------------------------------------------------------------------------
 *
 * Radix positions a popup against the layout viewport, and in an edge-to-edge
 * app that viewport runs under the status bar and behind the fixed bottom bar
 * — and, when the keyboard only shrinks the VISUAL viewport, behind the
 * keyboard as well. So the padding it keeps from each edge is measured: the
 * safe-area insets the shell already pads by, the bottom bar while it is
 * showing, and whatever the keyboard covers. Measured, never guessed in pixels.
 */

/** Resolves a CSS length (such as `var(--gt-safe-top)`) to pixels. */
function resolvePx(length: string): number {
  const probe = document.createElement('div');
  probe.style.cssText = `position:fixed;visibility:hidden;pointer-events:none;height:0;padding-top:${length}`;
  document.body.appendChild(probe);
  const px = Number.parseFloat(getComputedStyle(probe).paddingTop);
  probe.remove();
  return Number.isFinite(px) ? px : 0;
}

/** The bottom bar, if it is on screen (it hides for the keyboard and on wide screens). */
function bottomBarHeight(): number {
  const bar = document.querySelector<HTMLElement>('[data-bottom-bar]');
  if (bar === null || bar.getClientRects().length === 0) return 0;
  return bar.getBoundingClientRect().height;
}

function keyboardCover(): number {
  const viewport = window.visualViewport;
  if (viewport === null || viewport === undefined) return 0;
  return Math.max(0, window.innerHeight - (viewport.height + viewport.offsetTop));
}

const GAP = 8;

export function collisionInsets(): {
  top: number;
  right: number;
  bottom: number;
  left: number;
} {
  return {
    top: resolvePx('var(--gt-safe-top)') + GAP,
    right: resolvePx('var(--gt-safe-right)') + GAP,
    bottom: Math.max(bottomBarHeight(), keyboardCover(), resolvePx('var(--gt-safe-bottom)')) + GAP,
    left: resolvePx('var(--gt-safe-left)') + GAP,
  };
}
