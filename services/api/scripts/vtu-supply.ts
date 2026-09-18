/**
 * `pnpm vtu:supply` — put an official document somebody already holds into the
 * pipeline, without fetching anything.
 *
 * Authority: docs/41 §2 (Mode B) · docs/38 · `src/sources/acquire.ts`
 *
 *   pnpm vtu:supply --file ./34csbssch.pdf \
 *                   --url https://vtu.ac.in/pdf/2025syll3to8/34csbssch.pdf
 *   pnpm vtu:supply --file ./34csbssch.pdf --url https://… --dry-run
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS
 * ---------------------------------------------------------------------------
 *
 * `acquire.ts` has described two acquisition modes since it was written:
 *
 *     MODE A  authorized live source — the registry permits fetching
 *     MODE B  a document a person supplied, because it does not
 *
 * and says the difference is "ACQUISITION ONLY. What happens to the bytes
 * afterwards — hash, version, extract, normalize, validate, applicability — is
 * identical."
 *
 * That was true of the listing PAGE, which `vtu:sync --from` accepts, and
 * false of the documents. `store.put` had exactly one caller in the whole
 * repository, inside the live downloader. So Mode B could describe how a
 * document would be handled and offered no way to hand one over: the only
 * route to a document was the one the registry refuses, and a person holding
 * the official PDF was stuck.
 *
 * This is that door. It is not a second ingestion architecture (and must not
 * become one): it writes the same content-addressed store and the same
 * manifest the downloader writes, and everything downstream cannot tell where
 * the bytes came from except by reading the provenance that says so.
 *
 * ---------------------------------------------------------------------------
 * IT NEVER FETCHES, AND THAT IS THE POINT
 * ---------------------------------------------------------------------------
 *
 * There is no `fetch` in this file and there must never be one. The `--url` is
 * a PROVENANCE CLAIM about where the supplied bytes came from, recorded so the
 * document can be cited and later compared against the official copy. It is
 * not an instruction to go and get it, and this script would be pointless if
 * it were — the registry already refuses that, on purpose.
 *
 * Because the URL is a claim rather than something this script verifies, the
 * person running it is asserting it. That is exactly the Mode B bargain: the
 * human takes responsibility for acquisition, and the software takes
 * responsibility for never doing it silently.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { createLocalDocumentStore, sha256Of } from '../src/sources/document-store.js';
import {
  EMPTY_MANIFEST,
  looksLikePdf,
  recordSupplied,
  type Manifest,
} from '../src/sources/vtu-download.js';

const STORE_ROOT = resolve('../../.vtu-store/documents');
const MANIFEST_PATH = resolve('../../.vtu-store/manifest.json');

function flag(name: string): string | null {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? null : (process.argv[index + 1] ?? null);
}
const has = (name: string): boolean => process.argv.includes(`--${name}`);

/**
 * The URL must be VTU's own.
 *
 * Not a permission check — nothing is fetched — but this store holds VTU's
 * scheme and syllabus documents, and a row in it citing somebody else's site
 * would be a provenance record that cannot be checked against the publisher it
 * names. A document from another source belongs in another store.
 */
function checkUrl(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return 'Not a URL.';
  }
  if (parsed.protocol !== 'https:') return 'The official URL must be https.';
  if (!/(^|\.)vtu\.ac\.in$/i.test(parsed.hostname)) {
    return `Not a vtu.ac.in URL: ${parsed.hostname}`;
  }
  return null;
}

/**
 * Pages, counted from the bytes. §6 asks for it at capture rather than later.
 *
 * IT IS HANDED A COPY, AND THAT IS NOT DEFENSIVE PROGRAMMING. pdfjs takes
 * ownership of the buffer it is given and detaches it, so after this returns
 * the caller's array is length zero. The first run of this script reported
 * "bytes 0, pages unreadable" for a 246 571-byte PDF because of it — and the
 * `store.put` further down would have stored an empty document under the
 * correct hash, which is the kind of corruption that survives every later
 * check because the name still matches what was hashed before the damage.
 */
async function pageCountOf(bytes: Uint8Array): Promise<number | null> {
  /*
   * The loading TASK is what gets destroyed, not the document. Calling
   * `destroy()` on the document throws, and with the whole block inside one
   * `try` that cleanup failure was caught and reported as "unreadable" — for a
   * fourteen-page PDF whose page count had already been read successfully.
   *
   * So only the parse is guarded. A document this genuinely cannot open is
   * still stored, and extraction reports it as `no_text_layer` or `failed`
   * with a reason, which is a better place for that finding than here.
   */
  const task = getDocument({ data: new Uint8Array(bytes), useSystemFonts: true });
  try {
    const pdf = await task.promise;
    return pdf.numPages;
  } catch {
    return null;
  } finally {
    await task.destroy();
  }
}

async function main(): Promise<void> {
  const file = flag('file');
  const url = flag('url');

  if (file === null || url === null) {
    console.error(
      '\n  Usage: pnpm vtu:supply --file <path to the document> --url <the official VTU URL>\n\n' +
        '  Both are required. The URL is recorded as provenance; nothing is fetched.\n',
    );
    process.exitCode = 1;
    return;
  }

  const urlProblem = checkUrl(url);
  if (urlProblem !== null) {
    console.error(`\n  ${urlProblem}\n`);
    process.exitCode = 1;
    return;
  }

  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await readFile(file));
  } catch (error) {
    console.error(`\n  Cannot read ${file}: ${error instanceof Error ? error.message : ''}\n`);
    process.exitCode = 1;
    return;
  }

  /*
   * A PDF begins `%PDF-`. Checked here for the same reason the downloader
   * checks it: an HTML error page saved under a .pdf name is the common way a
   * "document" turns out not to be one, and storing it would put a row in the
   * catalogue's provenance chain that no extraction can ever read.
   */
  if (!looksLikePdf(bytes)) {
    console.error(`\n  ${basename(file)} does not begin with %PDF- — this is not a PDF.\n`);
    process.exitCode = 1;
    return;
  }

  const sha256 = sha256Of(bytes);
  const byteSize = bytes.byteLength;
  const pageCount = await pageCountOf(bytes);
  const capturedAt = new Date().toISOString();

  const manifest: Manifest = await readFile(MANIFEST_PATH, 'utf8')
    .then((raw) => JSON.parse(raw) as Manifest)
    .catch(() => EMPTY_MANIFEST);

  const { manifest: next, state } = recordSupplied(manifest, {
    sha256,
    byteSize,
    url,
    capturedAt,
    sourceFilename: basename(file),
    pageCount,
  });

  console.log('\nSUPPLIED OFFICIAL DOCUMENT — not a live automated fetch\n');
  console.log(`  file        ${basename(file)}`);
  console.log(`  url         ${url}`);
  console.log(`  sha256      ${sha256}`);
  console.log(`  bytes       ${String(byteSize)}`);
  console.log(`  pages       ${pageCount === null ? 'unreadable' : String(pageCount)}`);
  console.log(`  captured    ${capturedAt}`);
  console.log(`  outcome     ${state}`);

  if (state === 'changed') {
    /*
     * §7 and the September 2025 first-year circular: VTU replaced files in
     * place. Both binaries are kept, and which supersedes which is a question
     * for the documents themselves, not for whichever was supplied last.
     */
    console.log(
      '\n  This URL has served different bytes before. Both versions are kept;\n' +
        '  nothing is overwritten, and supersession is not inferred from order.',
    );
  }

  if (has('dry-run')) {
    console.log('\n  DRY RUN — nothing was written.\n');
    return;
  }

  await createLocalDocumentStore(STORE_ROOT).put(bytes);
  await mkdir(dirname(MANIFEST_PATH), { recursive: true });
  await writeFile(MANIFEST_PATH, JSON.stringify(next, null, 2), 'utf8');

  console.log(`\n  Stored. The manifest holds ${String(next.entries.length)} documents.`);
  console.log('  Next: pnpm vtu:normalize --scheme <year> --graph <graph.json>\n');
}

await main();
