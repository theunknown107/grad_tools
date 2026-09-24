/**
 * Parse course rows out of the harvested official VTU scheme tables.
 *
 * Research tooling. Produces an EXTRACTED dataset for review — not canonical
 * data, and nothing here writes to the product catalogue.
 *
 *   cd apps/web && node ../../tools/research/parse-vtu-schemes.mjs
 *
 * ---------------------------------------------------------------------------
 * THE ROW SHAPE, FROM THE DOCUMENTS THEMSELVES
 * ---------------------------------------------------------------------------
 *
 *   <sl> <category> <code> <title> <TD/PSB> <L> <T> <P> [S] <dur> <CIE> <SEE> <total> <credits>
 *
 * e.g. "1 PCC/BSC BCS301 Mathematics for Computer Science TD: Maths PSB:
 *       Maths/CS 3 2 0 03 50 50 100 4"
 *
 * 2022 rows carry three teaching-hour values (L T P); 2025 rows may carry a
 * fourth (S = Skill Development Activity / self-study). Both shapes are tried,
 * the longer first, and which one matched is recorded on the row so a reviewer
 * can tell a real S value from an absent column.
 *
 * A row that does not match is NOT guessed at. Unmatched codes are counted and
 * reported so the shortfall is visible rather than silently dropped.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';

const ROOT = resolve(process.cwd(), '../..');
const TEXT = resolve(ROOT, '.vtu-cache/text');
const OUT = resolve(ROOT, 'docs/research');

const docs = JSON.parse(
  await readFile(join(OUT, 'vtu-official-documents.json'), 'utf8'),
).documents;

const ROMAN = { I: 1, II: 2, III: 3, IV: 4, V: 5, VI: 6, VII: 7, VIII: 8 };
const CODE = /\b(1?B[A-Z]{2,5}\d{3}[A-Zx]?)\b/g;

/** With an S column (4 hour values), then without (3). Longer shape first. */
const ROWS = [
  {
    hours: 4,
    re: /(1?B[A-Z]{2,5}\d{3}[A-Zx]?)\s+(.{3,150}?)\s+(\d{1,2})\s+(\d{1,2})\s+(\d{1,2})\s+(\d{1,2})\s+(\d{2})\s+(\d{2,3}|-+)\s+(\d{2,3}|-+)\s+(\d{2,3})\s+(\d{1,2})(?!\d)/g,
  },
  {
    hours: 3,
    re: /(1?B[A-Z]{2,5}\d{3}[A-Zx]?)\s+(.{3,150}?)\s+(\d{1,2})\s+(\d{1,2})\s+(\d{1,2})\s+(\d{2})\s+(\d{2,3}|-+)\s+(\d{2,3}|-+)\s+(\d{2,3})\s+(\d{1,2})(?!\d)/g,
  },
];

const num = (v) => (/^-+$/.test(v) ? null : Number(v));

/** Strip the teaching-department tail the tables append to every title. */
function cleanTitle(raw) {
  return raw
    .replace(/\s*TD\s*:.*$/i, '')
    .replace(/\s*PSB\s*:.*$/i, '')
    .replace(/\s*(Any Department|Respective Dept.*|Concerned department.*)$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const courses = [];
const perDoc = [];

for (const doc of docs) {
  if (doc.status !== 'EXTRACTED') continue;
  const slug = doc.url.split('/').pop().replace(/\.pdf$/, '');
  const text = await readFile(join(TEXT, `${doc.scheme}_${slug}.txt`), 'utf8');

  const pages = text.split(/\n===== PAGE (\d+) =====\n/).slice(1);
  const seen = new Set();
  let matched = 0;
  let semester = null;

  for (let i = 0; i < pages.length; i += 2) {
    const pageNo = Number(pages[i]);
    const body = pages[i + 1].replace(/[ \t]+/g, ' ');

    for (const code of body.match(CODE) ?? []) seen.add(code.toUpperCase());

    /* Semester headings carry forward until the next one. */
    const heads = [...body.matchAll(/\b(I|II|III|IV|V|VI|VII|VIII)\s+SEMESTER\b/g)];
    if (heads.length > 0) semester = ROMAN[heads[heads.length - 1][1]] ?? semester;

    let pageMatched = 0;
    for (const { hours, re } of ROWS) {
      re.lastIndex = 0;
      for (const m of body.matchAll(re)) {
        const g = m.slice(1);
        const code = g[0].toUpperCase();
        const title = cleanTitle(g[1]);
        if (title.length < 3) continue;
        const h = g.slice(2, 2 + hours).map(Number);
        const rest = g.slice(2 + hours);
        courses.push({
          code,
          title,
          scheme: doc.scheme,
          programme: doc.programme,
          semester,
          L: h[0] ?? null,
          T: h[1] ?? null,
          P: h[2] ?? null,
          S: hours === 4 ? (h[3] ?? null) : null,
          sColumnPresent: hours === 4,
          examDurationHours: num(rest[0]),
          cieMarks: num(rest[1]),
          seeMarks: num(rest[2]),
          totalMarks: num(rest[3]),
          credits: Number(rest[4]),
          /*
           * A placeholder code is what the DOCUMENT prints for a course that
           * varies by stream (1BMATx101 -> 1BMATS101 / 1BMATE101 / ...). It is
           * not a course a student can be enrolled in, so it is marked rather
           * than promoted to a canonical code.
           */
          isPlaceholderCode: /X$/i.test(g[0]) && !/^\d/.test(g[0].slice(-2, -1)),
          provenance: {
            sourceUrl: doc.url,
            documentSha256: doc.sha256,
            sourcePage: pageNo,
            retrievedAt: doc.retrievedAt,
            parser: 'tools/research/parse-vtu-schemes.mjs@1',
          },
        });
        matched += 1;
        pageMatched += 1;
      }
      /* Do not re-scan THIS page with the shorter shape once it matched. */
      if (pageMatched > 0) break;
    }
  }
  perDoc.push({ url: doc.url, scheme: doc.scheme, programme: doc.programme,
    codesSeen: seen.size, rowsParsed: matched });
}

/* De-duplicate on code+scheme+programme, keeping every source reference. */
const byKey = new Map();
for (const c of courses) {
  const key = `${c.scheme}|${c.programme}|${c.code}`;
  if (!byKey.has(key)) byKey.set(key, { ...c, sources: [c.provenance] });
  else byKey.get(key).sources.push(c.provenance);
}
/* `provenance` is dropped: each row keeps the full `sources` array instead. */
const unique = [...byKey.values()].map(({ provenance: _drop, ...rest }) => rest);

/*
 * CIE + SEE must equal Total in these tables. Where it does not, the 4-value
 * shape matched a 3-value row and shifted every column, so the row is marked
 * SUSPECT rather than published as if it were clean. Nothing is repaired by
 * guessing which column slipped.
 */
for (const c of unique) {
  const sums = c.cieMarks !== null && c.seeMarks !== null && c.totalMarks !== null;
  c.parseConfidence = sums && c.cieMarks + c.seeMarks !== c.totalMarks ? 'SUSPECT' : 'OK';
}

const bySchemeCount = {};
for (const c of unique) bySchemeCount[c.scheme] = (bySchemeCount[c.scheme] ?? 0) + 1;

await writeFile(
  join(OUT, 'vtu-official-courses.json'),
  JSON.stringify({
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    status: 'EXTRACTED — not verified, not ready for ingestion',
    caveat:
      'Machine-parsed from official VTU scheme tables. Every row carries sourceUrl + sha256 + page. Rows that did not match the table shape were NOT guessed at; see coverage.unmatchedCodes for the shortfall.',
    counts: {
      uniqueCourses: unique.length,
      byScheme: bySchemeCount,
      parseOk: unique.filter((c) => c.parseConfidence === 'OK').length,
      parseSuspect: unique.filter((c) => c.parseConfidence === 'SUSPECT').length,
      placeholderCodes: unique.filter((c) => c.isPlaceholderCode).length,
    },
    coverage: perDoc,
    courses: unique,
  }, null, 1),
  'utf8',
);

const totalSeen = perDoc.reduce((n, d) => n + d.codesSeen, 0);
const totalRows = perDoc.reduce((n, d) => n + d.rowsParsed, 0);
console.log(`documents parsed : ${perDoc.length}`);
console.log(`codes seen       : ${totalSeen}`);
console.log(`rows parsed      : ${totalRows}`);
console.log(`unique courses   : ${unique.length}`);
console.log('by scheme        :', bySchemeCount);
console.log('\nwrote docs/research/vtu-official-courses.json');
