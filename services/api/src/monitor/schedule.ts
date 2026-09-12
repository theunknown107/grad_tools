/**
 * Running the monitor repeatedly, without knowing what is doing the running.
 *
 * Authority: Phase 7B.3.1 §35–§42, §63, §70, §127, §128
 *
 * ---------------------------------------------------------------------------
 * THIS IS NOT A DEPLOYED SCHEDULER, AND SAYING SO MATTERS
 * ---------------------------------------------------------------------------
 *
 * GradTools has no deployment. There is no Dockerfile, no Procfile, no
 * platform configuration and no deploy job — the only workflow in the
 * repository runs the test suite. So nothing here is running anywhere, and
 * §128's rule applies in full: **GradTools is not monitoring VTU.** It cannot
 * be, on two independent counts — no process is deployed, and the source gate
 * refuses live acquisition anyway.
 *
 * What this file provides is the execution path a scheduler would call, built
 * so that adopting one is configuration rather than a rewrite (§38). A managed
 * cron, a queue consumer, a container with a loop and a `pg_cron` job calling an
 * HTTP endpoint can all drive `runCycle` without any of the processors knowing
 * which of them did.
 *
 * ---------------------------------------------------------------------------
 * CADENCE IS A CEILING, NOT A SUGGESTION
 * ---------------------------------------------------------------------------
 *
 * `MINIMUM_INTERVAL_MINUTES` is enforced rather than documented. A university
 * publishes a handful of notices a day; polling it every thirty seconds would
 * gain nothing a student would notice and would look, from the far end, exactly
 * like the data-mining VTU's terms of use exclude. A configuration mistake that
 * would hammer a source should fail to start, not start quietly (§39).
 */

/** Below this, the configuration is refused rather than rounded up (§39). */
export const MINIMUM_INTERVAL_MINUTES = 5;
export const DEFAULT_INTERVAL_MINUTES = 60;

export interface ScheduleConfig {
  readonly intervalMinutes: number;
  /** Runs before the first wait, so a restart checks immediately. */
  readonly runOnStart: boolean;
}

/**
 * Reads the cadence from the environment, and refuses a bad one.
 *
 * A NUMBER THAT IS NOT A NUMBER IS AN ERROR, not a silent fallback to the
 * default. `MONITOR_INTERVAL_MINUTES=6O` with a letter O is a typo somebody
 * should hear about, and a scheduler that quietly ran hourly instead would hide
 * it for months.
 */
export function scheduleFromEnv(env: NodeJS.ProcessEnv = process.env): ScheduleConfig {
  const raw = env['MONITOR_INTERVAL_MINUTES'];
  if (raw === undefined || raw.trim() === '') {
    return { intervalMinutes: DEFAULT_INTERVAL_MINUTES, runOnStart: true };
  }

  const minutes = Number(raw);
  if (!Number.isFinite(minutes) || !Number.isInteger(minutes)) {
    throw new Error(`MONITOR_INTERVAL_MINUTES must be a whole number of minutes; got "${raw}".`);
  }
  if (minutes < MINIMUM_INTERVAL_MINUTES) {
    throw new Error(
      `MONITOR_INTERVAL_MINUTES is ${String(minutes)}, below the ${String(MINIMUM_INTERVAL_MINUTES)}-minute ` +
        `minimum. Sources are checked on a cadence that is polite to the publisher, ` +
        `and a university does not publish often enough for more to be useful.`,
    );
  }
  return { intervalMinutes: minutes, runOnStart: true };
}

export interface CycleOutcome {
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly ok: boolean;
  readonly detail: string | null;
}

export interface SchedulerHandle {
  /** Resolves once the loop has stopped and any in-flight cycle has finished. */
  stop(): Promise<void>;
}

/**
 * Calls `cycle` every interval until stopped.
 *
 * ---------------------------------------------------------------------------
 * A FAILED CYCLE DOES NOT STOP THE SCHEDULE
 * ---------------------------------------------------------------------------
 *
 * The one guarantee worth having from a long-running loop is that it is still
 * there tomorrow. A cycle that throws is recorded and the next one is scheduled
 * anyway, because the failure modes are overwhelmingly transient — a database
 * restart, a file briefly absent — and a monitor that exits on the first of
 * them is a monitor that silently stopped weeks before anybody noticed (§63,
 * §70).
 *
 * The interval is measured from the END of a cycle rather than the start, so a
 * run that takes longer than the interval cannot overlap itself. Two cycles
 * racing is safe — the uniqueness index sees to that — but it is still not
 * something to cause on purpose.
 */
export function startScheduler(
  config: ScheduleConfig,
  cycle: () => Promise<void>,
  report: (outcome: CycleOutcome) => void = () => {},
): SchedulerHandle {
  let stopped = false;
  let timer: NodeJS.Timeout | null = null;
  let inFlight: Promise<void> = Promise.resolve();

  const runOnce = async (): Promise<void> => {
    const startedAt = new Date().toISOString();
    try {
      await cycle();
      report({ startedAt, finishedAt: new Date().toISOString(), ok: true, detail: null });
    } catch (error) {
      report({
        startedAt,
        finishedAt: new Date().toISOString(),
        ok: false,
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const loop = (): void => {
    if (stopped) return;
    timer = setTimeout(
      () => {
        inFlight = runOnce().then(loop);
      },
      config.intervalMinutes * 60 * 1000,
    );
    /* Do not hold the process open on this timer's account alone. */
    timer.unref?.();
  };

  if (config.runOnStart) inFlight = runOnce().then(loop);
  else loop();

  return {
    async stop(): Promise<void> {
      stopped = true;
      if (timer !== null) clearTimeout(timer);
      await inFlight;
    },
  };
}
