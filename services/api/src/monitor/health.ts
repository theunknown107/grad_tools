/**
 * Is the monitor working, and how would anybody know?
 *
 * Authority: Phase 7B.6 §13, §54, §155–§163 · 0018_monitor_health.sql
 *
 * ---------------------------------------------------------------------------
 * THE FAILURE `monitor_health` CANNOT SEE
 * ---------------------------------------------------------------------------
 *
 * 0018 answers "what happened when the worker last ran", and answers it well:
 * a quiet source and a broken one are already distinguishable there. But every
 * one of its rows is written BY a run, so the one failure it is structurally
 * blind to is the run that never happened.
 *
 * A scheduler that was never configured, a cron entry that was deleted, a
 * container that stopped being deployed — all of them leave a `monitor_health`
 * that says `ok`, forever, growing quietly more out of date. That is the
 * failure §54 asks to be detectable, and it is detectable only by comparing the
 * last run against the clock.
 *
 * So this adds one thing to what the view already reports: how long ago, and
 * whether that is longer than it should be.
 */

import type { Sql } from '../db/client.js';

/**
 * What an operator needs to be told, in the order they would act on it.
 *
 * `unauthorized` is deliberately NOT a failure. While VTU's terms are
 * unreviewed, being refused is the system working exactly as designed, and
 * paging somebody hourly about it would train them to ignore the alert that
 * matters (docs/41).
 */
export type HealthState =
  'healthy' | 'degraded' | 'failed' | 'unauthorized' | 'never_ran' | 'stale';

export interface FamilyHealth {
  readonly family: string;
  readonly state: HealthState;
  readonly lastRunAt: string | null;
  readonly lastSuccessAt: string | null;
  readonly consecutiveFailures: number;
  readonly minutesSinceLastRun: number | null;
  /** One sentence an operator can act on. Never a stack trace. */
  readonly detail: string;
}

/**
 * How far past the expected cadence counts as overdue.
 *
 * Three intervals, not one. A single missed run is a blip — a slow run, a
 * restart, a scheduler that fired a minute late — and alerting on it produces
 * exactly the noise that teaches people to mute the alert. Three in a row is a
 * pattern.
 */
export const STALE_AFTER_INTERVALS = 3;

/**
 * Reads the health of every family the worker knows about.
 *
 * `expectedIntervalMinutes` is what the scheduler is configured to do, not what
 * the worker believes: the worker cannot know whether anything is calling it,
 * which is the entire point of the `never_ran` and `stale` states.
 */
export async function monitorHealth(
  sql: Sql,
  expectedIntervalMinutes: number,
  families: readonly string[] = [],
): Promise<FamilyHealth[]> {
  const rows = await sql<
    {
      family: string;
      last_run_at: Date | null;
      last_outcome: string | null;
      last_detail: string | null;
      last_success_at: Date | null;
      consecutive_failures: number;
    }[]
  >`
    SELECT family, last_run_at, last_outcome, last_detail, last_success_at, consecutive_failures
    FROM monitor_health
  `;

  const seen = new Map(rows.map((row) => [row.family, row]));
  const now = Date.now();
  const staleAfter = expectedIntervalMinutes * STALE_AFTER_INTERVALS;

  const health: FamilyHealth[] = [];

  /*
   * A FAMILY WITH NO ROW HAS NEVER BEEN CHECKED, and that is the loudest thing
   * this function can say. An empty `monitor_health` and a healthy one look
   * identical to anything that only reads rows.
   */
  for (const family of families) {
    if (seen.has(family)) continue;
    health.push({
      family,
      state: 'never_ran',
      lastRunAt: null,
      lastSuccessAt: null,
      consecutiveFailures: 0,
      minutesSinceLastRun: null,
      detail:
        'No run has ever been recorded for this family. Either the worker has ' +
        'not been deployed, or nothing is calling it.',
    });
  }

  for (const row of rows) {
    const lastRun = row.last_run_at === null ? null : new Date(row.last_run_at).getTime();
    const minutes = lastRun === null ? null : Math.floor((now - lastRun) / 60_000);

    health.push({
      family: row.family,
      state: stateOf(row, minutes, staleAfter),
      lastRunAt: row.last_run_at === null ? null : new Date(row.last_run_at).toISOString(),
      lastSuccessAt:
        row.last_success_at === null ? null : new Date(row.last_success_at).toISOString(),
      consecutiveFailures: row.consecutive_failures,
      minutesSinceLastRun: minutes,
      detail: detailOf(row, minutes, staleAfter),
    });
  }

  return health.sort((left, right) => left.family.localeCompare(right.family));
}

function stateOf(
  row: { last_outcome: string | null; consecutive_failures: number },
  minutes: number | null,
  staleAfter: number,
): HealthState {
  /*
   * OVERDUE OUTRANKS THE LAST OUTCOME. A family whose last run succeeded three
   * days ago is not healthy, however cheerful that run was — and reporting it
   * as healthy is precisely how a stopped scheduler goes unnoticed.
   */
  if (minutes !== null && minutes > staleAfter) return 'stale';
  if (row.last_outcome === 'unauthorized') return 'unauthorized';
  if (row.last_outcome === 'ok') return 'healthy';
  if (row.consecutive_failures >= STALE_AFTER_INTERVALS) return 'failed';
  return 'degraded';
}

function detailOf(
  row: { last_outcome: string | null; last_detail: string | null; consecutive_failures: number },
  minutes: number | null,
  staleAfter: number,
): string {
  if (minutes !== null && minutes > staleAfter) {
    return (
      `Last checked ${String(minutes)} minutes ago, past the ${String(staleAfter)}-minute ` +
      `threshold. Whatever is meant to be calling the worker probably is not.`
    );
  }
  if (row.last_outcome === 'unauthorized') {
    return 'Refused by the source registry, which is the expected state while VTU terms are unreviewed.';
  }
  if (row.last_outcome === 'ok') {
    /* §156. Finding nothing is a success, and saying so stops it reading as a fault. */
    return 'Last run completed. A run that finds nothing new is a healthy run.';
  }
  return row.last_detail ?? `Last run reported "${row.last_outcome ?? 'nothing'}".`;
}

/** The worst state present, for a single line an operator can alert on. */
export function worstOf(health: readonly FamilyHealth[]): HealthState {
  const order: readonly HealthState[] = [
    'healthy',
    'unauthorized',
    'degraded',
    'stale',
    'never_ran',
    'failed',
  ];
  let worst: HealthState = 'healthy';
  for (const entry of health) {
    if (order.indexOf(entry.state) > order.indexOf(worst)) worst = entry.state;
  }
  return worst;
}
