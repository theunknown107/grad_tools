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
   * The interface the API binds to. **This is a security control, not a
   * convenience setting.**
   *
   * Stage 1 has no authentication, and the private document routes
   * (`/api/v1/documents/import`, `/private`, `/:id/process`, `/:id/sections`)
   * are unauthenticated by design because there is no one to authenticate yet.
   * Binding to `0.0.0.0` would therefore publish an anonymous read-and-write
   * document service to every host that can reach the machine.
   *
   * CORS does NOT prevent this. CORS is a browser policy; curl, Postman and any
   * non-browser client ignore it entirely. The bind address is the control that
   * actually holds.
   *
   * Defaults to loopback. Production must set it explicitly, and
   * `assertSafeExposure` below refuses a non-loopback bind while the routes are
   * still unauthenticated (docs/13 §T-19, docs/25 §25.4).
   */
  HOST: z.string().min(1).default('127.0.0.1'),

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
  /**
   * Object-storage root for document bytes.
   *
   * MUST be outside the repository and outside any served directory: the web
   * server never maps a URL onto this path, and files are read back through the
   * application (docs/25 §25.6.3). No cloud provider is chosen yet (`OQ-027`).
   */
  DOCUMENT_STORAGE_ROOT: z.string().min(1).default('./.local-storage'),

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

/** Addresses that mean "every interface on this machine". */
const WILDCARD_HOSTS = new Set(['0.0.0.0', '::', '*']);

function isLoopback(host: string): boolean {
  const bare = host.replace(/^\[|\]$/g, '').toLowerCase();
  return bare === 'localhost' || bare === '::1' || /^127\./.test(bare);
}

/**
 * Refuses to start with unauthenticated private routes on a public interface.
 *
 * Called at boot, before the server listens. A misconfiguration that would
 * expose the document routes is a startup failure, not a quiet risk discovered
 * later — the same principle the rest of this file follows, applied to the one
 * setting whose default being wrong would matter most.
 *
 * `ALLOW_PUBLIC_BIND=true` is the deliberate escape hatch for a deployment that
 * has put its own authentication in front (a reverse proxy, a private network).
 * It must be set on purpose; nothing infers it.
 */
export function assertSafeExposure(config: Config, env: NodeJS.ProcessEnv = process.env): void {
  if (isLoopback(config.HOST)) return;
  if (env.ALLOW_PUBLIC_BIND === 'true') return;

  const where = WILDCARD_HOSTS.has(config.HOST) ? 'every network interface' : `"${config.HOST}"`;
  throw new Error(
    `Refusing to start: HOST is set to ${where}, which would expose the ` +
      `unauthenticated private document routes to the network.\n` +
      `  Stage 1 has no authentication, so the bind address is the only control ` +
      `protecting them (CORS does not apply to non-browser clients).\n` +
      `  Use HOST=127.0.0.1, or set ALLOW_PUBLIC_BIND=true if this deployment ` +
      `authenticates these routes some other way.`,
  );
}
