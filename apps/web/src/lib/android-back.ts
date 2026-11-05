/**
 * The Android Back button, in the order an installed app answers it.
 *
 *   1. an open dialog, sheet, menu or popover closes
 *   2. a focused field with the keyboard up loses focus (Android usually takes
 *      this one itself: the keyboard consumes Back before the app sees it)
 *   3. the app goes back one page
 *   4. only with nowhere left to go does the app exit
 *
 * Without this, Capacitor's default only moved the WebView's history, so an
 * open sheet stayed open and Back appeared to do nothing (emulator test
 * 2026-11-05, defect 2).
 *
 * Native only: `@capacitor/app` is imported lazily, so the web bundle and the
 * browser's own Back are untouched. One listener per mounted shell, removed on
 * unmount, so a remount never stacks a second one.
 */

import { useEffect } from 'react';

export type BackAction = 'dismiss' | 'blur' | 'history' | 'exit';

export function backAction(state: {
  readonly overlayOpen: boolean;
  readonly editing: boolean;
  readonly canGoBack: boolean;
}): BackAction {
  if (state.overlayOpen) return 'dismiss';
  if (state.editing) return 'blur';
  return state.canGoBack ? 'history' : 'exit';
}

/**
 * Everything that closes on Escape: Radix dialogs (and the vaul sheets built
 * on them), alert dialogs, menus, popovers and select lists.
 */
const OPEN_OVERLAY = [
  '[role="dialog"][data-state="open"]',
  '[role="alertdialog"][data-state="open"]',
  '[role="menu"][data-state="open"]',
  '[role="listbox"][data-state="open"]',
  '[data-radix-popper-content-wrapper]',
].join(',');

export function overlayOpen(doc: Document = document): boolean {
  return doc.querySelector(OPEN_OVERLAY) !== null;
}

/** A text field with the keyboard showing (the visual viewport shrinks for it). */
function editing(): boolean {
  const el = document.activeElement;
  const field =
    el instanceof HTMLTextAreaElement ||
    (el instanceof HTMLInputElement &&
      !['checkbox', 'radio', 'button', 'submit'].includes(el.type)) ||
    (el instanceof HTMLElement && el.isContentEditable);
  const viewport = window.visualViewport;
  return field && viewport !== null && viewport.height < window.innerHeight * 0.85;
}

/** Closes the top-most overlay the way a keyboard user would: Escape. */
export function dismissTopOverlay(doc: Document = document): void {
  const target = doc.activeElement ?? doc.body;
  target.dispatchEvent(
    new KeyboardEvent('keydown', {
      key: 'Escape',
      code: 'Escape',
      bubbles: true,
      cancelable: true,
    }),
  );
}

function isNative(): boolean {
  const cap = (window as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
  return typeof cap?.isNativePlatform === 'function' && cap.isNativePlatform();
}

export function useAndroidBack(): void {
  useEffect(() => {
    if (!isNative()) return;
    let remove: (() => void) | undefined;
    let cancelled = false;
    void (async () => {
      const { App } = await import('@capacitor/app');
      const sub = await App.addListener('backButton', ({ canGoBack }) => {
        switch (backAction({ overlayOpen: overlayOpen(), editing: editing(), canGoBack })) {
          case 'dismiss':
            dismissTopOverlay();
            return;
          case 'blur':
            (document.activeElement as HTMLElement | null)?.blur();
            return;
          case 'history':
            window.history.back();
            return;
          case 'exit':
            void App.exitApp();
        }
      });
      if (cancelled) void sub.remove();
      else remove = () => void sub.remove();
    })();
    return () => {
      cancelled = true;
      remove?.();
    };
  }, []);
}
