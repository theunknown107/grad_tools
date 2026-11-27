/**
 * Notifications — the design's inbox: what is new since the student last
 * looked (read state stays on this device) and what the VTU monitor has found
 * for a signed-in student. As in the design, a row is one control: opening it
 * marks it read. What may interrupt is set in Account → Settings.
 */

import { Capacitor } from '@capacitor/core';
import { Bell, BellRing, Check, ExternalLink, FileText } from 'lucide-react';
import { postDemoNotices, postTestNotice } from '../../lib/system-notifications.js';
import { externalHref } from '../../lib/external-url.js';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { Announcement, AnnouncementCategory } from '@gradtools/shared-types';
import { Badge } from '../../components/ui/badge.js';
import { Button } from '../../components/ui/button.js';
import { Card, CardHeader, CardRows } from '../../components/ui/card.js';
import { Callout, EmptyState, ErrorState, toast } from '../../components/ui/feedback.js';
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
import {
  announcementAnchor,
  CATEGORY_ICON,
  CATEGORY_LABEL,
  CATEGORY_TONE,
  SnapshotNote,
} from './AnnouncementCard.js';

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
  'sports',
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
  if (loading && items.length === 0 && error === null) return null;
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
      href={externalHref(notification.sourceUrl)}
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
        <div className="mt-1.5 inline-flex items-center gap-1 text-[12px] text-ink-3">
          Official source <ExternalLink className="size-3" aria-hidden="true" />
          <span className="sr-only">(opens in a new tab)</span>
        </div>
      </div>
      {unread && <Dot tone="accent" className="mt-1.5" label="Unread" />}
    </a>
  );
}

type Filter = 'all' | 'unread';

/** Android only: posts stored notices as phone notifications titled "Demo", with the chime. */
function DemoButton({ notices }: { readonly notices: readonly Announcement[] }) {
  const [busy, setBusy] = useState(false);
  return (
    <Button
      variant="primary"
      icon={<BellRing />}
      loading={busy}
      disabled={notices.length === 0}
      onClick={() => {
        setBusy(true);
        void postDemoNotices(notices, (notice) => CATEGORY_LABEL[notice.category])
          .then((result) => {
            if (result === 'blocked')
              toast('Notifications are off for GradTools', {
                tone: 'warning',
                description: 'Turn them on in Android settings to see the demo.',
              });
            else if (result === 'posted')
              toast(`${String(Math.min(15, notices.length))} notifications sent to this phone`, {
                tone: 'neutral',
              });
          })
          .finally(() => setBusy(false));
      }}
    >
      Play notification demo
    </Button>
  );
}

export function NotificationsPage() {
  const { items, loading, error, reload, snapshotAt } = useAnnouncements();
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
          <div className="flex flex-wrap gap-2">
            {Capacitor.isNativePlatform() && <DemoButton notices={items} />}
            <Button icon={<Check />} disabled={unread === 0} onClick={() => void readAll()}>
              Mark all read
            </Button>
          </div>
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

      {snapshotAt !== null && <SnapshotNote at={snapshotAt} />}
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
                  className={cn('flex items-start gap-3.5 p-4', isUnread && 'bg-accent-weak/20')}
                >
                  <Link
                    to={`/announcements#${announcementAnchor(announcement.id)}`}
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
                      <div className="mt-1.5 text-[12px] text-ink-3">
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

/**
 * Settings → Notifications: what may interrupt, and a plain statement that
 * browser notifications do not exist yet. There used to be a button here that
 * asked for permission and then said notifications were on, while nothing ever
 * showed one; a control wired to nothing is worse than no control.
 */
/** Android only: what the phone does with notices, and a way to hear it. */
function PhoneNotifications() {
  const [state, setState] = useState<'idle' | 'sending' | 'posted' | 'blocked'>('idle');
  return (
    <Card className="p-6">
      <SectionTitle>Phone notifications</SectionTitle>
      <p className="text-[13px] text-ink-2">
        Relevant VTU notices also arrive as phone notifications with the GradTools chime. Their
        sound and volume follow the &ldquo;VTU notices&rdquo; category in Android&rsquo;s settings
        for GradTools.
      </p>
      <Button
        className="mt-4"
        icon={<BellRing />}
        loading={state === 'sending'}
        onClick={() => {
          setState('sending');
          void postTestNotice().then(setState, () => setState('blocked'));
        }}
      >
        Send a test notification
      </Button>
      {state === 'posted' && (
        <p role="status" className="mt-2 text-[12px] text-ink-3">
          Sent. If you heard nothing, check the phone is not on silent and the &ldquo;VTU
          notices&rdquo; sound is on.
        </p>
      )}
      {state === 'blocked' && (
        <p role="alert" className="mt-2 text-[12px] text-warning">
          Notifications are turned off for GradTools. Turn them on in Android settings to hear
          notices.
        </p>
      )}
    </Card>
  );
}

export function NotificationSettings() {
  const { items } = useAnnouncements();
  const { preferences, savePreferences } = useNotifications(items);

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
      {Capacitor.isNativePlatform() ? (
        <PhoneNotifications />
      ) : (
        <Card className="p-6">
          <SectionTitle>Browser notifications</SectionTitle>
          <p className="text-[13px] text-ink-2">
            Browser notifications aren&rsquo;t available yet. New notices appear here in GradTools,
            in Notifications and on the bell, marked unread until you open them.
          </p>
        </Card>
      )}
    </div>
  );
}
