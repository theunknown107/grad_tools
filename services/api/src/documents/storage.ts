/**
 * Object storage.
 *
 * Authority: docs/17 §17.10 · docs/13 §T-03 · M5 §7
 *
 * An interface with a local-filesystem driver. No cloud provider is chosen yet
 * (M5 §7); swapping in S3, R2 or Blob storage later means one more
 * implementation of `ObjectStore`, not a change to any caller.
 *
 * THREE PROPERTIES THAT MAKE THIS SAFE
 *
 * 1. Keys are derived from the content hash, never from a filename. Nothing
 *    attacker-controlled reaches a path, so path traversal has no input to
 *    work with — it is designed out rather than filtered.
 * 2. Storage lives OUTSIDE the repository and outside any served directory.
 *    Files are read back through this module and streamed by the application;
 *    the web server never maps a URL onto this filesystem (M5 §7).
 * 3. Every resolved path is re-checked to be inside the root before use. Belt
 *    and braces: property 1 should make this unreachable, and it is asserted
 *    anyway, because "should be unreachable" is how traversal bugs are written.
 */

import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';

export interface ObjectStore {
  put(key: string, bytes: Buffer): Promise<void>;
  get(key: string): Promise<Buffer>;
  exists(key: string): Promise<boolean>;
  delete(key: string): Promise<void>;
}

/**
 * The storage key for a document.
 *
 * Content-addressed and fanned out two levels, so no directory accumulates
 * millions of entries. `sha256` is validated by the caller and by a database
 * CHECK, but it is re-checked here because this function's whole safety
 * argument is that its output contains nothing but hex.
 */
export function storageKeyFor(sha256: string): string {
  if (!/^[0-9a-f]{64}$/.test(sha256)) {
    throw new Error('Storage key must be derived from a lowercase hex SHA-256.');
  }
  return `${sha256.slice(0, 2)}/${sha256.slice(2, 4)}/${sha256}`;
}

export class LocalObjectStore implements ObjectStore {
  private readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
  }

  /**
   * Resolves a key to an absolute path, refusing anything that escapes the
   * root.
   *
   * `resolve` collapses `..` before the check, so a key of `../../etc/passwd`
   * produces a path outside the root and is rejected here rather than written.
   */
  private pathFor(key: string): string {
    const full = resolve(join(this.root, key));
    if (full !== this.root && !full.startsWith(this.root + sep)) {
      throw new Error('Refusing a storage key that resolves outside the storage root.');
    }
    return full;
  }

  async put(key: string, bytes: Buffer): Promise<void> {
    const path = this.pathFor(key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, bytes);
  }

  async get(key: string): Promise<Buffer> {
    return readFile(this.pathFor(key));
  }

  async exists(key: string): Promise<boolean> {
    try {
      await stat(this.pathFor(key));
      return true;
    } catch {
      return false;
    }
  }

  async delete(key: string): Promise<void> {
    await rm(this.pathFor(key), { force: true });
  }
}

/** In-memory store for tests. Same contract, no filesystem. */
export class MemoryObjectStore implements ObjectStore {
  private readonly items = new Map<string, Buffer>();

  put(key: string, bytes: Buffer): Promise<void> {
    if (key.includes('..')) {
      return Promise.reject(new Error('Refusing a storage key containing a traversal sequence.'));
    }
    this.items.set(key, bytes);
    return Promise.resolve();
  }

  get(key: string): Promise<Buffer> {
    const found = this.items.get(key);
    return found === undefined
      ? Promise.reject(new Error(`No object at key ${key}.`))
      : Promise.resolve(found);
  }

  exists(key: string): Promise<boolean> {
    return Promise.resolve(this.items.has(key));
  }

  delete(key: string): Promise<void> {
    this.items.delete(key);
    return Promise.resolve();
  }

  get size(): number {
    return this.items.size;
  }
}

/** Convenience for callers that have bytes and want the canonical key. */
export function keyForBytes(bytes: Buffer): string {
  return storageKeyFor(createHash('sha256').update(bytes).digest('hex'));
}
