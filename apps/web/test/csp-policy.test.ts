// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  clerkFrontendApi,
  contentSecurityPolicy,
  insertPolicyMeta,
} from '../scripts/csp-policy.mjs';

// A synthetic publishable key: base64 of "example-instance.clerk.accounts.dev$".
const SYNTHETIC_PK = `pk_test_${Buffer.from('example-instance.clerk.accounts.dev$').toString('base64')}`;

const directive = (policy: string, name: string) =>
  policy
    .split('; ')
    .find((part) => part.startsWith(`${name} `))
    ?.slice(name.length + 1) ?? null;

describe('Content-Security-Policy', () => {
  it("reads Clerk's Frontend API host from a publishable key, and nothing else", () => {
    expect(clerkFrontendApi(SYNTHETIC_PK)).toBe('https://example-instance.clerk.accounts.dev');
    expect(clerkFrontendApi('sk_test_secret')).toBeNull();
    expect(clerkFrontendApi(undefined)).toBeNull();
  });

  it('allows an external origin only when that integration is configured', () => {
    const bare = contentSecurityPolicy({});
    expect(directive(bare, 'connect-src')).toBe("'self' blob: data:");
    expect(directive(bare, 'frame-src')).toBe("'none'");
    expect(bare).not.toMatch(/clerk|cloudflare|https:/);

    const full = contentSecurityPolicy({
      apiUrl: 'https://api.example.test/v1',
      supabaseUrl: 'https://project.supabase.example',
      clerkPublishableKey: SYNTHETIC_PK,
      inlineScriptHashes: ['abc='],
    });
    expect(directive(full, 'connect-src')).toBe(
      "'self' blob: data: https://api.example.test https://project.supabase.example wss://project.supabase.example https://example-instance.clerk.accounts.dev",
    );
    expect(directive(full, 'script-src')).toBe(
      "'self' 'sha256-abc=' 'wasm-unsafe-eval' https://example-instance.clerk.accounts.dev https://challenges.cloudflare.com",
    );
    expect(directive(full, 'frame-src')).toBe('https://challenges.cloudflare.com');
  });

  it('never allows eval, wildcards, plugins or a foreign base URL', () => {
    const policy = contentSecurityPolicy({
      clerkPublishableKey: SYNTHETIC_PK,
      apiUrl: 'https://api.example.test',
    });
    expect(policy).not.toContain("'unsafe-eval'");
    expect(policy).not.toMatch(/(^|\s)\*(\s|;|$)|https:(\s|;|$)/);
    expect(directive(policy, 'object-src')).toBe("'none'");
    expect(directive(policy, 'base-uri')).toBe("'self'");
    expect(directive(policy, 'default-src')).toBe("'self'");
    expect(directive(policy, 'script-src')).not.toContain("'unsafe-inline'");
  });

  it('places the policy before any script, and refuses a page without the charset anchor', () => {
    const page = '<head><meta charset="UTF-8" /><script>1</script></head>';
    const out = insertPolicyMeta(page, "default-src 'self'");
    expect(out.indexOf('Content-Security-Policy')).toBeLessThan(out.indexOf('<script>'));
    expect(insertPolicyMeta('<meta charset="utf-8">', 'x')).toContain('content="x"');
    expect(() => insertPolicyMeta('<head><script>1</script></head>', 'x')).toThrow(/charset/);
  });
});
