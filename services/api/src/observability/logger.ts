/**
 * Structured logging.
 *
 * Authority: docs/24_OBSERVABILITY_AND_OPERATIONS.md §24.2
 *
 * REDACTION IS THE POINT OF THIS FILE.
 *
 * NFR-011: no secret, USN, name or session token may appear in any log line,
 * in any environment. The redaction list below is enforced by pino AND by a
 * test that asserts these strings never survive into log output — a redaction
 * policy that lives only in a config file rots the first time someone writes
 * `logger.info(req.body)`.
 *
 * In M5a there is no student data on the server at all, so the redaction list
 * is defence for the milestone that first adds it rather than for present
 * traffic. It exists now because retrofitting it later means auditing every
 * log call that already shipped.
 */

import pino, { type DestinationStream, type Logger } from 'pino';

/**
 * Paths pino removes before serialising.
 *
 * Covers request/response shapes as well as bare fields, because a leak is
 * usually an object logged wholesale rather than a field logged deliberately.
 */
const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
  'password',
  'token',
  'sessionToken',
  'email',
  'usn',
  'displayName',
  'name',
  '*.password',
  '*.token',
  '*.email',
  '*.usn',
  '*.displayName',
  'req.body.password',
  'req.body.token',
  'req.body.email',
  'req.body.usn',
] as const;

/**
 * `destination` exists so a test can drive this exact factory and read what it
 * actually writes. Without it the redaction policy could only be tested by
 * duplicating the path list, which would assert nothing about shipped code.
 */
export function createLogger(
  level: string,
  pretty: boolean,
  destination?: DestinationStream,
): Logger {
  const options = {
    level,
    redact: { paths: [...REDACT_PATHS], censor: '[redacted]' },
    // The database URL contains credentials; make certain it can never be
    // serialised even if something logs the whole config object.
    serializers: {
      config: () => '[redacted]',
      DATABASE_URL: () => '[redacted]',
    },
    ...(pretty && destination === undefined
      ? { transport: { target: 'pino/file', options: { destination: 1 } } }
      : {}),
  };

  return destination === undefined ? pino(options) : pino(options, destination);
}
