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

import { readdir, readFile } from 'node:fs/promises';
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
import { acquisitionMode, requireFetchPermission } from '../src/sources/acquire.js';
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
    ['access method none', { accessMethod: 'none' as const }, 'access_method_not_fetchable'],
    // M5.1 §1: a human-delivery source is not merely disabled, it is not the
    // kind of thing a fetch applies to.
    ['manual upload', { accessMethod: 'manual_upload' as const }, 'access_method_not_fetchable'],
    ['manual entry', { accessMethod: 'manual_entry' as const }, 'access_method_not_fetchable'],
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

  /*
   * M5.1 §1. `enabled` means "GradTools may reach out on a schedule", which is
   * only ever true of http_fetch. A manual source is recorded so its provenance
   * exists; polling one is a category error, not a configuration choice.
   */
  it.each(['none', 'manual_upload', 'manual_entry'] as const)(
    'refuses to fetch a %s source even with every other gate open and enabled',
    (accessMethod) => {
      const decision = checkSourcePermission(permittedSource({ accessMethod, enabled: true }));
      expect(decision.allowed).toBe(false);
      if (!decision.allowed) expect(decision.refusal).toBe('access_method_not_fetchable');
    },
  );

  it('permits only http_fetch when every other gate is open', () => {
    expect(checkSourcePermission(permittedSource({ accessMethod: 'http_fetch' })).allowed).toBe(
      true,
    );
  });

  it('refuses a manual source before touching the network', async () => {
    const outcome = await fetchSource(
      permittedSource({ accessMethod: 'manual_upload' }),
      'https://example.org/',
    );
    expect(outcome.ok).toBe(false);
    expect(outcome.refusal).toBe('access_method_not_fetchable');
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

/* -------------------------------------------------------------------------- */
/* The acquisition boundary                                                   */
/* -------------------------------------------------------------------------- */

/* ---------------------------------------------------------------------- */

describe('the door every outbound fetch goes through', () => {
  /*
   * §87, and the reason it is mandatory: `checkSourcePermission` was written,
   * documented and tested, and an audit found its only callers were its own
   * tests. Every VTU script reached the network directly. This asserts the
   * DOOR rather than the rule, because the rule was never the problem.
   *
   * The registry-backed cases live in `gates.test.ts`, which has a database.
   */
  it('refuses when there is no registry to consult', async () => {
    /* An unreachable registry is not permission. It fails closed. */
    const mode = await acquisitionMode(null, 'vtu-scheme-syllabus');
    expect(mode).toMatchObject({ mode: 'supplied', refusal: 'no_registry' });
    await expect(requireFetchPermission(null, 'vtu-scheme-syllabus')).rejects.toThrow(
      /not permission/i,
    );
  });

  it('is called by every script that reaches the network', async () => {
    /*
     * THE AUDIT, AS A TEST INSTEAD OF AS A ONE-OFF.
     *
     * The original defect was never a wrong rule — it was four scripts that
     * did not consult it, found by reading them once. Reading them once does
     * not keep them read, and `vtu:download` was still ungated long after the
     * other three were fixed: the one script whose entire purpose is
     * retrieving documents. `isFetchableUrl` looks like a guard and is the
     * opposite of one, since it confirms the host IS vtu.ac.in.
     *
     * So the audit runs on every suite. A new script that fetches and forgets
     * the door fails here rather than in somebody's traffic logs.
     */
    const dir = new URL('../scripts/', import.meta.url);
    const names = (await readdir(dir)).filter((name) => name.endsWith('.ts'));
    expect(names.length).toBeGreaterThan(5);

    const ungated: string[] = [];
    for (const name of names) {
      const source = await readFile(new URL(name, dir), 'utf8');
      /* `downloadAll` is a fetch too — it is where the requests actually go. */
      const reaches = /\bfetch\(|\bdownloadAll\(/.test(source);
      if (reaches && !source.includes('requireFetchPermission')) ungated.push(name);
    }
    expect(ungated).toEqual([]);
  });

  it('leaves the supplied-document door with no network access at all', async () => {
    /*
     * Mode B's whole value is that it does not fetch. A `--url` on
     * `vtu:supply` is a provenance CLAIM about bytes somebody already holds;
     * the day it becomes something the script goes and retrieves, the gate has
     * been routed around by the one tool written to make routing around it
     * unnecessary.
     */
    const source = await readFile(new URL('../scripts/vtu-supply.ts', import.meta.url), 'utf8');
    expect(source).not.toMatch(/\bfetch\(/);
    expect(source).not.toMatch(/\bdownloadAll\(/);
  });

  it('gates the artifact on the scheme it claims, and says so out loud', async () => {
    /*
     * AN ARTIFACT IS A PUBLICATION. Writing one used to need nothing but the
     * flag, so a catalogue that failed its own validation could be emitted,
     * committed and shipped, with the failure living only in a terminal
     * nobody kept.
     *
     * Three things have to hold together, and a source audit is how a script
     * with a top-level `main()` can be held to them at all:
     *
     *   - the verdict is asked for BEFORE the file is written;
     *   - the scheme validated is the scheme REQUESTED, not the database at
     *     large — a passing 2022 says nothing about a 2025 artifact;
     *   - `--force` exists, is explicit, and is reported rather than silent.
     */
    const source = await readFile(new URL('../scripts/vtu-sync.ts', import.meta.url), 'utf8');

    expect(source).toMatch(/gateEmission\(/);
    /* The requested scheme is what reaches the validator. */
    expect(source).toMatch(/gateEmission\(\s*wantYear\s*,/);
    expect(source).toMatch(/validateCatalogue\(sql, \{ schemeYear \}\)/);
    /* The write is guarded by the verdict, not merely informed by it. */
    expect(source).toMatch(/!emitRefused/);
    /* The override is opt-in and lands in the report. */
    expect(source).toMatch(/has\('force'\)/);
    expect(source).toMatch(/report\.emit = /);
  });

  it('emits only the aliases of the scheme being written', async () => {
    /*
     * The alias table went out whole regardless of `--scheme`, so a 2025
     * artifact carried the 2022 equivalence BCSL358D -> BCS358D — whose own
     * evidence line cites the 2022 CSBS syllabus — with no year on it to give
     * it away. An alias is a statement about one scheme's codes.
     */
    const source = await readFile(new URL('../scripts/vtu-sync.ts', import.meta.url), 'utf8');

    expect(source).toMatch(/COURSE_ALIASES\.filter\(/);
    expect(source).toMatch(/alias\.schemeYear === wantYear/);
    /* And the year travels with each emitted row. */
    expect(source).toMatch(/schemeYear: alias\.schemeYear/);
  });

  it('serialises the artifact under the identity the database uses', async () => {
    /*
     * `catalogue_courses` is unique on (scheme, programme, stream, semester,
     * code). The artifact deduplicated on the same thing WITHOUT the stream,
     * so the two first-year cycles — which differ only by stream — collapsed
     * into one another on the way out.
     */
    const source = await readFile(new URL('../scripts/vtu-sync.ts', import.meta.url), 'utf8');

    expect(source).toMatch(/const seen = new Map<string, CatalogueCourse>\(\)/);
    expect(source).toMatch(/courseKey\(/);
    expect(source).toMatch(/course\.streamId \?\? null/);
  });

  it('sends the resolved first year to the artifact, not only to the database', async () => {
    /*
     * The resolution wrote to the database through a collection the emit never
     * read, so the artifact shipped first-year PLACEHOLDERS — `1BMATX101`,
     * which no result card prints — and not the concrete courses they resolve
     * to. A 2025 first-year card would have matched nothing, against a
     * catalogue that appeared to cover the semester.
     *
     * The push has to sit INSIDE the resolution loop and before the database
     * write, so a run with no database still emits a correct catalogue.
     */
    const source = await readFile(new URL('../scripts/vtu-sync.ts', import.meta.url), 'utf8');
    const loop = source.slice(source.indexOf('for (const resolved of resolution.resolved)'));
    const pushAt = loop.indexOf('courses.push(');
    const upsertAt = loop.indexOf('upsertCourse(');

    expect(pushAt).toBeGreaterThan(-1);
    expect(upsertAt).toBeGreaterThan(-1);
    expect(pushAt).toBeLessThan(upsertAt);
    /* The emitted row carries the cycle and cites the placeholder it came from. */
    expect(loop.slice(pushAt, upsertAt)).toMatch(/streamId,/);
    expect(loop.slice(pushAt, upsertAt)).toMatch(/relatedCode: resolved\.slotCode/);
  });

  it('reaches the downloader from exactly one place in the sync', async () => {
    /*
     * `vtu:supply` gives a person a way to put an official document into the
     * store without fetching it, and for a while nothing could USE one: the
     * only route from the store to the database ran through `vtu:sync`, whose
     * gate stands in front of the downloader unconditionally. A supplied
     * document could be stored, hashed and extracted and never reach a
     * catalogue. The gate was right; the pipeline had no door.
     *
     * `--supplied-only` is that door, and it works by NOT CALLING the
     * downloader — there is then no option it can pass wrongly and no socket
     * it can open. That is only true while the call site stays single: a
     * second `downloadAll(` reachable from another branch would mean the flag
     * no longer describes what the run does, which is the failure this
     * catches.
     */
    const source = await readFile(new URL('../scripts/vtu-sync.ts', import.meta.url), 'utf8');

    expect(source.match(/\bdownloadAll\(/g)).toHaveLength(1);
    expect(source).toMatch(/suppliedOnly/);
    /* And the listing it replaces keeps its own gate. */
    expect(source).toMatch(/requireFetchPermission/);
  });
});
