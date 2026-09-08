/**
 * Retrieve the documents discovery found.
 *
 * Authority: Phase 7D §8–§12, §29, §33
 *
 *   pnpm vtu:download --graph graph.json                # everything in it
 *   pnpm vtu:download --graph graph.json --dry-run      # plan only
 *   pnpm vtu:download --graph graph.json --changed-only # conditional requests
 *   pnpm vtu:download --graph graph.json --limit 20     # a bounded first run
 *   pnpm vtu:download --graph graph.json --programme CSBS
 *
 * The store and the manifest live outside Git (§29): the repository keeps
 * normalized records and provenance, never a binary dump of VTU.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { createLocalDocumentStore } from '../src/sources/document-store.js';
import {
  downloadAll,
  DEFAULT_DELAY_MS,
  EMPTY_MANIFEST,
  type DownloadState,
  type Manifest,
} from '../src/sources/vtu-download.js';

const STORE_ROOT = resolve('../../.vtu-store/documents');
const MANIFEST_PATH = resolve('../../.vtu-store/manifest.json');

function flag(name: string): string | null {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? null : (process.argv[index + 1] ?? null);
}
const has = (name: string): boolean => process.argv.includes(`--${name}`);

interface GraphDocument {
  url: string;
  kind: string;
  schemeYear: string | null;
  programme: string | null;
  common: boolean;
}

async function readManifest(): Promise<Manifest> {
  try {
    return JSON.parse(await readFile(MANIFEST_PATH, 'utf8')) as Manifest;
  } catch {
    return EMPTY_MANIFEST;
  }
}

async function main(): Promise<void> {
  const graphPath = flag('graph');
  if (graphPath === null) throw new Error('Pass --graph <discovery json>.');

  const graph = JSON.parse(await readFile(graphPath, 'utf8')) as { documents: GraphDocument[] };
  const wantProgramme = flag('programme');
  const wantKind = flag('kind');

  const selected = graph.documents.filter(
    (doc) =>
      (wantProgramme === null ||
        doc.common ||
        (doc.programme ?? '').toLowerCase().includes(wantProgramme.toLowerCase())) &&
      (wantKind === null || doc.kind === wantKind),
  );

  const store = createLocalDocumentStore(STORE_ROOT);
  const manifest = await readManifest();
  const limit = flag('limit');

  console.log(
    `\nVTU download — ${String(selected.length)} of ${String(graph.documents.length)} documents selected`,
  );
  console.log(`  store:    ${STORE_ROOT}`);
  console.log(`  manifest: ${MANIFEST_PATH}`);
  if (has('dry-run')) console.log('  DRY RUN — nothing is fetched or written.\n');
  else console.log('');

  const { outcomes, manifest: next } = await downloadAll(
    selected.map((doc) => doc.url),
    store,
    manifest,
    {
      dryRun: has('dry-run'),
      changedOnly: has('changed-only'),
      delayMs: Number(flag('delay') ?? DEFAULT_DELAY_MS),
      limit: limit === null ? null : Number(limit),
    },
  );

  const tally = new Map<DownloadState, number>();
  for (const outcome of outcomes) tally.set(outcome.state, (tally.get(outcome.state) ?? 0) + 1);

  console.log('Outcomes');
  for (const [state, n] of [...tally].sort()) console.log(`  ${state.padEnd(18)} ${String(n)}`);

  const notable = outcomes.filter(
    (o) => o.state === 'failed' || o.state === 'blocked' || o.state === 'invalid_document',
  );
  if (notable.length > 0) {
    console.log('\nNeeding attention');
    for (const outcome of notable.slice(0, 20)) {
      console.log(`  ${outcome.state.padEnd(18)} ${outcome.reason ?? ''}\n      ${outcome.url}`);
    }
  }

  const changed = outcomes.filter((o) => o.state === 'changed');
  if (changed.length > 0) {
    console.log('\nChanged since last run');
    for (const outcome of changed) console.log(`  ${outcome.url}\n      ${outcome.reason ?? ''}`);
  }

  if (!has('dry-run')) {
    await mkdir(dirname(MANIFEST_PATH), { recursive: true });
    await writeFile(MANIFEST_PATH, JSON.stringify(next, null, 2), 'utf8');
    console.log(
      `\nManifest: ${String(next.entries.length)} unique documents, ` +
        `${String(next.entries.reduce((n, e) => n + e.urls.length, 0))} source references.`,
    );
  }
  console.log('');
}

await main();
