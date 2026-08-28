/**
 * Notifications — delivery and read state, kept apart from content.
 *
 * Authority: docs/08 §8.15 · docs/12 §12.12 · M7 §15, §16, §19, §22
 *
 * AN ANNOUNCEMENT IS CONTENT. A NOTIFICATION IS WHETHER YOU HAVE SEEN IT.
 * They are separate because they belong to different owners: the announcement
 * is the publisher's and is the same for everyone, while "unread" is the
 * student's and is nobody else's business (M7 §15).
 *
 * ALL OF IT STAYS ON THE DEVICE. There is no server notification table, no
 * per-student row anywhere, and no preferences endpoint — which is why none of
 * this needs authentication and why the announcement API cannot tell who is
 * reading (M7 §40).
 */

import type { Announcement, AnnouncementCategory } from '@gradtools/shared-types';
import { isRelevant, priorityOf, type Priority, type StudentContext } from './announcements.js';

export const NOTIFICATION_STATES = ['unread', 'read', 'dismissed'] as const;
export type NotificationState = (typeof NOTIFICATION_STATES)[number];

/**
 * What the device remembers about one announcement.
 *
 * `seenContentHash` is what makes an UPDATE able to notify again without every
 * refresh doing so: the state is tied to the version of the announcement that
 * was read, not merely to its id (M7 §22).
 */
export interface NotificationRecord {
  /** The announcement id. One record per announcement, which is the identity. */
  readonly id: string;
  readonly state: NotificationState;
  /** The `updatedAt` of the announcement when this state was set. */
  readonly seenVersion: string;
  readonly updatedAt: string;
}

/** An announcement paired with what the device remembers about it. */
export interface Notification {
  readonly announcement: Announcement;
  readonly state: NotificationState;
  readonly priority: Priority;
  readonly relevant: boolean;
}

/* -------------------------------------------------------------------------- */
/* Preferences                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Which categories the student wants to hear about.
 *
 * Muting affects NOTIFICATIONS, not the announcements page. A muted category
 * stops interrupting; it does not disappear, because hiding a result notice
 * because someone once muted "results" would be a trap (M7 §19).
 */
export interface NotificationPreferences {
  readonly muted: readonly AnnouncementCategory[];
  /**
   * Whether the student has opted in to browser notifications. Off until they
   * ask: permission is never requested on page load (M7 §21).
   */
  readonly browserNotifications: boolean;
}

export const DEFAULT_PREFERENCES: NotificationPreferences = {
  muted: [],
  browserNotifications: false,
};

export function isMuted(
  category: AnnouncementCategory,
  preferences: NotificationPreferences,
): boolean {
  return preferences.muted.includes(category);
}

/* -------------------------------------------------------------------------- */
/* Building the list                                                          */
/* -------------------------------------------------------------------------- */

/**
 * The state of one announcement for this device.
 *
 * An announcement nobody has interacted with is `unread`. One that was read and
 * has since CHANGED becomes unread again — the version it was read at no longer
 * exists, and a student who read "registration closes Friday" should hear about
 * it moving (M7 §22).
 *
 * Being dismissed survives an update. Dismissing is a stronger statement than
 * reading: it means "I do not want this", and honouring it only until the
 * publisher fixes a typo would make the control useless.
 */
export function stateFor(
  announcement: Announcement,
  records: readonly NotificationRecord[],
): NotificationState {
  const record = records.find((candidate) => candidate.id === announcement.id);
  if (record === undefined) return 'unread';
  if (record.state === 'dismissed') return 'dismissed';
  if (record.state === 'read' && record.seenVersion !== announcement.updatedAt) return 'unread';
  return record.state;
}

/**
 * The notification list: what is worth telling the student about.
 *
 * Irrelevant and muted announcements are excluded HERE and not from the
 * announcements page, which is the distinction between "do not interrupt me"
 * and "hide this from me".
 */
export function buildNotifications(
  announcements: readonly Announcement[],
  records: readonly NotificationRecord[],
  context: StudentContext,
  preferences: NotificationPreferences,
  now: Date,
): Notification[] {
  return announcements
    .filter((announcement) => isRelevant(announcement, context))
    .filter((announcement) => !isMuted(announcement.category, preferences))
    .map((announcement) => ({
      announcement,
      state: stateFor(announcement, records),
      priority: priorityOf(announcement, now),
      relevant: true,
    }));
}

export function unreadCount(notifications: readonly Notification[]): number {
  return notifications.filter((notification) => notification.state === 'unread').length;
}

/**
 * Records the state of one announcement, pinned to the version that was seen.
 *
 * Deterministic identity: one record per announcement id, replaced rather than
 * appended, so the same announcement can never produce two notification records
 * however many times the app refreshes (M7 §22).
 */
export function markState(
  records: readonly NotificationRecord[],
  announcement: Announcement,
  state: NotificationState,
  now: string,
): NotificationRecord[] {
  const next: NotificationRecord = {
    id: announcement.id,
    state,
    seenVersion: announcement.updatedAt,
    updatedAt: now,
  };
  const without = records.filter((record) => record.id !== announcement.id);
  return [...without, next];
}

export function markAllRead(
  records: readonly NotificationRecord[],
  notifications: readonly Notification[],
  now: string,
): NotificationRecord[] {
  return notifications
    .filter((notification) => notification.state === 'unread')
    .reduce(
      (accumulated, notification) => markState(accumulated, notification.announcement, 'read', now),
      [...records],
    );
}
