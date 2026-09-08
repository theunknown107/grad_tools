/**
 * Extract retrieved documents and normalize them into the academic catalogue.
 *
 * Authority: Phase 7D §13–§19, §22, §24, §26, §27, §35
 *
 *   pnpm vtu:normalize --scheme 2022 --out packages/vtu-catalogue/data/vtu-2022.json
 *   pnpm vtu:normalize --scheme 2022 --dry-run
 *
 * ---------------------------------------------------------------------------
 * EXTRACTION IS CACHED BY (DOCUMENT, PARSER VERSION)
 * ---------------------------------------------------------------------------
 *
 * §35: a new parser version must be able to re-read a document WITHOUT
 * downloading it again. The cache key is the document's own hash plus the
 * parser version, so bumping the parser invalidates exactly the extractions it
 * affects and nothing else — and the bytes never leave the store.
 *
 * ---------------------------------------------------------------------------
 * NATIVE TEXT ONLY, FOR NOW
 * ---------------------------------------------------------------------------
 *
 * §13's order is native text, then layout-aware, then rendering, then OCR. VTU
 * publishes text-layer PDFs, so the first rung carries these documents. A
 * document with no text layer is recorded as `no_text_layer` rather than being
 * pushed down the ladder silently — OCR is not run by default and a document
 * that would need it should be visible, not quietly approximated.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import {
  parseScheme,
  type Catalogue,
  type CatalogueConflict,
  type CatalogueCourse,
  type PositionedText,
  type SchemePage,
} from '@gradtools/vtu-catalogue';
import { createLocalDocumentStore } from '../src/sources/document-store.js';
import { EMPTY_MANIFEST, type Manifest } from '../src/sources/vtu-download.js';

const STORE_ROOT = resolve('../../.vtu-store/documents');
const MANIFEST_PATH = resolve('../../.vtu-store/manifest.json');
const CACHE_ROOT = resolve('../../.vtu-store/extractions');

/** Bumped when extraction changes; part of the cache key (§35). */
const EXTRACTOR_VERSION = '1.0.0';
/** Bumped when normalization changes. Recorded on the catalogue (§22). */
const NORMALIZATION_VERSION = '1.0.0';

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

type ExtractionStatus = 'text' | 'no_text_layer' | 'failed';

interface Extraction {
  readonly status: ExtractionStatus;
  readonly pages: SchemePage[];
  readonly pageCount: number;
  readonly reason?: string;
}

/**
 * A document's positioned text, from the cache or from the bytes.
 *
 * The cache is keyed by hash AND extractor version, so the same PDF read by a
 * newer extractor is a different entry rather than a stale hit.
 */
async function extract(sha256: string, bytes: Uint8Array): Promise<Extraction> {
  const cachePath = resolve(CACHE_ROOT, `${sha256}.${EXTRACTOR_VERSION}.json`);
  try {
    return JSON.parse(await readFile(cachePath, 'utf8')) as Extraction;
  } catch {
    /* Not cached yet. */
  }

  let result: Extraction;
  try {
    const doc = await getDocument({ data: bytes, useSystemFonts: true }).promise;
    const pages: SchemePage[] = [];
    let runs = 0;
    for (let n = 1; n <= doc.numPages; n += 1) {
      const page = await doc.getPage(n);
      const content = await page.getTextContent();
      const items: PositionedText[] = content.items
        .filter((item): item is typeof item & { str: string } => 'str' in item)
        .filter((item) => item.str.trim() !== '')
        .map((item) => ({
          text: item.str,
          x: (item.transform as number[])[4] ?? 0,
          y: (item.transform as number[])[5] ?? 0,
          width: item.width ?? 0,
          height: item.height ?? 0,
        }));
      runs += items.length;
      pages.push({ page: n, items });
    }
    /*
     * A scanned PDF returns pages and no runs. Recorded as such rather than
     * sent to OCR, which §13 keeps as a last resort and not a default.
     */
    result =
      runs === 0
        ? { status: 'no_text_layer', pages: [], pageCount: doc.numPages }
        : { status: 'text', pages, pageCount: doc.numPages };
  } catch (cause) {
    result = {
      status: 'failed',
      pages: [],
      pageCount: 0,
      reason: cause instanceof Error ? cause.message : String(cause),
    };
  }

  await mkdir(dirname(cachePath), { recursive: true });
  await writeFile(cachePath, JSON.stringify(result), 'utf8');
  return result;
}

async function main(): Promise<void> {
  const graphPath = flag('graph') ?? '../../apps/web/.qa/vtu/graph-2022.json';
  const wantYear = flag('scheme');
  const graph = JSON.parse(await readFile(graphPath, 'utf8')) as { documents: GraphDocument[] };

  const manifest: Manifest = await readFile(MANIFEST_PATH, 'utf8')
    .then((raw) => JSON.parse(raw) as Manifest)
    .catch(() => EMPTY_MANIFEST);
  const store = createLocalDocumentStore(STORE_ROOT);

  /* Which document each held hash came from, so provenance names a real URL. */
  const byUrl = new Map<string, string>();
  for (const entry of manifest.entries) for (const url of entry.urls) byUrl.set(url, entry.sha256);

  const schemeDocs = graph.documents.filter(
    (doc) =>
      doc.kind === 'scheme' &&
      (wantYear === null || doc.schemeYear === wantYear) &&
      byUrl.has(doc.url),
  );

  console.log(
    `\nVTU normalize — extractor ${EXTRACTOR_VERSION}, normalization ${NORMALIZATION_VERSION}`,
  );
  console.log(`  scheme documents held: ${String(schemeDocs.length)}\n`);

  const courses: CatalogueCourse[] = [];
  const documents: Catalogue['documents'] = [];
  const statuses = new Map<ExtractionStatus, number>();
  const now = new Date().toISOString();

  for (const doc of schemeDocs) {
    const sha256 = byUrl.get(doc.url) as string;
    const bytes = await store.get(sha256);
    if (bytes === null) {
      console.log(`  MISSING BYTES  ${doc.url}`);
      continue;
    }

    const extraction = await extract(sha256, bytes);
    statuses.set(extraction.status, (statuses.get(extraction.status) ?? 0) + 1);
    if (extraction.status !== 'text') {
      console.log(`  ${extraction.status.padEnd(14)} ${doc.url}  ${extraction.reason ?? ''}`);
      documents.push({
        sha256,
        sourceUrl: doc.url,
        kind: doc.kind,
        schemeYear: doc.schemeYear,
        programme: doc.programme,
        courses: 0,
      });
      continue;
    }

    const parsed = parseScheme(extraction.pages);
    for (const course of parsed.courses) {
      courses.push({
        schemeYear: doc.schemeYear ?? 'unknown',
        programme: doc.common ? null : doc.programme,
        semester: course.semester,
        code: course.code,
        title: course.title,
        credits: course.credits,
        creditBasis:
          course.viaAlternativeTo !== null
            ? 'alternative'
            : course.viaElectiveSlot !== null
              ? 'slot'
              : 'table',
        relatedCode: course.viaAlternativeTo ?? course.viaElectiveSlot,
        provenance: {
          documentSha256: sha256,
          sourceUrl: doc.url,
          sourcePage: course.page,
          parserVersion: EXTRACTOR_VERSION,
          retrievedAt: now,
        },
      });
    }

    documents.push({
      sha256,
      sourceUrl: doc.url,
      kind: doc.kind,
      schemeYear: doc.schemeYear,
      programme: doc.common ? null : doc.programme,
      courses: parsed.courses.length,
    });
    console.log(
      `  ${String(parsed.courses.length).padStart(4)} courses  ${String(parsed.rejected.length).padStart(3)} refused  ` +
        `${(doc.programme ?? '(common)').slice(0, 40).padEnd(40)} ${doc.url.split('/').pop() ?? ''}`,
    );
  }

  /*
   * CONFLICTS ARE RECORDED, NOT RESOLVED (§22). Two documents that give one
   * course different credits both stay in the record with their sources; the
   * catalogue reports the disagreement rather than picking a winner.
   */
  const seen = new Map<string, CatalogueCourse[]>();
  for (const course of courses) {
    const key = [course.schemeYear, course.programme ?? '(common)', course.semester, course.code]
      .map(String)
      .join(' ');
    seen.set(key, [...(seen.get(key) ?? []), course]);
  }
  const conflicts: CatalogueConflict[] = [];
  const deduped: CatalogueCourse[] = [];
  for (const group of seen.values()) {
    const first = group[0] as CatalogueCourse;
    deduped.push(first);
    const values = [...new Set(group.map((c) => c.credits))];
    if (values.length > 1) {
      conflicts.push({
        schemeYear: first.schemeYear,
        programme: first.programme,
        semester: first.semester,
        code: first.code,
        field: 'credits',
        readings: group.map((c) => ({
          value: c.credits,
          documentSha256: c.provenance.documentSha256,
          sourceUrl: c.provenance.sourceUrl,
        })),
      });
    }
  }

  const catalogue: Catalogue = {
    normalizationVersion: NORMALIZATION_VERSION,
    generatedAt: now,
    courses: deduped.sort(
      (a, b) =>
        a.schemeYear.localeCompare(b.schemeYear) ||
        (a.programme ?? '').localeCompare(b.programme ?? '') ||
        a.semester - b.semester ||
        a.code.localeCompare(b.code),
    ),
    conflicts,
    aliases: [],
    documents,
  };

  console.log('\nExtraction');
  for (const [status, n] of [...statuses].sort())
    console.log(`  ${status.padEnd(16)} ${String(n)}`);
  console.log('\nCatalogue');
  console.log(`  courses (deduplicated) ${String(deduped.length)}`);
  console.log(`  from readings          ${String(courses.length)}`);
  console.log(`  conflicts              ${String(conflicts.length)}`);
  console.log(`  documents              ${String(documents.length)}`);

  const out = flag('out');
  if (out !== null && !has('dry-run')) {
    const path = resolve(out);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify(catalogue, null, 2), 'utf8');
    console.log(`\nWrote ${path}`);
  }
  console.log('');
}

await main();
