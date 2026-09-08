/**
 * Content-addressed storage for retrieved documents.
 *
 * Authority: Phase 7D §4, §6, §7, §27, §37
 *
 * ---------------------------------------------------------------------------
 * THE HASH IS THE NAME
 * ---------------------------------------------------------------------------
 *
 * A document is stored under its own SHA-256 and nothing else. That gives three
 * properties for free:
 *
 *   DEDUPLICATION   the same PDF linked from six programme rows is one file,
 *                   not six (§6).
 *   VERSIONING      a URL whose bytes change produces a different name, so the
 *                   old version is still there rather than overwritten (§7).
 *   SAFETY          nothing derived from a URL or a Content-Disposition header
 *                   reaches the filesystem, so a filename cannot traverse out
 *                   of the store (§37).
 *
 * The two-character prefix directory is the usual git-object arrangement: a
 * thousand documents in one directory is unpleasant to list and slow on some
 * filesystems.
 *
 * ---------------------------------------------------------------------------
 * WHY LOCAL, AND BEHIND AN INTERFACE
 * ---------------------------------------------------------------------------
 *
 * The store is a local directory because the crawler is a developer tool and
 * the API has no object storage configured. `DocumentStore` is an interface so
 * that stays an implementation detail — a bucket-backed store satisfies the
 * same three methods.
 *
 * Nothing here is committed. The directory is gitignored (§29): the repository
 * keeps normalized records and provenance, not a binary dump of VTU.
 */

import { createHash } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

export interface StoredDocument {
  readonly sha256: string;
  readonly byteSize: number;
  /** True when the bytes were already present and nothing was written. */
  readonly alreadyPresent: boolean;
}

export interface DocumentStore {
  /** Stores bytes under their own hash. Idempotent. */
  put(bytes: Uint8Array): Promise<StoredDocument>;
  get(sha256: string): Promise<Uint8Array | null>;
  has(sha256: string): Promise<boolean>;
  /** Where a hash lives, for a caller that needs to hand a path to a tool. */
  pathFor(sha256: string): string;
}

export function sha256Of(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

const SHA256 = /^[0-9a-f]{64}$/;

/**
 * A hash, or a thrown error.
 *
 * Every path in this module is built from a hash, so validating the shape here
 * is what makes `pathFor` incapable of escaping the store — `..` is not
 * sixty-four hex characters (§37).
 */
function assertSha(sha256: string): string {
  if (!SHA256.test(sha256)) throw new Error(`Not a SHA-256: ${JSON.stringify(sha256)}`);
  return sha256;
}

export function createLocalDocumentStore(root: string): DocumentStore {
  const base = resolve(root);

  const pathFor = (sha256: string): string =>
    join(base, assertSha(sha256).slice(0, 2), `${sha256}.bin`);

  return {
    pathFor,

    async put(bytes) {
      const sha256 = sha256Of(bytes);
      const path = pathFor(sha256);
      try {
        const existing = await stat(path);
        /*
         * Already stored. The bytes are not rewritten: they hash to this name,
         * so by definition they are the bytes already there.
         */
        return { sha256, byteSize: existing.size, alreadyPresent: true };
      } catch {
        await mkdir(dirname(path), { recursive: true });
        await writeFile(path, bytes);
        return { sha256, byteSize: bytes.byteLength, alreadyPresent: false };
      }
    },

    async get(sha256) {
      try {
        return new Uint8Array(await readFile(pathFor(sha256)));
      } catch {
        return null;
      }
    },

    async has(sha256) {
      try {
        await stat(pathFor(sha256));
        return true;
      } catch {
        return false;
      }
    },
  };
}
