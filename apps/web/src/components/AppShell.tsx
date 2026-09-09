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
import { Link, NavLink, useLocation } from 'react-router-dom';
import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { ThemeControl } from './ThemeControl.js';
import { GlobalSearch, useSearchHotkey } from './GlobalSearch.js';
import { NotificationInbox } from './NotificationInbox.js';
import { TooltipProvider } from './ui/Tooltip.js';
import { ToastProvider } from './ui/Toast.js';
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
  /*
   * ADDING A DOCUMENT IS A DESTINATION, because handing GradTools a result
   * card, a calendar or a timetable is how information gets in — and typing it
   * is the fallback (M10A.9 §1, §6, §11).
   *
   * It takes the slot question papers had. That feature is not part of the
   * product and was holding one of five mobile tabs, which is the most
   * prominent placement the application has; the route still exists and
   * nothing points at it.
   */
  {
    to: '/import',
    label: 'Add document',
    shortLabel: 'Import',
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
const MOBILE_PATHS = ['/', '/academics', '/attendance', '/import', '/account'] as const;
const MOBILE_TABS: readonly Destination[] = MOBILE_PATHS.map(
  (path) => DESTINATIONS.find((destination) => destination.to === path) as Destination,
);

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
interface Box {
  readonly left: number;
  readonly width: number;
  readonly top: number;
  readonly height: number;
}

function useLimelight(
  containerRef: React.RefObject<HTMLElement | null>,
  activeKey: string,
): Box | null {
  const [box, setBox] = useState<Box | null>(null);

  const measure = useCallback(() => {
    const container = containerRef.current;
    if (container === null) return;
    const active = container.querySelector<HTMLElement>('[data-active="true"]');
    if (active === null) {
      setBox(null);
      return;
    }
    /*
     * Both axes, because the same indicator now travels DOWN a sidebar as well
     * as across the mobile bar. Measuring both costs nothing and means the
     * reference rebuild kept the travelling-marker behaviour instead of
     * replacing it with five markers that switch on.
     */
    setBox({
      left: active.offsetLeft,
      width: active.offsetWidth,
      top: active.offsetTop,
      height: active.offsetHeight,
    });
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

  const bottomNavRef = useRef<HTMLElement>(null);
  const bottomLight = useLimelight(bottomNavRef, location.pathname);

  return (
    /*
     * ONE TOOLTIP CLOCK FOR THE WHOLE APP.
     *
     * Without a provider above them each tooltip runs its own delay timer, so
     * moving down a column of eight attendance rows makes a person wait out the
     * delay eight times. `Tooltip` still works with no provider — it stands one
     * up for itself — but only this one can group them.
     */
    <TooltipProvider>
      <ToastProvider>
        <div className={styles.shell}>
          <a className={styles.skipLink} href="#main">
            Skip to content
          </a>

          {/*
        ------------------------------------------------------------------
        THE SIDEBAR IS THE NAVIGATION (reference rebuild)
        ------------------------------------------------------------------

        The old shell put three areas on a top bar and their destinations on a
        second row beneath it. The reference is sidebar-first: one vertical
        list, the brand above it, and the workspace beside it. Every route the
        two rows carried is here, in the same order, so nothing became
        unreachable — the arrangement changed, not the map.
      */}
          <aside className={styles.sidebar} aria-label="Sections">
            {/* Named explicitly: the wordmark is hidden in the icon rail, and
            without this the brand link announces nothing there. */}
            <NavLink to="/" className={styles.brand ?? ''} aria-label="GradTools home">
              <span className={styles.brandMark} aria-hidden="true">
                G
              </span>
              <span className={styles.brandText}>
                <span className={styles.brandWord}>GradTools</span>
                <span className={styles.brandKind}>Academic OS</span>
              </span>
            </NavLink>

            <nav className={styles.sideNav} aria-label="Destinations">
              {GROUPS.map((group) => (
                <Fragment key={group}>
                  {/* The group is NAMED, not merely separated by a rule. */}
                  <span className={styles.sideGroup}>{group}</span>
                  {DESTINATIONS.filter((destination) => destination.group === group).map((item) => {
                    const isActive =
                      item.to === '/'
                        ? location.pathname === '/'
                        : location.pathname === item.to ||
                          location.pathname.startsWith(`${item.to}/`);
                    return (
                      <NavLink
                        key={item.to}
                        to={item.to}
                        end={item.to === '/'}
                        data-active={isActive}
                        aria-current={isActive ? 'page' : undefined}
                        className={`${styles.sideLink ?? ''} ${isActive ? (styles.sideLinkActive ?? '') : ''}`}
                      >
                        <Icon name={item.icon} size="nav" />
                        <span className={styles.sideLabel}>{item.label}</span>
                      </NavLink>
                    );
                  })}
                </Fragment>
              ))}
            </nav>

            <p className={styles.sideFoot}>Independent student project. Not affiliated with VTU.</p>
          </aside>

          <div className={styles.workspace}>
            <header className={styles.topbar}>
              <button
                type="button"
                className={styles.searchTrigger ?? ''}
                onClick={openSearch}
                aria-label="Search GradTools"
                aria-keyshortcuts="Control+K"
              >
                <Icon name="search" size="nav" />
                <span className={styles.searchLabel}>Search</span>
                <kbd className={styles.searchKbd}>Ctrl K</kbd>
              </button>

              <div className={styles.topActions}>
                <NotificationInbox
                  notifications={notifications}
                  unread={unread}
                  onRead={(item) => void setState(item.announcement, 'read')}
                  onReadAll={() => void readAll()}
                />

                {/* On every page, not only Settings — a device setting, not a
                destination. Settings > Appearance remains its home. */}
                <ThemeControl />

                <NavLink to="/account" className={styles.topAction ?? ''} aria-label="Account">
                  <Icon name="account" size="medium" />
                </NavLink>
              </div>
            </header>

            <main className={styles.main} id="main" ref={mainRef} tabIndex={-1}>
              {children}
            </main>
          </div>

          <nav
            className={`${styles.bottomNav ?? ''} surfaceNav`}
            aria-label="Main"
            ref={bottomNavRef}
          >
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
                  item.to === '/'
                    ? location.pathname === '/'
                    : location.pathname.startsWith(item.to)
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
        </div>
      </ToastProvider>
    </TooltipProvider>
  );
}

/**
 * Consistent page heading block.
 *
 * THE EYEBROW IS BACK, and it is not a breadcrumb. The old reasoning was that
 * a navigation tier already said which area was open, so a line above the
 * title would repeat it. The approved design uses the slot for something the
 * navigation cannot say: the programme and scheme a page's figures belong to,
 * the semester a record covers, the division a timetable is for. That is
 * context, not a duplicate label.
 *
 * The title is set in the DISPLAY face at 26px, rising to 30px above 640.
 * It was `clamp(28px, 3.2vw, 40px)`, which reached 40px on a wide screen —
 * a page title that large is a poster, and every page had one.
 */
export function PageHeader({
  eyebrow,
  title,
  subtitle,
  action,
  back,
  pills,
}: {
  /** Programme, scheme, semester — what the page's content belongs to. */
  eyebrow?: string;
  title: string;
  subtitle?: string;
  action?: ReactNode;
  /** Where the back control goes. Present only on pages you arrive INTO. */
  back?: string | undefined;
  /**
   * The reference's outlined metadata pills, sitting opposite the title:
   * "10 lessons", "4,5 hours", "Due Jul 15". Facts about the page, never
   * actions — the action slot is separate and stays separate.
   */
  pills?: ReactNode;
}) {
  return (
    <div className={styles.pageHeader}>
      <div className={styles.pageHeading}>
        {eyebrow !== undefined && <p className={styles.pageEyebrow}>{eyebrow}</p>}
        <div className={styles.titleRow}>
          {back !== undefined && (
            <Link to={back} className={styles.backButton ?? ''} aria-label="Go back">
              <Icon name="arrowLeft" size="nav" />
            </Link>
          )}
          <h1 className={styles.pageTitle}>{title}</h1>
        </div>
        {subtitle !== undefined && <p className={styles.pageSubtitle}>{subtitle}</p>}
      </div>
      {/*
        ONE TRAILING CLUSTER.
        
        Pills and actions were siblings of the heading under
        `justify-content: space-between`, so at 1280 and 1440 the pills took
        the right-hand slot and pushed the primary button onto its own line —
        leaving "Add a semester" orphaned below the subtitle while "Add
        academic document" sat top-right. They belong together at the end of
        the row, and wrap together when there is no room.
      */}
      {(pills !== undefined || action !== undefined) && (
        <div className={styles.headerTrailing}>
          {pills !== undefined && <div className={styles.headerPills}>{pills}</div>}
          {action}
        </div>
      )}
    </div>
  );
}

export function Disclaimer({ children }: { children: ReactNode }) {
  return <p className={styles.disclaimer}>{children}</p>;
}
