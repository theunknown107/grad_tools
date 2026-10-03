/**
 * The acquisition boundary: the one door every outbound source fetch goes
 * through.
 *
 * Authority: Phase 7C §1–§4, §87, §100, §102 · docs/40
 *
 * ---------------------------------------------------------------------------
 * THE GATE EXISTED AND NOTHING CALLED IT
 * ---------------------------------------------------------------------------
 *
 * `checkSourcePermission` was written, documented and tested, and an audit of
 * every outbound `fetch` in this service found that its only callers were its
 * own tests. `vtu-discover`, `vtu-sync`, `vtu-smoke` and the downloader each
 * reached vtu.ac.in directly. `vtu-scheme.ts` even carries a comment saying it
 * is "gated by `checkSourcePermission` against the source registry" — which was
 * not true of any code path.
 *
 * A gate nothing calls is a comment. This module is the door, and the scripts
 * go through it.
 *
 * ---------------------------------------------------------------------------
 * TWO MODES, ONE PIPELINE (§2)
 * ---------------------------------------------------------------------------
 *
 *   MODE A  authorized live source — the registry permits fetching
 *   MODE B  a document a person supplied, because it does not
 *
 * The difference is ACQUISITION ONLY. What happens to the bytes afterwards —
 * hash, version, extract, normalize, validate, applicability — is identical,
 * which is what makes the eventual grant of permission a configuration change
 * rather than a rewrite (§102).
 *
 * ---------------------------------------------------------------------------
 * IT FAILS CLOSED, AND THAT IS DELIBERATE
 * ---------------------------------------------------------------------------
 *
 * No database connection means no registry, which means no evidence that
 * anything is permitted — so it refuses. A crawler that fetches when it cannot
 * find its own rules is exactly the failure the registry exists to prevent,
 * and "the database was down" is not permission.
 */

import type { Sql } from '../db/client.js';
import { findSource } from '../db/queries.js';
import { checkSourcePermission, type FetchDecision } from './fetch.js';

/** Why an acquisition did not happen live. */
export type AcquisitionRefusal =
  /** There is no registry to consult. */
  | 'no_registry'
  /** The registry has never heard of this source id. */
  | 'unregistered_source'
  /** The registry has heard of it and does not permit fetching. */
  | 'not_permitted';

export type AcquisitionMode =
  | { readonly mode: 'live' }
  | {
      readonly mode: 'supplied';
      readonly refusal: AcquisitionRefusal;
      /** What to tell a person, in words they can act on. */
      readonly detail: string;
    };

/**
 * May this source be fetched automatically, right now?
 *
 * The answer is read from the registry every time rather than cached: an
 * authorisation that was true last week is not evidence about today, and the
 * whole point of recording `terms_reviewed_at` is that it can expire.
 */
export async function acquisitionMode(sql: Sql | null, sourceId: string): Promise<AcquisitionMode> {
  if (sql === null) {
    return {
      mode: 'supplied',
      refusal: 'no_registry',
      detail:
        `No database connection, so the source registry cannot be consulted. ` +
        `"${sourceId}" is not fetched: an unreachable registry is not permission.`,
    };
  }

  const source = await findSource(sql, sourceId);
  if (source === null) {
    return {
      mode: 'supplied',
      refusal: 'unregistered_source',
      detail:
        `"${sourceId}" is not in the source registry. Every automated fetch path ` +
        `must have a registry identity and a recorded legal status before it runs (§3, §4).`,
    };
  }

  const decision: FetchDecision = checkSourcePermission(source);
  if (decision.allowed) return { mode: 'live' };

  return { mode: 'supplied', refusal: 'not_permitted', detail: decision.detail };
}

/**
 * The same question, for a caller that cannot continue without an answer.
 *
 * Throws rather than returning, because a script that treats "refused" as a
 * value it may ignore is a script that will eventually ignore it.
 */
export async function requireFetchPermission(sql: Sql | null, sourceId: string): Promise<void> {
  const mode = await acquisitionMode(sql, sourceId);
  if (mode.mode === 'live') return;
  throw new SourceNotAuthorized(sourceId, mode.refusal, mode.detail);
}

export class SourceNotAuthorized extends Error {
  readonly sourceId: string;
  readonly refusal: AcquisitionRefusal;

  constructor(sourceId: string, refusal: AcquisitionRefusal, detail: string) {
    super(detail);
    this.name = 'SourceNotAuthorized';
    this.sourceId = sourceId;
    this.refusal = refusal;
  }
}
