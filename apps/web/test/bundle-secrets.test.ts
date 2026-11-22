/**
 * Nothing secret may be in anything a browser downloads.
 *
 * Authority: docs/13 §13.17 · docs/25 §25.15 · M9 §21, §22, §44
 *
 * ---------------------------------------------------------------------------
 * WHY THIS READS THE BUILD AND NOT THE SOURCE
 * ---------------------------------------------------------------------------
 *
 * A secret does not reach a student through a source file; it reaches them
 * through the bundle. Vite inlines every `VITE_`-prefixed variable at build
 * time, so the question "is the service-role key in the browser?" can only be
 * answered by reading `dist` — which is exactly what an attacker reads.
 *
 * The scan is SHAPE-BASED, not name-based: a key renamed tomorrow still looks
 * like a key. Supabase's service-role JWT, its `sb_secret_` keys, Postgres
 * URLs, PEM private keys and Apple/Google client secrets each have a form that
 * survives minification, because they are string literals.
 *
 * `.env.example` values are documentation, not secrets, and the placeholder
 * forms that appear there are not treated as findings.
 */

import { describe, expect, it } from 'vitest';
import { readdir, readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

/*
 * The web package's root, whichever directory the runner was started in: the
 * project root when the whole suite runs, `apps/web` when this file does.
 */
const WEB_ROOT = existsSync(resolve(process.cwd(), 'apps/web/src'))
  ? resolve(process.cwd(), 'apps/web')
  : process.cwd();

const DIST = resolve(WEB_ROOT, 'dist');

/** Every file a browser could download from the build. */
async function bundleFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir)) {
    const path = join(dir, entry);
    if ((await stat(path)).isDirectory()) out.push(...(await bundleFiles(path)));
    else if (/\.(js|mjs|css|html|json|map)$/.test(entry)) out.push(path);
  }
  return out;
}

/**
 * What a secret looks like, whatever it is called.
 *
 * Each pattern is a shape a real credential has and a public value does not.
 * The anon/publishable key is deliberately NOT here: it belongs in a browser,
 * reaches only RLS-protected tables, and is useless without a user's own
 * session (docs/09 §9.18).
 */
interface Shape {
  readonly name: string;
  readonly pattern: RegExp;
  /**
   * True for a shape that is only a credential in context.
   *
   * `AKIA` followed by sixteen upper-case characters is an AWS key id — and is
   * also a sequence that occurs by chance in base64. The vendored Tesseract
   * cores are megabytes of exactly that, so applying this shape to third-party
   * binaries-as-JavaScript produces findings that are not credentials. It is
   * applied to what GradTools itself builds, where a match is real.
   */
  readonly ambiguousInBinaries?: boolean;
}

const SECRET_SHAPES: readonly Shape[] = [
  { name: 'Supabase service-role JWT', pattern: /"role"\s*:\s*"service_role"/ },
  {
    name: 'Supabase service-role JWT (encoded)',
    pattern: /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]*c2VydmljZV9yb2xl/,
  },
  { name: 'Supabase secret key', pattern: /sb_secret_[A-Za-z0-9_-]{8,}/ },
  {
    name: 'PostgreSQL connection URL with a password',
    pattern: /postgres(?:ql)?:\/\/[^\s:'"]+:[^\s@'"]+@/,
  },
  { name: 'PEM private key', pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
  { name: 'Google OAuth client secret', pattern: /GOCSPX-[A-Za-z0-9_-]{10,}/ },
  { name: 'AWS access key id', pattern: /AKIA[0-9A-Z]{16}/, ambiguousInBinaries: true },
  {
    name: 'Generic secret assignment',
    pattern: /(service_role_key|SERVICE_ROLE_KEY|DATABASE_URL)\s*[:=]\s*["'][^"']{12,}["']/,
  },
];

/** Third-party assets copied in verbatim by `scripts/vendor-ocr-assets.mjs`. */
const VENDORED = /[\\/]ocr[\\/]/;

describe('the built browser bundle', () => {
  it('exists, so this test is not silently vacuous', () => {
    /*
     * A scan that passes because there is nothing to scan is the failure mode
     * this guards against: run `pnpm build` before this suite.
     */
    expect(existsSync(DIST)).toBe(true);
  });

  it('contains no credential of any shape', async () => {
    const files = await bundleFiles(DIST);
    expect(files.length).toBeGreaterThan(0);

    const findings: string[] = [];
    for (const file of files) {
      const text = await readFile(file, 'utf8');
      for (const { name, pattern, ambiguousInBinaries } of SECRET_SHAPES) {
        if (ambiguousInBinaries === true && VENDORED.test(file)) continue;
        if (pattern.test(text)) findings.push(`${name} in ${file.replace(DIST, 'dist')}`);
      }
    }
    expect(findings).toEqual([]);
  });

  it('carries no token in any URL it builds', async () => {
    const files = await bundleFiles(DIST);
    const findings: string[] = [];
    for (const file of files) {
      const text = await readFile(file, 'utf8');
      /* A query string that carries a bearer credential, rather than reads one. */
      if (/[?&](access_token|refresh_token|api_key|apikey)=[A-Za-z0-9._-]{8,}/.test(text)) {
        findings.push(file.replace(DIST, 'dist'));
      }
    }
    expect(findings).toEqual([]);
  });
});

describe('the source tree', () => {
  it('keeps every service credential out of the repository', async () => {
    const roots = ['src', '../../services/api/src'].map((path) => resolve(WEB_ROOT, path));
    const findings: string[] = [];

    const walk = async (dir: string): Promise<void> => {
      for (const entry of await readdir(dir)) {
        const path = join(dir, entry);
        if ((await stat(path)).isDirectory()) {
          await walk(path);
          continue;
        }
        if (!/\.(ts|tsx|js|mjs|sql|json)$/.test(entry)) continue;
        const text = await readFile(path, 'utf8');
        for (const { name, pattern } of SECRET_SHAPES) {
          /*
           * `"role": "service_role"` appears in the API's own JWT-shape checks
           * and in SQL that names the role; a literal key does not.
           */
          if (name.startsWith('Supabase service-role JWT')) continue;
          if (pattern.test(text)) findings.push(`${name} in ${path}`);
        }
      }
    };

    for (const root of roots) if (existsSync(root)) await walk(root);
    expect(findings).toEqual([]);
  });
});
