/**
 * Shown when the sign-in service cannot be reached (offline, or the service is
 * down). Says what is true and offers a retry; it never retries in a loop —
 * AuthContext checks once more on its own only when the device reports that
 * it is back online.
 *
 *   unreachable   nobody is known on this device: the guest records show, and
 *                 nothing has been signed out.
 *   offline       a signed-in account this device verified recently: ITS
 *                 records on this device show, with when they last synced.
 *                 Syncing and signing out need a connection, so the notice
 *                 says so rather than letting them fail.
 */

import { useEffect, useState } from 'react';
import type { SyncBookkeeping } from '../../domain/sync.js';
import { Button } from '../../components/ui/button.js';
import { Callout } from '../../components/ui/feedback.js';
import { readValue } from '../../repositories/local/store.js';
import { useAuth } from './AuthContext.js';

function formatSynced(iso: string): string {
  const when = new Date(iso);
  if (Number.isNaN(when.getTime())) return 'at an unknown time';
  return when.toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** When this account last synced, from its own bookkeeping on this device. */
function useLastSynced(userId: string | null): string | null | undefined {
  const [value, setValue] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    if (userId === null) return;
    let cancelled = false;
    void readValue<SyncBookkeeping>(userId, 'syncState').then((stored) => {
      if (!cancelled) setValue(stored?.lastSyncedAt ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, [userId]);
  return value;
}

export function AuthUnreachable({
  className,
  show = ['unreachable', 'offline'],
}: {
  readonly className?: string;
  /** Which of the two states this placement speaks for. */
  readonly show?: readonly ('unreachable' | 'offline')[];
}) {
  const { state } = useAuth();
  const [busy, setBusy] = useState(false);
  const offline = state.status === 'offline';
  const lastSynced = useLastSynced(offline ? state.identity.userId : null);
  if (state.status !== 'unreachable' && state.status !== 'offline') return null;
  if (!show.includes(state.status)) return null;

  const retry = (
    <Button
      size="sm"
      disabled={busy}
      onClick={() => {
        setBusy(true);
        /*
         * A sign-in script that failed to load is never retried by Clerk
         * itself, so a real retry starts the app again. Records live in
         * on-device storage and survive it. Explicit, and once per tap.
         */
        window.location.reload();
      }}
    >
      {busy ? 'Trying again…' : 'Try again'}
    </Button>
  );
  const extra = className === undefined ? {} : { className };

  if (state.status === 'offline') {
    const who = state.identity.email ?? 'your account';
    const synced =
      lastSynced === undefined
        ? ''
        : lastSynced === null
          ? 'They have not been synced yet. '
          : `Last synced ${formatSynced(lastSynced)}. `;
    return (
      <Callout tone="warning" role="status" title="You’re offline." action={retry} {...extra}>
        Showing the records saved on this device for {who}. {synced}Changes you make stay here and
        go up the next time you sync. Syncing and signing out need a connection.
      </Callout>
    );
  }

  return (
    <Callout
      tone="warning"
      role="status"
      title="Can’t reach GradTools sign-in."
      action={retry}
      {...extra}
    >
      Check your connection. Your records on this device still work, and nothing has been signed
      out.
    </Callout>
  );
}
