/**
 * Asking the GradTools server to read a document with AI.
 *
 * WHAT LEAVES THE DEVICE: the one file the student chose — a PDF as a picture
 * of its first page, rendered here — sent to the GradTools API, which sends it
 * to the configured AI model and returns what it read. Only when the student
 * turns AI reading on, only when signed in, and never an AI key — the browser
 * never holds one. The reply is validated here too, with the same strict
 * schema the server uses; nothing is saved until the student confirms it.
 */

import { aiReviewSchema, DOCUMENT_AI_ROUTES, type AiReview } from '@gradtools/shared-types';
import { renderPdfPage } from '../lib/pdf-text.js';
import { apiBaseUrl, apiConfigured } from './reference.js';

/**
 * The free AI models read images, not PDFs, so a PDF is rendered on the device
 * (the same renderer the offline OCR path uses) — no cloud PDF parser.
 * ponytail: first page only; a result card or timetable is one page. Send
 * every page when a multi-page document needs AI.
 */
async function asImage(file: File): Promise<Blob> {
  if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) return file;
  const canvas = await renderPdfPage(await file.arrayBuffer(), 1);
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob === null)
        reject(new DocumentAiError('This PDF could not be prepared for AI reading.'));
      else resolve(blob);
    }, 'image/png');
  });
}

export class DocumentAiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DocumentAiError';
  }
}

export function documentAiAvailable(signedIn: boolean): boolean {
  return signedIn && apiConfigured();
}

export async function readWithAi(
  file: File,
  token: string,
  signal?: AbortSignal,
): Promise<AiReview> {
  const upload = await asImage(file);
  let response: Response;
  try {
    response = await fetch(`${apiBaseUrl()}${DOCUMENT_AI_ROUTES.extract}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/octet-stream' },
      body: upload,
      ...(signal === undefined ? {} : { signal }),
    });
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === 'AbortError') throw cause;
    throw new DocumentAiError('Could not reach GradTools to read this with AI.');
  }

  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      typeof body === 'object' && body !== null && 'error' in body
        ? (body as { error?: { message?: unknown } }).error?.message
        : undefined;
    throw new DocumentAiError(
      typeof message === 'string'
        ? message
        : response.status === 404
          ? 'AI reading is not available on this server.'
          : 'AI reading failed.',
    );
  }

  const review = aiReviewSchema.safeParse(body);
  if (!review.success) throw new DocumentAiError('The AI reading came back in an unexpected form.');
  return review.data;
}
