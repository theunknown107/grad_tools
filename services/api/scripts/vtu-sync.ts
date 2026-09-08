/**
 * One command: official source to persisted catalogue.
 *
 * Authority: Phase 7D.1 §15–§19, §31, §47
 *
 *   pnpm vtu:sync --scheme 2022
 *   pnpm vtu:sync --scheme 2022 --programme CSBS
 *   pnpm vtu:sync --scheme 2022 --dry-run
 *   pnpm vtu:sync --scheme 2022 --changed-only
 *   pnpm vtu:sync --scheme 2022 --from page.html    # a captured listing
 *   pnpm vtu:sync --scheme 2022 --emit ../../packages/vtu-catalogue/data/vtu-2022.json
 *
 * ---------------------------------------------------------------------------
 * DISCOVER, DOWNLOAD, EXTRACT, NORMALIZE, PERSIST, REPORT
 * ---------------------------------------------------------------------------
 *
 * The stages already exist as their own commands; this runs them in order and
 * reports each separately, because §31 asks for the counts never to be mixed.
 * "1134 discovered" is not "1134 downloaded" and neither is "1134 normalized".
 *
 * ---------------------------------------------------------------------------
 * WHY IT STILL EMITS A FILE
 * ---------------------------------------------------------------------------
 *
 * Postgres is the system of record (§2). The app is local-first and must
 * resolve a student's credits with no network and no server, so the same
 * normalized catalogue is also written as a build artifact that ships with the
 * app. One producer, two destinations — not two catalogues.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import postgres from 'postgres';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import {
  parseScheme,
  type Catalogue,
  type CatalogueCourse,
  type PositionedText,
  type SchemePage,
} from '@gradtools/vtu-catalogue';
import { createLocalDocumentStore } from '../src/sources/document-store.js';
import {
  downloadAll,
  DEFAULT_DELAY_MS,
  EMPTY_MANIFEST,
  type Manifest,
} from '../src/sources/vtu-download.js';
import { vtuSchemeAdapter, type SchemeDocument } from '../src/sources/vtu-scheme.js';
import {
  upsertApplicability,
  upsertCourse,
  upsertDocumentVersion,
  upsertSourceReference,
  upsertStream,
} from '../src/sources/catalogue-store.js';

const ROOT = 'https://vtu.ac.in/b-e-scheme-syllabus/';
const STORE_ROOT = resolve('../../.vtu-store/documents');
const MANIFEST_PATH = resolve('../../.vtu-store/manifest.json');
const CACHE_ROOT = resolve('../../.vtu-store/extractions');
const REPORT_PATH = resolve('../../.vtu-store/last-sync.json');

const EXTRACTOR_VERSION = '1.0.0';
const NORMALIZATION_VERSION = '1.0.0';

const flag = (name: string): string | null => {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? null : (process.argv[index + 1] ?? null);
};
const has = (name: string): boolean => process.argv.includes(`--${name}`);

type ExtractionStatus = 'text' | 'no_text_layer' | 'failed';
interface Extraction {
  readonly status: ExtractionStatus;
  readonly pages: SchemePage[];
  readonly pageCount: number;
  readonly reason?: string;
}

async function extract(sha256: string, bytes: Uint8Array): Promise<Extraction> {
  const cachePath = resolve(CACHE_ROOT, `${sha256}.${EXTRACTOR_VERSION}.json`);
  try {
    return JSON.parse(await readFile(cachePath, 'utf8')) as Extraction;
  } catch {
    /* Not cached under this extractor version yet. */
  }
  let result: Extraction;
  try {
    const doc = await getDocument({ data: bytes, useSystemFonts: true }).promise;
    const pages: SchemePage[] = [];
    let runs = 0;
    for (let n = 1; n <= doc.numPages; n += 1) {
      const content = await (await doc.getPage(n)).getTextContent();
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

/**
 * How a document's audience is recorded (§5, §6).
 *
 * `common` is a real answer — a stream scheme genuinely serves everyone in its
 * stream. `unknown` is a different answer, and collapsing them into a null
 * programme was the defect this replaces.
 */
function applicabilityOf(doc: SchemeDocument): {
  scope: 'programme' | 'stream' | 'common' | 'unknown';
  programmeName: string | null;
  streamId: string | null;
  streamName: string | null;
} {
  if (doc.programme !== null) {
    return { scope: 'programme', programmeName: doc.programme, streamId: null, streamName: null };
  }
  /*
   * A document whose own label names a stream belongs to that stream, and its
   * courses are namespaced by it. "CSE Stream Scheme (CSE/ISC/BT)" is not a
   * programme-less document; it is the CSE stream's.
   */
  const label = doc.streamLabel;
  if (label !== null) {
    return {
      scope: 'stream',
      programmeName: null,
      streamId: streamIdFor(label),
      streamName: label,
    };
  }
  if (doc.common) {
    return { scope: 'common', programmeName: null, streamId: null, streamName: null };
  }
  return { scope: 'unknown', programmeName: null, streamId: null, streamName: null };
}

/** A stable slug for a stream, from the label the source prints. */
function streamIdFor(label: string): string {
  return (
    label
      .toLowerCase()
      .replace(/\(.*?\)/g, ' ')
      .replace(/\b(scheme|syllabus)\b/g, ' ')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'stream'
  );
}

async function main(): Promise<void> {
  const wantYear = flag('scheme');
  const wantProgramme = flag('programme');
  const dryRun = has('dry-run');
  const report = {
    startedAt: new Date().toISOString(),
    scheme: wantYear,
    programme: wantProgramme,
    dryRun,
    discovered_pages: 0,
    discovered_pdf_urls: 0,
    selected: 0,
    download: {} as Record<string, number>,
    extracted: 0,
    extraction_failures: 0,
    no_text_layer: 0,
    normalized_courses: 0,
    persisted_versions: 0,
    persisted_references: 0,
    persisted_applicability: 0,
    persisted_courses_inserted: 0,
    persisted_courses_updated: 0,
    persisted_courses_unchanged: 0,
    conflicts: 0,
  };

  /* ---- 1. Discover ----------------------------------------------------- */

  const capture = flag('from');
  const body =
    capture !== null
      ? await readFile(capture, 'utf8')
      : await (
          await fetch(ROOT, {
            headers: { Accept: 'text/html' },
            signal: AbortSignal.timeout(30_000),
          })
        ).text();
  report.discovered_pages = 1;

  const raw = vtuSchemeAdapter.parse(body);
  report.discovered_pdf_urls = raw.length;
  const graph = vtuSchemeAdapter.describe(raw);

  const selected = graph.filter(
    (doc) =>
      doc.kind === 'scheme' &&
      (wantYear === null || doc.schemeYear === wantYear) &&
      (wantProgramme === null ||
        doc.common ||
        (doc.programme ?? '').toLowerCase().includes(wantProgramme.toLowerCase())),
  );
  report.selected = selected.length;

  console.log(`\nVTU sync${dryRun ? ' (DRY RUN)' : ''}`);
  console.log(`  discovered      ${String(raw.length)} PDF URLs on 1 page`);
  console.log(`  selected        ${String(selected.length)} scheme documents\n`);

  /* ---- 2. Download ----------------------------------------------------- */

  const store = createLocalDocumentStore(STORE_ROOT);
  const manifest: Manifest = await readFile(MANIFEST_PATH, 'utf8')
    .then((text) => JSON.parse(text) as Manifest)
    .catch(() => EMPTY_MANIFEST);

  const { outcomes, manifest: nextManifest } = await downloadAll(
    selected.map((doc) => doc.url),
    store,
    manifest,
    {
      dryRun,
      changedOnly: has('changed-only'),
      delayMs: Number(flag('delay') ?? DEFAULT_DELAY_MS),
      limit: null,
    },
  );
  for (const outcome of outcomes) {
    report.download[outcome.state] = (report.download[outcome.state] ?? 0) + 1;
  }
  console.log('  download');
  for (const [state, n] of Object.entries(report.download).sort()) {
    console.log(`    ${state.padEnd(18)} ${String(n)}`);
  }

  if (!dryRun) {
    await mkdir(dirname(MANIFEST_PATH), { recursive: true });
    await writeFile(MANIFEST_PATH, JSON.stringify(nextManifest, null, 2), 'utf8');
  }

  /* ---- 3. Extract and normalize ---------------------------------------- */

  const byUrl = new Map<string, string>();
  for (const entry of nextManifest.entries) {
    for (const url of entry.urls) byUrl.set(url, entry.sha256);
  }
  const bySha = new Map(nextManifest.entries.map((entry) => [entry.sha256, entry]));

  /*
   * ONE WRITE PER IDENTITY PER RUN.
   *
   * A scheme prints the same course in more than one table -- the first-year
   * document repeats every semester once per cycle group -- so without this the
   * second reading UPDATEs the first and the stored value depends on document
   * order. A second sync then reported 39 courses "updated" with nothing having
   * changed at the source, which is exactly what idempotency forbids (19).
   *
   * Where two readings of one identity DISAGREE, that is a conflict and is
   * reported as one rather than settled by whichever was read last (11).
   */
  const written = new Map<string, { credits: number; sha256: string }>();
  const disagreements: {
    code: string;
    semester: number;
    a: { credits: number; sha256: string };
    b: { credits: number; sha256: string };
  }[] = [];

  const courses: CatalogueCourse[] = [];
  const documents: Catalogue['documents'] = [];
  const now = new Date().toISOString();

  const url = process.env['DATABASE_URL'] ?? process.env['TEST_DATABASE_URL'] ?? null;
  const sql = dryRun || url === null ? null : postgres(url, { max: 2 });
  if (!dryRun && sql === null) {
    console.log('\n  NOT PERSISTING: no DATABASE_URL. The catalogue file is still written.');
  }

  try {
    for (const doc of selected) {
      const sha256 = byUrl.get(doc.url);
      if (sha256 === undefined) continue;
      const bytes = await store.get(sha256);
      if (bytes === null) continue;

      const extraction = await extract(sha256, bytes);
      if (extraction.status === 'text') report.extracted += 1;
      else if (extraction.status === 'no_text_layer') report.no_text_layer += 1;
      else report.extraction_failures += 1;

      const parsed =
        extraction.status === 'text'
          ? parseScheme(extraction.pages)
          : { courses: [], rejected: [], semesters: [], programme: null, schemeYear: null };

      const where = applicabilityOf(doc);

      /* ---- 4. Persist ---------------------------------------------------- */

      if (sql !== null) {
        if (where.streamId !== null && where.streamName !== null) {
          await upsertStream(sql, {
            id: where.streamId,
            name: where.streamName,
            sourceUrl: doc.url,
          });
        }
        const entry = bySha.get(sha256);
        const version = await upsertDocumentVersion(sql, {
          sha256,
          byteSize: entry?.byteSize ?? bytes.byteLength,
          mimeType: entry?.mimeType ?? 'application/pdf',
          pageCount: extraction.pageCount,
          retrievedAt: entry?.lastSeen ?? now,
          extractionMethod: 'pdfjs-text-layer',
          extractionStatus: extraction.status,
          parserVersion: EXTRACTOR_VERSION,
          normalizationVersion: NORMALIZATION_VERSION,
        });
        if (version.inserted) report.persisted_versions += 1;

        if (
          await upsertSourceReference(sql, version.id, {
            url: doc.url,
            linkText: doc.linkText,
            sourceId: null,
          })
        ) {
          report.persisted_references += 1;
        }

        if (
          await upsertApplicability(sql, version.id, {
            scope: where.scope,
            programmeName: where.programmeName,
            streamId: where.streamId,
            schemeYear: doc.schemeYear,
            semesterFrom: doc.semesters?.[0] ?? null,
            semesterTo: doc.semesters?.[1] ?? null,
          })
        ) {
          report.persisted_applicability += 1;
        }

        for (const course of parsed.courses) {
          const key = [
            doc.schemeYear ?? 'unknown',
            where.programmeName ?? '',
            where.streamId ?? '',
            String(course.semester),
            course.code,
          ].join('|');
          const already = written.get(key);
          if (already !== undefined) {
            if (already.credits !== course.credits) {
              disagreements.push({
                code: course.code,
                semester: course.semester,
                a: already,
                b: { credits: course.credits, sha256 },
              });
            }
            continue;
          }
          written.set(key, { credits: course.credits, sha256 });

          const action = await upsertCourse(sql, {
            schemeYear: doc.schemeYear ?? 'unknown',
            programmeName: where.programmeName,
            streamId: where.streamId,
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
            category: null,
            sha256,
            sourcePage: course.page,
          });
          if (action === 'inserted') report.persisted_courses_inserted += 1;
          else if (action === 'updated') report.persisted_courses_updated += 1;
          else report.persisted_courses_unchanged += 1;
        }
      }

      for (const course of parsed.courses) {
        courses.push({
          schemeYear: doc.schemeYear ?? 'unknown',
          programme: where.programmeName ?? where.streamName,
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
        programme: where.programmeName ?? where.streamName,
        courses: parsed.courses.length,
      });
    }
  } finally {
    await sql?.end();
  }

  /* ---- 5. The artifact the app ships ------------------------------------ */

  const seen = new Map<string, CatalogueCourse>();
  for (const course of courses) {
    const key = [course.schemeYear, course.programme ?? '(common)', course.semester, course.code]
      .map(String)
      .join(' ');
    if (!seen.has(key)) seen.set(key, course);
  }
  report.normalized_courses = seen.size;

  const emit = flag('emit');
  if (emit !== null && !dryRun) {
    const catalogue: Catalogue = {
      normalizationVersion: NORMALIZATION_VERSION,
      generatedAt: now,
      courses: [...seen.values()].sort(
        (a, b) =>
          a.schemeYear.localeCompare(b.schemeYear) ||
          (a.programme ?? '').localeCompare(b.programme ?? '') ||
          a.semester - b.semester ||
          a.code.localeCompare(b.code),
      ),
      conflicts: [],
      aliases: [],
      documents,
    };
    const path = resolve(emit);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify(catalogue, null, 2), 'utf8');
    console.log(`\n  catalogue file  ${path}`);
  }

  /* ---- 6. Report -------------------------------------------------------- */

  console.log('\n  extraction');
  console.log(`    text             ${String(report.extracted)}`);
  console.log(`    no text layer    ${String(report.no_text_layer)}`);
  console.log(`    failed           ${String(report.extraction_failures)}`);
  report.conflicts = disagreements.length;
  if (disagreements.length > 0) {
    console.log('');
    console.log('  conflicts (two readings of one course disagree on credits)');
    for (const d of disagreements.slice(0, 10)) {
      console.log(
        `    ${d.code} sem ${String(d.semester)}: ${String(d.a.credits)} (${d.a.sha256.slice(0, 8)}) vs ${String(d.b.credits)} (${d.b.sha256.slice(0, 8)})`,
      );
    }
  }

  console.log('\n  catalogue');
  console.log(`    normalized       ${String(report.normalized_courses)}`);
  if (!dryRun) {
    console.log(`    versions new     ${String(report.persisted_versions)}`);
    console.log(`    references new   ${String(report.persisted_references)}`);
    console.log(`    applicability    ${String(report.persisted_applicability)}`);
    console.log(`    courses inserted ${String(report.persisted_courses_inserted)}`);
    console.log(`    courses updated  ${String(report.persisted_courses_updated)}`);
    console.log(`    courses same     ${String(report.persisted_courses_unchanged)}`);
  }

  if (!dryRun) {
    await writeFile(
      REPORT_PATH,
      JSON.stringify({ ...report, finishedAt: new Date().toISOString() }, null, 2),
      'utf8',
    );
    console.log(`\n  report          ${REPORT_PATH}`);
  }
  console.log('');
}

await main();
