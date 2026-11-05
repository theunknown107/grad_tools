/**
 * Android Back priority (lib/android-back): overlay, then keyboard, then
 * history, then exit — and the Escape it sends really closes what is open.
 */
import { describe, expect, it } from 'vitest';
import { backAction, dismissTopOverlay, overlayOpen } from '../src/lib/android-back.js';

describe('the Android Back priority', () => {
  it('closes an open overlay before anything else', () => {
    expect(backAction({ overlayOpen: true, editing: true, canGoBack: true })).toBe('dismiss');
  });
  it('then lets go of a field being edited', () => {
    expect(backAction({ overlayOpen: false, editing: true, canGoBack: true })).toBe('blur');
  });
  it('then goes back a page', () => {
    expect(backAction({ overlayOpen: false, editing: false, canGoBack: true })).toBe('history');
  });
  it('exits only with nowhere left to go', () => {
    expect(backAction({ overlayOpen: false, editing: false, canGoBack: false })).toBe('exit');
  });
});

describe('finding and closing the top overlay', () => {
  it('sees an open dialog, menu or popover, and not a closed one', () => {
    document.body.innerHTML = '<div role="dialog" data-state="closed"></div>';
    expect(overlayOpen()).toBe(false);
    document.body.innerHTML = '<div role="dialog" data-state="open"></div>';
    expect(overlayOpen()).toBe(true);
    document.body.innerHTML = '<div role="menu" data-state="open"></div>';
    expect(overlayOpen()).toBe(true);
    document.body.innerHTML = '<div data-radix-popper-content-wrapper></div>';
    expect(overlayOpen()).toBe(true);
  });

  it('sends Escape, which is what every overlay here closes on', () => {
    document.body.innerHTML = '<button>focus</button>';
    const keys: string[] = [];
    document.addEventListener('keydown', (event) => keys.push(event.key), { once: true });
    (document.querySelector('button') as HTMLButtonElement).focus();
    dismissTopOverlay();
    expect(keys).toEqual(['Escape']);
  });
});
