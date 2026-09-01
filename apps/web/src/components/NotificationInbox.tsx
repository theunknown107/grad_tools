/**
 * The notification inbox, as a header popover.
 *
 * Authority: docs/05 §5.23 (M9.6B) · docs/20 §20.x · docs/27 §27.4
 * Reference: 21st.dev @ruixen.ui/notification-inbox-popover — RECREATED.
 * Accessible evidence was the preview and its described structure: All/Unread
 * tabs, a bold unread row with a dot, a timestamp, "Mark all as read" in the
 * header and "View all" in the footer. The source was not retrievable.
 *
 * ---------------------------------------------------------------------------
 * WHAT THE REFERENCE HAS THAT GRADTOOLS MUST NOT COPY
 * ---------------------------------------------------------------------------
 *
 * The reference puts an AVATAR on every row, because its notifications come
 * from people. GradTools notifications come from published announcements, and
 * there is no person to show. Rendering a generic avatar would invent a sender.
 * The slot is used for the PRIORITY instead — the one thing about an academic
 * notice that decides whether it can wait.
 *
 * Everything shown here is derived from announcements the API already
 * published. This component invents nothing: no delivery, no push, no
 * synthetic "welcome" notification (M9.6 §23).
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon } from './icons.js';
import { useDismissable } from '../hooks/useDismissable.js';
import type { Notification } from '../domain/notifications.js';
import styles from './NotificationInbox.module.css';

function ago(iso: string, now: number): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return '';
  const minutes = Math.round((now - then) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${String(minutes)}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${String(hours)}h`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${String(days)}d`;
  return `${String(Math.round(days / 7))}w`;
}

export interface NotificationInboxProps {
  readonly notifications: readonly Notification[];
  readonly unread: number;
  readonly onRead: (notification: Notification) => void;
  readonly onReadAll: () => void;
}

export function NotificationInbox({
  notifications,
  unread,
  onRead,
  onReadAll,
}: NotificationInboxProps): ReactNode {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<'all' | 'unread'>('all');
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  const close = useCallback(() => setOpen(false), []);
  useDismissable({ open, onDismiss: close, surfaceRef: panelRef, triggerRef });

  /*
   * Pinned when the panel OPENS. A list whose timestamps tick while it is on
   * screen redraws for no reason a reader benefits from, and "3m" becoming
   * "4m" under the cursor is a distraction rather than an update.
   *
   * State set in an effect rather than `useMemo(..., [open])`: the memo form
   * lies about being pure, and the linter is right to reject it.
   */
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (open) setNow(Date.now());
  }, [open]);

  const visible = useMemo(() => {
    const undismissed = notifications.filter((item) => item.state !== 'dismissed');
    return tab === 'unread' ? undismissed.filter((item) => item.state === 'unread') : undismissed;
  }, [notifications, tab]);

  const openItem = (item: Notification): void => {
    onRead(item);
    close();
    navigate('/announcements');
  };

  return (
    <div className={styles.wrap}>
      <button
        ref={triggerRef}
        type="button"
        className={styles.trigger}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={unread === 0 ? 'Notifications' : `Notifications, ${String(unread)} unread`}
        onClick={() => setOpen((value) => !value)}
      >
        <Icon name="notifications" size="medium" />
        {unread > 0 ? (
          // aria-hidden: the count is already in the button's label, and a
          // screen reader announcing "3" after "3 unread" is noise.
          <span className={styles.badge} aria-hidden="true">
            {unread > 9 ? '9+' : unread}
          </span>
        ) : null}
      </button>

      {open ? (
        <div
          ref={panelRef}
          role="dialog"
          aria-label="Notifications"
          className={`${styles.panel ?? ''} glassPanel`}
        >
          <div className={styles.head}>
            <div className={styles.tabs} role="tablist" aria-label="Filter">
              {(['all', 'unread'] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  role="tab"
                  aria-selected={tab === value}
                  className={styles.tab}
                  onClick={() => setTab(value)}
                >
                  {value === 'all' ? 'All' : `Unread${unread > 0 ? ` (${String(unread)})` : ''}`}
                </button>
              ))}
            </div>
            <button
              type="button"
              className={styles.markAll}
              onClick={onReadAll}
              disabled={unread === 0}
            >
              Mark all read
            </button>
          </div>

          <div className={styles.list}>
            {visible.length === 0 ? (
              <p className={styles.empty}>
                {tab === 'unread' ? 'Nothing unread.' : 'No notifications yet.'}
              </p>
            ) : (
              visible.slice(0, 8).map((item) => {
                const isUnread = item.state === 'unread';
                return (
                  <button
                    key={item.announcement.id}
                    type="button"
                    className={styles.item}
                    data-unread={isUnread}
                    onClick={() => openItem(item)}
                  >
                    <span
                      className={styles.priority}
                      data-priority={item.priority}
                      aria-hidden="true"
                    />
                    <span className={styles.itemText}>
                      <span className={styles.itemTitle}>{item.announcement.title}</span>
                      <span className={styles.itemMeta}>
                        {item.announcement.category}
                        {' · '}
                        {ago(item.announcement.updatedAt, now)}
                        {/* Provenance travels with the notice (docs/19). */}
                        {item.relevant ? '' : ' · not your semester'}
                      </span>
                    </span>
                    {isUnread ? <span className={styles.dot} aria-label="Unread" /> : null}
                  </button>
                );
              })
            )}
          </div>

          <button
            type="button"
            className={styles.foot}
            onClick={() => {
              close();
              navigate('/notifications');
            }}
          >
            View all notifications
          </button>
        </div>
      ) : null}
    </div>
  );
}
