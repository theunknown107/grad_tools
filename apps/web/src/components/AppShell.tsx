/**
 * Application shell: navigation, skip link, page frame.
 *
 * Authority: docs/04 §4.3, docs/27 §27.4 (focus management), docs/05 §5.18
 *
 * ---------------------------------------------------------------------------
 * M9.5: THE NAVIGATION IS HORIZONTAL AND IN TWO TIERS
 * ---------------------------------------------------------------------------
 *
 * The sidebar was 232px of permanent chrome down the left of every screen,
 * listing eleven destinations at all times — ten of which are not the one being
 * looked at. It also fixed the content to a single narrow column, which is why
 * every page read as a vertical stack.
 *
 * The references navigate horizontally: a slim top bar with the brand at one
 * end, a short row of destinations, and circular actions at the other. The
 * application reference then puts a row of contextual chips directly beneath
 * its heading. Two tiers, and eleven destinations fit comfortably in them:
 *
 *   TIER 1  the three areas — Overview, Academics, Account
 *   TIER 2  the destinations inside the area currently open
 *
 * Tier 2 is not a submenu that opens; it is always visible, always shows where
 * you are, and never hides a destination behind a click. On a phone it scrolls
 * sideways, which is what the mobile reference does with every row that is
 * wider than the screen.
 *
 * The bottom bar is unchanged in purpose (M9.3 §18): five destinations chosen
 * for a phone, not the first five of a list. On mobile it now also selects the
 * AREA, so the chip row beneath the header follows it.
 */

import { Icon, type IconName } from './icons.js';
import { NavLink, useLocation } from 'react-router-dom';
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { ThemeControl } from './ThemeControl.js';
import { GlobalSearch, useSearchHotkey } from './GlobalSearch.js';
import { NotificationInbox } from './NotificationInbox.js';
import { useAnnouncements, useNotifications } from '../hooks/useAnnouncements.js';
import styles from './AppShell.module.css';

interface Destination {
  readonly to: string;
  readonly label: string;
  readonly shortLabel: string;
  readonly icon: IconName;
  readonly group: string;
}

/**
 * Where a student can go.
 *
 * THREE GROUPS, NOT FIVE (M9.3 §17). `Documents` is deliberately ABSENT: it is
 * the operator's private import and review surface, not a student destination.
 */
const DESTINATIONS: readonly Destination[] = [
  { to: '/', label: 'Dashboard', shortLabel: 'Home', icon: 'dashboard', group: 'Overview' },
  {
    to: '/announcements',
    label: 'Announcements',
    shortLabel: 'News',
    icon: 'announcements',
    group: 'Overview',
  },
  {
    to: '/notifications',
    label: 'Notifications',
    shortLabel: 'Alerts',
    icon: 'notifications',
    group: 'Overview',
  },

  {
    to: '/semesters',
    label: 'My degree',
    shortLabel: 'Degree',
    icon: 'degree',
    group: 'Academics',
  },
  {
    to: '/results',
    label: 'Results',
    shortLabel: 'Results',
    icon: 'results',
    group: 'Academics',
  },
  { to: '/academics', label: 'SGPA & CGPA', shortLabel: 'GPA', icon: 'gpa', group: 'Academics' },
  {
    to: '/attendance',
    label: 'Attendance',
    shortLabel: 'Attendance',
    icon: 'attendance',
    group: 'Academics',
  },
  {
    to: '/timetable',
    label: 'Timetable',
    shortLabel: 'Timetable',
    icon: 'timetable',
    group: 'Academics',
  },
  {
    to: '/papers',
    label: 'Question papers',
    shortLabel: 'Papers',
    icon: 'papers',
    group: 'Academics',
  },

  { to: '/account', label: 'Account', shortLabel: 'Account', icon: 'account', group: 'Account' },
  /* An id card, not a second person: Account and Profile are adjacent chips and
     two identical glyphs beside two different words is worse than none. */
  { to: '/profile', label: 'Profile', shortLabel: 'Profile', icon: 'profile', group: 'Account' },
];

const GROUPS = ['Overview', 'Academics', 'Account'] as const;

/**
 * The mobile bar, CHOSEN rather than truncated (M9.3 §18). Five is the ceiling:
 * past that, labels stop being legible at 320px.
 */
const MOBILE_PATHS = ['/', '/academics', '/attendance', '/papers', '/account'] as const;
const MOBILE_TABS: readonly Destination[] = MOBILE_PATHS.map(
  (path) => DESTINATIONS.find((destination) => destination.to === path) as Destination,
);

/**
 * Which area the current route belongs to.
 *
 * Routes with no destination of their own — a single paper, the first-sync
 * screen, a mistyped URL — resolve to the area their parent path belongs to,
 * so `/papers/abc123` keeps Academics open and its chip row visible rather than
 * blanking the navigation.
 */
export function groupForPath(pathname: string): string {
  const exact = DESTINATIONS.find((destination) => destination.to === pathname);
  if (exact) return exact.group;

  const nested = DESTINATIONS.find(
    (destination) => destination.to !== '/' && pathname.startsWith(`${destination.to}/`),
  );
  if (nested) return nested.group;

  return 'Overview';
}

/**
 * The limelight: one indicator that TRAVELS between navigation items.
 *
 * Authority: M9.6B Reference 03 (@easemize/limelight-nav) — RECREATED.
 *
 * The reference's whole idea is that the active marker is a single object that
 * moves, not one of N markers that switch on. That difference is the entire
 * effect: a spotlight sliding to the tab you picked reads as one continuous
 * surface, where per-item underlines read as separate buttons.
 *
 * Position is MEASURED from the DOM rather than computed as `index / count`,
 * because the bar is a flex row whose items are sized by their labels. It is
 * re-measured on resize, so a rotation does not strand the light.
 *
 * Returns null until the first measurement, so the indicator never animates in
 * from x=0 on the first paint.
 */
function useLimelight(
  containerRef: React.RefObject<HTMLElement | null>,
  activeKey: string,
): { left: number; width: number } | null {
  const [box, setBox] = useState<{ left: number; width: number } | null>(null);

  const measure = useCallback(() => {
    const container = containerRef.current;
    if (container === null) return;
    const active = container.querySelector<HTMLElement>('[data-active="true"]');
    if (active === null) {
      setBox(null);
      return;
    }
    setBox({ left: active.offsetLeft, width: active.offsetWidth });
  }, [containerRef]);

  useLayoutEffect(measure, [measure, activeKey]);

  useEffect(() => {
    if (typeof ResizeObserver === 'undefined') return;
    const container = containerRef.current;
    if (container === null) return;
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    return () => observer.disconnect();
  }, [containerRef, measure]);

  return box;
}

export function AppShell({ children }: { children: ReactNode }) {
  const location = useLocation();
  const mainRef = useRef<HTMLElement>(null);
  const isFirstRender = useRef(true);

  const activeGroup = groupForPath(location.pathname);
  const inGroup = DESTINATIONS.filter((destination) => destination.group === activeGroup);

  /*
   * Route changes move focus to the main region.
   *
   * Without this a screen-reader user has no idea navigation happened in an
   * SPA — the page simply changes underneath them (docs/27 §27.4). Skipped on
   * first render so arriving at the site does not steal focus.
   */
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    mainRef.current?.focus();
  }, [location.pathname]);

  const [searchOpen, setSearchOpen] = useState(false);
  const openSearch = useCallback(() => setSearchOpen(true), []);
  const closeSearch = useCallback(() => setSearchOpen(false), []);
  useSearchHotkey(openSearch);

  /*
   * The shell reads announcements so the bell can carry a real unread count.
   * The same hooks the Notifications page uses, so the number in the header and
   * the list behind it can never disagree.
   */
  const { items: announcements } = useAnnouncements();
  const { notifications, unread, setState, readAll } = useNotifications(announcements);

  const groupNavRef = useRef<HTMLElement>(null);
  const bottomNavRef = useRef<HTMLElement>(null);
  const groupLight = useLimelight(groupNavRef, activeGroup);
  const bottomLight = useLimelight(bottomNavRef, location.pathname);

  return (
    <div className={styles.shell}>
      <a className={styles.skipLink} href="#main">
        Skip to content
      </a>

      <header className={`${styles.topbar ?? ''} glassNav`}>
        <div className={styles.topbarInner}>
          <NavLink to="/" className={styles.brand ?? ''}>
            <span className={styles.brandMark} aria-hidden="true">
              G
            </span>
            <span className={styles.brandWord}>GradTools</span>
          </NavLink>

          {/* TIER 1. Three words, so it fits on a top bar at any width worth
              putting one on. */}
          {/*
            TIER 1 carries the glow (Reference 02). One travelling capsule with
            an accent-tinted halo behind the open area — the reference's
            per-item coloured glow, reduced to a single light, because five
            differently-coloured glows would be five brand colours.
          */}
          <nav className={styles.groupNav} aria-label="Areas" ref={groupNavRef}>
            {groupLight !== null ? (
              <span
                className={styles.glow}
                aria-hidden="true"
                style={{
                  transform: `translateX(${String(groupLight.left)}px)`,
                  width: `${String(groupLight.width)}px`,
                }}
              />
            ) : null}
            {GROUPS.map((group) => {
              const first = DESTINATIONS.find((destination) => destination.group === group);
              if (first === undefined) return null;
              const isActive = group === activeGroup;
              return (
                <NavLink
                  key={group}
                  to={first.to}
                  end={first.to === '/'}
                  aria-current={isActive ? 'true' : undefined}
                  data-active={isActive}
                  className={`${styles.groupLink ?? ''} ${isActive ? (styles.groupLinkActive ?? '') : ''}`}
                >
                  {group}
                </NavLink>
              );
            })}
          </nav>

          <div className={styles.topActions}>
            {/*
              Search is a button, not a link: it opens a surface over the page
              rather than going anywhere. On a wide screen it shows its shortcut,
              on a phone it collapses to the glyph.
            */}
            <button
              type="button"
              className={`${styles.searchTrigger ?? ''} glassInput`}
              onClick={openSearch}
              aria-label="Search GradTools"
              aria-keyshortcuts="Control+K"
            >
              <Icon name="search" size="nav" />
              <span className={styles.searchLabel}>Search</span>
              <kbd className={styles.searchKbd}>Ctrl K</kbd>
            </button>

            <NotificationInbox
              notifications={notifications}
              unread={unread}
              onRead={(item) => void setState(item.announcement, 'read')}
              onReadAll={() => void readAll()}
            />

            {/* Theme is a device setting, not a destination. */}
            <ThemeControl />

            <NavLink to="/account" className={styles.topAction ?? ''} aria-label="Account">
              <Icon name="account" size="medium" />
            </NavLink>
          </div>
        </div>

        {/* TIER 2. The destinations inside the open area. Scrolls sideways on a
            phone rather than wrapping into a block of chrome. */}
        <nav className={styles.subNav} aria-label={activeGroup}>
          <div className={styles.subNavInner}>
            {inGroup.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === '/'}
                className={({ isActive }) =>
                  `${styles.subLink ?? ''} ${isActive ? (styles.subLinkActive ?? '') : ''}`
                }
              >
                <Icon name={item.icon} size="nav" />
                {item.label}
              </NavLink>
            ))}
          </div>
        </nav>
      </header>

      <main className={styles.main} id="main" ref={mainRef} tabIndex={-1}>
        {children}
      </main>

      <nav className={`${styles.bottomNav ?? ''} glassNav`} aria-label="Main" ref={bottomNavRef}>
        {/* The limelight itself: a beam above the active tab plus the lit pill
            behind it, travelling as one object (Reference 03). */}
        {bottomLight !== null ? (
          <span
            className={styles.limelight}
            aria-hidden="true"
            style={{
              transform: `translateX(${String(bottomLight.left)}px)`,
              width: `${String(bottomLight.width)}px`,
            }}
          />
        ) : null}
        {MOBILE_TABS.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/'}
            data-active={
              item.to === '/' ? location.pathname === '/' : location.pathname.startsWith(item.to)
            }
            className={({ isActive }) =>
              `${styles.bottomLink ?? ''} ${isActive ? (styles.bottomLinkActive ?? '') : ''}`
            }
          >
            <Icon name={item.icon} size="medium" />
            {item.shortLabel}
          </NavLink>
        ))}
      </nav>

      <GlobalSearch open={searchOpen} onClose={closeSearch} />

      <p className={styles.footer}>
        Independent student project. Not affiliated with or endorsed by VTU.
      </p>
    </div>
  );
}

/**
 * Consistent page heading block.
 *
 * No eyebrow line: the reference application puts a breadcrumb above its
 * heading, but the second navigation tier already says which area is open and
 * which destination is current. Adding "ACADEMICS" above "Results" would
 * repeat, in smaller type, something the highlighted chip two rows up already
 * says.
 */
export function PageHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <div className={styles.pageHeader}>
      <div className={styles.pageHeading}>
        <h1 className={styles.pageTitle}>{title}</h1>
        {subtitle !== undefined && <p className={styles.pageSubtitle}>{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export function Disclaimer({ children }: { children: ReactNode }) {
  return <p className={styles.disclaimer}>{children}</p>;
}
