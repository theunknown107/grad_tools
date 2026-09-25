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
 *   pnpm vtu:sync --scheme 2025 --from page.html --supplied-only  # no fetching
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
  COURSE_ALIASES,
  cycleGroupOf,
  optionGroupsOf,
  parseScheme,
  resolveFirstYearForStream,
  streamForProgramme,
  streamMembershipOf,
  type ParsedScheme,
  parseSyllabusDocument,
  type ParsedSyllabus,
  type Catalogue,
  courseKey,
  type CatalogueCourse,
  type PositionedText,
  type SchemePage,
} from '@gradtools/vtu-catalogue';
import { createLocalDocumentStore } from '../src/sources/document-store.js';
import {
  downloadAll,
  DEFAULT_DELAY_MS,
  EMPTY_MANIFEST,
  type DownloadState,
  type DownloadOutcome,
  type Manifest,
} from '../src/sources/vtu-download.js';
import {
  vtuSchemeAdapter,
  VTU_SCHEME_SOURCE_ID,
  type SchemeDocument,
} from '../src/sources/vtu-scheme.js';
import { requireFetchPermission } from '../src/sources/acquire.js';
import { validateCatalogue } from '../src/sources/catalogue-validate.js';
import { resolveProgramme } from '../src/sources/programme-aliases.js';
import {
  upsertApplicability,
  upsertCourse,
  recordConflict,
  upsertDocumentVersion,
  upsertSourceReference,
  upsertStream,
  upsertStreamProgramme,
  upsertAlias,
  upsertOptionGroup,
  upsertSyllabus,
  type UnresolvedField,
} from '../src/sources/catalogue-store.js';

/**
 * The document that establishes the one alias GradTools holds.
 *
 * Named explicitly rather than searched for: the citation is part of the fact,
 * and an alias attached to whatever document happened to be at hand is not
 * evidence of anything (§14).
 */
const ALIAS_EVIDENCE_URL = /2csbssyll\.pdf$/i;

/** Bumped when syllabus extraction changes; recorded on every module (§9). */
const SYLLABUS_PARSER_VERSION = '1.0.0';

const ROOT = 'https://vtu.ac.in/b-e-scheme-syllabus/';
const STORE_ROOT = resolve('../../.vtu-store/documents');
const MANIFEST_PATH = resolve('../../.vtu-store/manifest.json');
const CACHE_ROOT = resolve('../../.vtu-store/extractions');
const REPORT_PATH = resolve('../../.vtu-store/last-sync.json');
/**
 * One row per selected document, beside the counts.
 *
 * A separate file because it is a different KIND of thing: the report is a
 * tally a person reads, and this is the evidence behind every number in it.
 * Gitignored with the rest of the store — it names public VTU URLs and nothing
 * else, but it is generated, large, and belongs with the documents it
 * describes rather than in the repository (§20).
 */
const LEDGER_PATH = resolve('../../.vtu-store/last-sync-documents.json');

const EXTRACTOR_VERSION = '1.0.0';
/*
 * 1.1.0: the scheme reader accepts six-letter course codes, so rows like
 * `BMATEC301` that were invisible now normalize; and the listing's programme
 * column is read from the table header, so documents that were unplaced now
 * carry a programme. Both change what a document normalizes TO, which is what
 * this version is recorded beside every row for.
 */
/*
 * 1.2.0 adds `streamId` to every course and `schemeYear` to every alias. Both
 * are additive, so a reader of the older shape still works — a minor bump, by
 * the semver this field has used since it was introduced.
 */
const NORMALIZATION_VERSION = '1.2.0';

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

/**
 * WHAT BECAME OF ONE DOCUMENT.
 *
 * A run used to report download states as COUNTS and nothing else, so "failed
 * 4" named no URL and gave no reason, and the two `continue`s in the extract
 * loop dropped those same documents again in silence. A count cannot be acted
 * on: it says four sources are missing from the catalogue and not which four,
 * nor at which stage they were lost.
 *
 * So every SELECTED document gets one of these, whatever happens to it. The
 * fields are the vocabularies the pipeline already has — `DownloadState` from
 * the downloader and the extractor's own status — rather than a third status
 * system laid over them: a document has a download outcome and, if it got far
 * enough to have one, an extraction outcome, and the two answer different
 * questions.
 *
 * `extraction: null` is therefore not "extraction failed". It is "extraction
 * was never reached", and the download state above it says why.
 */
interface DocumentLedgerRow {
  readonly url: string;
  readonly linkText: string | null;
  readonly kind: string;
  readonly schemeYear: string | null;
  readonly programme: string | null;
  readonly scope: 'programme' | 'stream' | 'common' | 'unknown';
  readonly streamId: string | null;
  readonly download: DownloadState;
  readonly downloadReason: string | null;
  readonly sha256: string | null;
  readonly byteSize: number | null;
  readonly extraction: ExtractionStatus | null;
  /** Why nothing was extracted, where the download itself succeeded. */
  readonly lostAt: string | null;
  readonly courses: number;
  readonly syllabi: number;
}

/** A stable slug for a stream, from the label the source prints. */
/**
 * Whether an artifact for this scheme may be written.
 *
 * Opens a connection of its own rather than reusing the run's, because the run
 * closes its handle before the artifact is built and because the verdict must
 * come from the catalogue AS STORED — the same rows `vtu:validate` reads, not
 * whatever the in-memory pass happened to produce.
 *
 * WITHOUT A DATABASE THERE IS NO VERDICT, and no verdict is not a pass. A run
 * with no `DATABASE_URL` cannot check the thing it is about to publish, so it
 * refuses unless a human says otherwise.
 */
async function gateEmission(
  schemeYear: string | null,
  forced: boolean,
): Promise<{ allowed: boolean; reason: string }> {
  const url = process.env['DATABASE_URL'] ?? process.env['TEST_DATABASE_URL'] ?? null;
  if (url === null) {
    return forced
      ? { allowed: true, reason: 'FORCED: no database, so the catalogue was not validated' }
      : {
          allowed: false,
          reason:
            'no DATABASE_URL, so the catalogue this would publish cannot be validated. ' +
            'Set one, or pass --force to write it unvalidated.',
        };
  }

  const sql = postgres(url, { max: 1 });
  try {
    const result = await validateCatalogue(sql, { schemeYear });
    if (result.passed) {
      return {
        allowed: true,
        reason: `validation of the ${schemeYear ?? 'whole'} catalogue passed`,
      };
    }
    const failures = result.findings
      .filter((finding) => finding.severity === 'fail')
      .map((finding) => finding.message);
    const listed = failures.slice(0, 5).join('; ');
    return forced
      ? {
          allowed: true,
          reason: `FORCED past ${String(result.failures)} validation failure(s): ${listed}`,
        }
      : {
          allowed: false,
          reason:
            `validation of the ${schemeYear ?? 'whole'} catalogue FAILED with ` +
            `${String(result.failures)} failure(s): ${listed}. ` +
            'Fix them, or pass --force to publish a catalogue known to be wrong.',
        };
  } finally {
    await sql.end();
  }
}

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

/**
 * Every header field that did not resolve, and why (§5).
 *
 * An ambiguous reading keeps what was PRINTED. "Exam Hours 100" is in a real
 * laboratory syllabus, and storing it in the column would make an impossible
 * figure indistinguishable from an established one; storing nothing at all
 * would lose the evidence that the document says something odd.
 */
function unresolvedOf(read: ParsedSyllabus): Record<string, UnresolvedField> {
  const fields = {
    title: read.courseTitle,
    semester: read.semester,
    credits: read.credits,
    cieMarks: read.cieMarks,
    seeMarks: read.seeMarks,
    totalMarks: read.totalMarks,
    examHours: read.examHours,
    teachingHours: read.teachingHours,
  };
  const out: Record<string, UnresolvedField> = {};
  for (const [name, field] of Object.entries(fields)) {
    if (field.state === 'resolved') continue;
    out[name] =
      field.state === 'ambiguous' && field.value !== null
        ? { state: 'ambiguous', printed: field.value }
        : { state: 'unavailable' };
  }
  return out;
}

/**
 * The course code a syllabus document is FILED under, where its name is one.
 *
 * VTU names each first-year syllabus after the course it describes, so
 * `.../BMATS101.pdf` is the university stating an identity independently of
 * the header inside. Only an exact course-code filename counts — a
 * semester-wide document like `2csbssyll.pdf` names no single course, and
 * reading one out of it would be invention.
 */
function filedCode(url: string): string | null {
  const name =
    url
      .split('/')
      .pop()
      ?.replace(/\.pdf$/i, '') ?? '';
  return /^[A-Z]{2,5}\d{3}[A-Za-z]?$/.test(name) ? name : null;
}

async function main(): Promise<void> {
  const wantYear = flag('scheme');
  /*
   * `--programme CSBS` used to select NOTHING, silently: VTU's listing labels
   * the row "Computer Science & Business System", and an empty selection looks
   * exactly like a source with no documents. The alias table is explicit, and
   * an acronym that is not in it is an error rather than a guess (§4, §14).
   */
  const named = flag('programme');
  const resolved = named === null ? null : resolveProgramme(named);
  if (resolved !== null && 'error' in resolved) {
    console.error(`\n  ${resolved.error}\n`);
    process.exitCode = 1;
    return;
  }
  const wantProgramme = resolved === null ? null : resolved.match;
  const dryRun = has('dry-run');
  let emitRefused = false;
  let emitVerdict = '';
  const suppliedOnly = has('supplied-only');
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
    /*
     * Kept apart from the course counts. §44: discovered, downloaded,
     * extracted, normalized and persisted are five different numbers, and a
     * syllabus is not a course.
     */
    normalized_syllabi: 0,
    normalized_modules: 0,
    normalized_topics: 0,
    persisted_syllabi_inserted: 0,
    persisted_syllabi_updated: 0,
    persisted_syllabi_unchanged: 0,
    option_groups: 0,
    option_memberships: 0,
    conflicts_opened: 0,
    conflicts_existing: 0,
    /* The first year, resolved from the stream a programme is declared to be in. */
    first_year_resolved: 0,
    first_year_unresolved: 0,
    first_year_unmapped: 0,
    /* 'written' | 'forced' | 'refused' | 'not requested' */
    emit: 'not requested' as string,
    aliases_persisted: 0,
    conflicts: 0,
  };

  /* ---- 1. Discover ----------------------------------------------------- */

  const url = process.env['DATABASE_URL'] ?? process.env['TEST_DATABASE_URL'] ?? null;
  const sql = dryRun || url === null ? null : postgres(url, { max: 2 });

  const capture = flag('from');

  /*
   * THE GATE, BEFORE THE FETCH (§1, §4, §87).
   *
   * `--from` is Mode B: a listing somebody supplied, already on disk, and
   * nothing goes out over the network for it. Without it this reaches
   * vtu.ac.in, and reaching vtu.ac.in requires the registry to say so.
   *
   * It used to just fetch. `checkSourcePermission` was written and tested for
   * exactly this and had no callers outside its own test file.
   */
  if (capture === null) {
    await requireFetchPermission(sql, VTU_SCHEME_SOURCE_ID);
  }
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
  const graph = vtuSchemeAdapter.describe(raw, body);

  const selected = graph.filter(
    (doc) =>
      /*
       * Syllabus documents as well as schemes. A scheme says a course exists
       * and what it is worth; only its syllabus says what is IN it, and §3
       * makes that structure the point of this phase rather than a later
       * extra.
       */
      (doc.kind === 'scheme' || doc.kind === 'syllabus') &&
      (wantYear === null || doc.schemeYear === wantYear) &&
      (wantProgramme === null ||
        doc.common ||
        (doc.programme ?? '').toLowerCase().includes(wantProgramme.toLowerCase())),
  );
  report.selected = selected.length;

  console.log(`\nVTU sync${dryRun ? ' (DRY RUN)' : ''}`);
  console.log(`  discovered      ${String(raw.length)} PDF URLs on 1 page`);
  const schemeCount = selected.filter((doc) => doc.kind === 'scheme').length;
  console.log(
    `  selected        ${String(schemeCount)} scheme, ` +
      `${String(selected.length - schemeCount)} syllabus documents\n`,
  );

  /* ---- 2. Download ----------------------------------------------------- */

  /*
   * THE GATE AGAIN, BECAUSE `--from` TURNED THE FIRST ONE OFF.
   *
   * The check above is skipped when a captured listing is supplied, which is
   * right for the LISTING — nothing is fetched to read it. It was also the
   * script's only gate call, and the step below fetches every PDF the listing
   * names. So `vtu:sync --scheme 2025 --from page.html` would have downloaded
   * 192 documents from vtu.ac.in with no permission check at all, through the
   * flag whose whole purpose is not fetching.
   *
   * A dry run is exempt because it genuinely fetches nothing: `downloadAll`
   * reports what it WOULD do and opens no socket. That is what makes building
   * the discovery graph offline possible without asking for permission the run
   * does not need.
   */
  if (!dryRun && !suppliedOnly) {
    await requireFetchPermission(sql, VTU_SCHEME_SOURCE_ID);
  }

  const store = createLocalDocumentStore(STORE_ROOT);
  const manifest: Manifest = await readFile(MANIFEST_PATH, 'utf8')
    .then((text) => JSON.parse(text) as Manifest)
    .catch(() => EMPTY_MANIFEST);

  /*
   * MODE B FOR THE PIPELINE, NOT JUST FOR THE BYTES.
   *
   * `pnpm vtu:supply` gives a person a way to put an official document into
   * the store without fetching it. Nothing could then USE it: the only route
   * from the store to the database ran through here, and the gate above stands
   * in front of the downloader unconditionally, so a supplied document could
   * be stored, hashed and extracted and never reach a catalogue. The gate was
   * right and the pipeline had no door.
   *
   * `--supplied-only` is that door. It does not weaken the gate — it removes
   * the reason for one, by not calling the downloader at all. Every document
   * is taken from the manifest and the store as they already stand, and one
   * that was never supplied is reported as such rather than fetched.
   *
   * THE STRUCTURE IS THE GUARANTEE. This branch does not reach `downloadAll`,
   * so there is no option it could pass wrongly and no socket it could open;
   * the only fetch in this file is the listing, which `--from` replaces and
   * which keeps its own gate above.
   */
  const held = new Map(
    manifest.entries.flatMap((entry) => entry.urls.map((url) => [url, entry] as const)),
  );
  const { outcomes, manifest: nextManifest } = suppliedOnly
    ? {
        manifest,
        outcomes: selected.map((doc): DownloadOutcome => {
          const entry = held.get(doc.url);
          return entry === undefined
            ? {
                url: doc.url,
                state: 'failed',
                sha256: null,
                byteSize: null,
                reason:
                  'No bytes for this URL have been supplied. `pnpm vtu:supply --file <path> --url <this url>` puts an official document into the store without fetching it.',
              }
            : {
                url: doc.url,
                state: 'already_present',
                sha256: entry.sha256,
                byteSize: entry.byteSize,
                reason: null,
              };
        }),
      }
    : await downloadAll(
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
  const downloadByUrl = new Map<string, (typeof outcomes)[number]>();
  for (const outcome of outcomes) {
    report.download[outcome.state] = (report.download[outcome.state] ?? 0) + 1;
    downloadByUrl.set(outcome.url, outcome);
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
    schemeYear: string;
    programmeName: string | null;
    code: string;
    semester: number;
    a: { credits: number; sha256: string };
    b: { credits: number; sha256: string };
  }[] = [];

  const courses: CatalogueCourse[] = [];
  const ledger: DocumentLedgerRow[] = [];

  /*
   * THE FIRST YEAR IS RESOLVED AFTER THE LOOP, BECAUSE IT TAKES TWO DOCUMENTS.
   *
   * A first-year document prints a template — `1BMATx101` — and the tables that
   * resolve it, but it never says which PROGRAMME is reading it. The programme
   * comes from the scheme documents processed alongside it. So the evidence is
   * gathered here and the resolution runs once both halves are in hand.
   */
  const firstYearDocuments: {
    readonly sha256: string;
    readonly url: string;
    readonly schemeYear: string;
    readonly pages: readonly SchemePage[];
    readonly parsed: ParsedScheme;
    readonly cycle: string | null;
  }[] = [];
  const programmesSeen = new Set<string>();
  const firstYearUnresolved: string[] = [];
  const documents: Catalogue['documents'] = [];
  const now = new Date().toISOString();

  /* Opened at the top now: the gate is consulted BEFORE anything is fetched. */
  if (!dryRun && sql === null) {
    /*
     * The artifact is no longer written regardless: `--emit` is gated on the
     * requested scheme validating, and with no database there is nothing to
     * validate it against.
     */
    console.log(
      '\n  NOT PERSISTING: no DATABASE_URL.' +
        (flag('emit') === null
          ? ''
          : ' --emit will refuse too, since the catalogue cannot be validated.'),
    );
  }

  try {
    for (const doc of selected) {
      const outcome = downloadByUrl.get(doc.url);
      const where = applicabilityOf(doc);
      const base = {
        url: doc.url,
        linkText: doc.linkText,
        kind: doc.kind,
        schemeYear: doc.schemeYear,
        programme: where.programmeName,
        scope: where.scope,
        streamId: where.streamId,
        download: outcome?.state ?? 'failed',
        downloadReason: outcome?.reason ?? 'This URL was never attempted.',
        sha256: outcome?.sha256 ?? null,
        byteSize: outcome?.byteSize ?? null,
      } as const;

      /*
       * A DOCUMENT THAT GOT NO FURTHER STILL GETS A ROW (§9, §18).
       *
       * These two used to be bare `continue`s, and they are the exact stage at
       * which the run's four failed downloads disappeared: the counter said
       * four had failed, and then nothing said which, or why, or that they had
       * also been skipped here.
       */
      const sha256 = byUrl.get(doc.url);
      if (sha256 === undefined) {
        ledger.push({
          ...base,
          extraction: null,
          lostAt: 'no bytes were retrieved',
          courses: 0,
          syllabi: 0,
        });
        continue;
      }
      const bytes = await store.get(sha256);
      if (bytes === null) {
        ledger.push({
          ...base,
          sha256,
          extraction: null,
          lostAt: 'the manifest names bytes the store does not hold',
          courses: 0,
          syllabi: 0,
        });
        continue;
      }

      const extraction = await extract(sha256, bytes);
      if (extraction.status === 'text') report.extracted += 1;
      else if (extraction.status === 'no_text_layer') report.no_text_layer += 1;
      else report.extraction_failures += 1;

      const readable = extraction.status === 'text';
      const parsed =
        readable && doc.kind === 'scheme'
          ? parseScheme(extraction.pages)
          : { courses: [], rejected: [], semesters: [], programme: null, schemeYear: null };
      const syllabi =
        readable && doc.kind === 'syllabus' ? parseSyllabusDocument(extraction.pages) : [];
      report.normalized_syllabi += syllabi.length;
      for (const read of syllabi) {
        report.normalized_modules += read.modules.length;
        for (const module of read.modules) report.normalized_topics += module.topics.length;
      }

      /*
       * What this document actually yielded. A scheme that extracted cleanly
       * and produced no courses is a NORMALIZATION gap, and it is only visible
       * as one because the two numbers are recorded side by side (§43).
       */
      ledger.push({
        ...base,
        sha256,
        extraction: extraction.status,
        lostAt: readable ? null : 'the PDF carries no text layer',
        courses: parsed.courses.length,
        syllabi: syllabi.length,
      });

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

        /*
         * A syllabus keeps the identity its own document states. It is NOT
         * matched to a course row first: the two come from different
         * documents and the documents disagree — the scheme's option list
         * writes BCSL358D where the syllabus writes BCS358D. Forcing a match
         * here would discard one document's reading to satisfy the other's,
         * and §22 records disagreements rather than resolving them.
         */
        for (const read of syllabi) {
          if (read.courseCode.value === null) continue;
          const action = await upsertSyllabus(sql, {
            schemeYear: doc.schemeYear ?? 'unknown',
            programmeName: where.programmeName,
            streamId: where.streamId,
            semester: read.semester.value,
            code: read.courseCode.value,
            title: read.courseTitle.value,
            credits: read.credits.state === 'resolved' ? read.credits.value : null,
            cieMarks: read.cieMarks.state === 'resolved' ? read.cieMarks.value : null,
            seeMarks: read.seeMarks.state === 'resolved' ? read.seeMarks.value : null,
            totalMarks: read.totalMarks.state === 'resolved' ? read.totalMarks.value : null,
            examHours: read.examHours.state === 'resolved' ? read.examHours.value : null,
            teachingHours:
              read.teachingHours.state === 'resolved' ? read.teachingHours.value : null,
            unresolved: unresolvedOf(read),
            objectives: read.objectives,
            outcomes: read.outcomes,
            sha256,
            sourcePage: read.pages[0] ?? 1,
            parserVersion: SYLLABUS_PARSER_VERSION,
            extractionMethod: 'pdfjs-text-layer',
            modules: read.modules.map((module) => ({
              number: module.number,
              title: module.title,
              hours: module.hours,
              content: module.content,
              sourcePage: module.page,
              topics: module.topics.map((topic) => ({
                position: topic.order,
                title: topic.title,
                sourcePage: topic.page,
              })),
            })),
          });
          if (action === 'inserted') report.persisted_syllabi_inserted += 1;
          else if (action === 'updated') report.persisted_syllabi_updated += 1;
          else report.persisted_syllabi_unchanged += 1;
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
                schemeYear: doc.schemeYear ?? 'unknown',
                programmeName: where.programmeName,
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

        /*
         * The choices this document offers. Written from the rows it printed,
         * not from the courses already stored: a group is a reading of ONE
         * document, and gathering it across documents would invent options no
         * single scheme ever listed together (§6).
         */
        for (const group of optionGroupsOf(parsed.courses)) {
          await upsertOptionGroup(sql, {
            schemeYear: doc.schemeYear ?? 'unknown',
            programmeName: where.programmeName,
            streamId: where.streamId,
            semester: group.semester,
            slotCode: group.slotCode,
            kind: group.kind,
            credits: group.credits,
            sha256,
            sourcePage: group.page,
            members: group.members.map((member) => ({
              code: member.code,
              title: member.title,
              credits: member.credits,
              sourcePage: member.page,
            })),
          });
          report.option_groups += 1;
          report.option_memberships += group.members.length;
        }

        /*
         * A SYLLABUS THAT NAMES A CODE ITS OWN FILE IS NOT FILED UNDER.
         *
         * VTU files each first-year syllabus under the course code —
         * `BMATS101.pdf` describes BMATS101 — so the filename is a second,
         * independent statement of identity. Two of them disagree with their
         * own contents: `BCHEC102.pdf` and `BCHEE102.pdf` print
         * "Course Code: BCHEC202 /202" in their headers.
         *
         * Neither reading is corrected here. §16: the disagreement is recorded
         * with both readings and left OPEN, because nothing in this pipeline
         * has the standing to decide which of the university's own statements
         * about its own course is the mistaken one.
         */
        for (const read of syllabi) {
          const printed = read.courseCode.value;
          const filed = filedCode(doc.url);
          if (printed === null || filed === null || filed === printed) continue;
          const outcome = await recordConflict(sql, {
            entityType: 'syllabus',
            schemeYear: doc.schemeYear ?? 'unknown',
            programmeName: where.programmeName,
            semester: read.semester.value,
            code: filed,
            field: 'code',
            readings: [
              { value: printed, sha256, sourcePage: read.courseCode.page },
              { value: filed, sha256, sourcePage: null },
            ],
          });
          if (outcome === 'opened') report.conflicts_opened += 1;
          else report.conflicts_existing += 1;
        }
      }

      if (where.scope === 'programme' && where.programmeName !== null && doc.kind === 'scheme') {
        programmesSeen.add(where.programmeName);
      }
      /*
       * A first-year document is one that declares which programmes each stream
       * contains. That table is the thing this resolution turns on, so its
       * presence is what marks the document rather than a filename or a
       * semester number.
       */
      if (readable && doc.kind === 'scheme' && streamMembershipOf(extraction.pages).length > 0) {
        firstYearDocuments.push({
          sha256,
          url: doc.url,
          schemeYear: doc.schemeYear ?? 'unknown',
          pages: extraction.pages,
          parsed,
          cycle: cycleGroupOf(extraction.pages),
        });
      }

      for (const course of parsed.courses) {
        courses.push({
          schemeYear: doc.schemeYear ?? 'unknown',
          programme: where.programmeName ?? where.streamName,
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

    /* ---- 3b. The first year, resolved per programme --------------------- */

    /*
     * A FIRST-YEAR DOCUMENT DESCRIBES A TEMPLATE; A PROGRAMME READS IT.
     *
     * The placeholder rows (`1BMATx101`) carry the credits, the options table
     * names a stream against each concrete code, and the membership table says
     * which programmes each stream contains. None of that is a guess and all of
     * it is printed, so the chain is walked end to end:
     *
     *     programme  ->  stream  ->  concrete code  ->  credits from the slot
     *
     * THE CYCLE IS PART OF THE IDENTITY. Both first-year documents resolve
     * semester I's mathematics to the same course and its science to different
     * ones, because they describe the two alternative cycles a student picks
     * between. Stored under one stream they would make a semester that requires
     * both physics AND chemistry, so each cycle gets its own stream identity
     * and a caller is told which it is looking at.
     */
    for (const firstYear of firstYearDocuments) {
      const memberships = streamMembershipOf(firstYear.pages);
      for (const programmeName of programmesSeen) {
        const membership = streamForProgramme(memberships, programmeName);
        if (membership === null) {
          report.first_year_unmapped += 1;
          continue;
        }
        const resolution = resolveFirstYearForStream(firstYear.pages, firstYear.parsed, membership);
        report.first_year_resolved += resolution.resolved.length;
        report.first_year_unresolved += resolution.unresolved.length;
        for (const slot of resolution.unresolved) {
          firstYearUnresolved.push(
            `${firstYear.url.split('/').pop() ?? ''} ${membership.abbreviation} sem ${String(slot.semester)} ${slot.slotCode}: ${slot.reason}`,
          );
        }
        if (resolution.resolved.length === 0) continue;

        const streamId = streamIdFor(
          `${membership.abbreviation} ${firstYear.cycle ?? 'first year'}`,
        );
        /*
         * The stream and its programmes are DATABASE records; the artifact
         * carries the id on each course instead. A run with no database still
         * emits a correct catalogue, which is what `--emit` is for.
         */
        if (sql !== null) {
          await upsertStream(sql, {
            id: streamId,
            name:
              firstYear.cycle === null
                ? membership.streamName
                : `${membership.streamName} — ${firstYear.cycle}`,
            sourceUrl: firstYear.url,
          });
          for (const programme of membership.programmes) {
            await upsertStreamProgramme(sql, {
              streamId,
              programmeCode: programme.code,
              programmeName: programme.name,
              sourceUrl: firstYear.url,
            });
          }
        }

        for (const resolved of resolution.resolved) {
          const key = [
            firstYear.schemeYear,
            '',
            streamId,
            String(resolved.semester),
            resolved.code,
          ].join('|');
          if (written.has(key)) continue;
          written.set(key, { credits: resolved.credits, sha256: firstYear.sha256 });

          /*
           * THE SHIPPED ARTIFACT GETS THE SAME ROW THE DATABASE DOES.
           *
           * This used to write only to the database, and the emitted catalogue
           * was built from a separate collection the resolution never reached.
           * So the artifact carried the first-year PLACEHOLDERS — `1BMATX101`,
           * which no student's result card ever prints — and not the concrete
           * courses they resolve to. A 2025 first-year card would have matched
           * nothing at all, against a catalogue that appeared to cover the
           * semester.
           */
          courses.push({
            schemeYear: firstYear.schemeYear,
            programme: null,
            streamId,
            semester: resolved.semester,
            code: resolved.code,
            title: resolved.title,
            credits: resolved.credits,
            creditBasis: 'slot',
            relatedCode: resolved.slotCode,
            provenance: {
              documentSha256: firstYear.sha256,
              sourceUrl: firstYear.url,
              sourcePage: resolved.page,
              parserVersion: EXTRACTOR_VERSION,
              retrievedAt: now,
            },
          });

          if (sql === null) continue;
          const action = await upsertCourse(sql, {
            schemeYear: firstYear.schemeYear,
            programmeName: null,
            streamId,
            semester: resolved.semester,
            code: resolved.code,
            title: resolved.title,
            credits: resolved.credits,
            /* The placeholder row is where the figure is printed. */
            creditBasis: 'slot',
            relatedCode: resolved.slotCode,
            category: null,
            sha256: firstYear.sha256,
            sourcePage: resolved.page,
          });
          if (action === 'inserted') report.persisted_courses_inserted += 1;
          else if (action === 'updated') report.persisted_courses_updated += 1;
          else report.persisted_courses_unchanged += 1;
        }
      }
    }

    /*
     * PERSIST THE DISAGREEMENT, do not merely print it.
     *
     * Two readings of one course that differ on credits used to be reported to
     * the terminal and then forgotten, so the durable catalogue looked settled
     * when it was not. Both readings are stored against the documents that made
     * them, and the conflict stays OPEN: §18 allows nothing here to resolve it,
     * because "the second document also said something" is not evidence about
     * which document is right.
     */
    if (sql !== null) {
      for (const d of disagreements) {
        const outcome = await recordConflict(sql, {
          entityType: 'course',
          schemeYear: d.schemeYear,
          programmeName: d.programmeName,
          semester: d.semester,
          code: d.code,
          field: 'credits',
          readings: [
            { value: String(d.a.credits), sha256: d.a.sha256, sourcePage: null },
            { value: String(d.b.credits), sha256: d.b.sha256, sourcePage: null },
          ],
        });
        if (outcome === 'opened') report.conflicts_opened += 1;
        else report.conflicts_existing += 1;
      }
    }

    /*
     * THE ALIAS TABLE, PERSISTED (§11).
     *
     * It used to live only in the web app, where the crawler and the database
     * could not see it — an authoritative academic fact held by the frontend
     * alone. It is written here from the same table the app reads, against the
     * document that establishes it, so `vtu:validate` can check it and a query
     * can join through it.
     *
     * The alias is stored only when its evidence document is actually held.
     * Writing an equivalence whose citation we cannot produce would be the one
     * thing §14 forbids: an alias nobody can check.
     */
    if (sql !== null) {
      for (const alias of COURSE_ALIASES) {
        const evidence = [...bySha.entries()].find(([, entry]) =>
          entry.urls.some((entryUrl) => ALIAS_EVIDENCE_URL.test(entryUrl)),
        );
        if (evidence === undefined) continue;
        await upsertAlias(sql, {
          schemeYear: alias.schemeYear,
          variantCode: alias.variant,
          canonicalCode: alias.canonical,
          title: alias.title,
          reason: alias.evidence,
          sha256: evidence[0],
          sourcePage: null,
        });
        report.aliases_persisted += 1;
      }
    }
  } finally {
    await sql?.end();
  }

  /* ---- 5. The artifact the app ships ------------------------------------ */

  /*
   * THE ARTIFACT'S IDENTITY MUST BE THE DATABASE'S IDENTITY.
   *
   * `catalogue_courses` is unique on (scheme, programme, stream, semester,
   * code) and this map was unique on the same thing WITHOUT the stream — so
   * the two first-year cycles, which differ only by stream, collapsed into one
   * another here. The physics cycle's `1BMATS101` and the chemistry cycle's
   * are two rows in the database and were one row in the artifact, and the
   * science that differs between them landed in a single semester-I namespace
   * that demanded both.
   */
  const seen = new Map<string, CatalogueCourse>();
  for (const course of courses) {
    const key = courseKey(
      course.schemeYear,
      course.programme,
      course.semester,
      course.code,
      course.streamId ?? null,
    );
    if (!seen.has(key)) seen.set(key, course);
  }
  report.normalized_courses = seen.size;

  const emit = flag('emit');
  if (emit !== null && !dryRun) {
    /*
     * AN ARTIFACT IS A PUBLICATION, AND IT IS GATED ON THE SCHEME IT CLAIMS.
     *
     * Writing one used to need nothing but the flag. A catalogue that fails
     * its own validation could be emitted, committed and shipped, and the
     * failure lived only in a terminal nobody kept — which is the exact shape
     * of defect this pipeline exists to prevent.
     *
     * The scheme VALIDATED IS THE SCHEME REQUESTED. Not "the last run", not
     * "the database as a whole": `--scheme 2025 --emit` validates 2025, and a
     * 2022 catalogue passing tells it nothing.
     *
     * `--force` exists because a human may have a reason, and it is loud,
     * deliberate, and recorded in the run report. It overrides the validation
     * verdict and NOTHING else — the source gate above is not reachable from
     * here and is not affected by it.
     */
    const verdict = await gateEmission(wantYear, has('force'));
    emitVerdict = verdict.reason;
    if (!verdict.allowed) {
      console.error(`\n  REFUSING TO EMIT — ${verdict.reason}\n`);
      report.emit = 'refused';
      process.exitCode = 1;
      emitRefused = true;
    }
  }
  if (emit !== null && !dryRun && !emitRefused) {
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
      conflicts: disagreements.map((d) => ({
        schemeYear: d.schemeYear,
        programme: d.programmeName,
        semester: d.semester,
        code: d.code,
        field: 'credits' as const,
        readings: [
          { value: String(d.a.credits), documentSha256: d.a.sha256 },
          { value: String(d.b.credits), documentSha256: d.b.sha256 },
        ],
      })),
      /*
       * The shipped catalogue carries the alias table too, so an offline app
       * resolves BCSL358D without a database and without a copy of the table
       * of its own (§11, §38).
       */
      /*
       * ONLY THIS SCHEME'S ALIASES, AND EACH ONE SAYS WHICH SCHEME.
       *
       * This emitted the whole table regardless of `--scheme`, and
       * `CatalogueAlias` had no year to put on them, so a 2025 artifact
       * carried the 2022 equivalence `BCSL358D` -> `BCS358D` — whose own
       * evidence line cites the 2022 CSBS syllabus — with nothing downstream
       * able to tell it did not belong. An alias is a statement about one
       * scheme's codes; it travels with its year or it does not travel.
       *
       * A run with no `--scheme` is asking for everything, and gets it: the
       * year on each row is what keeps that honest.
       */
      aliases: COURSE_ALIASES.filter(
        (alias) => wantYear === null || alias.schemeYear === wantYear,
      ).map((alias) => ({
        schemeYear: alias.schemeYear,
        variant: alias.variant,
        canonical: alias.canonical,
        title: alias.title,
        evidence: alias.evidence,
      })),
      documents,
    };
    const path = resolve(emit);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify(catalogue, null, 2), 'utf8');
    report.emit = has('force') ? 'forced' : 'written';
    console.log(`\n  catalogue file  ${path}`);
    console.log(`  emit            ${report.emit} — ${emitVerdict}`);
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
    console.log('  first year');
    console.log(`    resolved         ${String(report.first_year_resolved)}`);
    console.log(`    unresolved       ${String(report.first_year_unresolved)}`);
    console.log(`    programme unmapped ${String(report.first_year_unmapped)}`);
    for (const line of firstYearUnresolved.slice(0, 12)) console.log(`      ${line}`);
  }

  /*
   * Its own block. §44: a syllabus is not a course, and "62 normalized" must
   * never be readable as 62 of whichever the reader had in mind.
   */
  console.log('\n  syllabus');
  console.log(`    syllabi          ${String(report.normalized_syllabi)}`);
  console.log(`    modules          ${String(report.normalized_modules)}`);
  console.log(`    topics           ${String(report.normalized_topics)}`);
  if (sql !== null) {
    console.log(`    syllabi new      ${String(report.persisted_syllabi_inserted)}`);
    console.log(`    syllabi updated  ${String(report.persisted_syllabi_updated)}`);
    console.log(`    syllabi same     ${String(report.persisted_syllabi_unchanged)}`);
  }

  console.log('  options');
  console.log(`    groups           ${String(report.option_groups)}`);
  console.log(`    memberships      ${String(report.option_memberships)}`);
  if (sql !== null) {
    console.log('  conflicts');
    console.log(`    newly opened     ${String(report.conflicts_opened)}`);
    console.log(`    already open     ${String(report.conflicts_existing)}`);
  }

  /*
   * WHERE THE SOURCES THAT DID NOT ARRIVE WENT.
   *
   * Printed, not merely written, because a run that loses documents in silence
   * is the failure this ledger exists to make impossible. A clean run prints
   * nothing here.
   */
  const lost = ledger.filter((row) => row.lostAt !== null);
  if (lost.length > 0) {
    console.log('\n  sources that produced nothing');
    for (const row of lost.slice(0, 12)) {
      console.log(`    ${row.download.padEnd(16)} ${row.lostAt ?? ''}`);
      console.log(`      ${row.url}`);
      if (row.downloadReason !== null) console.log(`      ${row.downloadReason}`);
    }
    if (lost.length > 12) console.log(`    … and ${String(lost.length - 12)} more, in the ledger`);
  }

  if (!dryRun) {
    await writeFile(
      REPORT_PATH,
      JSON.stringify({ ...report, finishedAt: new Date().toISOString() }, null, 2),
      'utf8',
    );
    await writeFile(LEDGER_PATH, JSON.stringify(ledger, null, 2), 'utf8');
    console.log(`\n  report          ${REPORT_PATH}`);
    console.log(`  documents       ${LEDGER_PATH}`);
  }
  console.log('');
}

await main();
