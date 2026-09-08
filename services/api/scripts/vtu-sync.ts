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
  COURSE_ALIASES,
  optionGroupsOf,
  parseScheme,
  parseSyllabusDocument,
  type ParsedSyllabus,
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
import { resolveProgramme } from '../src/sources/programme-aliases.js';
import {
  upsertApplicability,
  upsertCourse,
  recordConflict,
  upsertDocumentVersion,
  upsertSourceReference,
  upsertStream,
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
    aliases_persisted: 0,
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
    schemeYear: string;
    programmeName: string | null;
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
      aliases: COURSE_ALIASES.map((alias) => ({
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
