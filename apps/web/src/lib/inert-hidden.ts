/**
 * Makes the page behind a modal popup unreachable, not only unannounced.
 *
 * Radix's modal primitives (dialogs, menus, selects, the bottom sheet) mark
 * everything outside the popup `aria-hidden` — tagged `data-aria-hidden` — but
 * leave it focusable, so a screen-reader user can still Tab into content that
 * is announced as absent. Mirroring that marker onto `inert` closes the gap.
 *
 * Observer callbacks run as microtasks, and Radix restores focus to the trigger
 * in a later task, so the page is interactive again before focus returns.
 */
const OURS = 'data-gt-inert';

function sync(element: Element): void {
  if (!(element instanceof HTMLElement)) return;
  const hidden =
    element.hasAttribute('data-aria-hidden') && element.getAttribute('aria-hidden') === 'true';
  if (hidden && !element.inert) {
    element.inert = true;
    element.setAttribute(OURS, '');
  } else if (!hidden && element.hasAttribute(OURS)) {
    element.inert = false;
    element.removeAttribute(OURS);
  }
}

export function mirrorAriaHiddenAsInert(root: HTMLElement = document.body): () => void {
  const observer = new MutationObserver((records) => {
    for (const record of records) sync(record.target as Element);
  });
  observer.observe(root, {
    subtree: true,
    attributes: true,
    attributeFilter: ['aria-hidden', 'data-aria-hidden'],
  });
  return () => observer.disconnect();
}
