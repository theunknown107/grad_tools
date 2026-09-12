/**
 * API entry point.
 *
 * Authority: docs/24 §24.5, docs/25 §25.4
 *
 * Configuration is validated before anything else, so a misconfiguration is a
 * loud startup failure rather than a 500 later. Shutdown drains the connection
 * pool so a rolling deploy does not sever in-flight queries.
 */

import { assertSafeExposure, loadConfig } from './config.js';
import { createClient } from './db/client.js';
import { createApp } from './http/app.js';
import { createLogger } from './observability/logger.js';
import { stopListening } from './monitor/realtime.js';

function start(): void {
  let config;
  try {
    config = loadConfig();
    // Before anything listens: refuse to publish unauthenticated routes.
    assertSafeExposure(config);
  } catch (error) {
    // Deliberately console, not the logger: the logger needs config to exist.
    // eslint-disable-next-line no-console
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
    return;
  }

  const logger = createLogger(config.LOG_LEVEL, config.NODE_ENV !== 'production');
  const sql = createClient(config.DATABASE_URL);
  const app = createApp(config, sql, logger);

  /*
   * Bound explicitly. `app.listen(PORT)` alone binds every interface, which
   * would put the unauthenticated Stage 1 document routes on the network
   * (docs/13 §T-19).
   */
  const server = app.listen(config.PORT, config.HOST, () => {
    logger.info(
      {
        host: config.HOST,
        port: config.PORT,
        env: config.APP_ENV,
        ingestion: config.INGESTION_ENABLED,
      },
      'gradtools api listening',
    );
  });

  /*
   * ---------------------------------------------------------------------------
   * SSE CONNECTIONS NEVER END ON THEIR OWN
   * ---------------------------------------------------------------------------
   *
   * `server.close()` stops accepting new connections and then waits for the
   * open ones to finish. A notification stream is designed never to finish, so
   * this used to wait forever: every rolling deploy would hang until the
   * platform lost patience and sent SIGKILL, cutting off whatever else was
   * in flight.
   *
   * So: stop accepting, drain what will drain, and after a grace period end
   * the rest. `closeAllConnections` is Node's own — there is nothing to track
   * by hand (Phase 7B.6 §78, §151).
   */
  const shutdown = (signal: string): void => {
    logger.info({ signal }, 'shutting down');

    let done = false;
    const finish = (): void => {
      if (done) return;
      done = true;
      /* The LISTEN session is not an HTTP connection and closes separately. */
      void stopListening()
        .then(() => sql.end())
        .then(() => {
          process.exit(0);
        });
    };

    server.close(finish);
    server.closeIdleConnections();

    const grace = setTimeout(() => {
      logger.info({ signal }, 'ending streams that did not drain');
      server.closeAllConnections();
      finish();
    }, 5_000);
    /* Do not keep the process alive purely to wait out the grace period. */
    grace.unref();
  };

  process.on('SIGTERM', () => {
    shutdown('SIGTERM');
  });
  process.on('SIGINT', () => {
    shutdown('SIGINT');
  });
}

start();
