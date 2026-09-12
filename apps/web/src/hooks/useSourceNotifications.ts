/**
 * The notices a background run decided this student should know about.
 *
 * Authority: Phase 7B.3.1 §14, §24, §50, §81–§85
 *
 * ---------------------------------------------------------------------------
 * THE ONE THING ON THIS PAGE THAT IS NOT LOCAL
 * ---------------------------------------------------------------------------
 *
 * Everything else in the notification centre is computed on the device from a
 * feed identical for every visitor, and read state never leaves the browser
 * (M7 §40). These rows are different in kind: a server-side run decided, while
 * nobody was here, that a particular VTU notice concerns this particular
 * student, and wrote it down. That is what makes it survive a closed laptop —
 * and it is also why it needs an account, where the rest of this page does not.
 *
 * SIGNED OUT, THIS IS SIMPLY NOTHING. No token means no request, no error and
 * no empty panel: a student using GradTools anonymously is not missing a
 * feature that failed, they are using the product the way it works without an
 * account.
 *
 * WHAT IS NOT SENT: no branch, no semester, no profile. The server already
 * knows who the caller is from their token and decided applicability before
 * this hook existed. The request carries no student context because there is
 * none to carry.
 */

import { useCallback, useEffect, useState } from 'react';
import { STUDENT_ROUTES } from '@gradtools/shared-types';
import { apiBaseUrl } from '../repositories/reference.js';
import { useAuth } from '../features/auth/AuthContext.js';

export type SourceNotificationState = 'unread' | 'read' | 'dismissed';

/** One notification, exactly as the API returns it. */
export interface SourceNotification {
  readonly id: string;
  readonly family: string;
  readonly category: string;
  readonly importance: 'high' | 'medium' | 'low';
  readonly title: string;
  readonly sourceUrl: string;
  readonly publishedAt: string | null;
  readonly reason: string;
  readonly state: SourceNotificationState;
  readonly createdAt: string;
}

export interface SourceNotificationsState {
  readonly items: readonly SourceNotification[];
  readonly unread: number;
  readonly loading: boolean;
  /** True when there is no account, so there is nothing to show and no error. */
  readonly unavailable: boolean;
  readonly error: string | null;
  readonly markRead: (id: string) => Promise<void>;
  readonly markAllRead: () => Promise<void>;
  readonly reload: () => void;
}

export function useSourceNotifications(): SourceNotificationsState {
  const { adapter, state: authState } = useAuth();
  const [items, setItems] = useState<readonly SourceNotification[]>([]);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const signedIn = authState.status === 'signed_in';
  const unavailable = adapter === null || !signedIn;

  /** The bearer token, or null. Read per request, never held in state. */
  const authorize = useCallback(async (): Promise<Record<string, string> | null> => {
    if (adapter === null) return null;
    const token = await adapter.accessToken();
    return token === null ? null : { Authorization: `Bearer ${token}` };
  }, [adapter]);

  useEffect(() => {
    if (unavailable) {
      setItems([]);
      setUnread(0);
      setLoading(false);
      setError(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    void (async () => {
      try {
        const headers = await authorize();
        if (headers === null) throw new Error('no token');
        const response = await fetch(`${apiBaseUrl()}${STUDENT_ROUTES.meNotifications}`, {
          headers,
        });
        if (!response.ok) throw new Error(String(response.status));
        const body = (await response.json()) as {
          notifications: SourceNotification[];
          unread: number;
        };
        if (cancelled) return;
        setItems(body.notifications);
        setUnread(body.unread);
        setLoading(false);
      } catch {
        if (cancelled) return;
        /*
         * A PANEL THAT CANNOT BE REACHED SAYS SO. Showing an empty list would
         * tell the student there is nothing waiting, which is a different and
         * possibly false claim (§63).
         */
        setError('Could not reach your notices. They are safe; this is a connection problem.');
        setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [unavailable, authorize, reloadToken]);

  const markRead = useCallback(
    async (id: string): Promise<void> => {
      const headers = await authorize();
      if (headers === null) return;
      const response = await fetch(`${apiBaseUrl()}/api/v1/me/notifications/${id}`, {
        method: 'PATCH',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ state: 'read' }),
      });
      if (!response.ok) return;
      /* Optimism would be wrong here: the server owns this state now. */
      setItems((current) =>
        current.map((row) => (row.id === id ? { ...row, state: 'read' as const } : row)),
      );
      setUnread((current) => Math.max(0, current - 1));
    },
    [authorize],
  );

  const markAllRead = useCallback(async (): Promise<void> => {
    const headers = await authorize();
    if (headers === null) return;
    const response = await fetch(`${apiBaseUrl()}${STUDENT_ROUTES.meNotificationsRead}`, {
      method: 'POST',
      headers,
    });
    if (!response.ok) return;
    setItems((current) => current.map((row) => ({ ...row, state: 'read' as const })));
    setUnread(0);
  }, [authorize]);

  return {
    items,
    unread,
    loading,
    unavailable,
    error,
    markRead,
    markAllRead,
    reload: () => setReloadToken((value) => value + 1),
  };
}
