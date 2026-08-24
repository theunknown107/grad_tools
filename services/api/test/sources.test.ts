/**
 * Source adapters, gating and change detection.
 *
 * Authority: docs/14 §14.2, §14.3, §14.6, §14.7 · docs/13 §T-11 · M5 §10–§14, §21
 *
 * No network and no database. `parse`, `normalize` and `validate` are pure, and
 * the permission check is a function of a source row — so the entire adapter
 * framework, including every refusal path, is provable from fixtures.
 *
 * That is the point of the split: an adapter that could only be tested by
 * fetching would be untestable exactly when the source is down, and would
 * tempt someone into fetching during a test run.
 */

import { describe, expect, it } from 'vitest';
import type { Source } from '@gradtools/shared-types';
import { detectChanges, hashItem, type NormalizedItem } from '../src/sources/adapter.js';
import {
  checkDestination,
  checkSourcePermission,
  fetchSource,
  isPrivateAddress,
} from '../src/sources/fetch.js';
import { vtuAnnouncementsAdapter } from '../src/sources/vtu-announcements.js';
import {
  ANNOUNCEMENTS_FIXTURE,
  ANNOUNCEMENTS_FIXTURE_HOSTILE,
  ANNOUNCEMENTS_FIXTURE_UPDATED,
} from './fixtures/vtu-announcements.html.js';

/** A source with every gate open. Only ever constructed inside tests. */
function permittedSource(overrides: Partial<Source> = {}): Source {
  return {
    id: 'test-source',
    kind: 'announcements',
    publisher: 'Test Publisher',
    canonicalUrl: 'https://example.org/',
    authority: 'official',
    accessMethod: 'http_fetch',
    robotsStatus: 'allowed',
    robotsCheckedAt: '2026-08-24',
    robotsNote: null,
    termsStatus: 'permitted',
    termsReviewedAt: '2026-08-24',
    termsNote: null,
    rightsStatus: 'permitted',
    verification: 'verified',
    verifiedAt: '2026-08-24',
    enabled: true,
    health: 'healthy',
    consecutiveFailures: 0,
    lastCheckedAt: null,
    parserVersion: 'test-v1',
    pollIntervalSeconds: 3600,
    notes: null,
    ...overrides,
  };
}

/* -------------------------------------------------------------------------- */
/* Permission                                                                 */
/* -------------------------------------------------------------------------- */

describe('source permission gate', () => {
  it('permits a source only when every gate has passed', () => {
    expect(checkSourcePermission(permittedSource()).allowed).toBe(true);
  });

  it.each([
    ['disabled', { enabled: false }, 'source_disabled'],
    ['robots unknown', { robotsStatus: 'unknown' as const }, 'robots_not_allowed'],
    ['robots disallowed', { robotsStatus: 'disallowed' as const }, 'robots_not_allowed'],
    ['terms unknown', { termsStatus: 'unknown' as const }, 'terms_not_permitted'],
    ['terms prohibited', { termsStatus: 'prohibited' as const }, 'terms_not_permitted'],
    ['terms restricted', { termsStatus: 'restricted' as const }, 'terms_not_permitted'],
    ['unverified', { verification: 'unverified' as const }, 'source_unverified'],
    ['access method none', { accessMethod: 'none' as const }, 'access_method_none'],
  ])('refuses a %s source', (_label, overrides, expected) => {
    const decision = checkSourcePermission(permittedSource(overrides));
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.refusal).toBe(expected);
  });

  /*
   * The two gates are independent, and this is the case that proves it: robots
   * allows the path, and the source is still refused because nobody has read
   * the terms. This is exactly VTU's announcements situation.
   */
  it('refuses when robots allows but terms are unreviewed', () => {
    const decision = checkSourcePermission(
      permittedSource({ robotsStatus: 'allowed', termsStatus: 'unknown', termsReviewedAt: null }),
    );
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.refusal).toBe('terms_not_permitted');
  });

  it('treats unknown as refusal, never as permission', () => {
    const unknown = permittedSource({
      robotsStatus: 'unknown',
      termsStatus: 'unknown',
      rightsStatus: 'unknown',
    });
    expect(checkSourcePermission(unknown).allowed).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* SSRF                                                                       */
/* -------------------------------------------------------------------------- */

describe('destination gate (SSRF)', () => {
  it.each([
    '127.0.0.1',
    '0.0.0.0',
    '10.1.2.3',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.1',
    '169.254.169.254', // cloud metadata
    '100.64.0.1', // CGNAT
    '::1',
    'fe80::1',
    'fd00::1',
    '::ffff:127.0.0.1',
  ])('treats %s as private', (address) => {
    expect(isPrivateAddress(address)).toBe(true);
  });

  it.each(['8.8.8.8', '1.1.1.1', '93.184.216.34', '2606:4700::1111'])(
    'treats %s as public',
    (address) => {
      expect(isPrivateAddress(address)).toBe(false);
    },
  );

  it('refuses a loopback URL', async () => {
    const decision = await checkDestination('http://127.0.0.1:5432/');
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.refusal).toBe('private_address');
  });

  it('refuses the cloud metadata address', async () => {
    const decision = await checkDestination('http://169.254.169.254/latest/meta-data/');
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.refusal).toBe('private_address');
  });

  it.each(['file:///etc/passwd', 'gopher://example.org/', 'ftp://example.org/'])(
    'refuses the scheme in %s',
    async (url) => {
      const decision = await checkDestination(url);
      expect(decision.allowed).toBe(false);
      if (!decision.allowed) expect(decision.refusal).toBe('unsupported_scheme');
    },
  );

  it('refuses a malformed URL', async () => {
    const decision = await checkDestination('not a url at all');
    expect(decision.allowed).toBe(false);
  });

  /*
   * Both refusals are independent. A disabled source is refused before any DNS
   * happens, so a permission failure can never leak a lookup to an attacker's
   * host.
   */
  it('refuses a disabled source before touching the network', async () => {
    const outcome = await fetchSource(permittedSource({ enabled: false }), 'https://example.org/');
    expect(outcome.ok).toBe(false);
    expect(outcome.refusal).toBe('source_disabled');
  });

  it('refuses a private destination even for a fully permitted source', async () => {
    const outcome = await fetchSource(permittedSource(), 'http://127.0.0.1/admin');
    expect(outcome.ok).toBe(false);
    expect(outcome.refusal).toBe('private_address');
  });
});

/* -------------------------------------------------------------------------- */
/* Adapter: parse / normalize / validate                                      */
/* -------------------------------------------------------------------------- */

describe('vtu-announcements adapter', () => {
  it('is disabled-by-design: it exposes no fetch method', () => {
    expect(vtuAnnouncementsAdapter).not.toHaveProperty('fetch');
    expect(vtuAnnouncementsAdapter.parserVersion).toBe('vtu-ann-v1');
  });

  it('parses the fixture into the expected raw items', () => {
    const raw = vtuAnnouncementsAdapter.parse(ANNOUNCEMENTS_FIXTURE);
    expect(raw).toHaveLength(3);
    expect(raw[0]?.title).toBe('Revised examination timetable & venue list');
    expect(raw[0]?.publishedAt).toBe('2026-07-10');
  });

  it('ignores markup outside the notices list', () => {
    const raw = vtuAnnouncementsAdapter.parse(ANNOUNCEMENTS_FIXTURE);
    expect(raw.map((item) => item.title)).not.toContain('Home');
  });

  it('reports a missing date as null rather than guessing one', () => {
    const raw = vtuAnnouncementsAdapter.parse(ANNOUNCEMENTS_FIXTURE);
    const undated = raw.find((item) => item.externalId.includes('no-date'));
    expect(undated?.publishedAt).toBeNull();
  });

  /** Golden output: the exact normalized result the fixture must produce. */
  it('normalizes to a stable golden shape', () => {
    const items = vtuAnnouncementsAdapter.normalize(
      vtuAnnouncementsAdapter.parse(ANNOUNCEMENTS_FIXTURE),
    );
    expect(items.map(({ payloadHash: _hash, ...rest }) => rest)).toEqual([
      {
        externalId: 'external-circular.pdf',
        title: 'Circular regarding attendance condonation',
        url: 'https://example.org/external-circular.pdf',
        publishedAt: '2026-07-02',
      },
      {
        externalId: 'notice/example-no-date',
        title: 'Notice with no date supplied',
        url: 'https://vtu.ac.in/notice/example-no-date/',
        publishedAt: null,
      },
      {
        externalId: 'notice/example-timetable-revision',
        title: 'Revised examination timetable & venue list',
        url: 'https://vtu.ac.in/notice/example-timetable-revision/',
        publishedAt: '2026-07-10',
      },
    ]);
  });

  it('produces identical output on repeated runs', () => {
    const once = vtuAnnouncementsAdapter.normalize(
      vtuAnnouncementsAdapter.parse(ANNOUNCEMENTS_FIXTURE),
    );
    const twice = vtuAnnouncementsAdapter.normalize(
      vtuAnnouncementsAdapter.parse(ANNOUNCEMENTS_FIXTURE),
    );
    expect(once).toEqual(twice);
  });

  it('hashes independently of key order', () => {
    const base = { externalId: 'a', title: 'T', url: null, publishedAt: null };
    expect(hashItem(base)).toBe(
      hashItem({ publishedAt: null, url: null, title: 'T', externalId: 'a' }),
    );
  });

  it('returns nothing for unrelated markup rather than failing', () => {
    expect(vtuAnnouncementsAdapter.parse('<html><body><p>Nothing here</p></body></html>')).toEqual(
      [],
    );
  });

  it('survives malformed input without throwing', () => {
    expect(() => vtuAnnouncementsAdapter.parse('<li class="notice-item"><a href=')).not.toThrow();
  });

  describe('validate', () => {
    const verdictFor = (html: string) =>
      vtuAnnouncementsAdapter.validate(
        vtuAnnouncementsAdapter.normalize(vtuAnnouncementsAdapter.parse(html)),
      );

    it('accepts the well-formed fixture entirely', () => {
      const verdict = verdictFor(ANNOUNCEMENTS_FIXTURE);
      expect(verdict.valid).toHaveLength(3);
      expect(verdict.rejected).toHaveLength(0);
    });

    it('rejects a javascript: link', () => {
      const verdict = verdictFor(ANNOUNCEMENTS_FIXTURE_HOSTILE);
      expect(verdict.valid.some((item) => item.url?.startsWith('javascript'))).toBe(false);
    });

    it('rejects an empty title', () => {
      const verdict = verdictFor(ANNOUNCEMENTS_FIXTURE_HOSTILE);
      expect(verdict.rejected.some((r) => r.reason.includes('no title'))).toBe(true);
    });

    it('rejects a duplicate identifier within one response', () => {
      const verdict = verdictFor(ANNOUNCEMENTS_FIXTURE_HOSTILE);
      expect(verdict.rejected.some((r) => r.reason.includes('Duplicate'))).toBe(true);
    });

    it('never silently drops an item: rejected items carry a reason', () => {
      const verdict = verdictFor(ANNOUNCEMENTS_FIXTURE_HOSTILE);
      expect(verdict.rejected.length).toBeGreaterThan(0);
      for (const rejection of verdict.rejected) {
        expect(rejection.reason.length).toBeGreaterThan(0);
      }
    });
  });
});

/* -------------------------------------------------------------------------- */
/* Change detection                                                           */
/* -------------------------------------------------------------------------- */

describe('change detection', () => {
  const normalize = (html: string) =>
    vtuAnnouncementsAdapter.normalize(vtuAnnouncementsAdapter.parse(html));
  const hashesOf = (items: readonly NormalizedItem[]) =>
    new Map(items.map((item) => [item.externalId, item.payloadHash]));

  it('reports every item as new on a first poll', () => {
    const changes = detectChanges(new Map(), normalize(ANNOUNCEMENTS_FIXTURE));
    expect(changes).toHaveLength(3);
    expect(changes.every((change) => change.changeType === 'new')).toBe(true);
  });

  /*
   * The property that keeps the change log honest: an unchanged page must
   * produce no rows at all, or every poll appends and the log becomes noise.
   */
  it('reports nothing when nothing changed', () => {
    const items = normalize(ANNOUNCEMENTS_FIXTURE);
    expect(detectChanges(hashesOf(items), items)).toEqual([]);
  });

  it('detects a modified item, a new item and a removed item together', () => {
    const before = hashesOf(normalize(ANNOUNCEMENTS_FIXTURE));
    const changes = detectChanges(before, normalize(ANNOUNCEMENTS_FIXTURE_UPDATED));
    const byType = (type: string) => changes.filter((c) => c.changeType === type);

    expect(byType('modified').map((c) => c.externalId)).toEqual([
      'notice/example-timetable-revision',
    ]);
    expect(byType('new').map((c) => c.externalId)).toEqual(['notice/example-new-item']);
    expect(byType('removed').map((c) => c.externalId)).toEqual(['external-circular.pdf']);
  });

  it('records the last known hash for a removed item', () => {
    const before = hashesOf(normalize(ANNOUNCEMENTS_FIXTURE));
    const changes = detectChanges(before, normalize(ANNOUNCEMENTS_FIXTURE_UPDATED));
    const removed = changes.find((c) => c.changeType === 'removed');
    expect(removed?.payloadHash).toBe(before.get('external-circular.pdf'));
  });

  it('is idempotent: re-running against the new state reports nothing', () => {
    const updated = normalize(ANNOUNCEMENTS_FIXTURE_UPDATED);
    expect(detectChanges(hashesOf(updated), updated)).toEqual([]);
  });

  it('detects removal of everything when a source returns an empty list', () => {
    const before = hashesOf(normalize(ANNOUNCEMENTS_FIXTURE));
    const changes = detectChanges(before, []);
    expect(changes).toHaveLength(3);
    expect(changes.every((c) => c.changeType === 'removed')).toBe(true);
  });
});
