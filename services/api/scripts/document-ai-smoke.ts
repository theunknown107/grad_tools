/**
 * One real AI read of a SYNTHETIC fixture — a manual check, never run in CI.
 *
 *   GEMINI_API_KEY must be in the environment (it is never printed).
 *   tsx scripts/document-ai-smoke.ts result-card|timetable
 *
 * Only the synthetic documents in test/fixtures/documents may be sent. Never
 * point this at a real grade card: it would send a student's record to the
 * configured Gemini service.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGeminiReader } from '../src/documents/gemini.js';
import { readDocument } from '../src/documents/read.js';

const fixture = process.argv[2] === 'timetable' ? 'timetable' : 'result-card';
const apiKey = process.env.GEMINI_API_KEY;
if (apiKey === undefined || apiKey === '') {
  console.error('GEMINI_API_KEY is not set in this environment.');
  process.exit(2);
}
const model = process.env.GEMINI_DOCUMENT_MODEL ?? 'gemini-2.5-flash';
const here = fileURLToPath(new URL('.', import.meta.url));
const bytes = readFileSync(join(here, '..', 'test', 'fixtures', 'documents', `${fixture}.png`));

const started = Date.now();
try {
  const review = await readDocument(bytes, createGeminiReader({ apiKey, model }), model);
  console.log(JSON.stringify({ fixture, model, ms: Date.now() - started, review }, null, 2));
} catch (error) {
  console.error(`read failed: ${error instanceof Error ? error.message : 'unknown'}`);
  process.exit(1);
}
