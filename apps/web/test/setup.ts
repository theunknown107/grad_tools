/**
 * Web test setup.
 *
 * Authority: docs/22 §22.26
 */

import { configure } from '@testing-library/dom';

/*
 * Testing Library's async queries have their OWN timeout, separate from
 * Vitest's. `testTimeout: 20_000` in vitest.config.ts governs how long a test
 * may run; `asyncUtilTimeout` governs how long a single `findBy*` waits before
 * it throws "Unable to find an element" — and it defaults to 1000ms.
 *
 * That 1s is comfortable for one test file and too tight for forty-two running
 * in parallel. `reference.test.tsx` flaked three times in one session on a
 * `findByText` that takes ~400ms alone and over 3800ms under full-suite load:
 * the assertion was correct, the component was correct, and the wait expired
 * before the render it was waiting for.
 *
 * Five seconds is long enough to absorb scheduler contention and still short
 * enough that a genuinely missing element fails the run rather than hanging it.
 */
configure({ asyncUtilTimeout: 5_000 });

/* -------------------------------------------------------------------------- */
/* Browser APIs jsdom does not implement                                      */
/* -------------------------------------------------------------------------- */

/*
 * The Radix primitives measure things, and jsdom implements almost none of the
 * measurement APIs. These are ENVIRONMENT shims, not component behaviour: each
 * one stands in for a real browser API so a component can mount, and none of
 * them makes an assertion pass that would otherwise fail.
 *
 * Deliberately minimal. A ResizeObserver that never fires is honest — jsdom has
 * no layout, so there is nothing for it to report — and a test that needs a
 * real measurement is a test that belongs in the Playwright harness instead.
 */

if (!('ResizeObserver' in globalThis)) {
  // Radix's arrow and popper measure their own size on mount.
  globalThis.ResizeObserver = class {
    observe(): void {
      /* jsdom has no layout to observe. */
    }
    unobserve(): void {
      /* as above */
    }
    disconnect(): void {
      /* as above */
    }
  } as unknown as typeof ResizeObserver;
}

if (!('DOMRect' in globalThis)) {
  globalThis.DOMRect = class {
    readonly x = 0;
    readonly y = 0;
    readonly width = 0;
    readonly height = 0;
    readonly top = 0;
    readonly right = 0;
    readonly bottom = 0;
    readonly left = 0;
    static fromRect(): DOMRect {
      return new (globalThis.DOMRect as unknown as new () => DOMRect)();
    }
    toJSON(): unknown {
      return this;
    }
  } as unknown as typeof DOMRect;
}

/*
 * Menus, comboboxes and the command palette scroll the highlighted item into
 * view on every arrow press. jsdom throws on the call rather than ignoring it.
 */
/*
 * Guarded on `typeof Element`, because some suites in this project run under
 * the NODE environment rather than jsdom — the PDF text-layer tests, for one —
 * and there is no `Element` there at all.
 *
 * Assigned through a widened alias: `!('scrollIntoView' in Element.prototype)`
 * narrows the prototype to `never` inside the branch, TypeScript concluding
 * that an Element without the property cannot exist, so the assignment has to
 * be made against a type that has not been narrowed.
 */
const elementProto =
  typeof Element === 'undefined'
    ? null
    : (Element.prototype as unknown as Record<string, unknown>);

if (elementProto !== null && !('scrollIntoView' in elementProto)) {
  elementProto['scrollIntoView'] = function scrollIntoView(): void {
    /* no viewport to scroll */
  };
}

/*
 * Radix uses Pointer Events for its dismissal layer and for menu interaction.
 * jsdom ships neither the capture methods nor `PointerEvent` itself, and
 * userEvent's pointer simulation calls both.
 */
if (elementProto !== null && !('hasPointerCapture' in elementProto)) {
  elementProto['hasPointerCapture'] = () => false;
  elementProto['setPointerCapture'] = () => undefined;
  elementProto['releasePointerCapture'] = () => undefined;
}

if (!('PointerEvent' in globalThis)) {
  globalThis.PointerEvent = globalThis.MouseEvent as unknown as typeof PointerEvent;
}
