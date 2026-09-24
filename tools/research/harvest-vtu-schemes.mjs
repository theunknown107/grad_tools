/**
 * Harvest official VTU scheme PDFs, with provenance.
 *
 * Research tooling. Nothing in the application imports it, and it writes only
 * to docs/research/ and a local cache.
 *
 * For every PDF: download (cached), sha256, extract text with the SAME pdfjs
 * build the product parses result cards with, record page count and the
 * retrieval timestamp. A document that fails extraction is RECORDED as failed,
 * never substituted with a third-party value.
 *
 *   cd apps/web && node ../../tools/research/harvest-vtu-schemes.mjs
 *
 * (run from apps/web so pdfjs-dist resolves)
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

/*
 * Resolve pdfjs from the WORKING DIRECTORY (apps/web), not from this file.
 * The point is to use the exact build the product parses result cards with,
 * rather than installing a second PDF stack for research.
 */
const requireFromCwd = createRequire(resolve(process.cwd(), 'package.json'));
const { getDocument } = await import(
  pathToFileURL(requireFromCwd.resolve('pdfjs-dist/legacy/build/pdf.mjs')).href
);

const ROOT = resolve(process.cwd(), '../..');
const CACHE = resolve(ROOT, '.vtu-cache');
const OUT = resolve(ROOT, 'docs/research');

/**
 * The official documents this pass targets.
 *
 * `scheme` and `programme` are taken from the VTU index page's own link text,
 * not inferred from the filename. `semesters` likewise.
 */
const TARGETS = [
  // ---- 2022 scheme, semesters 3-8: where the 259 missing codes live -------
  ['2022', 'Computer Science & Engineering', '3-8', 'https://vtu.ac.in/pdf/2022_3to8/38csesch.pdf'],
  ['2022', 'Information Science & Engineering', '3-8', 'https://vtu.ac.in/pdf/2022_3to8/38issch.pdf'],
  ['2022', 'Computer Science (CS)', '3-8', 'https://vtu.ac.in/pdf/2022_3to8/38cssch.pdf'],
  ['2022', 'Computer Engineering', '3-8', 'https://vtu.ac.in/pdf/2022_3to8/38cesch.pdf'],
  ['2022', 'AI & Data Science', '3-8', 'https://vtu.ac.in/pdf/2022_3to8/38aidssch.pdf'],
  ['2022', 'AI & Machine Learning', '3-8', 'https://vtu.ac.in/pdf/2022_3to8/38aimlsch.pdf'],
  ['2022', 'Computer & Communication Engineering', '3-8', 'https://vtu.ac.in/pdf/2022_3to8/38ccesch.pdf'],
  ['2022', 'Computer Science & Design', '3-8', 'https://vtu.ac.in/pdf/2022_3to8/38csdsch.pdf'],
  ['2022', 'Data Science', '3-8', 'https://vtu.ac.in/pdf/2022_3to8/38dssch.pdf'],
  ['2022', 'Electronics & Communication', '3-4', 'https://vtu.ac.in/pdf/2022_3to8/ecesch.pdf'],
  ['2022', 'Electronics & Communication', '5-8', 'https://vtu.ac.in/pdf/2022_3to8/5ecesch.pdf'],
  ['2022', 'Electrical & Electronics', '3-4', 'https://vtu.ac.in/pdf/2022_3to8/34eesch.pdf'],
  ['2022', 'Electrical & Electronics', '5-8', 'https://vtu.ac.in/pdf/2022_3to8/58eesch.pdf'],
  ['2022', 'Mechanical Engineering', '3-4', 'https://vtu.ac.in/pdf/2022_3to8/mecsch.pdf'],
  ['2022', 'Mechanical Engineering', '5-8', 'https://vtu.ac.in/pdf/2022_3to8/58mecsch.pdf'],
  ['2022', 'Civil Engineering', '3-4', 'https://vtu.ac.in/pdf/2022_3to8/civsch.pdf'],
  ['2022', 'Civil Engineering', '5-8', 'https://vtu.ac.in/pdf/2022_3to8/58civsch.pdf'],
  // ---- 2022 scheme, semesters 1-2: streams GradTools has not read --------
  ['2022', 'Electrical Streams', '1-2', 'https://vtu.ac.in/pdf/2022syll/elecsch.pdf'],
  ['2022', 'Mechanical Streams', '1-2', 'https://vtu.ac.in/pdf/2022syll/mechsch.pdf'],
  // ---- 2025 scheme ------------------------------------------------------
  ['2025', 'Common to all Engineering (Physics Cycle)', '1-2', 'https://vtu.ac.in/pdf/UG2024/phycyc.pdf'],
  ['2025', 'Common to all Engineering (Chemistry Cycle)', '1-2', 'https://vtu.ac.in/pdf/UG2024/chemcyc.pdf'],
  ['2025', 'Computer Science & Engineering', '3-4', 'https://vtu.ac.in/pdf/2025syll3to8/34csesch.pdf'],
  ['2025', 'Information Science & Engineering', '3-4', 'https://vtu.ac.in/pdf/2025syll3to8/34issch.pdf'],
  ['2025', 'Electronics & Communication', '3-4', 'https://vtu.ac.in/pdf/2025syll3to8/34ecsch.pdf'],
  ['2025', 'Electrical & Electronics', '3-4', 'https://vtu.ac.in/pdf/2025syll3to8/34eeesch.pdf'],
  ['2025', 'Mechanical Engineering', '3-4', 'https://vtu.ac.in/pdf/2025syll3to8/34mecsch.pdf'],
  ['2025', 'Civil Engineering', '3-4', 'https://vtu.ac.in/pdf/2025syll3to8/34civilsch.pdf'],
  ['2025', 'AI & Machine Learning', '3-4', 'https://vtu.ac.in/pdf/2025syll3to8/34aimlsch.pdf'],
  ['2025', 'AI & Data Science', '3-4', 'https://vtu.ac.in/pdf/2025syll3to8/34aidssch.pdf'],
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchCached(url) {
  const name = url.replace(/^https?:\/\//, '').replace(/[^\w.-]/g, '_');
  const file = join(CACHE, name);
  if (existsSync(file)) return { file, bytes: (await stat(file)).size, cached: true };
  const res = await fetch(url, { headers: { 'user-agent': 'GradToolsResearch/1.0' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await writeFile(file, buf);
  await sleep(1000); // rate limit: one request per second
  return { file, bytes: buf.length, cached: false };
}

async function extract(file) {
  const data = new Uint8Array(await readFile(file));
  const doc = await getDocument({ data, useSystemFonts: true }).promise;
  const pages = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    pages.push(content.items.map((i) => i.str).join(' ').replace(/[ \t]+/g, ' '));
  }
  return { pageCount: doc.numPages, pages };
}

await mkdir(CACHE, { recursive: true });
await mkdir(join(CACHE, 'text'), { recursive: true });

const records = [];
for (const [scheme, programme, semesters, url] of TARGETS) {
  const rec = { scheme, programme, semesters, url, retrievedAt: new Date().toISOString() };
  try {
    const { file, bytes, cached } = await fetchCached(url);
    rec.bytes = bytes;
    rec.cached = cached;
    rec.sha256 = createHash('sha256').update(await readFile(file)).digest('hex');
    const { pageCount, pages } = await extract(file);
    rec.pageCount = pageCount;
    const text = pages.map((t, i) => `\n===== PAGE ${i + 1} =====\n${t}`).join('\n');
    rec.chars = text.length;
    /* An image-only scan extracts as near-nothing. Record it, never fake it. */
    rec.status = text.replace(/=====[^=]*=====/g, '').trim().length < 200
      ? 'EXTRACTION_EMPTY (likely image-only scan)'
      : 'EXTRACTED';
    const slug = url.split('/').pop().replace(/\.pdf$/, '');
    rec.textFile = `.vtu-cache/text/${scheme}_${slug}.txt`;
    await writeFile(join(CACHE, 'text', `${scheme}_${slug}.txt`), text, 'utf8');
  } catch (error) {
    rec.status = `FAILED: ${String(error.message)}`;
  }
  records.push(rec);
  console.log(`${rec.status.padEnd(34)} ${scheme} ${programme} [${semesters}] ${url.split('/').pop()}`);
}

/* Duplicate detection by content hash, not by filename. */
const byHash = new Map();
for (const r of records) {
  if (!r.sha256) continue;
  if (!byHash.has(r.sha256)) byHash.set(r.sha256, []);
  byHash.get(r.sha256).push(r.url);
}
const duplicates = [...byHash.entries()].filter(([, urls]) => urls.length > 1)
  .map(([sha256, urls]) => ({ sha256, urls }));

await writeFile(
  join(OUT, 'vtu-official-documents.json'),
  JSON.stringify({
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    method: 'Official vtu.ac.in PDFs only. Downloaded with curl-equivalent fetch at 1 req/s, hashed, extracted with the product pdfjs build.',
    indexSource: 'https://vtu.ac.in/b-e-scheme-syllabus/',
    counts: {
      targeted: records.length,
      extracted: records.filter((r) => r.status === 'EXTRACTED').length,
      empty: records.filter((r) => String(r.status).startsWith('EXTRACTION_EMPTY')).length,
      failed: records.filter((r) => String(r.status).startsWith('FAILED')).length,
    },
    duplicates,
    documents: records,
  }, null, 1),
  'utf8',
);
console.log('\nwrote docs/research/vtu-official-documents.json');
console.log('duplicates by sha256:', duplicates.length);
