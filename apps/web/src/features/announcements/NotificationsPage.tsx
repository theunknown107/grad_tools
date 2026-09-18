/**
 * Notifications — the design's inbox: what is new since the student last
 * looked (read state stays on this device) and what the VTU monitor has found
 * for a signed-in student. As in the design, a row is one control: opening it
 * marks it read. What may interrupt is set in Account → Settings.
 */

import { Bell, BellRing, Check, ExternalLink, FileText } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { AnnouncementCategory } from '@gradtools/shared-types';
import { Badge } from '../../components/ui/badge.js';
import { Button } from '../../components/ui/button.js';
import { Card, CardHeader, CardRows } from '../../components/ui/card.js';
import { Callout, EmptyState, ErrorState } from '../../components/ui/feedback.js';
import { SwitchRow } from '../../components/ui/field.js';
import { Dot, IconTile, PageHeader, SectionTitle } from '../../components/ui/page.js';
import { Segmented } from '../../components/ui/segmented.js';
import { Skeleton } from '../../components/ui/skeleton.js';
import { useAnnouncements, useNotifications } from '../../hooks/useAnnouncements.js';
import {
  useSourceNotifications,
  type SourceNotification,
} from '../../hooks/useSourceNotifications.js';
import { cn } from '../../lib/cn.js';
import { relativeTime } from '../../lib/time.js';
import { CATEGORY_ICON, CATEGORY_LABEL, CATEGORY_TONE } from './AnnouncementCard.js';

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
 * What the VTU monitor has found for this student. Signed-in only: renders
 * nothing at all otherwise, so a signed-out student is never shown an empty
 * box that implies a feature they cannot use.
 */
export function FromVtu() {
  const { items, unread, loading, unavailable, error, markRead, markAllRead } =
    useSourceNotifications();
  if (unavailable) return null;
  if (loading && items.length === 0) return null;
  if (error === null && items.length === 0) return null;
  return (
    <Card className="overflow-hidden">
      <CardHeader
        icon={<BellRing className="text-ink-2" aria-hidden="true" />}
        title="Waiting for you from VTU"
        action={
          unread > 0 ? (
            <Button size="sm" icon={<Check />} onClick={() => void markAllRead()}>
              Mark all read
            </Button>
          ) : undefined
        }
      />
      {error !== null ? (
        <Callout tone="warning" className="m-4">
          {error}
        </Callout>
      ) : (
        <CardRows>
          {items.map((row) => (
            <FromVtuRow key={row.id} notification={row} onRead={markRead} />
          ))}
        </CardRows>
      )}
    </Card>
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
  const unread = notification.state === 'unread';
  return (
    <a
      href={notification.sourceUrl}
      target="_blank"
      rel="noreferrer noopener"
      onClick={() => {
        if (unread) void onRead(notification.id);
      }}
      className={cn(
        'flex items-start gap-3.5 px-5 py-4 text-left transition-colors hover:bg-panel',
        unread && 'bg-accent-weak/20',
      )}
    >
      <IconTile tone={high ? 'warning' : 'neutral'}>
        <FileText />
      </IconTile>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-[14px] leading-tight font-semibold text-ink">{notification.title}</h3>
          {high && <Badge tone="warning">Important</Badge>}
          <Badge className="capitalize">{notification.category.replace(/_/g, ' ')}</Badge>
        </div>
        <p className="mt-1 text-[13px] text-ink-2">{notification.reason}</p>
        <div className="mt-1.5 inline-flex items-center gap-1 text-[11px] text-ink-3">
          Official source <ExternalLink className="size-3" aria-hidden="true" />
          <span className="sr-only">(opens in a new tab)</span>
        </div>
      </div>
      {unread && <Dot tone="accent" className="mt-1.5" label="Unread" />}
    </a>
  );
}

type Filter = 'all' | 'unread';

export function NotificationsPage() {
  const { items, loading, error, reload } = useAnnouncements();
  const { notifications, unread, setState, readAll } = useNotifications(items);
  const [filter, setFilter] = useState<Filter>('all');
  const now = Date.now();
  const undismissed = notifications.filter((notification) => notification.state !== 'dismissed');
  const visible =
    filter === 'unread' ? undismissed.filter((item) => item.state === 'unread') : undismissed;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Overview"
        title="Notifications"
        description="Academic updates since you last looked. Read state stays on this device."
        actions={
          <Button icon={<Check />} disabled={unread === 0} onClick={() => void readAll()}>
            Mark all read
          </Button>
        }
      />

      <FromVtu />

      <Segmented<Filter>
        label="Which notifications"
        value={filter}
        onChange={setFilter}
        options={[
          { value: 'all', label: `All · ${String(undismissed.length)}` },
          { value: 'unread', label: `Unread · ${String(unread)}` },
        ]}
        className="w-full"
      />

      {error !== null ? (
        <ErrorState title="Notifications are unavailable" message={error} onRetry={reload} />
      ) : loading ? (
        <div role="status" aria-live="polite" className="flex flex-col gap-2">
          <span className="sr-only">Loading notifications…</span>
          {[0, 1, 2, 3].map((key) => (
            <Skeleton key={key} className="h-24 rounded-xl" />
          ))}
        </div>
      ) : visible.length === 0 ? (
        <EmptyState
          icon={<Bell />}
          title={filter === 'unread' ? "You're all caught up" : 'No notifications yet'}
          description={
            filter === 'unread'
              ? 'No unread notifications. Switch to All to see everything you have already read.'
              : 'Announcements that apply to you appear here.'
          }
        />
      ) : (
        <ul className="flex flex-col gap-2">
          {visible.map(({ announcement, state, priority }) => {
            const Icon = CATEGORY_ICON[announcement.category];
            const high = priority === 'urgent' || priority === 'important';
            const isUnread = state === 'unread';
            return (
              <li key={announcement.id}>
                <Card
                  interactive
                  asChild
                  className={cn(
                    'flex items-start gap-3.5 p-4',
                    isUnread && 'border-accent/30 bg-accent-weak/20',
                  )}
                >
                  <Link
                    to="/announcements"
                    data-state={state}
                    onClick={() => {
                      if (isUnread) void setState(announcement, 'read');
                    }}
                  >
                    <IconTile tone={high ? 'warning' : 'neutral'}>
                      <Icon />
                    </IconTile>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-[14px] leading-tight font-semibold text-ink">
                          {announcement.title}
                        </h3>
                        {high && <Badge tone="warning">Important</Badge>}
                        <Badge tone={CATEGORY_TONE[announcement.category]}>
                          {CATEGORY_LABEL[announcement.category]}
                        </Badge>
                        {announcement.origin === 'demo_fixture' && (
                          <Badge tone="warning">Demo data</Badge>
                        )}
                      </div>
                      {announcement.body !== null && (
                        <p className="mt-1 line-clamp-3 text-[13px] text-ink-2">
                          {announcement.body}
                        </p>
                      )}
                      <div className="mt-1.5 text-[11px] text-ink-3">
                        {announcement.publisher}
                        {announcement.publishedAt !== null && (
                          <>
                            {' · '}
                            <time dateTime={announcement.publishedAt}>
                              {relativeTime(announcement.publishedAt, now)}
                            </time>
                          </>
                        )}
                      </div>
                    </div>
                    {isUnread && <Dot tone="accent" className="mt-1.5" label="Unread" />}
                  </Link>
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** Settings → Notifications: what may interrupt, and browser notifications. */
export function NotificationSettings() {
  const { items } = useAnnouncements();
  const { preferences, savePreferences } = useNotifications(items);
  const [permission, setPermission] = useState<string | null>(null);

  const enableBrowserNotifications = async (): Promise<void> => {
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
  };

  return (
    <div className="flex flex-col gap-4">
      <Card className="p-6">
        <SectionTitle>What interrupts you</SectionTitle>
        <p className="mb-4 text-[13px] text-ink-2">
          Muting a category stops it appearing in Notifications. It never hides the notice from
          Announcements — you can always go and look.
        </p>
        <div className="divide-y divide-line">
          {MUTABLE.map((category) => {
            const muted = preferences.muted.includes(category);
            return (
              <SwitchRow
                key={category}
                title={CATEGORY_LABEL[category]}
                checked={!muted}
                onCheckedChange={() =>
                  void savePreferences({
                    ...preferences,
                    muted: muted
                      ? preferences.muted.filter((value) => value !== category)
                      : [...preferences.muted, category],
                  })
                }
              />
            );
          })}
        </div>
      </Card>
      <Card className="p-6">
        <SectionTitle>Browser notifications</SectionTitle>
        <p className="text-[13px] text-ink-2">
          GradTools can show a browser notification while it is open. It cannot notify you when the
          app is closed — that needs a push service GradTools does not have yet.
        </p>
        <Button
          className="mt-4"
          icon={<BellRing />}
          onClick={() => void enableBrowserNotifications()}
        >
          {preferences.browserNotifications ? 'Notifications are on' : 'Turn on notifications'}
        </Button>
        {permission !== null && (
          <p role="status" className="mt-3 text-[12px] text-ink-2">
            {permission}
          </p>
        )}
      </Card>
    </div>
  );
}
