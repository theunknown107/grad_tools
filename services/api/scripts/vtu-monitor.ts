/**
 * Check the monitored VTU sources for what has changed.
 *
 * Authority: Phase 7B.3 §58, §68–§76, §113, §137–§142 · docs/41
 *
 *   pnpm vtu:monitor --fixture               # every family, from committed snapshots
 *   pnpm vtu:monitor --fixture --snapshot v2 # the later snapshot of each
 *   pnpm vtu:monitor --fixture --dry-run     # decide everything, write nothing
 *   pnpm vtu:monitor --family examination    # one family
 *   pnpm vtu:monitor --verbose               # the ledger, row by row
 *   pnpm vtu:monitor                         # ask the registry, and be refused
 *
 * ---------------------------------------------------------------------------
 * WITHOUT `--fixture` THIS IS EXPECTED TO REFUSE
 * ---------------------------------------------------------------------------
 *
 * All six families are registered with `terms_status = 'unknown'` and
 * `access_method = 'none'`, so `acquireLive` is refused by the registry before
 * anything is fetched. That is the current, correct behaviour and not an error
 * in this script: the fact that robots.txt permits a path is not authorization
 * to mine it, and VTU's terms say the access licence does not extend to
 * extraction tools (docs/41).
 *
 * The refusal prints as `UNAUTHORIZED` with the registry's own words, and the
 * run is still recorded — a source nobody may fetch and a source that is simply
 * quiet must not look the same to an operator (§133).
 *
 * ---------------------------------------------------------------------------
 * A DRY RUN IS THE SAME CODE PATH
 * ---------------------------------------------------------------------------
 *
 * `--dry-run` changes exactly one thing: nothing is written. Acquisition,
 * hashing, change detection, classification and ranking all happen, and the
 * ledger is printed. A dry run that took a shortcut would be testing the
 * shortcut (§58).
 */

import postgres from 'postgres';
import { randomUUID } from 'node:crypto';
import type { Sql } from '../src/db/client.js';
import {
  acquireFixture,
  acquireLive,
  FAMILY_SOURCE_ID,
  SOURCE_FAMILIES,
  type AcquisitionOutcome,
} from '../src/monitor/acquire.js';
import {
  runMonitor,
  type KnownItem,
  type RunResult,
  type SourceFamily,
} from '../src/monitor/run.js';
import {
  finishRun,
  knownItems,
  markRemoved,
  saveItems,
  startRun,
  type StoredItem,
} from '../src/monitor/store.js';
import { contentHashOf, changeOf } from '../src/monitor/run.js';

function has(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function flag(name: string): string | null {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? null : (process.argv[index + 1] ?? null);
}

const FIXTURE = has('fixture');
const DRY_RUN = has('dry-run');
const VERBOSE = has('verbose');
const SNAPSHOT = flag('snapshot') ?? 'v1';

function chosenFamilies(): readonly SourceFamily[] {
  const named = flag('family');
  if (named === null) return SOURCE_FAMILIES;
  const match = SOURCE_FAMILIES.find((family) => family === named);
  if (match === undefined) {
    throw new Error(`Unknown family "${named}". One of: ${SOURCE_FAMILIES.join(', ')}.`);
  }
  return [match];
}

/**
 * The registry connection, or none.
 *
 * A missing `DATABASE_URL` is not fatal for a fixture dry run — reading a
 * committed file and deciding what it means needs no database. It IS fatal for
 * a run that intends to write, because a run that cannot record what it did has
 * not done it (§60).
 */
function openRegistry(): Sql | null {
  /* An EMPTY variable is an absent one. `DATABASE_URL=` in the environment is
   * how a developer says "not this time", and treating it as a connection
   * string produces an authentication error that looks like a real fault. */
  const url =
    [process.env['DATABASE_URL'], process.env['TEST_DATABASE_URL']].find(
      (value) => value !== undefined && value.trim() !== '',
    ) ?? null;
  if (url === null) return null;
  return postgres(url, { max: 1, onnotice: () => {} }) as unknown as Sql;
}

function printLedger(result: RunResult): void {
  for (const row of result.ledger) {
    const state = row.notifiable ? 'notifiable' : 'held';
    const why = row.note === null ? '' : ` — ${row.note}`;
    console.log(
      `    [${row.change.toUpperCase().padEnd(9)}] ${row.externalId}  ` +
        `${row.category}/${row.importance}  ${state}${why}`,
    );
    if (row.signals.length > 0) console.log(`                  matched: ${row.signals.join(', ')}`);
  }
}

async function monitorFamily(sql: Sql | null, family: SourceFamily): Promise<boolean> {
  const runId = randomUUID().slice(0, 32);
  const sourceId = FAMILY_SOURCE_ID[family];
  console.log(`\n${family}  (${sourceId})`);

  const writing = sql !== null && !DRY_RUN;
  if (writing) await startRun(sql, runId, family, FIXTURE ? 'fixture' : 'live', DRY_RUN);

  const outcome: AcquisitionOutcome = FIXTURE
    ? await acquireFixture(family, SNAPSHOT)
    : await acquireLive(sql, family);

  if (!outcome.ok) {
    /*
     * THE THREE FAILURES STAY DISTINCT. Collapsing "forbidden" into "error" is
     * how a monitoring system ends up reporting that a source is quiet when it
     * is actually one nobody is allowed to read (§5).
     */
    console.log(`  ${outcome.failure.toUpperCase()}: ${outcome.detail}`);
    if (writing) await finishRun(sql, runId, outcome.failure, outcome.detail, []);
    return outcome.failure === 'unauthorized';
  }

  console.log(`  acquired ${String(outcome.snapshot.items.length)} item(s) from ${outcome.from}`);

  /*
   * WITHOUT A REGISTRY THERE IS NO PREVIOUS RUN, so everything reads as new.
   * Said out loud rather than left for someone to infer from the numbers.
   */
  let known: ReadonlyMap<string, KnownItem> = new Map();
  if (sql !== null) known = await knownItems(sql, sourceId);
  else console.log('  no database: change detection has nothing to compare against');

  const result = runMonitor(runId, outcome.snapshot, known);
  const m = result.metrics;
  console.log(
    `  discovered ${String(m.discovered)}  new ${String(m.new)}  unchanged ${String(m.unchanged)}  ` +
      `updated ${String(m.updated)}  revised ${String(m.revised)}  removed ${String(m.removed)}`,
  );
  console.log(`  notifiable ${String(m.notifiable)}  held ${String(m.held)}`);
  if (VERBOSE) printLedger(result);

  if (!writing) {
    console.log(DRY_RUN ? '  dry run: nothing written' : '  no database: nothing written');
    return true;
  }

  const stored: StoredItem[] = outcome.snapshot.items.map((item) => {
    const hash = contentHashOf(item);
    const row = result.ledger.find((entry) => entry.externalId === item.externalId);
    return {
      item,
      contentHash: hash,
      change: changeOf(item, hash, known),
      category: row?.category ?? 'unresolved',
      signals: row?.signals ?? [],
      importance: row?.importance ?? 'low',
    };
  });
  await saveItems(sql, runId, sourceId, family, stored);
  await markRemoved(
    sql,
    runId,
    sourceId,
    result.ledger.filter((row) => row.change === 'removed').map((row) => row.externalId),
  );
  await finishRun(sql, runId, 'ok', null, result.ledger);
  console.log(`  written, run ${runId}`);
  return true;
}

async function main(): Promise<void> {
  const families = chosenFamilies();
  const sql = openRegistry();
  if (sql === null && !FIXTURE) {
    console.log(
      'No DATABASE_URL, so the source registry cannot be consulted. Live acquisition is ' +
        'refused: an unreachable registry is not permission (docs/41).',
    );
  }

  let allWell = true;
  try {
    for (const family of families) {
      /*
       * FAILURE ISOLATION (§74). One family that cannot be read must not stop
       * the other five, and the reason it failed is printed rather than thrown
       * away.
       */
      try {
        const ok = await monitorFamily(sql, family);
        if (!ok) allWell = false;
      } catch (error) {
        allWell = false;
        console.log(`  FAILED: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  } finally {
    await (sql as unknown as { end?: () => Promise<void> } | null)?.end?.();
  }

  /*
   * A NON-ZERO EXIT ONLY FOR THINGS AN OPERATOR SHOULD ACT ON. Being refused
   * by the registry is the system working, so it exits 0 and says so.
   */
  console.log(
    allWell ? '\nDone.' : '\nDone, with families that could not be read. Every one is named above.',
  );
  process.exitCode = allWell ? 0 : 1;
}

await main();
