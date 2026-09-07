/**
 * The document drop surface.
 *
 * Authority: Phase 7B §4, §13, §15 · docs/27
 *
 * This component sits in front of the import pipeline and owns two of its
 * steps — selection and validation. So what is tested is exactly that boundary:
 * what it lets through, what it refuses, what it says about a refusal, and
 * whether a person with no mouse can use it at all.
 *
 * It is NOT tested for appearance. jsdom has no layout, so an assertion about
 * the drop highlight or the fanned sheets would be asserting nothing.
 */

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FileDropzone } from '../src/components/ui/FileDropzone.js';

afterEach(cleanup);

function makeFile(name: string, type: string): File {
  return new File(['x'], name, { type });
}

/** jsdom builds no FileList, so the drop payload is assembled by hand. */
function dropFiles(target: Element, files: readonly File[]): void {
  fireEvent.drop(target, {
    dataTransfer: {
      files: {
        length: files.length,
        item: (index: number) => files[index] ?? null,
        [Symbol.iterator]: function* () {
          yield* files;
        },
      },
    },
  });
}

describe('FileDropzone', () => {
  it('states the formats it accepts before anything is chosen', () => {
    render(<FileDropzone onFiles={vi.fn()} />);
    // On the surface, not in a tooltip: a person needs to know before they
    // go looking for the file, not after the refusal.
    expect(screen.getByText(/PDF · JPEG · PNG · WebP/i)).toBeTruthy();
  });

  it('is operable from the keyboard alone', async () => {
    const user = userEvent.setup();
    render(<FileDropzone onFiles={vi.fn()} />);

    const choose = screen.getByRole('button', { name: 'Choose a file' });
    const clicked = vi.fn();
    /*
     * The button opens the native picker, which jsdom cannot show — so the
     * assertion is that the button REACHES the input, which is the part that
     * used to be broken. The old surface had a styled <label>: Tab landed on it
     * only through `:focus-within` on a hidden input, and Space did nothing.
     */
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    input.addEventListener('click', clicked);

    await user.tab();
    expect(document.activeElement).toBe(choose);
    await user.keyboard(' ');
    expect(clicked).toHaveBeenCalled();
  });

  it('exposes exactly one control, not the input as well', () => {
    render(<FileDropzone onFiles={vi.fn()} />);
    // Two tab stops for one action is worse than one, and an unlabelled file
    // input beside a labelled button is noise in a screen reader.
    expect(screen.getAllByRole('button')).toHaveLength(1);
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    expect(input.getAttribute('aria-hidden')).toBe('true');
    expect(input.tabIndex).toBe(-1);
  });

  it('passes an accepted file straight through to the pipeline', () => {
    const onFiles = vi.fn();
    render(<FileDropzone onFiles={onFiles} />);

    const pdf = makeFile('sem3.pdf', 'application/pdf');
    dropFiles(screen.getByText(/Drop a document here/i).parentElement as Element, [pdf]);

    expect(onFiles).toHaveBeenCalledOnce();
    expect(onFiles.mock.calls[0]?.[0]).toEqual([pdf]);
  });

  it('refuses a file it cannot read, names it, and never calls the pipeline', () => {
    const onFiles = vi.fn();
    render(<FileDropzone onFiles={onFiles} />);

    dropFiles(screen.getByText(/Drop a document here/i).parentElement as Element, [
      makeFile('timetable.docx', 'application/vnd.openxmlformats'),
    ]);

    // NAMED. "Unsupported file" tells a person who dropped four nothing about
    // which one was the problem.
    expect(screen.getByText(/timetable\.docx/)).toBeTruthy();
    expect(onFiles).not.toHaveBeenCalled();
  });

  it('lets the good files through when a batch is mixed, and still reports the bad one', () => {
    const onFiles = vi.fn();
    render(<FileDropzone onFiles={onFiles} />);

    const pdf = makeFile('sem3.pdf', 'application/pdf');
    dropFiles(screen.getByText(/Drop a document here/i).parentElement as Element, [
      pdf,
      makeFile('notes.docx', 'application/vnd.openxmlformats'),
    ]);

    /*
     * A batch is not all-or-nothing. Refusing three good result cards because a
     * fourth file was a Word document would make the person do the whole thing
     * again for no reason.
     */
    expect(onFiles).toHaveBeenCalledOnce();
    expect(onFiles.mock.calls[0]?.[0]).toEqual([pdf]);
    expect(screen.getByText(/notes\.docx/)).toBeTruthy();
  });

  it('announces the refusal rather than only drawing it', () => {
    render(<FileDropzone onFiles={vi.fn()} />);
    dropFiles(screen.getByText(/Drop a document here/i).parentElement as Element, [
      makeFile('marks.docx', 'application/vnd.openxmlformats'),
    ]);

    // It appeared in response to something the person just did, so it is live.
    const region = screen.getByRole('status');
    expect(region.textContent).toMatch(/marks\.docx/);
  });

  it('says what to do about a Word document instead of only refusing it', () => {
    render(<FileDropzone onFiles={vi.fn()} />);
    dropFiles(screen.getByText(/Drop a document here/i).parentElement as Element, [
      makeFile('timetable.docx', 'application/vnd.openxmlformats'),
    ]);

    // The supplied Semester 5 timetable is a DOCX, so this is the commonest
    // refusal there is; "no" alone would leave the student stuck.
    expect(screen.getByRole('status').textContent).toMatch(/saved as a PDF/i);
  });

  it('stops accepting while the pipeline is reading, and says so', () => {
    const onFiles = vi.fn();
    render(<FileDropzone onFiles={onFiles} busy />);

    expect(screen.getByText(/Reading your document…/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Choose a file' })).toHaveProperty('disabled', true);

    dropFiles(screen.getByText(/Reading your document…/i).parentElement as Element, [
      makeFile('sem3.pdf', 'application/pdf'),
    ]);
    // A second batch dropped mid-read would race the OCR worker.
    expect(onFiles).not.toHaveBeenCalled();
  });

  it('lets a refusal be dismissed', async () => {
    const user = userEvent.setup();
    render(<FileDropzone onFiles={vi.fn()} />);
    dropFiles(screen.getByText(/Drop a document here/i).parentElement as Element, [
      makeFile('marks.docx', 'application/vnd.openxmlformats'),
    ]);

    await user.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByRole('status')).toBeNull();
  });
});
