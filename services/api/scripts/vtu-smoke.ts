/**
 * Live smoke test against the official VTU source.
 *
 * Authority: Phase 7D §40
 *
 *   pnpm vtu:smoke
 *
 * SEPARATE FROM THE TEST SUITE, ON PURPOSE. §40 asks for a check that the real
 * source is reachable and shaped as expected — and §39 forbids making the
 * ordinary suite depend on the internet. A test that fails on a train and
 * passes in an office is measuring the network, not the code, so this is a
 * script somebody runs deliberately.
 *
 * Exits non-zero if any check fails, so CI can schedule it separately.
 */

import { createHash } from 'node:crypto';
import { vtuSchemeAdapter } from '../src/sources/vtu-scheme.js';
import { fetchDocument, isFetchableUrl } from '../src/sources/vtu-download.js';
import { USER_AGENT } from '../src/sources/fetch.js';

const ROOT = 'https://vtu.ac.in/b-e-scheme-syllabus/';

const results: { name: string; ok: boolean; detail: string }[] = [];

async function check(name: string, fn: () => Promise<string>): Promise<void> {
  try {
    results.push({ name, ok: true, detail: await fn() });
  } catch (cause) {
    results.push({
      name,
      ok: false,
      detail: cause instanceof Error ? cause.message : String(cause),
    });
  }
}

let body = '';
let firstPdfUrl = '';

await check('the official listing is reachable', async () => {
  const response = await fetch(ROOT, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'text/html' },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`HTTP ${String(response.status)}`);
  body = await response.text();
  return `${String(body.length)} bytes`;
});

await check('scheme documents are discoverable', () => {
  const items = vtuSchemeAdapter.parse(body);
  if (items.length < 100) throw new Error(`Only ${String(items.length)} PDF links found.`);
  return `${String(items.length)} PDF links`;
});

await check('a 2022 scheme document is present', () => {
  const graph = vtuSchemeAdapter.describe(vtuSchemeAdapter.parse(body));
  const found = graph.filter((doc) => doc.schemeYear === '2022' && doc.kind === 'scheme');
  if (found.length === 0) throw new Error('No 2022 scheme document in the graph.');
  firstPdfUrl = found[0]?.url ?? '';
  return `${String(found.length)} 2022 scheme documents`;
});

await check('one of them downloads and hashes', async () => {
  if (firstPdfUrl === '') throw new Error('No URL to try.');
  const fetchable = isFetchableUrl(firstPdfUrl);
  if (!fetchable.ok) throw new Error(fetchable.reason);
  const fetched = await fetchDocument(firstPdfUrl);
  const sha256 = createHash('sha256').update(fetched.bytes).digest('hex');
  if (!/^[0-9a-f]{64}$/.test(sha256)) throw new Error('No hash produced.');
  return `${String(fetched.bytes.byteLength)} bytes, sha ${sha256.slice(0, 16)}…`;
});

console.log('\nVTU live smoke test\n');
for (const result of results) {
  console.log(`  ${result.ok ? 'PASS' : 'FAIL'}  ${result.name}\n        ${result.detail}`);
}
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${String(results.length - failed)}/${String(results.length)} checks passed.\n`);
process.exitCode = failed === 0 ? 0 : 1;
