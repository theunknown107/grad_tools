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
  /** True while the realtime stream is open. Never gates the inbox. */
  readonly connected: boolean;
  readonly markRead: (id: string) => Promise<void>;
  readonly markAllRead: () => Promise<void>;
  readonly reload: () => void;
}

export function useSourceNotifications(): SourceNotificationsState {
  const { adapter, state: authState } = useAuth();
  const [items, setItems] = useState<readonly SourceNotification[]>([]);
  /*
   * DERIVED, NOT TRACKED. A separate counter and a list of rows are two places
   * that can disagree, and they did: a live arrival incremented the count while
   * an in-flight list read then reset it, so a notification was visible and
   * uncounted at the same time. There is one source of truth now.
   */
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  /** Whether the doorbell is answering. The inbox works either way. */
  const [connected, setConnected] = useState(false);

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
        /*
         * THE LIST IS AUTHORITATIVE, BUT IT IS NOT A SNAPSHOT OF NOW.
         *
         * A notification can arrive on the stream between this request being
         * issued and its reply landing, and replacing the list outright would
         * drop it from view — the row would still be in the database, but the
         * student would not see it until they reloaded. So the server's rows
         * win on content and order, and anything that arrived live and is not
         * in them yet is kept (§22, §74).
         *
         * Nothing is resurrected by this: the only rows it can preserve are
         * ones this session was told about by `notification.created`.
         */
        setItems((current) => {
          const known = new Set(body.notifications.map((row) => row.id));
          const live = current.filter((row) => !known.has(row.id));
          return live.length === 0 ? body.notifications : [...live, ...body.notifications];
        });
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

  /*
   * ---------------------------------------------------------------------------
   * THE DOORBELL, AND WHY IT IS NOT `EventSource`
   * ---------------------------------------------------------------------------
   *
   * `EventSource` cannot set a request header. The only way to authenticate one
   * is to put the token in the URL — where it lands in access logs, proxy logs
   * and the browser history — and §17 and §20 require identity to come from
   * authentication rather than from something in the request a caller can
   * change. So the stream is read with `fetch`, which takes an `Authorization`
   * header like every other call this hook makes.
   *
   * What is given up is `EventSource`'s automatic reconnect, which is replaced
   * below by one that refetches the authoritative list first — which is the
   * behaviour §26 and §74 actually want, and `EventSource` would not have
   * given.
   *
   * THE EVENT IS A HINT. Losing one costs nothing: the row is already in the
   * database, and the next connect reads it (§22).
   */
  useEffect(() => {
    if (unavailable) return;

    const abort = new AbortController();
    let stopped = false;
    let attempt = 0;

    const run = async (): Promise<void> => {
      while (!stopped) {
        try {
          const headers = await authorize();
          if (headers === null) return;
          const response = await fetch(`${apiBaseUrl()}${STUDENT_ROUTES.meNotificationsStream}`, {
            headers: { ...headers, Accept: 'text/event-stream' },
            signal: abort.signal,
          });
          if (!response.ok || response.body === null) throw new Error(String(response.status));

          attempt = 0;
          setConnected(true);
          /*
           * §26, §74. The stream replays nothing, so anything that arrived
           * while we were away is picked up from the authoritative list — not
           * from the socket.
           */
          setReloadToken((value) => value + 1);

          /*
           * A plain `TextDecoder` over the byte reader, rather than piping
           * through a `TextDecoderStream`. One fewer stream to construct, and
           * `TextDecoderStream` does not exist in every environment this runs
           * in — jsdom has no implementation, so the test suite could not see
           * a single delivered frame until this changed.
           *
           * `stream: true` matters: a multi-byte character can straddle two
           * chunks, and decoding each chunk independently would corrupt it.
           */
          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let buffer = '';
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            /* SSE frames are separated by a blank line. */
            let split = buffer.indexOf('\n\n');
            while (split !== -1) {
              handleFrame(buffer.slice(0, split));
              buffer = buffer.slice(split + 2);
              split = buffer.indexOf('\n\n');
            }
          }
        } catch {
          /* A dropped stream is not an error a student needs to see. */
        }

        setConnected(false);
        if (stopped) return;
        /*
         * Backing off to a minute. A server that is down does not want a
         * browser retrying every second, and the inbox is unaffected while we
         * wait (§27).
         */
        attempt += 1;
        const wait = Math.min(1000 * 2 ** attempt, 60_000);
        await new Promise((resolve) => setTimeout(resolve, wait));
      }
    };

    /** One SSE frame: `event: <name>` then `data: <json>`. */
    const handleFrame = (frame: string): void => {
      let name = 'message';
      let data = '';
      for (const line of frame.split('\n')) {
        if (line.startsWith('event:')) name = line.slice(6).trim();
        else if (line.startsWith('data:')) data += line.slice(5).trim();
      }
      if (name !== 'notification.created' || data === '') return;

      try {
        const created = JSON.parse(data) as {
          notificationId: string;
          category: string;
          importance: 'high' | 'medium' | 'low';
          title: string;
          sourceUrl: string;
          reason: string;
        };
        setItems((current) => {
          /*
           * §68, §166. A duplicate event must not become a duplicate row. The
           * id is the database's, so the same notification delivered twice is
           * recognisably the same one.
           */
          if (current.some((row) => row.id === created.notificationId)) return current;
          return [
            {
              id: created.notificationId,
              family: '',
              category: created.category,
              importance: created.importance,
              title: created.title,
              sourceUrl: created.sourceUrl,
              publishedAt: null,
              reason: created.reason,
              state: 'unread' as const,
              createdAt: new Date().toISOString(),
            },
            ...current,
          ];
        });
      } catch {
        /* An unreadable frame is a dropped doorbell, not a failure. */
      }
    };

    void run();
    return () => {
      stopped = true;
      abort.abort();
    };
  }, [unavailable, authorize]);

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
  }, [authorize]);

  const unread = items.filter((row) => row.state === 'unread').length;

  return {
    items,
    unread,
    loading,
    unavailable,
    error,
    connected,
    markRead,
    markAllRead,
    reload: () => setReloadToken((value) => value + 1),
  };
}
