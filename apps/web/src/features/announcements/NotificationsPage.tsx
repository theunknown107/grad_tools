/**
 * The notification centre.
 *
 * Authority: docs/12 §12.12 · M7 §16, §19, §21, §22
 *
 * NOT A SOCIAL FEED (M7 §16). A list of what is unread, three controls, and a
 * way to stop a category interrupting. No badges that count things nobody asked
 * to count, no infinite scroll, no activity.
 *
 * EVERYTHING HERE IS LOCAL. Read state and preferences live on the device; the
 * server is never told what has been read, which is why none of this needs an
 * account (M7 §40).
 */

import { useState } from 'react';
import type { Announcement, AnnouncementCategory } from '@gradtools/shared-types';
import { PageHeader } from '../../components/AppShell.js';
import { Icon, type IconName } from '../../components/icons.js';
import { MetaPill } from '../../components/ui/tone.js';
import { formatCount } from '../../lib/format.js';
import { IslandTabs, IslandTabGroup, IslandTabPanel } from '../../components/ui/IslandTabs.js';
import { Skeleton as ShapedSkeleton } from '../../components/ui/Skeleton.js';
import { Button, EmptyState, Notice, Panel, StatusPill } from '../../components/ui/index.js';
import { useAnnouncements, useNotifications } from '../../hooks/useAnnouncements.js';
import {
  useSourceNotifications,
  type SourceNotification,
} from '../../hooks/useSourceNotifications.js';
import { CATEGORY_LABEL } from './AnnouncementRow.js';
import styles from './announcements.module.css';

/**
 * The notices a server-side run left for this student while they were away.
 *
 * Authority: Phase 7B.3.1 §14, §24, §27, §50, §51, §85
 *
 * ---------------------------------------------------------------------------
 * A PANEL BESIDE THE INBOX, NOT A CHANGE TO IT
 * ---------------------------------------------------------------------------
 *
 * The inbox below is local: a public feed, filtered on the device, with read
 * state that never leaves the browser. These rows are the opposite — decided on
 * a server, for this account, and read state the server owns. Merging them
 * would mean one list where "read" means two different things depending on the
 * row, and a student could not tell which.
 *
 * So they sit above, in their own panel, saying where they came from. The page
 * below is untouched (§85).
 *
 * SIGNED OUT, THIS RENDERS NOTHING AT ALL. Not an empty state, not a prompt to
 * sign in: a student using GradTools without an account is using it as designed,
 * and a panel advertising what they are missing would be the nag this product
 * does not do.
 */
export function FromVtu() {
  const { items, unread, loading, unavailable, error, markRead, markAllRead } =
    useSourceNotifications();

  if (unavailable) return null;
  if (loading && items.length === 0) return null;
  if (error !== null) {
    return (
      <Panel title="Waiting for you from VTU">
        <Notice tone="warning">{error}</Notice>
      </Panel>
    );
  }
  if (items.length === 0) return null;

  return (
    <Panel
      title="Waiting for you from VTU"
      action={
        unread > 0 ? (
          <Button
            variant="secondary"
            onClick={() => {
              void markAllRead();
            }}
          >
            <Icon name="check" size="nav" />
            Mark all read
          </Button>
        ) : undefined
      }
    >
      <ul className={styles.inbox}>
        {items.map((row) => (
          <FromVtuRow key={row.id} notification={row} onRead={markRead} />
        ))}
      </ul>
    </Panel>
  );
}

function FromVtuRow({
  notification,
  onRead,
}: {
  readonly notification: SourceNotification;
  readonly onRead: (id: string) => Promise<void>;
}) {
  const high = notification.importance === 'high';
  return (
    <li>
      <article className={styles.notification} data-state={notification.state}>
        <span
          className={styles.notificationMark}
          data-high={high ? 'true' : undefined}
          aria-hidden="true"
        >
          <Icon name="papers" size="nav" />
        </span>

        <div className={styles.notificationBody}>
          <div className={styles.notificationHead}>
            {/* Text from a document this project did not write. Rendered as text. */}
            <h3 className={styles.notificationTitle}>{notification.title}</h3>
            {high && <StatusPill tone="warning">Important</StatusPill>}
            <StatusPill tone="neutral">{notification.category.replace(/_/g, ' ')}</StatusPill>
          </div>

          {/*
            §27. WHY THEY GOT IT, in the values the source and their profile
            actually carry — "Applies to your scheme · programme · semester."
            A notification nobody can account for is one they learn to ignore.
          */}
          <p className={styles.notificationMeta}>{notification.reason}</p>

          <div className={styles.notificationActions}>
            {/*
              §26, §52. The official document, never a copy we made of it.
              `rel` because the destination is not ours.
            */}
            <a href={notification.sourceUrl} target="_blank" rel="noreferrer noopener">
              Open official source
            </a>
            {notification.state === 'unread' && (
              <Button
                variant="ghost"
                onClick={() => {
                  void onRead(notification.id);
                }}
              >
                Mark read
              </Button>
            )}
          </div>
        </div>
      </article>
    </li>
  );
}

/** Categories worth muting. Results and examinations are deliberately absent. */
const MUTABLE: readonly AnnouncementCategory[] = [
  'results',
  'exam_timetable',
  'exam_registration',
  'backlog',
  'summer_semester',
  'revaluation',
  'fees',
  'holiday',
  'academic_calendar',
  'college_notice',
  'department_notice',
  'general',
];

/**
 * Which icon a category takes, from the icons this product already ships.
 *
 * The approved design gives every notification a mark of its kind. GradTools
 * has twelve categories where the design's sample has five, so they are grouped
 * onto marks that already exist rather than a new icon being drawn for each —
 * one icon family, never a mixed set (§20).
 */
const CATEGORY_ICON: Record<AnnouncementCategory, IconName> = {
  results: 'results',
  exam_timetable: 'timetable',
  exam_registration: 'edit',
  backlog: 'warning',
  summer_semester: 'degree',
  revaluation: 'refresh',
  fees: 'papers',
  holiday: 'timetable',
  academic_calendar: 'timetable',
  college_notice: 'announcements',
  department_notice: 'announcements',
  general: 'info',
};

/** When it was published, as the design shows it — and never invented. */
function publishedWhen(announcement: Announcement): string | null {
  if (announcement.publishedAt === null) return null;
  return new Date(announcement.publishedAt).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

export function NotificationsPage() {
  const { items, loading: feedLoading, error } = useAnnouncements();
  const { notifications, unread, preferences, setState, readAll, savePreferences } =
    useNotifications(items);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [permission, setPermission] = useState<string | null>(null);

  const visible = notifications.filter((notification) =>
    unreadOnly ? notification.state === 'unread' : notification.state !== 'dismissed',
  );

  /**
   * Browser notifications, asked for ONLY when the student clicks.
   *
   * Never on page load (M7 §21). A permission prompt a visitor did not ask for
   * is the fastest way to be refused permanently, and it is rude.
   *
   * This is the Notification API, not Web Push: alerts appear while GradTools
   * is open and nothing is delivered when it is closed. True push needs a
   * server, VAPID keys and a subscription store, none of which is approved —
   * see docs/24 and OQ-036.
   */
  async function enableBrowserNotifications() {
    if (!('Notification' in window)) {
      setPermission('This browser does not support notifications.');
      return;
    }
    const result = await Notification.requestPermission();
    setPermission(
      result === 'granted'
        ? 'Browser notifications are on while GradTools is open.'
        : 'Permission was not granted, so notifications stay in the app.',
    );
    await savePreferences({ ...preferences, browserNotifications: result === 'granted' });
  }

  /*
   * THE INBOX, HOISTED so it can be the content of BOTH tab panels.
   *
   * Only the selected panel is mounted by Radix, and `visible` is already
   * derived from the selected filter, so exactly one correctly-filtered list
   * is ever in the document. Declaring both is what gives each tab a real
   * tabpanel for `aria-controls` to point at — which is what was missing when
   * these were tabs with no panel anywhere on the page.
   */
  const inbox =
    error !== null ? (
      <Notice tone="warning">{error}</Notice>
    ) : feedLoading ? (
      <ShapedSkeleton lines={4} height="60px" radius="md" label="Loading notifications" />
    ) : visible.length === 0 ? (
      <EmptyState
        title={unreadOnly ? 'You are up to date' : 'No notifications yet'}
        icons={['notifications', 'announcements', 'empty']}
      >
        {unreadOnly
          ? 'Switch to All to see everything you have already read.'
          : 'Announcements that apply to you appear here.'}
      </EmptyState>
    ) : (
      <ul className={styles.inbox}>
        {visible.map((notification) => {
          const { announcement, state, priority } = notification;
          const when = publishedWhen(announcement);
          const high = priority === 'urgent' || priority === 'important';
          return (
            <li key={announcement.id}>
              {/*
                THE DESIGN'S NOTIFICATION CARD: a mark of its kind, the notice,
                and what it is — with the unread ones carried on their own tint.
              */}
              <article className={styles.notification} data-state={state}>
                <span
                  className={styles.notificationMark}
                  data-high={high ? 'true' : undefined}
                  aria-hidden="true"
                >
                  <Icon name={CATEGORY_ICON[announcement.category]} size="nav" />
                </span>

                <div className={styles.notificationBody}>
                  <div className={styles.notificationHead}>
                    {/* External text, rendered as text. */}
                    <h3 className={styles.notificationTitle}>{announcement.title}</h3>
                    {high && <StatusPill tone="warning">Important</StatusPill>}
                    <StatusPill tone="neutral">{CATEGORY_LABEL[announcement.category]}</StatusPill>
                    {/*
                      DEMO CONTENT SAYS SO, driven by the record's own origin so
                      a synthetic notice can never be shown as official (M7 §36).
                    */}
                    {announcement.origin === 'demo_fixture' && (
                      <span className={styles.demo}>Demo data</span>
                    )}
                  </div>

                  {announcement.body !== null && (
                    <p className={styles.notificationText}>{announcement.body}</p>
                  )}

                  <p className={styles.notificationMeta}>
                    {announcement.publisher}
                    {when !== null && (
                      <>
                        {' · '}
                        <time dateTime={announcement.publishedAt ?? undefined}>{when}</time>
                      </>
                    )}
                  </p>

                  <div className={styles.notificationActions}>
                    {state === 'unread' && (
                      <Button
                        variant="secondary"
                        small
                        onClick={() => {
                          void setState(announcement, 'read');
                        }}
                      >
                        Mark as read
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      small
                      onClick={() => {
                        void setState(announcement, 'dismissed');
                      }}
                    >
                      Dismiss
                    </Button>
                  </div>
                </div>

                {/*
                  UNREAD IS NOT CONVEYED BY COLOUR ALONE (M7 §29). The dot is
                  the design's mark and is decorative; the word beside it is
                  what a screen reader reads.
                */}
                {state === 'unread' && (
                  <span className={styles.unreadMark}>
                    <span aria-hidden="true" />
                    <span className="visually-hidden">Unread</span>
                  </span>
                )}
              </article>
            </li>
          );
        })}
      </ul>
    );

  return (
    <div className={`${styles.page ?? ''} ${styles.settingsPage ?? ''}`}>
      <PageHeader
        eyebrow="Overview"
        title="Notifications"
        subtitle="What is new since you last looked. Read state stays on this device."
        pills={
          unread > 0 ? <MetaPill>{formatCount(unread, 'unread', 'unread')}</MetaPill> : undefined
        }
        action={
          <Button
            variant="secondary"
            disabled={unread === 0}
            onClick={() => {
              void readAll();
            }}
          >
            <Icon name="check" size="nav" />
            Mark all read
          </Button>
        }
      />

      <FromVtu />

      {/*
        -------------------------------------------------------------------
        M9.6F: AN INBOX TOOLBAR, NOT A PANEL OF CONTROLS
        -------------------------------------------------------------------

        A bordered panel titled "3 unread" held a checkbox and a button, and
        the notifications themselves began below it — so a third of the screen
        above the inbox was chrome. It is now one toolbar row, matching the
        header's notification popover so the page and the popover read as the
        same inbox rather than two different ones.

        All/Unread as tabs rather than a checkbox: it is a VIEW of the list,
        and the counts belong on the tabs where they say what each view holds.
      */}
      <IslandTabGroup
        value={unreadOnly ? 'unread' : 'all'}
        onChange={(id) => {
          setUnreadOnly(id === 'unread');
        }}
      >
        <div className={styles.toolbar}>
          <IslandTabs
            label="Which notifications"
            value={unreadOnly ? 'unread' : 'all'}
            onChange={(id) => {
              setUnreadOnly(id === 'unread');
            }}
            tabs={[
              { id: 'all', label: 'All', count: notifications.length },
              { id: 'unread', label: 'Unread', count: unread },
            ]}
          />
        </div>

        <IslandTabPanel id="all">{inbox}</IslandTabPanel>
        <IslandTabPanel id="unread">{inbox}</IslandTabPanel>
      </IslandTabGroup>

      <Panel title="What interrupts you">
        <p className={styles.note}>
          Muting a category stops it appearing here. It never hides the notice from the
          Announcements page — you can always go and look.
        </p>
        <ul className={styles.muteList}>
          {MUTABLE.map((category) => {
            const muted = preferences.muted.includes(category);
            return (
              <li key={category}>
                <label className={styles.checkbox}>
                  <input
                    type="checkbox"
                    checked={!muted}
                    onChange={() => {
                      void savePreferences({
                        ...preferences,
                        muted: muted
                          ? preferences.muted.filter((value) => value !== category)
                          : [...preferences.muted, category],
                      });
                    }}
                  />
                  {CATEGORY_LABEL[category]}
                </label>
              </li>
            );
          })}
        </ul>
      </Panel>

      <Panel title="Browser notifications">
        <p className={styles.note}>
          GradTools can show a browser notification while it is open. It cannot notify you when the
          app is closed — that needs a server GradTools does not have yet.
        </p>
        <Button
          variant="secondary"
          onClick={() => {
            void enableBrowserNotifications();
          }}
        >
          {preferences.browserNotifications ? 'Notifications are on' : 'Turn on notifications'}
        </Button>
        {permission !== null && (
          <p className={styles.note} role="status">
            {permission}
          </p>
        )}
      </Panel>
    </div>
  );
}
