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
import { CATEGORY_LABEL } from './AnnouncementRow.js';
import styles from './announcements.module.css';

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
                    <StatusPill tone="neutral">
                      {CATEGORY_LABEL[announcement.category]}
                    </StatusPill>
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
        pills={unread > 0 ? <MetaPill>{formatCount(unread, 'unread', 'unread')}</MetaPill> : undefined}
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
