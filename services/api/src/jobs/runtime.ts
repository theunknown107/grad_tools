/**
 * The worker loop, as a testable unit.
 *
 * Authority: docs/17 §17.15 · docs/24 §24.2 · M5A.3-final §2, §4, §5, §8
 *
 * Separated from `main.ts` so the loop's real behaviour — sleeping when idle,
 * recovering stalled jobs on a schedule, stopping promptly on a signal — can be
 * tested without spawning a process or waiting on real timers. `main.ts` is
 * then only wiring: configuration, clients, signals.
 *
 * NO HTTP. Nothing here listens on a port. The worker reaches the outside world
 * through PostgreSQL and the object store, and nothing reaches it.
 */

import type { Logger } from 'pino';
import { runOneJob, recoverStalled, type WorkerDeps } from './ocr-worker.js';

/**
 * How long to wait after finding an empty queue.
 *
 * Not a busy loop, and not a long one either: OCR is minutes-scale work whose
 * latency nobody is watching, so a few seconds of idle delay costs a user
 * nothing and costs the database one trivial indexed query per tick.
 */
export const IDLE_SLEEP_MS = 3_000;

/**
 * How often to return abandoned jobs to the queue.
 *
 * Comfortably below `STALLED_AFTER_MS` (30 minutes) so a job killed with a
 * worker is picked up within a few minutes rather than half an hour, and far
 * above the cost of the query — one indexed UPDATE every five minutes is not
 * database traffic worth economising on.
 */
export const RECOVERY_INTERVAL_MS = 5 * 60_000;

export interface RuntimeOptions {
  readonly idleSleepMs?: number;
  readonly recoveryIntervalMs?: number;
  /** Stop after this many loop iterations. Tests only; production never sets it. */
  readonly maxIterations?: number;
  /** Injectable so tests do not wait on real time. */
  readonly sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  readonly now?: () => number;
}

export interface RuntimeStats {
  readonly processed: number;
  readonly idleTicks: number;
  readonly recoveries: number;
  readonly iterations: number;
}

/**
 * Sleeps, but wakes immediately if the signal aborts.
 *
 * A plain `setTimeout` would make shutdown wait out the full idle interval,
 * which is the difference between a worker that stops on Ctrl-C and one that
 * appears to hang.
 */
export function interruptibleSleep(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(finish, ms);
    signal.addEventListener('abort', finish, { once: true });
    function finish(): void {
      clearTimeout(timer);
      signal.removeEventListener('abort', finish);
      resolve();
    }
  });
}

/**
 * Runs the worker loop until the signal aborts.
 *
 * The shape is deliberate:
 *
 *   - Stalled recovery runs FIRST, before any claim. A worker starting after a
 *     crash should pick up what the dead one dropped, not wait five minutes.
 *   - A successful job loops straight to the next claim with no delay: when
 *     there is a backlog, sleeping between items would just make it longer.
 *   - An empty queue sleeps, interruptibly.
 *   - `runOneJob` handles its own failures and never throws, so a bad document
 *     cannot end the loop. The try/catch here is for the unexpected — a
 *     database blip — where the right response is also to keep going.
 */
export async function runWorkerLoop(
  deps: WorkerDeps,
  signal: AbortSignal,
  options: RuntimeOptions = {},
): Promise<RuntimeStats> {
  const idleSleepMs = options.idleSleepMs ?? IDLE_SLEEP_MS;
  const recoveryIntervalMs = options.recoveryIntervalMs ?? RECOVERY_INTERVAL_MS;
  const sleep = options.sleep ?? interruptibleSleep;
  const now = options.now ?? Date.now;
  const { logger } = deps;

  let processed = 0;
  let idleTicks = 0;
  let recoveries = 0;
  let iterations = 0;
  let lastRecovery = 0;

  while (!signal.aborted) {
    if (options.maxIterations !== undefined && iterations >= options.maxIterations) break;
    iterations += 1;

    try {
      if (now() - lastRecovery >= recoveryIntervalMs) {
        lastRecovery = now();
        recoveries += await recoverStalled(deps);
      }

      const outcome = await runOneJob(deps);

      if (outcome === null) {
        idleTicks += 1;
        await sleep(idleSleepMs, signal);
      } else {
        processed += 1;
      }
    } catch (cause) {
      /*
       * Something outside a job failed — most plausibly the database. Log it
       * and keep going: a worker that exits on a transient error needs a
       * supervisor to notice, and we would rather it simply retry.
       */
      logger.error(
        { err: cause instanceof Error ? cause.message : String(cause) },
        'worker loop error',
      );
      await sleep(idleSleepMs, signal);
    }
  }

  return { processed, idleTicks, recoveries, iterations };
}

/**
 * A worker identifier for logs and job claims.
 *
 * Deliberately NOT the hostname, the username or anything derived from the
 * machine (M5A.3-final §6). It exists to tell two workers apart in a log, and
 * an identifier that carries a person's name or a host's identity is a small
 * leak with no benefit.
 */
export function generateWorkerId(
  random: () => string = () => Math.random().toString(36).slice(2),
): string {
  return `ocr-${random().slice(0, 8)}`;
}

/** Startup banner. Metadata only; never a document, never a path. */
export function logStartup(logger: Logger, workerId: string, options: RuntimeOptions = {}): void {
  logger.info(
    {
      workerId,
      idleSleepMs: options.idleSleepMs ?? IDLE_SLEEP_MS,
      recoveryIntervalMs: options.recoveryIntervalMs ?? RECOVERY_INTERVAL_MS,
    },
    'ocr worker started',
  );
}

/* -------------------------------------------------------------------------- */
/* Shutdown                                                                   */
/* -------------------------------------------------------------------------- */

export interface ShutdownHooks {
  readonly abort: () => void;
  readonly exit: (code: number) => void;
  readonly logger: Logger;
}

/**
 * Builds the signal handler.
 *
 * Extracted from `main.ts` so the DECISION is testable without delivering a
 * real signal — which is not possible on Windows, where Node has no catchable
 * SIGINT for a spawned child. The wiring in `main.ts` is then one line per
 * signal, and the policy lives here where it can be proven.
 *
 * FIRST signal: stop claiming, let the in-flight job finish, close cleanly.
 * Aborting does not cancel the running job — a half-processed document would
 * leave its row `processing` with sections partly written, and the recovery
 * path exists for crashes, not for shutdowns we chose.
 *
 * SECOND signal: exit now. A user pressing Ctrl-C twice is saying they are not
 * willing to wait, and continuing to wait would be ignoring them.
 */
export function createShutdownHandler(hooks: ShutdownHooks): (signal: string) => void {
  let shuttingDown = false;
  return (signal: string): void => {
    if (shuttingDown) {
      hooks.logger.warn({ signal }, 'second signal: exiting immediately');
      hooks.exit(1);
      return;
    }
    shuttingDown = true;
    hooks.logger.info({ signal }, 'shutting down after the current job');
    hooks.abort();
  };
}
