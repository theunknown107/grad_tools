/**
 * Announcements: normalisation, gates, deduplication and the API.
 *
 * Authority: docs/09 §9.16 · docs/13 §13.15 · docs/22 · M7 §37
 *
 * A REAL DATABASE. The publication gate, the URL scheme constraint and the
 * deduplication indexes are all database guarantees, and none of them exists in
 * a mock. The normalisation tests need no database and run beside them.
 *
 * SYNTHETIC CONTENT ONLY. No real VTU or college notice appears here.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { loadConfig } from '../src/config.js';
import { createClient, type Sql } from '../src/db/client.js';
import { runMigrations } from '../src/db/migrate.js';
import { seed } from '../src/db/seed.js';
import { createApp } from '../src/http/app.js';
import { createLogger } from '../src/observability/logger.js';
import {
  checkAnnouncementUrl,
  contentHashOf,
  normalizeAnnouncement,
  parseTimestamp,
  toPlainText,
} from '../src/announcements/normalize.js';
import { publishAnnouncement, upsertAnnouncement } from '../src/announcements/store.js';

/* -------------------------------------------------------------------------- */
/* Normalisation — no database needed                                         */
/* -------------------------------------------------------------------------- */

describe('announcement URLs', () => {
  /*
   * AN ALLOWLIST, NOT A BLOCKLIST (M7 §31). A blocklist has to be right about
   * every scheme that will ever exist.
   */
  it('accepts http and https and nothing else', () => {
    expect(checkAnnouncementUrl('https://example.edu/notice').ok).toBe(true);
    expect(checkAnnouncementUrl('http://example.edu/notice').ok).toBe(true);

    for (const hostile of [
      'javascript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'file:///etc/passwd',
      'vbscript:msgbox(1)',
      'blob:https://example.edu/abc',
    ]) {
      expect(checkAnnouncementUrl(hostile).ok).toBe(false);
    }
  });

  /* A link into the student's own network is either a mistake or an attack. */
  it('refuses links to private and loopback addresses', () => {
    for (const internal of [
      'http://localhost:3001/admin',
      'http://127.0.0.1/',
      'http://192.168.1.1/',
      'http://10.0.0.5/',
      'http://169.254.169.254/latest/meta-data/',
    ]) {
      expect(checkAnnouncementUrl(internal).ok).toBe(false);
    }
  });

  /* `https://vtu.ac.in@evil.example` reads as the university at a glance. */
  it('refuses a link carrying credentials', () => {
    expect(checkAnnouncementUrl('https://vtu.ac.in@evil.example/notice').ok).toBe(false);
  });

  it('treats an absent link as absent rather than invalid', () => {
    expect(checkAnnouncementUrl(null)).toEqual({ ok: true, url: null });
    expect(checkAnnouncementUrl('  ')).toEqual({ ok: true, url: null });
  });
});

describe('announcement text', () => {
  /*
   * MARKUP IS REMOVED, NOT ESCAPED. A sanitiser decides which HTML is safe to
   * keep, a question with a long history of wrong answers. This keeps none.
   */
  it('strips markup rather than keeping any of it', () => {
    const hostile = '<p>Results are out <script>alert(1)</script><img src=x onerror=alert(1)></p>';
    const text = toPlainText(hostile);

    expect(text).not.toContain('<');
    expect(text).not.toContain('script');
    expect(text).toContain('Results are out');
  });

  it('keeps paragraph breaks as line breaks', () => {
    expect(toPlainText('<p>First</p><p>Second</p>')).toBe('First\nSecond');
  });

  it('decodes the entities a notice actually uses', () => {
    expect(toPlainText('Fees &amp; dues &lt;important&gt;')).toBe('Fees & dues <important>');
  });

  it('reports empty content as absent', () => {
    expect(toPlainText('   ')).toBeNull();
    expect(toPlainText('<p> </p>')).toBeNull();
  });
});

describe('announcement dates', () => {
  it('parses a real timestamp and refuses anything else', () => {
    expect(parseTimestamp('2026-09-12T00:00:00Z')).toBe('2026-09-12T00:00:00.000Z');
    expect(parseTimestamp('apply soon')).toBeNull();
    expect(parseTimestamp('')).toBeNull();
    expect(parseTimestamp(null)).toBeNull();
  });
});

describe('normalisation', () => {
  const base = {
    publisher: 'Demo University (synthetic)',
    title: 'A notice',
    category: 'general' as const,
  };

  it('refuses a notice with no title', () => {
    const outcome = normalizeAnnouncement({ ...base, title: '   ' });
    expect(outcome.ok).toBe(false);
  });

  it('refuses a notice whose link is unsafe, rather than dropping the link', () => {
    const outcome = normalizeAnnouncement({ ...base, canonicalUrl: 'javascript:alert(1)' });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toContain('http');
  });

  it('refuses a deadline that precedes the publication date', () => {
    const outcome = normalizeAnnouncement({
      ...base,
      publishedAt: '2026-09-10T00:00:00Z',
      deadlineAt: '2026-09-01T00:00:00Z',
    });
    expect(outcome.ok).toBe(false);
  });

  /*
   * The hash is over NORMALISED content, so re-fetching a page whose whitespace
   * or markup changed is not a new notice — but a real edit is.
   */
  it('gives the same content the same identity through cosmetic change', () => {
    const a = normalizeAnnouncement({ ...base, body: '<p>Results  are   out</p>' });
    const b = normalizeAnnouncement({ ...base, body: 'Results are out' });
    expect(a.ok && b.ok && a.value.contentHash === b.value.contentHash).toBe(true);
  });

  it('changes identity when the content genuinely changes', () => {
    const a = contentHashOf({
      title: 'Closes Friday',
      body: null,
      category: 'backlog',
      canonicalUrl: null,
      publishedAt: null,
      deadlineAt: null,
    });
    const b = contentHashOf({
      title: 'Closes Monday',
      body: null,
      category: 'backlog',
      canonicalUrl: null,
      publishedAt: null,
      deadlineAt: null,
    });
    expect(a).not.toBe(b);
  });
});

/* -------------------------------------------------------------------------- */
/* The database                                                               */
/* -------------------------------------------------------------------------- */

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeDb = DATABASE_URL === undefined ? describe.skip : describe;

describeDb('announcements against PostgreSQL', () => {
  let sql: Sql;
  let app: Express;
  const logger = createLogger('silent', false);

  beforeAll(async () => {
    sql = createClient(DATABASE_URL as string);
    await runMigrations(sql);
    await seed(sql);
    app = createApp(
      loadConfig({ DATABASE_URL, NODE_ENV: 'test', APP_ENV: 'test' }),
      sql,
      logger,
    );
  }, 60_000);

  afterAll(async () => {
    await sql.end();
  });

  beforeEach(async () => {
    await sql`DELETE FROM announcements`;
  });

  async function store(
    overrides: Partial<{
      title: string;
      body: string | null;
      category: string;
      externalId: string | null;
      sourceId: string | null;
      deadlineAt: string | null;
      audience: Record<string, unknown>;
    }> = {},
  ) {
    const normalized = normalizeAnnouncement({
      publisher: 'Demo University (synthetic)',
      title: overrides.title ?? 'A notice',
      body: overrides.body ?? null,
      category: (overrides.category ?? 'general') as 'general',
      canonicalUrl: null,
      publishedAt: '2026-09-01T00:00:00Z',
      eventStartAt: null,
      deadlineAt: overrides.deadlineAt ?? null,
      externalId: overrides.externalId ?? null,
    });
    if (!normalized.ok) throw new Error(normalized.reason);

    return upsertAnnouncement(sql, {
      normalized: normalized.value,
      origin: overrides.sourceId === undefined ? 'operator_entry' : 'external_source',
      sourceId: overrides.sourceId ?? null,
      audience: (overrides.audience ?? {}) as never,
    });
  }

  /* ---- the publication gate ------------------------------------------- */

  describe('the publication gate', () => {
    /*
     * UNVALIDATED CONTENT DOES NOT REACH A STUDENT (M7 §11). Storing a notice
     * and vouching for it are different acts.
     */
    it('does not serve a stored announcement until it is published', async () => {
      await store({ title: 'Unverified notice' });

      const response = await request(app).get('/api/v1/announcements');
      expect(response.status).toBe(200);
      expect(response.body.data.length).toBe(0);
      expect(response.body.total).toBe(0);
    });

    it('serves it once verified and published', async () => {
      const outcome = await store({ title: 'Verified notice' });
      await publishAnnouncement(sql, outcome.id, 'operator');

      const response = await request(app).get('/api/v1/announcements');
      expect(response.body.data.length).toBe(1);
      expect(response.body.data[0].title).toBe('Verified notice');
    });

    /* The database refuses publication without verification, not just the code. */
    it('refuses to mark anything published without verification', async () => {
      const outcome = await store();
      await expect(
        sql`UPDATE announcements SET publication = 'published' WHERE id = ${outcome.id}::uuid`,
      ).rejects.toThrow();
    });

    /* An unpublished id is NOT FOUND: "it exists but you may not see it" is
       itself information about unreleased content. */
    it('answers 404 for an unpublished announcement by id', async () => {
      const outcome = await store();
      const response = await request(app).get(`/api/v1/announcements/${outcome.id}`);
      expect(response.status).toBe(404);
    });

    it('refuses an unsafe URL at the database level too', async () => {
      await expect(
        sql`
          INSERT INTO announcements (origin, publisher, title, canonical_url, content_hash)
          VALUES ('operator_entry', 'X', 'Y', 'javascript:alert(1)', ${'a'.repeat(64)})
        `,
      ).rejects.toThrow();
    });
  });

  /* ---- deduplication --------------------------------------------------- */

  describe('deduplication', () => {
    /* The same notice seen twice is one announcement (M7 §10). */
    it('recognises the same item from the same source', async () => {
      const first = await store({ sourceId: 'vtu-announcements', externalId: 'notice-1' });
      const second = await store({ sourceId: 'vtu-announcements', externalId: 'notice-1' });

      expect(first.kind).toBe('created');
      expect(second.kind).toBe('unchanged');
      expect(second.id).toBe(first.id);

      const [count] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM announcements`;
      expect(count?.n).toBe(1);
    });

    it('recognises identical content from a source that names nothing', async () => {
      const first = await store({ sourceId: 'vtu-announcements', title: 'Same words' });
      const second = await store({ sourceId: 'vtu-announcements', title: 'Same words' });

      expect(second.kind).toBe('unchanged');
      expect(second.id).toBe(first.id);
    });

    it('updates in place when the content changes', async () => {
      const first = await store({
        sourceId: 'vtu-announcements',
        externalId: 'notice-1',
        title: 'Closes Friday',
      });
      const second = await store({
        sourceId: 'vtu-announcements',
        externalId: 'notice-1',
        title: 'Closes Monday',
      });

      expect(second.kind).toBe('updated');
      expect(second.id).toBe(first.id);

      const [row] = await sql<{ title: string; n: number }[]>`
        SELECT title, (SELECT count(*)::int FROM announcements) AS n
          FROM announcements WHERE id = ${first.id}::uuid
      `;
      expect(row?.title).toBe('Closes Monday');
      expect(row?.n).toBe(1);
    });

    /*
     * AN EDIT WITHDRAWS VERIFICATION (M7 §11). Content that changed has not
     * been checked, and a published notice quietly becoming different text is
     * how unreviewed content reaches a student.
     */
    it('unpublishes an announcement whose content changed', async () => {
      const first = await store({
        sourceId: 'vtu-announcements',
        externalId: 'notice-1',
        title: 'Closes Friday',
      });
      await publishAnnouncement(sql, first.id, 'operator');
      expect((await request(app).get('/api/v1/announcements')).body.total).toBe(1);

      await store({
        sourceId: 'vtu-announcements',
        externalId: 'notice-1',
        title: 'Closes Monday',
      });

      expect((await request(app).get('/api/v1/announcements')).body.total).toBe(0);
    });

    /* Re-seeing an unchanged notice must not undo a verification. */
    it('keeps a published announcement published when nothing changed', async () => {
      const first = await store({ sourceId: 'vtu-announcements', externalId: 'notice-1' });
      await publishAnnouncement(sql, first.id, 'operator');
      await store({ sourceId: 'vtu-announcements', externalId: 'notice-1' });

      expect((await request(app).get('/api/v1/announcements')).body.total).toBe(1);
    });
  });

  /* ---- the read API ----------------------------------------------------- */

  describe('the read API', () => {
    async function published(overrides: Parameters<typeof store>[0] = {}) {
      const outcome = await store(overrides);
      await publishAnnouncement(sql, outcome.id, 'operator');
      return outcome.id;
    }

    it('filters by category', async () => {
      await published({ title: 'Result notice', category: 'results' });
      await published({ title: 'Holiday notice', category: 'holiday' });

      const results = await request(app).get('/api/v1/announcements?category=results');
      expect(results.body.total).toBe(1);
      expect(results.body.data[0].category).toBe('results');
    });

    /* A typo must not read as "there is nothing in that category". */
    it('refuses an unknown category rather than returning everything', async () => {
      await published();
      const response = await request(app).get('/api/v1/announcements?category=nonsense');
      expect(response.status).toBe(400);
    });

    it('pages, and caps how much a caller may take', async () => {
      for (let index = 0; index < 5; index += 1) {
        await published({ title: `Notice ${String(index)}` });
      }

      const page = await request(app).get('/api/v1/announcements?limit=2&offset=2');
      expect(page.body.data.length).toBe(2);
      expect(page.body.total).toBe(5);

      const capped = await request(app).get('/api/v1/announcements?limit=100000');
      expect(capped.body.limit).toBeLessThanOrEqual(100);
    });

    it('serves one published announcement by id', async () => {
      const id = await published({ title: 'Findable' });
      const response = await request(app).get(`/api/v1/announcements/${id}`);

      expect(response.status).toBe(200);
      expect(response.body.title).toBe('Findable');
      expect(response.body.audience).toBeDefined();
    });

    /*
     * THE FEED TAKES NO STUDENT CONTEXT (M7 §13, §40). There is no parameter to
     * personalise with, so the service cannot learn who is asking.
     */
    it('ignores anything that looks like student context', async () => {
      await published({ title: 'For everyone' });

      const response = await request(app).get(
        '/api/v1/announcements?semester=5&branch=CSE&usn=1XX22CS001',
      );
      expect(response.status).toBe(200);
      expect(response.body.data.length).toBe(1);
      // Identical to the unparameterised request: nothing was filtered by it.
      const plain = await request(app).get('/api/v1/announcements');
      expect(response.body.total).toBe(plain.body.total);
    });

    it('offers only filters that would return something', async () => {
      await published({ category: 'results' });
      const response = await request(app).get('/api/v1/announcements/filters');

      expect(response.status).toBe(200);
      expect(response.body.categories.map((c: { value: string }) => c.value)).toEqual(['results']);
    });

    it('carries the audience so the browser can decide relevance', async () => {
      await published({
        title: 'Fifth semester only',
        audience: { semester: 5, branchName: 'Computer Science and Engineering' },
      });

      const response = await request(app).get('/api/v1/announcements');
      expect(response.body.data[0].audience.semester).toBe(5);
      expect(response.body.data[0].audience.branchName).toBe('Computer Science and Engineering');
    });
  });

  /* ---- operator entry --------------------------------------------------- */

  describe('operator entry', () => {
    it('stores an entry, unpublished', async () => {
      const response = await request(app).post('/api/v1/announcements/entry').send({
        publisher: 'Demo College (synthetic)',
        title: 'Internal assessment schedule',
        category: 'college_notice',
      });

      expect(response.status).toBe(201);
      expect(response.body.published).toBe(false);
      // Not student-visible until someone verifies it.
      expect((await request(app).get('/api/v1/announcements')).body.total).toBe(0);
    });

    /* The caller cannot publish. Storing and vouching are separate acts. */
    it('ignores any attempt to publish through the entry route', async () => {
      const response = await request(app).post('/api/v1/announcements/entry').send({
        publisher: 'X',
        title: 'Sneaky',
        category: 'general',
        publication: 'published',
        verification: 'verified',
      });

      expect(response.status).toBe(201);
      expect((await request(app).get('/api/v1/announcements')).body.total).toBe(0);
    });

    it('refuses an entry with an unsafe link', async () => {
      const response = await request(app).post('/api/v1/announcements/entry').send({
        publisher: 'X',
        title: 'Bad link',
        category: 'general',
        canonicalUrl: 'javascript:alert(1)',
      });
      expect(response.status).toBe(400);
    });

    it('refuses an entry with no title', async () => {
      const response = await request(app)
        .post('/api/v1/announcements/entry')
        .send({ publisher: 'X', title: '', category: 'general' });
      expect(response.status).toBe(400);
    });

    it('strips markup from an entered body', async () => {
      const created = await request(app).post('/api/v1/announcements/entry').send({
        publisher: 'X',
        title: 'Has markup',
        category: 'general',
        body: '<script>alert(1)</script>Real text',
      });

      await publishAnnouncement(sql, created.body.id, 'operator');
      const response = await request(app).get(`/api/v1/announcements/${created.body.id}`);

      expect(response.body.body).not.toContain('<');
      expect(response.body.body).toContain('Real text');
    });

    it('publishes only when a verifier is named', async () => {
      const created = await request(app)
        .post('/api/v1/announcements/entry')
        .send({ publisher: 'X', title: 'Needs a name', category: 'general' });

      const anonymous = await request(app)
        .post(`/api/v1/announcements/${created.body.id}/publish`)
        .send({});
      expect(anonymous.status).toBe(400);

      const named = await request(app)
        .post(`/api/v1/announcements/${created.body.id}/publish`)
        .send({ verifiedBy: 'operator' });
      expect(named.status).toBe(200);
      expect((await request(app).get('/api/v1/announcements')).body.total).toBe(1);
    });
  });

  /* ---- the VTU gate ------------------------------------------------------ */

  describe('the VTU source gate', () => {
    /*
     * OQ-006 / OQ-026 ARE OPEN, SO THE SOURCE STAYS OFF (M7 §5, §34). This is
     * asserted rather than assumed: a milestone that enabled it by accident
     * would look exactly like one that did not.
     */
    it('leaves the VTU announcement source disabled and unfetchable', async () => {
      const [source] = await sql<
        { enabled: boolean; terms_status: string; access_method: string }[]
      >`
        SELECT enabled, terms_status, access_method FROM sources WHERE id = 'vtu-announcements'
      `;

      expect(source?.enabled).toBe(false);
      expect(source?.terms_status).toBe('unknown');
      // Not even reachable: only http_fetch sources can ever be polled.
      expect(source?.access_method).toBe('none');
    });

    /* The database refuses to enable it, so no code path can. */
    it('cannot be enabled while its terms are unreviewed', async () => {
      await expect(
        sql`UPDATE sources SET enabled = true WHERE id = 'vtu-announcements'`,
      ).rejects.toThrow();
    });

    it('has no published announcements from any external source', async () => {
      const [count] = await sql<{ n: number }[]>`
        SELECT count(*)::int AS n FROM announcements WHERE origin = 'external_source'
      `;
      expect(count?.n).toBe(0);
    });
  });
});
