/**
 * One AI document read, end to end, with every boundary in order:
 *
 *   bytes ── signature check ── model (deadline) ── JSON.parse ── strict
 *   schema ── deterministic recognition ── review payload
 *
 * The reply is untrusted input at every step. A reply that is not JSON, or
 * that fails the strict schema in any way, is REJECTED — never repaired, never
 * partially used. An unrecognised document returns no data at all. Nothing
 * here writes anywhere: the payload goes back to the student's device, which
 * saves only what the student confirms.
 */

import {
  aiExtractionSchema,
  AI_DOCUMENT_MAX_BYTES,
  type AiDocumentMimeType,
  type AiExtraction,
  type AiReview,
} from '@gradtools/shared-types';
import { DocumentReaderError, type DocumentReader } from './gemini.js';
import { recognize } from './recognize.js';

/** A reply this slow is a stalled request, not a thorough one. */
export const READ_TIMEOUT_MS = 90_000;

export type ReadFailure =
  DocumentReaderError['failure'] | 'too_large' | 'unsupported_type' | 'invalid_reply';

export class DocumentReadError extends Error {
  constructor(readonly failure: ReadFailure) {
    super(`Document read failed: ${failure}`);
    this.name = 'DocumentReadError';
  }
}

/**
 * The single source of truth for "is this model reply usable": valid JSON that
 * satisfies the strict `aiExtractionSchema`. Returns the parsed extraction, or
 * throws `DocumentReadError('invalid_reply')`. A reply is never repaired.
 *
 * Shared so the provider router can decide whether to fall back to the next
 * provider on an invalid reply, and `readDocument` can validate the reply it
 * finally uses — both through the exact same check, not two copies of it.
 */
export function validateAiReply(reply: string): AiExtraction {
  let parsed: unknown;
  try {
    parsed = JSON.parse(reply);
  } catch {
    throw new DocumentReadError('invalid_reply');
  }
  const extraction = aiExtractionSchema.safeParse(parsed);
  if (!extraction.success) throw new DocumentReadError('invalid_reply');
  return extraction.data;
}

/** What the bytes ARE, by signature — the declared type is not trusted. */
export function sniffDocument(bytes: Uint8Array): AiDocumentMimeType | null {
  const head = bytes.subarray(0, 1024);
  const at = (offset: number, text: string): boolean =>
    [...text].every((char, index) => head[offset + index] === char.charCodeAt(0));
  if (Buffer.from(head).toString('latin1').includes('%PDF-')) return 'application/pdf';
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return 'image/jpeg';
  if (head[0] === 0x89 && at(1, 'PNG')) return 'image/png';
  if (at(0, 'RIFF') && at(8, 'WEBP')) return 'image/webp';
  return null;
}

export async function readDocument(
  bytes: Uint8Array,
  reader: DocumentReader,
  model: string,
  timeoutMs = READ_TIMEOUT_MS,
): Promise<AiReview> {
  if (bytes.byteLength > AI_DOCUMENT_MAX_BYTES) throw new DocumentReadError('too_large');
  const mimeType = sniffDocument(bytes);
  if (mimeType === null) throw new DocumentReadError('unsupported_type');

  const signal = AbortSignal.timeout(timeoutMs);
  let reply: string;
  try {
    reply = await reader({ bytes, mimeType }, signal);
  } catch (error) {
    throw error instanceof DocumentReaderError
      ? new DocumentReadError(error.failure)
      : new DocumentReadError(signal.aborted ? 'timeout' : 'service');
  }

  const extraction = validateAiReply(reply);

  const outcome = recognize(extraction);
  const known = outcome.recognition !== 'UNRECOGNIZED_DOCUMENT';
  return {
    recognition: outcome.recognition,
    evidence: [...outcome.evidence],
    documentType: outcome.documentType,
    /* Only the recognised document's own section, and nothing for an unrecognised one. */
    resultCard: known && outcome.documentType === 'RESULT_CARD' ? extraction.resultCard : null,
    timetable: known && outcome.documentType === 'TIMETABLE' ? extraction.timetable : null,
    model,
  };
}
