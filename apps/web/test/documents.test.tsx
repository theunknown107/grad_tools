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
    paperFormat: null,
    ocrEngine: null,
    ocrEngineVersion: null,
    ocrLanguages: null,
    ocrPsm: null,
    ocrDpi: null,
    ocrDurationMs: null,
    ocrCharCount: null,
    needsReview: false,
    reviewReason: null,
    ...overrides,
  };
}

/** Routes fetch by path so the page can be driven without a server. */
function mockApi(
  documents: unknown[],
  sections: unknown[] = [],
  extracted?: { paper: unknown; questions: unknown[] },
) {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      // /questions is tested FIRST: the questions route is /api/v1/papers/:id/
      // questions, which also contains '/paper'.
      const body = url.includes('/sections')
        ? { data: sections }
        : url.includes('/questions')
          ? { data: extracted?.questions ?? [] }
          : url.includes('/paper')
            ? { data: extracted?.paper ?? null, history: [] }
            : { data: documents };
      return Promise.resolve({ ok: true, json: () => Promise.resolve(body) } as Response);
    }),
  );
}

function paper(overrides: Record<string, unknown> = {}) {
  return {
    id: '22222222-2222-2222-2222-222222222222',
    documentId: '11111111-1111-1111-1111-111111111111',
    paperFormat: 'descriptive',
    extractionSource: 'native',
    parserVersion: 'positional-v1',
    extractionVersion: 1,
    isCurrent: true,
    pageCount: 3,
    questionCount: 1,
    mcqItemCount: 0,
    needsReview: false,
    reviewReason: null,
    createdAt: '2026-08-27T10:00:00+05:30',
    reviewSummary: {
      total: 1,
      unreviewed: 1,
      accepted: 0,
      corrected: 0,
      rejected: 0,
      needsReview: 0,
    },
    confidenceSummary: { high: 1, medium: 0, low: 0, reviewRequired: 0 },
    ...overrides,
  };
}

function question(overrides: Record<string, unknown> = {}) {
  return {
    id: '33333333-3333-3333-3333-333333333333',
    paperId: '22222222-2222-2222-2222-222222222222',
    ordinal: 0,
    questionNumber: '1',
    module: '1',
    text: 'Explain the phases of a compiler',
    marks: 8,
    bloomLevel: 'L2',
    courseOutcome: 'CO1',
    pageNumber: 1,
    boundingBox: { x: 10, y: 20, width: 300, height: 12 },
    confidence: 'high',
    needsReview: false,
    reviewState: 'unreviewed',
    reviewed: null,
    reviewNote: null,
    reviewedAt: null,
    reviewedBy: null,
    subQuestions: [],
    ...overrides,
  };
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
    // M5A.3: OCR now exists, so the screen offers it rather than apologising.
    expect(screen.getByText(/can be read with image recognition/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /read the scan/i })).toBeTruthy();
    // Still no text to show.
    expect(screen.queryByRole('button', { name: /show text/i })).toBeNull();
  });

  /*
   * M5A.3 §13. The progress states must read as progress, never as AI and never
   * as a promise of accuracy.
   */
  it.each([
    ['ocr_queued', /waiting to be read/i, 'Queued'],
    ['ocr_processing', /reading the scanned pages/i, 'Reading'],
  ])('shows %s as progress', async (status, detail, label) => {
    mockApi([doc({ extractionStatus: status })]);
    render(<DocumentsPage />);
    expect(await screen.findByText(detail)).toBeTruthy();
    expect(screen.getByText(label)).toBeTruthy();
  });

  it('describes a successfully read scan without claiming accuracy', async () => {
    mockApi([doc({ extractionStatus: 'ocr_extracted' })]);
    render(<DocumentsPage />);
    expect(await screen.findByText(/image recognition was used to read the text/i)).toBeTruthy();
    expect(screen.getByText('Text read from scan')).toBeTruthy();
  });

  it('surfaces the review caveat for text that needs checking', async () => {
    mockApi([
      doc({
        extractionStatus: 'ocr_needs_review',
        needsReview: true,
        reviewReason: 'This paper contains mathematics. Formulas and symbols are not reliable.',
      }),
    ]);
    render(<DocumentsPage />);
    expect(await screen.findByText(/some layout or notation may need review/i)).toBeTruthy();
    expect(screen.getByText(/formulas and symbols are not reliable/i)).toBeTruthy();
  });

  /* Never "AI", never a claim of accuracy (M5A.3 §13). */
  it('never says AI or claims accuracy', async () => {
    for (const status of ['ocr_queued', 'ocr_processing', 'ocr_extracted', 'ocr_needs_review']) {
      cleanup();
      mockApi([doc({ extractionStatus: status })]);
      const view = render(<DocumentsPage />);
      await screen.findByText('BCS403 paper.pdf');
      const text = view.container.textContent ?? '';
      for (const wrong of [/\bAI\b/, /artificial intelligence/i, /100%/, /accurate/i]) {
        expect(text).not.toMatch(wrong);
      }
    }
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

  /* ------------------------------------------------------------------ */
  /* Extracted question structure (M5A.5)                                */
  /* ------------------------------------------------------------------ */

  describe('questions', () => {
    async function openQuestions(extracted: { paper: unknown; questions: unknown[] }) {
      mockApi([doc()], [], extracted);
      render(<DocumentsPage />);
      await screen.findByText('BCS403 paper.pdf');
      await userEvent.click(screen.getByRole('button', { name: 'Show questions' }));
    }

    it('shows the paper type, where it was read from, and the parser version', async () => {
      await openQuestions({ paper: paper(), questions: [question()] });

      expect(await screen.findByText('Written answers')).toBeTruthy();
      expect(screen.getByText("The document's own text")).toBeTruthy();
      expect(screen.getByText(/positional-v1/)).toBeTruthy();
    });

    it('lists each question with its module, marks and page', async () => {
      await openQuestions({ paper: paper(), questions: [question()] });

      expect(await screen.findByText('Q1')).toBeTruthy();
      expect(screen.getByText('Explain the phases of a compiler')).toBeTruthy();
      expect(screen.getByText('Module 1')).toBeTruthy();
      expect(screen.getByText('8 marks')).toBeTruthy();
      expect(screen.getByText('Page 1')).toBeTruthy();
    });

    /*
     * The word "accuracy" must never appear. The parser reports how much the
     * LAYOUT agreed, which is answerable; how correct the reading is, it
     * cannot know (docs/32 ED-46).
     */
    it('describes confidence as clarity, never as an accuracy score', async () => {
      await openQuestions({ paper: paper(), questions: [question()] });

      expect(await screen.findByText('Clear')).toBeTruthy();
      expect(screen.queryByText(/accuracy/i)).toBeNull();
      expect(screen.queryByText(/%/)).toBeNull();
    });

    it('says plainly when a question needs review', async () => {
      await openQuestions({
        paper: paper({ needsReview: true, reviewReason: '1 question should be checked.' }),
        questions: [question({ confidence: 'review_required', needsReview: true })],
      });

      expect(await screen.findByText('Needs review')).toBeTruthy();
      expect(screen.getByText('1 question should be checked.')).toBeTruthy();
    });

    /* A correction is shown, and so is the fact that it is a correction. */
    it('shows a corrected value rather than the machine value', async () => {
      await openQuestions({
        paper: paper({
          reviewSummary: {
            total: 1,
            unreviewed: 0,
            accepted: 0,
            corrected: 1,
            rejected: 0,
            needsReview: 0,
          },
        }),
        questions: [
          question({
            reviewState: 'corrected',
            reviewed: {
              questionNumber: null,
              module: null,
              text: null,
              marks: 10,
              bloomLevel: null,
              courseOutcome: null,
            },
          }),
        ],
      });

      expect(await screen.findByText('10 marks')).toBeTruthy();
      expect(screen.queryByText('8 marks')).toBeNull();
      expect(screen.getByText('Corrected')).toBeTruthy();
    });

    it('lists sub-questions under their question', async () => {
      await openQuestions({
        paper: paper(),
        questions: [
          question({
            subQuestions: [
              {
                id: '44444444-4444-4444-4444-444444444444',
                questionId: '33333333-3333-3333-3333-333333333333',
                ordinal: 0,
                label: 'a',
                text: 'Describe lexical analysis',
                marks: 6,
                bloomLevel: 'L2',
                courseOutcome: 'CO1',
                pageNumber: 1,
                boundingBox: { x: 10, y: 40, width: 200, height: 12 },
                confidence: 'high',
                needsReview: false,
                reviewState: 'unreviewed',
                reviewed: null,
                reviewNote: null,
                reviewedAt: null,
                reviewedBy: null,
              },
            ],
          }),
        ],
      });

      expect(await screen.findByText('Describe lexical analysis')).toBeTruthy();
      expect(screen.getByText('a')).toBeTruthy();
    });

    /*
     * `unknown` is a real outcome and says so. Presenting it as a broken app
     * would be wrong: the document was read correctly and correctly found to
     * match no template we know.
     */
    it('says the format could not be identified rather than guessing', async () => {
      await openQuestions({
        paper: paper({
          paperFormat: 'unknown',
          questionCount: 0,
          needsReview: true,
          reviewReason: 'The paper format could not be identified.',
          reviewSummary: {
            total: 0,
            unreviewed: 0,
            accepted: 0,
            corrected: 0,
            rejected: 0,
            needsReview: 0,
          },
        }),
        questions: [],
      });

      expect(await screen.findByText('Could not be identified')).toBeTruthy();
      expect(screen.getByText(/No questions could be worked out/)).toBeTruthy();
    });

    it('says so when nothing has been extracted yet', async () => {
      await openQuestions({ paper: null, questions: [] });
      expect(await screen.findByText(/No question structure has been worked out/)).toBeTruthy();
    });

    /*
     * Extracted text is rendered as TEXT. It came out of a PDF anyone could
     * have crafted, and React escaping is what stops it becoming markup
     * (docs/13 §T-21).
     */
    it('renders hostile extracted text as text, never as markup', async () => {
      await openQuestions({
        paper: paper(),
        questions: [question({ text: '<img src=x onerror=alert(1)> Explain' })],
      });

      expect(await screen.findByText('<img src=x onerror=alert(1)> Explain')).toBeTruthy();
      expect(document.querySelector('img')).toBeNull();
    });
  });
});
