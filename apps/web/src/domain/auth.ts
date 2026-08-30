/**
 * Identity, as the app reasons about it.
 *
 * Authority: docs/11 §11.13 · docs/12 §12.14 · M9 §12, §58, §61
 *
 * ---------------------------------------------------------------------------
 * NOTHING HERE KNOWS WHAT SUPABASE IS
 * ---------------------------------------------------------------------------
 *
 * The domain knows there is a signed-in person with an opaque `userId`. It does
 * not know who issued it, what an access token looks like, or that OAuth
 * exists. All of that lives in one adapter (`repositories/cloud/supabase.ts`),
 * which is the only file in the app that imports the provider's SDK (M9 §61).
 *
 * The point is not portability for its own sake. It is that a provider's
 * concepts — a session object, a refresh token, a user metadata blob — are
 * shapes that spread everywhere once they are allowed to, and then the
 * question "can we change providers" has the answer "not without touching two
 * hundred files".
 *
 * ---------------------------------------------------------------------------
 * THE STATES A STUDENT CAN BE IN
 * ---------------------------------------------------------------------------
 *
 * Deliberately explicit, because the app must never leave a person guessing
 * whether their work is safe (M9 §39, §68).
 */

/** Who is signed in. `email` is for display; `userId` is the identity (M9 §12). */
export interface Identity {
  readonly userId: string;
  readonly email: string | null;
  /** `google` | `apple` | `email`. Shown in settings, never trusted. */
  readonly provider: string | null;
}

export type AuthState =
  /** Still working out whether a stored session is valid. */
  | { readonly status: 'restoring' }
  /** Nobody is signed in. Local-first still works completely (M9 §40). */
  | { readonly status: 'signed_out' }
  | { readonly status: 'signed_in'; readonly identity: Identity }
  /**
   * There WAS a session and it is no longer valid — expired, revoked, or the
   * account deleted elsewhere. Distinct from `signed_out` because the student
   * needs telling rather than silently finding themselves logged out (M9 §68).
   */
  | { readonly status: 'expired' };

export function identityOf(state: AuthState): Identity | null {
  return state.status === 'signed_in' ? state.identity : null;
}

/**
 * Which local storage scope this state reads.
 *
 * THE ONE FUNCTION THAT DECIDES WHOSE DATA IS ON SCREEN (M9 §37, §38). While
 * restoring, and whenever nobody is signed in, that is the anonymous scope; a
 * signed-in student reads their own.
 *
 * `expired` maps to the anonymous scope on purpose: a session we can no longer
 * verify is not proof of identity, and continuing to show an account's records
 * on a shared browser because we once saw a valid token is exactly the leak
 * §37 is about.
 */
export function scopeFor(state: AuthState): string | null {
  return state.status === 'signed_in' ? state.identity.userId : null;
}

/* -------------------------------------------------------------------------- */
/* Sync state                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * What is happening to the student's data right now.
 *
 * `failed` EXISTS AND IS SHOWN. The one thing this must never do is display
 * "Synced" after an upload that did not land (M9 §55, §68) — a student who
 * trusts that and then loses their phone loses a semester of records.
 */
export type SyncStatus =
  | 'local_only'
  | 'syncing'
  | 'synced'
  | 'offline'
  | 'failed'
  /** Changes are waiting for a person to resolve them. Not an error. */
  | 'conflicts';

export interface SyncState {
  readonly status: SyncStatus;
  /** The server cursor this device has caught up to. */
  readonly cursor: string | null;
  /** Records the server refused, with reasons, waiting to be shown. */
  readonly conflicts: readonly SyncConflict[];
  /** When a sync last completed successfully. Null means never. */
  readonly lastSyncedAt: string | null;
  /** Present only when `status` is `failed`, and written for a person. */
  readonly error: string | null;
}

export interface SyncConflict {
  readonly id: string;
  readonly collection: string;
  readonly reason: string;
  /** The version this device holds. */
  readonly local: Record<string, unknown> | null;
  /** The version the cloud holds. */
  readonly server: Record<string, unknown> | null;
}

export const IDLE_SYNC: SyncState = {
  status: 'local_only',
  cursor: null,
  conflicts: [],
  lastSyncedAt: null,
  error: null,
};

/**
 * How the sync state reads to a student.
 *
 * Short, and never reassuring beyond the facts. "Saved on this device" is what
 * is true when there is no account; it does not imply a backup exists.
 */
export const SYNC_LABEL: Record<SyncStatus, string> = {
  local_only: 'Saved on this device',
  syncing: 'Syncing…',
  synced: 'Synced',
  offline: 'Offline — changes are saved here',
  failed: 'Sync failed',
  conflicts: 'Needs your attention',
};

/* -------------------------------------------------------------------------- */
/* The first sign-in                                                          */
/* -------------------------------------------------------------------------- */

/**
 * What a student is choosing between when they first sign in.
 *
 * NOTHING IS DECIDED FOR THEM AND NOTHING HAPPENS BY DEFAULT (M9 §27, §51).
 * Signing in is not consent to upload: a student may have four years of records
 * on this device and an account they made to read announcements on, and
 * assuming the two should be merged is how people lose data.
 */
export interface MergeSituation {
  /** How many records this device holds under the anonymous scope. */
  readonly localCount: number;
  /** How many the cloud holds for this account. */
  readonly cloudCount: number;
}

export type MergeChoice =
  /** Upload this device's records into the account. */
  | 'upload_local'
  /** Take the cloud's records onto this device. */
  | 'use_cloud'
  /** Keep both: upload local records the cloud does not have, keep the rest. */
  | 'merge'
  /** Stay local-only for now. Nothing is uploaded and nothing is downloaded. */
  | 'stay_local';

/**
 * Which choices make sense in a given situation, and which is safest.
 *
 * THE SAFE OPTION IS NEVER DESTRUCTIVE AND IS NEVER PRESELECTED WHEN IT COULD
 * LOSE SOMETHING (M9 §54). With records on both sides the recommendation is
 * `merge`, because it is the only choice that discards nothing.
 */
export function mergeOptionsFor(situation: MergeSituation): {
  readonly available: readonly MergeChoice[];
  readonly recommended: MergeChoice;
} {
  const { localCount, cloudCount } = situation;

  if (localCount === 0 && cloudCount === 0) {
    return { available: ['stay_local'], recommended: 'stay_local' };
  }
  if (localCount === 0) {
    // Nothing here to lose; taking the cloud copy is the whole point.
    return { available: ['use_cloud', 'stay_local'], recommended: 'use_cloud' };
  }
  if (cloudCount === 0) {
    return { available: ['upload_local', 'stay_local'], recommended: 'upload_local' };
  }
  return {
    available: ['merge', 'upload_local', 'use_cloud', 'stay_local'],
    recommended: 'merge',
  };
}

/** Plain language for each choice, with its consequence stated (M9 §52). */
export const MERGE_LABEL: Record<MergeChoice, { title: string; detail: string }> = {
  merge: {
    title: 'Keep both',
    detail: 'Records on this device are added to your account. Nothing is deleted.',
  },
  upload_local: {
    title: 'Use this device’s records',
    detail: 'What is on this device becomes your account’s records.',
  },
  use_cloud: {
    title: 'Use my account’s records',
    detail: 'Your account’s records are downloaded here. This device’s copy is kept, not deleted.',
  },
  stay_local: {
    title: 'Keep this device only',
    detail: 'Nothing is uploaded. You can sync later from Account settings.',
  },
};
