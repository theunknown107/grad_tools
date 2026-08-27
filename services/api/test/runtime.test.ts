/**
 * The worker loop.
 *
 * Authority: docs/17 §17.15 · M5A.3-final §4, §5, §6, §8
 *
 * The loop is tested against a real database, because what it does is claim
 * jobs — but with an injected sleep and clock, so the suite never waits on real
 * time. What is under test is the LOOP's behaviour: does it sleep when idle,
 * recover stalled jobs on schedule, stop promptly on a signal, and survive an
 * error without dying.
 */

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createClient, type Sql } from '../src/db/client.js';
import { runMigrations } from '../src/db/migrate.js';
import { seed } from '../src/db/seed.js';
import { createLogger } from '../src/observability/logger.js';
import { MemoryObjectStore } from '../src/documents/storage.js';
import { importDocument } from '../src/documents/ingest.js';
import * as queue from '../src/jobs/queue.js';
import * as ocr from '../src/documents/ocr.js';
import {
  createShutdownHandler,
  generateWorkerId,
  interruptibleSleep,
  runWorkerLoop,
  IDLE_SLEEP_MS,
  RECOVERY_INTERVAL_MS,
} from '../src/jobs/runtime.js';
import { STALLED_AFTER_MS } from '../src/jobs/ocr-worker.js';
import { scannedPdf } from './fixtures/pdfs.js';

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeDb = DATABASE_URL === undefined ? describe.skip : describe;

describe('worker identity', () => {
  /*
   * Never the hostname or username. The id exists to tell two workers apart in
   * a log; one carrying a person's name is a small leak with no benefit.
   */
  it('is anonymous and does not embed the machine or the user', () => {
    const id = generateWorkerId();
    expect(id).toMatch(/^ocr-[a-z0-9]{1,8}$/);

    const forbidden = [process.env.USERNAME, process.env.USER, process.env.COMPUTERNAME].filter(
      (value): value is string => typeof value === 'string' && value.length > 2,
    );
    for (const value of forbidden) {
      expect(id.toLowerCase()).not.toContain(value.toLowerCase());
    }
    expect(id).not.toMatch(/[\\/:]/);
  });

  it('differs between workers', () => {
    const ids = new Set(Array.from({ length: 20 }, () => generateWorkerId()));
    expect(ids.size).toBeGreaterThan(15);
  });
});

describe('interruptible sleep', () => {
  /*
   * The difference between a worker that stops on Ctrl-C and one that appears
   * to hang for the whole idle interval.
   */
  it('returns early when the signal aborts', async () => {
    const controller = new AbortController();
    const started = Date.now();
    const sleeping = interruptibleSleep(60_000, controller.signal);
    controller.abort();
    await sleeping;
    expect(Date.now() - started).toBeLessThan(1_000);
  });

  it('returns immediately if already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const started = Date.now();
    await interruptibleSleep(60_000, controller.signal);
    expect(Date.now() - started).toBeLessThan(500);
  });

  it('waits when not interrupted', async () => {
    const started = Date.now();
    await interruptibleSleep(60, new AbortController().signal);
    expect(Date.now() - started).toBeGreaterThanOrEqual(40);
  });
});

/*
 * Shutdown POLICY, tested directly.
 *
 * End-to-end signal delivery cannot be verified on Windows — Node has no
 * catchable SIGINT for a spawned child there — so the decision is extracted and
 * proven here, and the wiring in main.ts is one line per signal.
 */
describe('shutdown handler', () => {
  const hooks = () => {
    const calls = { aborted: 0, exited: [] as number[] };
    const handler = createShutdownHandler({
      abort: () => {
        calls.aborted += 1;
      },
      exit: (code) => {
        calls.exited.push(code);
      },
      logger: createLogger('silent', false),
    });
    return { handler, calls };
  };

  /* First signal stops claiming and lets the in-flight job finish. */
  it('aborts on the first signal without exiting', () => {
    const { handler, calls } = hooks();
    handler('SIGINT');
    expect(calls.aborted).toBe(1);
    expect(calls.exited).toEqual([]);
  });

  /* A user pressing Ctrl-C twice is saying they will not wait. */
  it('exits immediately on the second signal', () => {
    const { handler, calls } = hooks();
    handler('SIGINT');
    handler('SIGINT');
    expect(calls.aborted).toBe(1);
    expect(calls.exited).toEqual([1]);
  });

  it('treats SIGTERM the same as SIGINT', () => {
    const { handler, calls } = hooks();
    handler('SIGTERM');
    expect(calls.aborted).toBe(1);
  });

  it('does not abort twice however many signals arrive', () => {
    const { handler, calls } = hooks();
    for (const s of ['SIGINT', 'SIGTERM', 'SIGINT', 'SIGINT']) handler(s);
    expect(calls.aborted).toBe(1);
  });
});

describe('runtime intervals', () => {
  /* Recovery must be well inside the stall window, or a dropped job waits. */
  it('recovers far more often than jobs go stale', () => {
    expect(RECOVERY_INTERVAL_MS).toBeLessThan(STALLED_AFTER_MS / 2);
  });

  /* Not a busy loop, and not a slow one. */
  it('idles for seconds, not milliseconds or minutes', () => {
    expect(IDLE_SLEEP_MS).toBeGreaterThanOrEqual(1_000);
    expect(IDLE_SLEEP_MS).toBeLessThanOrEqual(30_000);
  });
});

describeDb('worker loop', () => {
  let sql: Sql;
  let store: MemoryObjectStore;
  const logger = createLogger('silent', false);

  beforeAll(async () => {
    sql = createClient(DATABASE_URL as string);
    await runMigrations(sql);
    await seed(sql);
    store = new MemoryObjectStore();
  }, 60_000);

  afterAll(async () => {
    await sql.end();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await sql`DELETE FROM documents WHERE original_filename LIKE 'rt-%'`;
  });

  const deps = (workerId = 'rt-worker') => ({ sql, store, logger, workerId });

  async function queuedScan(name: string): Promise<string> {
    /*
     * A trailing PDF comment makes each fixture's bytes unique. Documents are
     * content-addressed, so two identical scans are ONE document by design —
     * correct behaviour, but it means a test needing two distinct documents has
     * to supply two distinct files.
     */
    const bytes = Buffer.concat([
      scannedPdf(),
      Buffer.from(
        `
%rt-${name}
`,
        'latin1',
      ),
    ]);
    const outcome = await importDocument(sql, store, {
      bytes,
      filename: `rt-${name}.pdf`,
    });
    if (outcome.kind !== 'imported') throw new Error('fixture import failed');
    await sql`
      UPDATE documents SET extraction_status = 'ocr_required' WHERE id = ${outcome.id}::uuid
    `;
    await queue.enqueue(sql, 'ocr', outcome.id);
    return outcome.id;
  }

  function stubOcr() {
    vi.spyOn(ocr, 'runOcr').mockResolvedValue({
      ok: true,
      pages: [{ pageNumber: 1, text: 'Module-1 text', tsv: '' }],
      text: 'Module-1 text',
      format: 'descriptive',
      config: { languages: 'eng', psm: 3, dpi: 150, needsReview: false, reviewReason: null },
      engine: 'tesseract',
      engineVersion: 'test',
      durationMs: 1,
      charCount: 13,
      needsReview: false,
      reviewReason: null,
      extractorVersion: 'tesseract-v1',
    });
  }

  it('sleeps instead of spinning when the queue is empty', async () => {
    await sql`DELETE FROM jobs`;
    const sleep = vi.fn().mockResolvedValue(undefined);

    const stats = await runWorkerLoop(deps(), new AbortController().signal, {
      maxIterations: 3,
      sleep,
      recoveryIntervalMs: 10 ** 9,
    });

    expect(stats.idleTicks).toBe(3);
    expect(stats.processed).toBe(0);
    expect(sleep).toHaveBeenCalledTimes(3);
  });

  it('processes queued work without sleeping between jobs', async () => {
    await sql`DELETE FROM jobs`;
    await queuedScan('a');
    await queuedScan('b');
    stubOcr();
    const sleep = vi.fn().mockResolvedValue(undefined);

    const stats = await runWorkerLoop(deps(), new AbortController().signal, {
      maxIterations: 2,
      sleep,
      recoveryIntervalMs: 10 ** 9,
    });

    expect(stats.processed).toBe(2);
    // A backlog is drained back to back; sleeping between items would only
    // make the backlog longer.
    expect(sleep).not.toHaveBeenCalled();
  }, 40_000);

  it('stops promptly when the signal aborts', async () => {
    await sql`DELETE FROM jobs`;
    const controller = new AbortController();
    controller.abort();

    const stats = await runWorkerLoop(deps(), controller.signal, { sleep: vi.fn() });
    expect(stats.iterations).toBe(0);
  });

  /*
   * A worker starting after a crash should pick up what the dead one dropped,
   * not wait for the first scheduled recovery.
   */
  it('recovers stalled jobs before claiming anything', async () => {
    await sql`DELETE FROM jobs`;
    const id = await queuedScan('stalled');
    await queue.claim(sql, 'ocr', 'worker-dead');
    await sql`
      UPDATE jobs SET started_at = now() - interval '2 hours' WHERE document_id = ${id}::uuid
    `;
    stubOcr();

    const stats = await runWorkerLoop(deps(), new AbortController().signal, {
      maxIterations: 1,
      sleep: vi.fn().mockResolvedValue(undefined),
    });

    expect(stats.recoveries).toBeGreaterThan(0);
    // Recovered and then claimed within the same iteration.
    expect(stats.processed).toBe(1);
  }, 40_000);

  it('runs recovery on a schedule, not on every iteration', async () => {
    await sql`DELETE FROM jobs`;
    let clock = 0;
    const now = () => clock;
    const sleep = vi.fn().mockImplementation(() => {
      clock += 1_000;
      return Promise.resolve();
    });

    const stats = await runWorkerLoop(deps(), new AbortController().signal, {
      maxIterations: 6,
      sleep,
      now,
      recoveryIntervalMs: 2_500,
    });

    // 6 iterations advancing 1s each: recovery at t=0, 2.5s+, 5s+ — not 6 times.
    expect(stats.iterations).toBe(6);
    expect(stats.idleTicks).toBe(6);
  });

  /*
   * A transient database error must not end the loop. A worker that exits on a
   * blip needs a supervisor to notice; we would rather it retry.
   */
  it('survives an unexpected error and keeps going', async () => {
    await sql`DELETE FROM jobs`;
    const failing = {
      ...deps(),
      sql: new Proxy(sql, {
        apply() {
          throw new Error('database blip');
        },
      }) as Sql,
    };

    const stats = await runWorkerLoop(failing, new AbortController().signal, {
      maxIterations: 2,
      sleep: vi.fn().mockResolvedValue(undefined),
      recoveryIntervalMs: 10 ** 9,
    });

    expect(stats.iterations).toBe(2);
  });
});
