import { afterEach, describe, expect, it } from 'vitest';
import { mirrorAriaHiddenAsInert } from '../src/lib/inert-hidden.js';

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('mirrorAriaHiddenAsInert', () => {
  let stop = () => undefined as void;
  afterEach(() => {
    stop();
    document.body.innerHTML = '';
  });

  it('makes what a modal hides inert, and gives it back afterwards', async () => {
    const page = document.createElement('div');
    document.body.append(page);
    stop = mirrorAriaHiddenAsInert();

    page.setAttribute('aria-hidden', 'true');
    page.setAttribute('data-aria-hidden', 'true');
    await flush();
    expect(page.inert).toBe(true);

    page.removeAttribute('aria-hidden');
    page.removeAttribute('data-aria-hidden');
    await flush();
    expect(page.inert).toBe(false);
  });

  it('leaves alone what the app hid or made inert itself', async () => {
    const decorative = document.createElement('span');
    const preview = document.createElement('div');
    preview.inert = true;
    document.body.append(decorative, preview);
    stop = mirrorAriaHiddenAsInert();

    decorative.setAttribute('aria-hidden', 'true');
    preview.setAttribute('aria-hidden', 'true');
    preview.setAttribute('data-aria-hidden', 'true');
    await flush();
    expect(decorative.inert).toBeFalsy();

    preview.removeAttribute('data-aria-hidden');
    await flush();
    // It was inert before any popup opened, so closing one must not undo that.
    expect(preview.inert).toBe(true);
  });
});
