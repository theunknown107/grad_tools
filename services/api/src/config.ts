/**
 * Environment configuration.
 *
 * Authority: docs/25_DEPLOYMENT_AND_ENVIRONMENTS.md §25.4
 *
 * Validated with Zod at boot. The process REFUSES TO START on a missing or
 * malformed variable rather than failing later at first use, so a
 * misconfiguration is a loud startup failure instead of a 500 at 2am
 * (docs/24 §24.5).
 *
 * Secrets come from the environment only. Nothing here is ever sent to the
 * browser: the API owns database access and the client never holds a
 * connection string (M5a §13).
 */

import { z } from 'zod';

const configSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  APP_ENV: z.enum(['local', 'test', 'experimental', 'staging', 'alpha']).default('local'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),

  /** Secret. Never logged, never returned by any endpoint. */
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

  /** Comma-separated CORS allowlist. No wildcard is accepted (docs/13 §13.5). */
  WEB_ORIGIN: z.string().default('http://localhost:5173'),

  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'silent']).default('info'),

  /**
   * Master switch for all external source polling. Defaults off in every
   * environment (docs/25 §25.4). No ingestion exists in M5a; the variable is
   * validated here so the default cannot drift.
   */
  INGESTION_ENABLED: z
    .string()
    .default('false')
    .transform((value) => value === 'true'),
});

export type Config = Omit<z.infer<typeof configSchema>, 'WEB_ORIGIN'> & {
  readonly allowedOrigins: readonly string[];
};

/**
 * Reads and validates configuration.
 *
 * Throws with every problem listed at once rather than one at a time, because
 * fixing a misconfiguration one restart per variable is miserable.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = configSchema.safeParse(env);

  if (!parsed.success) {
    const problems = parsed.error.issues
      .map((issue) => `  ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${problems}`);
  }

  const { WEB_ORIGIN, ...rest } = parsed.data;

  return {
    ...rest,
    allowedOrigins: WEB_ORIGIN.split(',')
      .map((origin) => origin.trim())
      .filter((origin) => origin !== ''),
  };
}
