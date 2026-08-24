/**
 * The source adapter contract.
 *
 * Authority: docs/14 §14.2, §14.3, §14.7 · M5 §13
 *
 * THE SHAPE, AND WHY IT IS THIS SHAPE
 *
 *   fetch      the ONLY step that performs I/O
 *   parse      bytes  -> raw items      pure
 *   normalize  raw    -> canonical      pure
 *   validate   canonical -> verdict     pure
 *   publish    persistence, gated
 *
 * Everything after `fetch` is deterministic, so an adapter can be developed and
 * regression-tested entirely from a stored fixture, with no network and no
 * dependence on the source being up or unchanged. That is what makes
 * `parse/normalize/validate` golden-testable and what keeps a source outage
 * from being an untestable adapter.
 *
 * FETCHING IS GATED, NOT ASSUMED. `fetch` is separated so it can be refused.
 * An adapter is a description of how to read a source, not permission to read
 * it — the permission lives in the `sources` row and its database constraint
 * (docs/14 §14.3, M5 §10).
 */

import { createHash } from 'node:crypto';
import type { ChangeType } from '@gradtools/shared-types';

/** One item as the source presents it, before any interpretation. */
export interface RawItem {
  readonly externalId: string;
  readonly title: string;
  readonly url: string | null;
  readonly publishedAt: string | null;
}

/** One item in GradTools' canonical shape. */
export interface NormalizedItem {
  readonly externalId: string;
  readonly title: string;
  readonly url: string | null;
  readonly publishedAt: string | null;
  /** Content address of the normalized item — what "modified" is decided against. */
  readonly payloadHash: string;
}

export interface ValidationVerdict {
  readonly valid: NormalizedItem[];
  /** Rejected items with a reason. An adapter never silently drops an item. */
  readonly rejected: { readonly item: NormalizedItem; readonly reason: string }[];
}

export interface SourceAdapter {
  readonly sourceId: string;
  readonly parserVersion: string;
  /** Bytes -> raw items. Pure. Never touches the network. */
  parse(body: string): RawItem[];
  /** Raw -> canonical. Pure, total, and stable across runs. */
  normalize(raw: readonly RawItem[]): NormalizedItem[];
  /** Canonical -> verdict. Pure. */
  validate(items: readonly NormalizedItem[]): ValidationVerdict;
}

/**
 * The payload hash.
 *
 * Computed over the normalized fields in a fixed order, so the same item
 * produces the same hash on every run and across processes. A hash over an
 * object's own key order would make "modified" depend on parser incidentals.
 */
export function hashItem(item: Omit<NormalizedItem, 'payloadHash'>): string {
  const canonical = JSON.stringify([item.externalId, item.title, item.url, item.publishedAt]);
  return createHash('sha256').update(canonical).digest('hex');
}

/* -------------------------------------------------------------------------- */
/* Change detection                                                           */
/* -------------------------------------------------------------------------- */

export interface DetectedChange {
  readonly externalId: string;
  readonly changeType: ChangeType;
  readonly title: string | null;
  readonly url: string | null;
  readonly payloadHash: string;
}

/**
 * Diffs a fresh poll against what was previously seen.
 *
 * Pure, so change detection is testable without a database or a source. The
 * result is a list of changes to RECORD; nothing here sends anything, because
 * notification delivery is a later milestone (M5 §14).
 *
 * `removed` carries the last known hash rather than a null, so the record says
 * *what* disappeared. An item that reappears later produces a `new` change
 * against a hash that may differ, which is the honest description of what the
 * source did.
 */
export function detectChanges(
  previous: ReadonlyMap<string, string>,
  current: readonly NormalizedItem[],
): DetectedChange[] {
  const changes: DetectedChange[] = [];
  const seen = new Set<string>();

  for (const item of current) {
    seen.add(item.externalId);
    const before = previous.get(item.externalId);

    if (before === undefined) {
      changes.push({
        externalId: item.externalId,
        changeType: 'new',
        title: item.title,
        url: item.url,
        payloadHash: item.payloadHash,
      });
    } else if (before !== item.payloadHash) {
      changes.push({
        externalId: item.externalId,
        changeType: 'modified',
        title: item.title,
        url: item.url,
        payloadHash: item.payloadHash,
      });
    }
    // Unchanged items produce nothing. A poll that finds no change must write
    // no rows, or an unchanged page becomes an endless change log.
  }

  for (const [externalId, payloadHash] of previous) {
    if (!seen.has(externalId)) {
      changes.push({ externalId, changeType: 'removed', title: null, url: null, payloadHash });
    }
  }

  return changes;
}
