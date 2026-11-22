/**
 * Which OpenRouter models may read documents RIGHT NOW — a developer
 * diagnostic, never served by the API.
 *
 *   tsx scripts/document-ai-models.ts
 *
 * Metadata only: the public model catalog and endpoint lists. No inference
 * request is made and no API key is read. Every $0/$0 catalog entry is
 * assessed by the same `assessModel` the reader runs before each read, once
 * with the production privacy rule (ZDR + data collection denied) and once
 * without it (synthetic documents only).
 */

import {
  assessModel,
  isFree,
  openRouterMetadata,
  type ModelEndpoints,
} from '../src/documents/openrouter.js';

const get = <T>(path: string): Promise<T> =>
  openRouterMetadata<T>(path, AbortSignal.timeout(30_000));

const catalog = await get<{ id: string; pricing: Record<string, unknown> }[]>('/models');
const zdr = await get<{ model_id: string; tag: string }[]>('/endpoints/zdr');
const free = catalog.filter((model) => isFree(model.pricing));

console.log(
  `${String(catalog.length)} models in the catalog; ${String(free.length)} priced $0 for every item.\n`,
);
const rows = [];
for (const { id } of free) {
  const meta = await get<ModelEndpoints>(`/models/${id}/endpoints`);
  const tags = new Set(zdr.filter((entry) => entry.model_id === id).map((entry) => entry.tag));
  const production = assessModel(meta, tags);
  const synthetic = assessModel(meta, null);
  rows.push({
    model: id,
    input: meta.architecture.input_modalities.join('+'),
    output: synthetic.output ?? '-',
    freeEndpoints: synthetic.freeEndpoints,
    zdrEndpoints: production.privateEndpoints,
    synthetic: synthetic.eligible ? 'eligible' : 'no',
    production: production.eligible ? 'eligible' : 'no',
    why: (production.eligible ? [] : production.reasons).join('; '),
  });
}
console.table(rows);
console.log(
  `\nConfigured primary:   ${process.env.DOCUMENT_AI_PRIMARY_MODEL ?? 'qwen/qwen3.8-27b:free (default)'}`,
);
console.log(`Configured secondary: ${process.env.DOCUMENT_AI_SECONDARY_MODEL ?? '(none)'}`);
