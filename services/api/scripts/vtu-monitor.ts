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
 *   pnpm vtu:monitor --fixture --fanout      # also notify the students it concerns
 *   pnpm vtu:monitor --fixture --fanout --dry-run   # who WOULD be notified, and why
 *   pnpm vtu:monitor --fixture --fanout --watch     # on a schedule, until stopped
 *   pnpm vtu:monitor --floor high            # only interrupt people about the urgent
 *   pnpm vtu:monitor                         # ask the registry, and be refused
 *
 * ---------------------------------------------------------------------------
 * `--watch` IS NOT "ALWAYS ON"
 * ---------------------------------------------------------------------------
 *
 * It is a loop in a terminal that stops when the terminal does. GradTools has
 * no deployment — no Dockerfile, no Procfile, no platform configuration, no
 * deploy job — so nothing here runs anywhere unattended, and §128 forbids
 * describing it as though it did (see src/monitor/schedule.ts).
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
  publishedItems,
  saveItems,
  startRun,
  type StoredItem,
} from '../src/monitor/store.js';
import { materialize, type FanoutDecision } from '../src/monitor/fanout.js';
import { scheduleFromEnv, startScheduler } from '../src/monitor/schedule.js';
import type { Importance } from '../src/monitor/classify.js';
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
const FANOUT = has('fanout');
const WATCH = has('watch');
const SNAPSHOT = flag('snapshot') ?? 'v1';

function importanceFloor(): Importance {
  const named = flag('floor') ?? 'medium';
  if (named !== 'high' && named !== 'medium' && named !== 'low') {
    throw new Error(`--floor must be high, medium or low; got "${named}".`);
  }
  return named;
}

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

/**
 * The fanout connection, or none.
 *
 * A DIFFERENT ROLE FROM THE API'S, deliberately. The worker is a different
 * process doing a different job and holding different rights: two views and one
 * INSERT (Supabase 0009). Reusing the API's connection string would mean a bug
 * in one could reach the other's privileges, and the whole reason the monitor
 * role is narrow is that nothing else should be able to borrow it.
 *
 * Absent means no fanout, said out loud rather than inferred from a zero.
 */
function openFanout(): Sql | null {
  const url =
    [process.env['MONITOR_DATABASE_URL'], process.env['TEST_MONITOR_DATABASE_URL']].find(
      (value) => value !== undefined && value.trim() !== '',
    ) ?? null;
  if (url === null) return null;
  return postgres(url, { max: 2, prepare: false, onnotice: () => {} }) as unknown as Sql;
}

/**
 * The dry-run report §43 asks for: source, user, match, importance, result.
 *
 * Grouped by item rather than by student, because the question an operator has
 * before letting a run write is "who is this notice about to reach", and the
 * per-student view buries that.
 */
function printFanoutReport(decisions: readonly FanoutDecision[]): void {
  const byItem = new Map<string, FanoutDecision[]>();
  for (const decision of decisions) {
    const held = byItem.get(decision.externalId);
    if (held === undefined) byItem.set(decision.externalId, [decision]);
    else held.push(decision);
  }

  for (const [externalId, group] of byItem) {
    const first = group[0];
    if (first === undefined) continue;
    console.log(`\n  ${externalId}  ${first.category}/${first.importance}`);
    for (const decision of group) {
      /*
       * THE USER ID IS TRUNCATED. A dry-run report is something a developer
       * pastes into an issue, and a full account identifier does not need to
       * travel with it (§28, §80).
       */
      const who = `${decision.userId.slice(0, 8)}…`;
      const matched = decision.matched.length === 0 ? '—' : decision.matched.join('+');
      console.log(
        `    ${who}  ${decision.outcome.padEnd(15)} ${matched.padEnd(24)} ${decision.reason}`,
      );
    }
  }
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

/**
 * One pass over the chosen families, plus the fanout if one was asked for.
 *
 * This is the unit a scheduler calls (§38). It takes its connections as
 * arguments rather than opening them, so a long-running loop opens them once
 * instead of once a minute — and so nothing in the processors knows whether a
 * cron, a queue or a person invoked it.
 */
async function runCycle(sql: Sql | null, fanout: Sql | null): Promise<boolean> {
  const families = chosenFamilies();
  let allWell = true;

  for (const family of families) {
    /*
     * FAILURE ISOLATION (§74). One family that cannot be read must not stop the
     * other five, and the reason is printed rather than thrown away.
     */
    try {
      const ok = await monitorFamily(sql, family);
      if (!ok) allWell = false;
    } catch (error) {
      allWell = false;
      console.log(`  FAILED: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (!FANOUT) return allWell;

  console.log('\nfanout');
  if (sql === null) {
    console.log('  no registry: there are no stored items to notify anybody about');
    return allWell;
  }
  if (fanout === null) {
    console.log(
      '  no MONITOR_DATABASE_URL: nobody is notified. The worker reaches student ' +
        'notifications through its own narrow role, and without one there is no path.',
    );
    return allWell;
  }

  const runId = randomUUID().slice(0, 32);
  const items = await publishedItems(sql, null);
  const result = await materialize(fanout, runId, items, {
    floor: importanceFloor(),
    dryRun: DRY_RUN,
  });

  console.log(
    `  ${String(result.usersConsidered)} student(s) × ${String(result.itemsConsidered)} item(s) ` +
      `at or above ${importanceFloor()}  (${String(result.belowFloor)} below the floor)`,
  );
  console.log(
    `  created ${String(result.created)}  already held ${String(result.alreadyHeld)}  ` +
      `not applicable ${String(result.notApplicable)}  unresolved ${String(result.unresolved)}`,
  );
  if (DRY_RUN) {
    console.log('  dry run: nothing written');
    if (VERBOSE) printFanoutReport(result.decisions);
  }
  return allWell;
}

async function main(): Promise<void> {
  const sql = openRegistry();
  const fanout = openFanout();
  if (sql === null && !FIXTURE) {
    console.log(
      'No DATABASE_URL, so the source registry cannot be consulted. Live acquisition is ' +
        'refused: an unreachable registry is not permission (docs/41).',
    );
  }

  let allWell = true;
  try {
    if (!WATCH) {
      allWell = await runCycle(sql, fanout);
    } else {
      const schedule = scheduleFromEnv();
      console.log(
        `Checking every ${String(schedule.intervalMinutes)} minute(s). This is a loop in a ` +
          `terminal, not a deployment: stop it with Ctrl-C.`,
      );
      const handle = startScheduler(
        schedule,
        async () => {
          await runCycle(sql, fanout);
        },
        (outcome) => {
          console.log(
            outcome.ok
              ? `\n[${outcome.finishedAt}] cycle complete`
              : `\n[${outcome.finishedAt}] cycle FAILED: ${outcome.detail ?? 'no detail'}`,
          );
        },
      );
      await new Promise<void>((resolve) => {
        const stop = (): void => {
          void handle.stop().then(resolve);
        };
        process.once('SIGINT', stop);
        process.once('SIGTERM', stop);
      });
    }
  } finally {
    await (sql as unknown as { end?: () => Promise<void> } | null)?.end?.();
    await (fanout as unknown as { end?: () => Promise<void> } | null)?.end?.();
  }

  /*
   * A NON-ZERO EXIT ONLY FOR THINGS AN OPERATOR SHOULD ACT ON. Being refused by
   * the registry is the system working, so it exits 0 and says so.
   */
  console.log(
    allWell ? '\nDone.' : '\nDone, with families that could not be read. Every one is named above.',
  );
  process.exitCode = allWell ? 0 : 1;
}

await main();
