/**
 * Documents page.
 *
 * Authority: M5A §14, §16 · docs/28
 *
 * The claims worth testing here are honesty claims: that the page says the
 * documents are private, that a scanned paper is explained rather than shown as
 * a failure, and that a rejection reads as information rather than as a broken
 * app. In the supplied 65-document test corpus 56 produced no meaningful text
 * (docs/32 OQ-019), so for that sample the scan message was the common path
 * rather than an edge case.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { screen, waitFor } from '@testing-library/dom';
import userEvent from '@testing-library/user-event';
import { DocumentsPage } from '../src/features/documents/DocumentsPage.js';

function doc(overrides: Record<string, unknown> = {}) {
  return {
    id: '11111111-1111-1111-1111-111111111111',
    sourceId: null,
    title: 'BCS403 paper.pdf',
    sha256: 'a'.repeat(64),
    byteSize: 446724,
    mimeType: 'application/pdf',
    pageCount: 3,
    state: 'extracted',
    extractionStatus: 'text_available',
    rightsStatus: 'user_private',
    presentation: 'private',
    sourceUrl: null,
    licenseNote: null,
    rejectionReason: null,
    createdAt: '2026-08-24',
    ...overrides,
  };
}

/** Routes fetch by path so the page can be driven without a server. */
function mockApi(documents: unknown[], sections: unknown[] = []) {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      const body = url.includes('/sections') ? { data: sections } : { data: documents };
      return Promise.resolve({ ok: true, json: () => Promise.resolve(body) } as Response);
    }),
  );
}

describe('DocumentsPage', () => {
  beforeEach(() => {
    mockApi([]);
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('states plainly that the documents are private and where they live', async () => {
    render(<DocumentsPage />);
    expect(await screen.findByText(/these documents are yours/i)).toBeTruthy();
    expect(screen.getByText(/stored on this machine only/i)).toBeTruthy();
    expect(screen.getByText(/does not share them/i)).toBeTruthy();
  });

  /*
   * OQ-028 is open. The page says what is true today rather than implying a
   * retention policy nobody has decided (M5A §16).
   */
  it('states retention as it actually is, without inventing a policy', async () => {
    render(<DocumentsPage />);
    expect(await screen.findByText(/stay until you remove them/i)).toBeTruthy();
  });

  it('shows an honest empty state', async () => {
    render(<DocumentsPage />);
    expect(await screen.findByText(/no documents yet/i)).toBeTruthy();
  });

  it('lists a document with its size, pages and fingerprint', async () => {
    mockApi([doc()]);
    render(<DocumentsPage />);

    expect(await screen.findByText('BCS403 paper.pdf')).toBeTruthy();
    expect(screen.getByText('436 KB')).toBeTruthy();
    expect(screen.getByText('3')).toBeTruthy();
    // A short prefix, not a wall of hex.
    expect(screen.getByText('aaaaaaaaaaaa')).toBeTruthy();
  });

  /*
   * M5A.1 §9. `ocr_required` is a legitimate processing OUTCOME: the document
   * was read correctly and correctly found to have no text layer. In the
   * supplied corpus 54 of 63 accepted PDFs were scans, so presenting that as an
   * error would tell most students their good paper had broken.
   */
  it('explains a scanned document instead of reporting a failure', async () => {
    mockApi([doc({ extractionStatus: 'ocr_required' })]);
    render(<DocumentsPage />);

    expect(await screen.findByText(/no usable text layer was found/i)).toBeTruthy();
    expect(screen.getByText(/does not do yet/i)).toBeTruthy();
    // No "Show text" button, because there is none.
    expect(screen.queryByRole('button', { name: /show text/i })).toBeNull();
  });

  it('does not describe a scan as a failure or an error', async () => {
    const { container } = render(<DocumentsPage />);
    cleanup();
    mockApi([doc({ extractionStatus: 'ocr_required' })]);
    const view = render(<DocumentsPage />);
    await screen.findByText(/no usable text layer was found/i);

    const text = view.container.textContent ?? '';
    for (const wrong of [/extraction failed/i, /could not read/i, /error/i, /damaged/i]) {
      expect(text).not.toMatch(wrong);
    }
    expect(container).toBeTruthy();
  });

  it('labels a scan by its outcome rather than calling it "Read"', async () => {
    mockApi([doc({ extractionStatus: 'ocr_required' })]);
    render(<DocumentsPage />);
    expect(await screen.findByText('Needs image reading')).toBeTruthy();
    expect(screen.queryByText('Read')).toBeNull();
  });

  /* A real failure must still read as one, or the distinction is worthless. */
  it('still reports a genuine extraction failure as a failure', async () => {
    mockApi([doc({ extractionStatus: 'extraction_failed' })]);
    render(<DocumentsPage />);
    expect(await screen.findByText(/could not be read/i)).toBeTruthy();
    expect(screen.getByText('Could not read')).toBeTruthy();
  });

  it('shows why a document was not accepted', async () => {
    mockApi([
      doc({
        state: 'rejected',
        extractionStatus: 'pending',
        rejectionReason: 'The file is not a PDF. Its contents do not begin with a PDF header.',
      }),
    ]);
    render(<DocumentsPage />);

    expect(await screen.findByText(/not accepted/i)).toBeTruthy();
    expect(screen.getByText(/do not begin with a PDF header/i)).toBeTruthy();
    // Nothing to read, so no action is offered.
    expect(screen.queryByRole('button', { name: /read text/i })).toBeNull();
  });

  it('reveals extracted text on request, with page positions', async () => {
    mockApi(
      [doc()],
      [
        {
          id: 's1',
          documentId: doc().id,
          pageNumber: 1,
          ordinal: 0,
          content: 'Module-1 Explain the divide and conquer technique.',
          extractorVersion: 'pdftotext-v1',
        },
      ],
    );
    render(<DocumentsPage />);

    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /show text/i }));

    await waitFor(() => {
      expect(screen.getByText(/divide and conquer/i)).toBeTruthy();
    });
    expect(screen.getByText('Page 1')).toBeTruthy();
  });

  it('offers no download or share action anywhere', async () => {
    mockApi([doc()]);
    render(<DocumentsPage />);
    await screen.findByText('BCS403 paper.pdf');

    for (const forbidden of [/download/i, /share/i, /publish/i, /make public/i]) {
      expect(screen.queryByRole('button', { name: forbidden })).toBeNull();
      expect(screen.queryByRole('link', { name: forbidden })).toBeNull();
    }
  });

  it('keeps internal jargon off the screen', async () => {
    mockApi([doc({ extractionStatus: 'ocr_required' })]);
    const { container } = render(<DocumentsPage />);
    await screen.findByText('BCS403 paper.pdf');

    const text = container.textContent ?? '';
    for (const jargon of [
      'user_private',
      'rights_status',
      'presentation',
      'quarantined',
      'OQ-0',
      'sha256',
      'storage_key',
    ]) {
      expect(text).not.toContain(jargon);
    }
  });

  it('reports a server that cannot be reached, with a retry', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new Error('network'))),
    );
    render(<DocumentsPage />);
    expect(await screen.findByRole('button', { name: /try again/i })).toBeTruthy();
  });
});
