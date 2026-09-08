/**
 * Retrieving documents: hashing, deduplication, versioning and failure.
 *
 * Authority: Phase 7D §6–§12, §34, §37, §39
 *
 * Every response here is a stub. §39 is explicit that unit tests must not
 * depend on live VTU, and a download test that reached the network would be
 * measuring somebody's uptime rather than this code.
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createLocalDocumentStore, sha256Of } from '../src/sources/document-store.js';
import {
  downloadAll,
  EMPTY_MANIFEST,
  isFetchableUrl,
  looksLikePdf,
  type Manifest,
} from '../src/sources/vtu-download.js';

/** Bytes that begin `%PDF-`, which is all the content check asks for. */
const pdf = (marker: string): Uint8Array => new TextEncoder().encode(`%PDF-1.7\n${marker}`);

const respond = (bytes: Uint8Array, headers: Record<string, string> = {}): Response =>
  new Response(bytes, { status: 200, headers: { 'content-type': 'application/pdf', ...headers } });

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'gradtools-store-'));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const options = { dryRun: false, changedOnly: false, delayMs: 0, limit: null };
const now = () => '2026-09-08T00:00:00.000Z';

describe('the document store', () => {
  it('names a document by its own hash, and stores identical bytes once', async () => {
    const store = createLocalDocumentStore(root);
    const first = await store.put(pdf('a'));
    const second = await store.put(pdf('a'));

    expect(first.sha256).toBe(sha256Of(pdf('a')));
    expect(first.alreadyPresent).toBe(false);
    expect(second.alreadyPresent).toBe(true);
    expect(second.sha256).toBe(first.sha256);
  });

  it('refuses a path that is not a hash', () => {
    /*
     * §37. Every path in the store is built from a hash, so this is what makes
     * traversal impossible: `..` is not sixty-four hex characters.
     */
    const store = createLocalDocumentStore(root);
    expect(() => store.pathFor('../../etc/passwd')).toThrow(/not a sha-256/i);
    expect(() => store.pathFor('')).toThrow();
  });

  it('returns null for a document it does not hold', async () => {
    const store = createLocalDocumentStore(root);
    expect(await store.get('0'.repeat(64))).toBeNull();
  });
});

describe('what may be fetched', () => {
  it('accepts VTU over https and refuses everything else', () => {
    expect(isFetchableUrl('https://vtu.ac.in/pdf/x.pdf').ok).toBe(true);
    expect(isFetchableUrl('https://www.vtu.ac.in/pdf/x.pdf').ok).toBe(true);
    expect(isFetchableUrl('https://evil.example/x.pdf').ok).toBe(false);
    expect(isFetchableUrl('file:///etc/passwd').ok).toBe(false);
    expect(isFetchableUrl('not a url').ok).toBe(false);
  });

  it('does not mistake a login page for a PDF', () => {
    expect(looksLikePdf(pdf('x'))).toBe(true);
    expect(looksLikePdf(new TextEncoder().encode('<!DOCTYPE html>'))).toBe(false);
  });
});

describe('a download run', () => {
  it('stores one binary when two URLs return the same bytes', async () => {
    /*
     * §6. The same PDF is linked from several programme rows. One document,
     * two source references — not two copies and not two catalogue entries.
     */
    const store = createLocalDocumentStore(root);
    const { outcomes, manifest } = await downloadAll(
      ['https://vtu.ac.in/pdf/a.pdf', 'https://vtu.ac.in/pdf/b.pdf'],
      store,
      EMPTY_MANIFEST,
      options,
      { fetch: () => Promise.resolve(respond(pdf('same'))), now },
    );

    expect(manifest.entries).toHaveLength(1);
    expect(manifest.entries[0]?.urls).toEqual([
      'https://vtu.ac.in/pdf/a.pdf',
      'https://vtu.ac.in/pdf/b.pdf',
    ]);
    expect(outcomes.map((o) => o.state)).toEqual(['downloaded', 'duplicate']);
  });

  it('keeps the old version when a URL’s bytes change', async () => {
    /*
     * §7. Content-addressed storage makes this free: different bytes hash to a
     * different name, so nothing is overwritten and the history is real.
     */
    const store = createLocalDocumentStore(root);
    const url = 'https://vtu.ac.in/pdf/a.pdf';
    const first = await downloadAll([url], store, EMPTY_MANIFEST, options, {
      fetch: () => Promise.resolve(respond(pdf('v1'))),
      now,
    });
    const second = await downloadAll([url], store, first.manifest, options, {
      fetch: () => Promise.resolve(respond(pdf('v2'))),
      now,
    });

    expect(second.outcomes[0]?.state).toBe('changed');
    expect(second.manifest.urlHistory[url]).toEqual([sha256Of(pdf('v1')), sha256Of(pdf('v2'))]);
    /* Both versions are still in the store. */
    expect(await store.has(sha256Of(pdf('v1')))).toBe(true);
    expect(await store.has(sha256Of(pdf('v2')))).toBe(true);
  });

  it('is idempotent: a second run with no change downloads nothing', async () => {
    // §34, asserted by counting actual fetches rather than trusting the report.
    const store = createLocalDocumentStore(root);
    let calls = 0;
    const fetcher = () => {
      calls += 1;
      return Promise.resolve(respond(pdf('same')));
    };
    const first = await downloadAll(
      ['https://vtu.ac.in/pdf/a.pdf'],
      store,
      EMPTY_MANIFEST,
      options,
      {
        fetch: fetcher,
        now,
      },
    );
    const second = await downloadAll(
      ['https://vtu.ac.in/pdf/a.pdf'],
      store,
      first.manifest,
      options,
      {
        fetch: fetcher,
        now,
      },
    );

    expect(second.outcomes[0]?.state).toBe('already_present');
    expect(second.manifest.entries).toHaveLength(1);
    /* Two calls: the second was conditional and came back 304. */
    expect(calls).toBe(2);
  });

  it('does not fetch at all in a dry run', async () => {
    const store = createLocalDocumentStore(root);
    let calls = 0;
    const { outcomes, manifest } = await downloadAll(
      ['https://vtu.ac.in/pdf/a.pdf'],
      store,
      EMPTY_MANIFEST,
      { ...options, dryRun: true },
      {
        fetch: () => {
          calls += 1;
          return Promise.resolve(respond(pdf('a')));
        },
        now,
      },
    );

    expect(calls).toBe(0);
    expect(manifest.entries).toHaveLength(0);
    expect(outcomes[0]?.reason).toMatch(/would download/i);
  });

  it('records a failure and carries on to the next document', async () => {
    /*
     * §8. A broken link in the middle of a thousand documents is normal, and a
     * crawler that stops there is useless.
     */
    const store = createLocalDocumentStore(root);
    const { outcomes } = await downloadAll(
      ['https://vtu.ac.in/pdf/gone.pdf', 'https://vtu.ac.in/pdf/fine.pdf'],
      store,
      EMPTY_MANIFEST,
      options,
      {
        fetch: (input) =>
          Promise.resolve(
            String(input).includes('gone')
              ? new Response('missing', { status: 404 })
              : respond(pdf('fine')),
          ),
        now,
      },
    );

    expect(outcomes[0]).toMatchObject({ state: 'failed' });
    expect(outcomes[0]?.reason).toMatch(/404/);
    expect(outcomes[1]?.state).toBe('downloaded');
  });

  it('refuses bytes that are not a PDF, whatever the content type says', async () => {
    const store = createLocalDocumentStore(root);
    const { outcomes } = await downloadAll(
      ['https://vtu.ac.in/pdf/a.pdf'],
      store,
      EMPTY_MANIFEST,
      options,
      {
        fetch: () => Promise.resolve(respond(new TextEncoder().encode('<html>login</html>'))),
        now,
      },
    );
    expect(outcomes[0]).toMatchObject({ state: 'invalid_document' });
  });

  it('blocks a URL that is not a VTU document without fetching it', async () => {
    const store = createLocalDocumentStore(root);
    let calls = 0;
    const { outcomes } = await downloadAll(
      ['https://evil.example/x.pdf'],
      store,
      EMPTY_MANIFEST,
      options,
      {
        fetch: () => {
          calls += 1;
          return Promise.resolve(respond(pdf('x')));
        },
        now,
      },
    );
    expect(outcomes[0]?.state).toBe('blocked');
    expect(calls).toBe(0);
  });

  it('skips a held document with no validator when asked for changes only', async () => {
    const store = createLocalDocumentStore(root);
    const held: Manifest = {
      version: 1,
      entries: [
        {
          sha256: sha256Of(pdf('a')),
          byteSize: 10,
          mimeType: 'application/pdf',
          urls: ['https://vtu.ac.in/pdf/a.pdf'],
          firstSeen: now(),
          lastSeen: now(),
          etag: null,
          lastModified: null,
        },
      ],
      urlHistory: {},
    };
    let calls = 0;
    const { outcomes } = await downloadAll(
      ['https://vtu.ac.in/pdf/a.pdf'],
      store,
      held,
      { ...options, changedOnly: true },
      {
        fetch: () => {
          calls += 1;
          return Promise.resolve(respond(pdf('a')));
        },
        now,
      },
    );

    expect(calls).toBe(0);
    expect(outcomes[0]?.state).toBe('already_present');
    expect(outcomes[0]?.reason).toMatch(/no validator/i);
  });

  it('gives every URL exactly one outcome', async () => {
    // §9: none is dropped, whatever happens to it.
    const store = createLocalDocumentStore(root);
    const urls = [
      'https://vtu.ac.in/pdf/a.pdf',
      'https://evil.example/b.pdf',
      'https://vtu.ac.in/pdf/c.pdf',
    ];
    const { outcomes } = await downloadAll(urls, store, EMPTY_MANIFEST, options, {
      fetch: () => Promise.resolve(respond(pdf('x'))),
      now,
    });
    expect(outcomes.map((o) => o.url)).toEqual(urls);
  });
});
