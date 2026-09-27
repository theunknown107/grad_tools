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

  /**
   * The interface the API binds to. Loopback by default, for local work; a
   * container sets `0.0.0.0` (the Dockerfile does).
   *
   * Binding publicly is safe because NO route is unauthenticated: the reads are
   * public by design, every `/api/v1/me` route verifies a Supabase session, and
   * the two operator writes require `OPERATOR_TOKEN` (and do not exist at all
   * without it). The bind address used to be the only thing standing between
   * those writes and the network; it is no longer the control (docs/13 §T-19).
   */
  HOST: z.string().min(1).default('127.0.0.1'),

  /**
   * The operator credential for announcement entry and publication. **SECRET.**
   *
   * Unset — the default, and right for any deployment that has no operator —
   * the operator routes are not mounted: they answer 404 like any other path.
   * Set, they require `Authorization: Bearer <token>`. At least 32 characters,
   * so it cannot be a word someone guesses; generate it, never choose it.
   * Never a `VITE_` variable: it must not reach a browser bundle.
   */
  OPERATOR_TOKEN: z
    .string()
    .min(32, 'OPERATOR_TOKEN must be at least 32 characters; generate it randomly')
    .optional(),

  /**
   * The Gemini API key for AI document reading. **SECRET.** Server-only: read
   * from the environment and never a `VITE_` variable, so no browser bundle or
   * APK can hold it. Unset, the AI reading route does not exist (404) and the
   * app reads documents on the device only.
   */
  GEMINI_API_KEY: z.string().min(1).optional(),

  /**
   * The model that reads documents. Changing it is a deliberate configuration
   * change; the service never falls back to another model on its own.
   */
  GEMINI_DOCUMENT_MODEL: z.string().min(1).max(60).default('gemini-3.8-flash'),

  /**
   * How much the model reasons before answering. Routine extraction needs
   * little: `low` keeps latency and cost predictable.
   */
  GEMINI_THINKING_LEVEL: z.enum(['minimal', 'low', 'medium', 'high']).default('low'),

  /** Secret. Never logged, never returned by any endpoint. */
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

  /** Comma-separated CORS allowlist. No wildcard is accepted (docs/13 §13.5). */
  WEB_ORIGIN: z.string().default('http://localhost:5173'),

  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'silent']).default('info'),

  /* -- The student cloud (M9) ---------------------------------------------- */

  /**
   * The Supabase project URL, e.g. https://<ref>.supabase.co.
   *
   * PUBLIC, not a secret: it is in every browser request already. Its presence
   * is what turns authentication on — absent, the API serves the public
   * surface only and every student route reports the feature as unavailable
   * (docs/25 §25.15).
   */
  SUPABASE_URL: z.string().url().optional(),

  /**
   * The student-cloud connection string. **SECRET.**
   *
   * It must name the `authenticator` role. `postgres` and `service_role` both
   * carry `bypassrls` and would turn every RLS policy in the schema into
   * decoration — the API asserts this at startup and refuses to boot otherwise
   * (docs/13 §13.17).
   */
  SUPABASE_DB_URL: z.string().min(1).optional(),

  /**
   * A privileged connection used for ONE operation: deleting an account, which
   * has to remove a row from `auth.users`. **SECRET.** Optional, and where it
   * is absent account deletion reports itself unavailable rather than half
   * working (M9 §34, §44).
   */
  SUPABASE_ADMIN_DB_URL: z.string().min(1).optional(),

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

/** Environments that are reached over the network by people other than the developer. */
const DEPLOYED_ENVIRONMENTS = new Set<Config['APP_ENV']>(['staging', 'alpha']);

/**
 * Refuses to start a deployed environment whose browser policy is not explicit.
 *
 * Called at boot, before the server listens. In `staging` and `alpha` the CORS
 * allowlist must be SET — the `http://localhost:5173` default would silently
 * refuse the real web app — and every origin must be `https://`, because a
 * page served over plain HTTP could be altered on the way to the student. The
 * Android app's origin, `https://localhost`, qualifies.
 *
 * Binding publicly is no longer refused: nothing unauthenticated remains to
 * expose (see `HOST` and `OPERATOR_TOKEN`).
 */
export function assertSafeExposure(config: Config, env: NodeJS.ProcessEnv = process.env): void {
  if (!DEPLOYED_ENVIRONMENTS.has(config.APP_ENV)) return;

  const problems: string[] = [];
  if (env.WEB_ORIGIN === undefined || env.WEB_ORIGIN.trim() === '') {
    problems.push(`WEB_ORIGIN must be set explicitly in ${config.APP_ENV}.`);
  }
  const insecure = config.allowedOrigins.filter((origin) => !origin.startsWith('https://'));
  if (insecure.length > 0) {
    problems.push(
      `Every WEB_ORIGIN must use https:// in ${config.APP_ENV}: ${insecure.join(', ')}`,
    );
  }
  if (problems.length > 0) {
    throw new Error(`Refusing to start:\n  ${problems.join('\n  ')}`);
  }
}
