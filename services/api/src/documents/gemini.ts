/**
 * The one place the server talks to Gemini.
 *
 * What the model is GIVEN: a fixed system instruction, one fixed text turn,
 * the document as inline data, and a response schema. What it is NOT given:
 * tools, function declarations, search, code execution, URL context, files
 * API objects, or anything else that could act. Its reply is text, returned
 * to the caller unparsed and untrusted.
 *
 * Inline data rather than the Files API: the file is not stored on Google's
 * side as an object that outlives the request, and there is nothing to delete.
 */

import { ApiError as GeminiApiError, GoogleGenAI, ThinkingLevel } from '@google/genai';
import type { AiDocumentMimeType } from '@gradtools/shared-types';
import { DOCUMENT_TURN, EXTRACTION_INSTRUCTION, GEMINI_RESPONSE_SCHEMA } from './instruction.js';

/** Reads one document; resolves with the model's raw reply text. */
export type DocumentReader = (
  document: { readonly bytes: Uint8Array; readonly mimeType: AiDocumentMimeType },
  signal: AbortSignal,
) => Promise<string>;

/** Why a read failed — in categories safe to show, never the provider's text. */
export type ReaderFailure =
  | 'not_configured'
  | 'model_unavailable'
  | 'rate_limited'
  | 'timeout'
  | 'service'
  | 'unsupported_type';

export class DocumentReaderError extends Error {
  constructor(readonly failure: ReaderFailure) {
    super(`Document reading failed: ${failure}`);
    this.name = 'DocumentReaderError';
  }
}

/** Maps a provider error to a category. The provider's message is discarded. */
export function classifyReaderError(error: unknown, signal: AbortSignal): DocumentReaderError {
  if (error instanceof DocumentReaderError) return error;
  if (signal.aborted) return new DocumentReaderError('timeout');
  if (error instanceof GeminiApiError) {
    if (error.status === 400 || error.status === 401 || error.status === 403) {
      return new DocumentReaderError('not_configured');
    }
    if (error.status === 404) return new DocumentReaderError('model_unavailable');
    if (error.status === 429) return new DocumentReaderError('rate_limited');
  }
  return new DocumentReaderError('service');
}

export function createGeminiReader(options: {
  readonly apiKey: string;
  readonly model: string;
  readonly thinkingLevel: 'minimal' | 'low' | 'medium' | 'high';
}): DocumentReader {
  const thinkingLevel = {
    minimal: ThinkingLevel.MINIMAL,
    low: ThinkingLevel.LOW,
    medium: ThinkingLevel.MEDIUM,
    high: ThinkingLevel.HIGH,
  }[options.thinkingLevel];
  const client = new GoogleGenAI({ apiKey: options.apiKey });
  return async (document, signal) => {
    try {
      const response = await client.models.generateContent({
        model: options.model,
        contents: [
          {
            role: 'user',
            parts: [
              { text: DOCUMENT_TURN },
              {
                inlineData: {
                  mimeType: document.mimeType,
                  data: Buffer.from(document.bytes).toString('base64'),
                },
              },
            ],
          },
        ],
        config: {
          systemInstruction: EXTRACTION_INSTRUCTION,
          responseMimeType: 'application/json',
          responseJsonSchema: GEMINI_RESPONSE_SCHEMA,
          /* Gemini 3 sampling is left at the model's defaults (no temperature, topP, topK). */
          thinkingConfig: { thinkingLevel },
          abortSignal: signal,
        },
      });
      return response.text ?? '';
    } catch (error) {
      throw classifyReaderError(error, signal);
    }
  };
}
