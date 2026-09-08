/**
 * Discover VTU's UG scheme and syllabus document graph.
 *
 * Authority: Phase 7C.2 §14–§16, §30, §31, §34, §36
 *
 *   pnpm vtu:discover                        # fetch the official listing
 *   pnpm vtu:discover --from page.html       # read a captured copy instead
 *   pnpm vtu:discover --scheme 2022          # only that scheme year
 *   pnpm vtu:discover --programme CSBS       # only programmes matching
 *   pnpm vtu:discover --json out.json        # write the graph
 *
 * DISCOVERY ONLY. Nothing is downloaded and nothing is written to the database
 * — this reports what the official listing contains so the graph can be
 * inspected before anything acts on it (§31).
 */

import { readFile, writeFile } from 'node:fs/promises';
import { vtuSchemeAdapter, VTU_SCHEME_PARSER_VERSION } from '../src/sources/vtu-scheme.js';
import { checkDestination, USER_AGENT } from '../src/sources/fetch.js';

const ROOT = 'https://vtu.ac.in/b-e-scheme-syllabus/';

function flag(name: string): string | null {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? null : (process.argv[index + 1] ?? null);
}

/**
 * The page, from a captured copy or from VTU.
 *
 * A capture is preferred in development and required in tests: the unit suite
 * must not depend on the internet (§52), and re-reading one saved page while
 * iterating on classification is also the polite thing to do.
 */
async function loadPage(): Promise<{ body: string; from: string }> {
  const file = flag('from');
  if (file !== null) return { body: await readFile(file, 'utf8'), from: file };

  /*
   * THE SAME GUARDS AS EVERY OTHER FETCH (§34). `checkDestination` refuses a
   * private or unresolvable address before a socket is opened. The source
   * registry's robots and terms gates apply to a REGISTERED source; this
   * script is a developer tool reading one public listing page, and it still
   * announces itself and still refuses anything that is not VTU over HTTPS.
   */
  if (!/^https:\/\/vtu\.ac\.in\//.test(ROOT)) throw new Error('The root must be VTU over HTTPS.');
  const destination = await checkDestination(ROOT);
  if (!destination.allowed) {
    throw new Error(`Refused before fetching: ${destination.refusal} — ${destination.detail}`);
  }

  const response = await fetch(ROOT, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'text/html' },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`${ROOT} returned ${String(response.status)}.`);
  return { body: await response.text(), from: ROOT };
}

async function main(): Promise<void> {
  const { body, from } = await loadPage();

  const raw = vtuSchemeAdapter.parse(body);
  const verdict = vtuSchemeAdapter.validate(vtuSchemeAdapter.normalize(raw));
  const graph = vtuSchemeAdapter
    .describe(raw)
    .filter((doc) => verdict.valid.some((item) => item.externalId === doc.url));

  const wantYear = flag('scheme');
  const wantProgramme = flag('programme');
  const selected = graph.filter(
    (doc) =>
      (wantYear === null || doc.schemeYear === wantYear) &&
      (wantProgramme === null ||
        (doc.programme ?? '').toLowerCase().includes(wantProgramme.toLowerCase())),
  );

  const count = <T>(items: readonly T[], key: (item: T) => string): Map<string, number> => {
    const tally = new Map<string, number>();
    for (const item of items) tally.set(key(item), (tally.get(key(item)) ?? 0) + 1);
    return tally;
  };

  const line = (label: string, value: string | number): void => {
    console.log(`  ${label.padEnd(26)} ${String(value)}`);
  };

  console.log(`\nVTU scheme discovery — parser ${VTU_SCHEME_PARSER_VERSION}`);
  console.log(`  source: ${from}\n`);

  line('PDF links found', raw.length);
  line('valid documents', verdict.valid.length);
  line('rejected', verdict.rejected.length);
  line('after filters', selected.length);

  console.log('\nBy scheme year');
  for (const [year, n] of [...count(graph, (d) => d.schemeYear ?? '(unstated)')].sort()) {
    line(year, n);
  }

  console.log('\nBy document kind');
  for (const [kind, n] of [...count(graph, (d) => d.kind)].sort()) line(kind, n);

  console.log('\nCommon / stream-wide documents');
  line('common', graph.filter((d) => d.common).length);
  line('programme-specific', graph.filter((d) => !d.common).length);

  const programmes = [...new Set(graph.map((d) => d.programme).filter((p) => p !== null))];
  console.log(`\nProgrammes named: ${String(programmes.length)}`);

  if (selected.length > 0 && selected.length <= 40) {
    console.log('\nSelected documents');
    for (const doc of selected) {
      console.log(
        `  ${(doc.schemeYear ?? '----').padEnd(5)} ${doc.kind.padEnd(16)} ${
          doc.semesters === null
            ? '     '
            : `${String(doc.semesters[0])}-${String(doc.semesters[1])}  `
        } ${(doc.programme ?? '(common)').slice(0, 46).padEnd(46)} ${doc.url}`,
      );
    }
  }

  if (verdict.rejected.length > 0) {
    console.log('\nRejected');
    for (const { item, reason } of verdict.rejected.slice(0, 10)) {
      console.log(`  ${reason}  ${item.url ?? item.externalId}`);
    }
  }

  const out = flag('json');
  if (out !== null) {
    await writeFile(
      out,
      JSON.stringify(
        {
          discoveredAt: new Date().toISOString(),
          source: from,
          parserVersion: VTU_SCHEME_PARSER_VERSION,
          documents: selected,
        },
        null,
        2,
      ),
      'utf8',
    );
    console.log(`\nWrote ${String(selected.length)} documents to ${out}`);
  }
  console.log('');
}

await main();
