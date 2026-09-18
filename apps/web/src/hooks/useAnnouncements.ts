/**
 * Announcements and notifications, joined on the device.
 *
 * Authority: docs/12 §12.12 · M7 §13, §15, §22, §40
 *
 * The server returns a feed identical for every visitor. Everything personal —
 * which notices matter, which have been read, which are muted — happens here,
 * from data that never leaves the browser (M7 §40).
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { SOURCE_ROUTES, type Announcement } from '@gradtools/shared-types';
import {
  buildNotifications,
  DEFAULT_PREFERENCES,
  markAllRead,
  markState,
  unreadCount,
  type Notification,
  type NotificationPreferences,
  type NotificationRecord,
  type NotificationState,
} from '../domain/notifications.js';
import { sortForStudent, type StudentContext } from '../domain/announcements.js';
import { useRepositories } from '../repositories/context.js';
import { apiBaseUrl } from '../repositories/reference.js';
import { publish, storeFor, useShared } from './shared-store.js';
import { useProfile, useSemesters } from './useCollection.js';
import { buildSemesterViews, currentSemester } from '../domain/academics.js';

/* -------------------------------------------------------------------------- */
/* The feed                                                                   */
/* -------------------------------------------------------------------------- */

export interface AnnouncementsState {
  readonly items: readonly Announcement[];
  readonly total: number;
  readonly loading: boolean;
  readonly error: string | null;
  readonly reload: () => void;
}

/**
 * Published announcements from the API.
 *
 * NO STUDENT CONTEXT IS SENT — not a branch, not a semester, not an optional
 * hint. The request is identical for every visitor, which is what makes the
 * feed impossible to personalise server-side and therefore impossible to
 * profile from.
 */
export function useAnnouncements(category?: string, source?: string): AnnouncementsState {
  const [items, setItems] = useState<readonly Announcement[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [token, setToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    const params = new URLSearchParams();
    if (category !== undefined && category !== 'all') params.set('category', category);
    if (source !== undefined && source !== 'all') params.set('source', source);
    const query = params.toString();

    fetch(`${apiBaseUrl()}${SOURCE_ROUTES.announcements}${query === '' ? '' : `?${query}`}`)
      .then(async (response) => {
        if (!response.ok) throw new Error(String(response.status));
        return (await response.json()) as { data: Announcement[]; total: number };
      })
      .then((body) => {
        if (cancelled) return;
        setItems(body.data);
        setTotal(body.total);
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        // A feed that cannot be reached says so; it does not show an empty
        // state, which would read as "there is nothing to tell you".
        setError('Could not reach the GradTools server.');
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [category, source, token]);

  const reload = useCallback(() => {
    setToken((n) => n + 1);
  }, []);

  return { items, total, loading, error, reload };
}

/* -------------------------------------------------------------------------- */
/* Student context                                                            */
/* -------------------------------------------------------------------------- */

/**
 * What the device knows about the student, for relevance.
 *
 * The semester comes from the degree first and the profile second: a semester
 * marked in progress is something the student maintains, while the profile
 * field is a number they typed once and may not have revisited.
 */
export function useStudentContext(): StudentContext {
  const { profile } = useProfile();
  const { items: semesters } = useSemesters();

  return useMemo(() => {
    const inProgress = currentSemester(buildSemesterViews(semesters, []));
    return {
      schemeId: profile?.schemeId ?? null,
      branchName: profile?.branch ?? null,
      collegeName: profile?.collegeName ?? null,
      currentSemester: inProgress?.number ?? profile?.currentSemester ?? null,
    };
  }, [profile, semesters]);
}

/* -------------------------------------------------------------------------- */
/* Notifications                                                              */
/* -------------------------------------------------------------------------- */

export interface NotificationsState {
  readonly notifications: readonly Notification[];
  readonly unread: number;
  readonly preferences: NotificationPreferences;
  readonly loading: boolean;
  readonly setState: (announcement: Announcement, state: NotificationState) => Promise<void>;
  readonly readAll: () => Promise<void>;
  readonly savePreferences: (preferences: NotificationPreferences) => Promise<void>;
}

interface NotificationStore {
  readonly records: readonly NotificationRecord[];
  readonly preferences: NotificationPreferences;
  readonly loading: boolean;
}

const EMPTY_STORE: NotificationStore = {
  records: [],
  preferences: DEFAULT_PREFERENCES,
  loading: true,
};

/**
 * The notification list for this device.
 *
 * READ STATE IS SHARED ACROSS EVERY CONSUMER. It used to live in a `useState`
 * inside this hook, so the shell's badge, the notifications page and the
 * settings screen each held their own copy: pressing "Mark all read" cleared
 * the page and left the badge still saying 9+ until the app was reloaded. One
 * store beside the repository fixes all four consumers at once — see
 * `shared-store.ts`.
 *
 * `now` is taken once per hook call rather than per render, so priority and
 * "days left" cannot flicker between two renders of the same screen.
 */
export function useNotifications(announcements: readonly Announcement[]): NotificationsState {
  const repository = useRepositories().notifications;
  const context = useStudentContext();
  const store = storeFor<NotificationStore>(repository, () => EMPTY_STORE);

  const { records, preferences, loading } = useShared(store, async () => {
    const [loadedRecords, loadedPreferences] = await Promise.all([
      repository.listStates(),
      repository.getPreferences(),
    ]);
    return {
      records: loadedRecords,
      preferences: loadedPreferences ?? DEFAULT_PREFERENCES,
      loading: false,
    };
  });

  const now = useMemo(() => new Date(), []);

  const notifications = useMemo(
    () => buildNotifications(announcements, records, context, preferences, now),
    [announcements, records, context, preferences, now],
  );

  /*
   * Every write reads the CURRENT snapshot rather than a value captured when
   * the callback was built, so two consumers writing in the same tick cannot
   * overwrite one another with a stale list.
   */
  const saveRecords = useCallback(
    async (next: readonly NotificationRecord[]) => {
      publish(store, { ...store.snapshot, records: next });
      await repository.saveStates(next);
    },
    [repository, store],
  );

  const setState = useCallback(
    async (announcement: Announcement, state: NotificationState) => {
      await saveRecords(
        markState(store.snapshot.records, announcement, state, new Date().toISOString()),
      );
    },
    [saveRecords, store],
  );

  const readAll = useCallback(async () => {
    await saveRecords(markAllRead(store.snapshot.records, notifications, new Date().toISOString()));
  }, [saveRecords, notifications, store]);

  const savePreferences = useCallback(
    async (next: NotificationPreferences) => {
      publish(store, { ...store.snapshot, preferences: next });
      await repository.savePreferences(next);
    },
    [repository, store],
  );

  return {
    notifications,
    unread: unreadCount(notifications),
    preferences,
    loading,
    setState,
    readAll,
    savePreferences,
  };
}

/** The student's feed, ordered by relevance then urgency then recency. */
export function useSortedAnnouncements(
  announcements: readonly Announcement[],
): readonly Announcement[] {
  const context = useStudentContext();
  const now = useMemo(() => new Date(), []);
  return useMemo(() => sortForStudent(announcements, context, now), [announcements, context, now]);
}
