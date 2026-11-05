/**
 * Shown when the sign-in service cannot be reached (offline, or the service is
 * down). Says what is true — the session is UNKNOWN, not expired — and offers
 * a retry. It never retries in a loop; AuthContext checks once more on its own
 * only when the device reports that it is back online.
 */

import { useState } from 'react';
import { Button } from '../../components/ui/button.js';
import { Callout } from '../../components/ui/feedback.js';
import { useAuth } from './AuthContext.js';

export function AuthUnreachable({ className }: { readonly className?: string }) {
  const { state } = useAuth();
  const [busy, setBusy] = useState(false);
  if (state.status !== 'unreachable') return null;
  return (
    <Callout
      tone="warning"
      role="status"
      title="Can’t reach GradTools sign-in."
      {...(className === undefined ? {} : { className })}
      action={
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
      }
    >
      Check your connection. Your records on this device still work, and nothing has been signed
      out.
    </Callout>
  );
}
