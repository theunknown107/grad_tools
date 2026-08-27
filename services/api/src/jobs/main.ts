/**
 * OCR worker entry point.
 *
 * Authority: docs/17 §17.15 · docs/21 §21.7.2 · docs/25 §25.4 · M5A.3-final §2
 *
 *   pnpm --filter @gradtools/api worker
 *
 * A separate process from the API, sharing its modules and its database and
 * nothing else. It serves no HTTP, listens on no port, and is reachable from
 * nothing — which is why it needs none of the API's bind-address protection.
 *
 * Wiring only. The loop itself lives in `runtime.ts` so it can be tested
 * without spawning a process or waiting on real timers.
 */

import { assertSafeExposure, loadConfig } from '../config.js';
import { createClient } from '../db/client.js';
import { LocalObjectStore } from '../documents/storage.js';
import { ocrAvailable } from '../documents/ocr.js';
import { createLogger } from '../observability/logger.js';
import { createShutdownHandler, generateWorkerId, logStartup, runWorkerLoop } from './runtime.js';

async function start(): Promise<void> {
  let config;
  try {
    config = loadConfig();
    // The worker binds nothing, but it reads the same configuration as the API
    // and a misconfiguration should fail identically in both.
    assertSafeExposure(config);
  } catch (error) {
    // Deliberately console: the logger needs configuration to exist.
    // eslint-disable-next-line no-console
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
    return;
  }

  const logger = createLogger(config.LOG_LEVEL, config.NODE_ENV !== 'production');

  /*
   * Refuse to start without the OCR toolchain (M5A.3-final §7).
   *
   * A worker that starts, claims jobs and fails every one of them is worse than
   * a worker that does not start: it burns through each job's retry budget and
   * leaves a trail of documents marked unreadable for a reason that has nothing
   * to do with the documents. Checking once at boot turns that into one clear
   * message.
   */
  if (!(await ocrAvailable())) {
    // eslint-disable-next-line no-console
    console.error(
      'Refusing to start: the OCR toolchain is not available.\n' +
        '  This worker needs `tesseract` and `pdftoppm` on PATH, or TESSERACT_BIN\n' +
        '  and PDFTOPPM_BIN pointing at them.\n' +
        '  Kannada additionally needs kan.traineddata reachable via TESSDATA_PREFIX.\n' +
        '  Starting without them would fail every job and mark good documents unreadable.',
    );
    process.exit(1);
    return;
  }

  const sql = createClient(config.DATABASE_URL);
  const store = new LocalObjectStore(config.DOCUMENT_STORAGE_ROOT);
  const workerId = generateWorkerId();
  const controller = new AbortController();

  logStartup(logger, workerId);

  /*
   * Shutdown: stop claiming, let the current job finish, then close.
   *
   * Aborting the signal ends the loop after the in-flight job returns — it does
   * not cancel that job. A half-processed document would leave its row
   * `processing` and its sections partly written, and the recovery path exists
   * for crashes, not for shutdowns we chose.
   *
   * A second signal exits immediately, because a user pressing Ctrl-C twice is
   * telling us they are not willing to wait.
   */
  const shutdown = createShutdownHandler({
    abort: () => {
      controller.abort();
    },
    exit: (code) => {
      process.exit(code);
    },
    logger,
  });

  process.on('SIGTERM', () => {
    shutdown('SIGTERM');
  });
  process.on('SIGINT', () => {
    shutdown('SIGINT');
  });

  try {
    const stats = await runWorkerLoop({ sql, store, logger, workerId }, controller.signal);
    logger.info({ workerId, ...stats }, 'ocr worker stopped');
  } finally {
    await sql.end();
  }

  process.exit(0);
}

await start();
