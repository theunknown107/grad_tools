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
import { Fragment, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ThemeControl } from './ThemeControl.js';
import { GlobalSearch, OpenSearchProvider, useSearchHotkey } from './GlobalSearch.js';
import { NotificationInbox } from './NotificationInbox.js';
import { Sheet } from './ui/Sheet.js';
import { TooltipProvider } from './ui/Tooltip.js';
import { ToastProvider } from './ui/Toast.js';
import { useAnnouncements, useNotifications } from '../hooks/useAnnouncements.js';
import { useProfile } from '../hooks/useCollection.js';
import { Avatar } from './ui/Avatar.js';
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
   * EXAMS ARE NOT THE WEEKLY TIMETABLE, and the navigation says so by putting
   * them beside it rather than inside it. One is the shape of an ordinary
   * week; the other is a handful of dated events that matter enormously for a
   * month and then do not exist. A student looking for either would not think
   * to look under the other.
   */
  {
    to: '/exams',
    label: 'Exam time table',
    shortLabel: 'Exams',
    icon: 'papers',
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
 * The modifier the search shortcut actually uses on this machine.
 *
 * Read once at module load from the platform string. `navigator.platform` is
 * deprecated but is the only thing that distinguishes an Apple keyboard
 * reliably in every browser this ships to; a wrong guess here is a label that
 * tells somebody to press a key they do not have.
 */
const MODIFIER_KEY =
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl';

/**
 * The mobile bar, CHOSEN rather than truncated (M9.3 §18). Five is the ceiling:
 * past that, labels stop being legible at 320px.
 */
/*
 * THE FOUR DESTINATIONS THE BOTTOM BAR CARRIES, from the approved design.
 *
 * Home, Results, Timetable, Attendance — the four a student opens on a phone —
 * and a fifth control that is NOT a destination: "More", which opens the rest
 * of the navigation as a sheet. The bar used to spend all five slots on
 * destinations, which meant seven of the eleven routes were unreachable on a
 * phone without going through a page that happened to link to them.
 */
const MOBILE_PATHS = ['/', '/results', '/timetable', '/attendance'] as const;
const MOBILE_TABS: readonly Destination[] = MOBILE_PATHS.map(
  (path) => DESTINATIONS.find((destination) => destination.to === path) as Destination,
);

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
  const [moreOpen, setMoreOpen] = useState(false);
  /*
   * THE RAIL. 256px expanded, 76px collapsed, as the design specifies.
   *
   * Plain component state, exactly as the design has it: the shell never
   * unmounts during client-side navigation, so the choice survives moving
   * between pages without being persisted. Storing it would be inventing a
   * preference the design does not have.
   */
  const [collapsed, setCollapsed] = useState(false);
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

  /*
   * The shell reads the profile for one thing: who to show in the sidebar
   * footer and the top-right avatar. It is the same hook every page uses, so
   * the name in the chrome and the name on the Profile page cannot disagree.
   */
  const { profile } = useProfile();

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
        {/* So a page can open the palette — the 404's middle action is the
            design's own "Search". */}
        <OpenSearchProvider onOpen={openSearch}>
          <div className={styles.shell} data-collapsed={collapsed ? 'true' : undefined}>
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
            <aside id="gt-sidebar" className={styles.sidebar} aria-label="Sections">
              {/* Named explicitly: the wordmark is hidden in the icon rail, and
            without this the brand link announces nothing there. */}
              {/*
              A PLAIN LINK, not a NavLink.
              
              `NavLink` sets `aria-current="page"` when its target is active, so
              on the dashboard the brand announced itself as the current page
              alongside the Dashboard row — two "current page" elements, one of
              which is a logo. The brand is a way home, not a destination in the
              list.
            */}
              <Link to="/" className={styles.brand ?? ''} aria-label="GradTools home">
                {/*
                THE MARK IS THE MORTARBOARD, not a letter. The design puts the
                same glyph here that "My degree" uses in the navigation below —
                a lettermark reads as a placeholder that nobody got round to
                replacing, and this product is about a degree.
              */}
                <span className={styles.brandMark} aria-hidden="true">
                  <Icon name="degree" size="large" />
                </span>
                <span className={styles.brandText}>
                  <span className={styles.brandWord}>GradTools</span>
                  <span className={styles.brandKind}>Academic OS</span>
                </span>
              </Link>

              <nav className={styles.sideNav} aria-label="Destinations">
                {GROUPS.map((group) => (
                  <Fragment key={group}>
                    {/* The group is NAMED, not merely separated by a rule. */}
                    <span className={styles.sideGroup}>{group}</span>
                    {DESTINATIONS.filter((destination) => destination.group === group).map(
                      (item) => {
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
                            /*
                          IN THE RAIL THE LABEL IS THE ONLY NAME THERE IS.
                          Collapsed, the row is a bare glyph, so the design
                          gives it a `title` — and the visually-hidden label
                          below keeps the accessible name intact for a screen
                          reader in both states, which a `title` alone would
                          not do reliably.
                        */
                            {...(collapsed ? { title: item.label } : {})}
                          >
                            <Icon name={item.icon} size="nav" />
                            <span className={styles.sideLabel}>{item.label}</span>
                          </NavLink>
                        );
                      },
                    )}
                  </Fragment>
                ))}
              </nav>

              {/*
              THE FOOTER IS THE STUDENT, not a disclaimer.
              
              The design ends the sidebar with who is signed in — avatar, name,
              register number — and makes the whole block the way to Profile.
              The "not affiliated with VTU" line that used to sit here is not
              lost: the dashboard footer carries the full version of it, which
              is where a disclaimer belongs, rather than repeated in the chrome
              of every screen.
            */}
              {/* Named on hover in the rail, like every other row there. */}
              <NavLink
                to="/profile"
                className={styles.sideIdentity ?? ''}
                {...(collapsed ? { title: profile?.displayName ?? 'Your profile' } : {})}
              >
                <Avatar name={profile?.displayName ?? null} size={32} />
                <span className={styles.sideIdentityText}>
                  <span className={styles.sideIdentityName}>
                    {profile?.displayName ?? 'Your profile'}
                  </span>
                  {/* Only where the student actually gave one (§24). */}
                  {profile?.usn !== null && profile?.usn !== undefined && profile.usn !== '' ? (
                    <span className={styles.sideIdentityUsn}>{profile.usn}</span>
                  ) : null}
                </span>
              </NavLink>
            </aside>

            <div className={styles.workspace}>
              <header className={styles.topbar}>
                {/*
                THE RAIL CONTROL, at the leading edge of the bar where the
                design puts it, and desktop-only: below `lg` the sidebar is not
                on screen at all, so a control that collapses it would do
                nothing visible.
              */}
                <button
                  type="button"
                  className={styles.railToggle ?? ''}
                  onClick={() => setCollapsed((value) => !value)}
                  aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
                  aria-expanded={!collapsed}
                  aria-controls="gt-sidebar"
                  title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
                >
                  <Icon name={collapsed ? 'sidebarExpand' : 'sidebarCollapse'} size="medium" />
                </button>
                <button
                  type="button"
                  className={styles.searchTrigger ?? ''}
                  onClick={openSearch}
                  aria-label="Search GradTools"
                  aria-keyshortcuts="Control+K"
                >
                  <Icon name="search" size="nav" />
                  {/*
                  The design's own placeholder. "Search" alone does not say what
                  is searchable, and this field reaches results, courses and
                  actions — so it says so.
                */}
                  <span className={styles.searchLabel}>Search results, courses, actions…</span>
                  {/*
                  TWO CHIPS, as the design draws it — and the modifier is the
                  one this keyboard actually has. The design hardcodes ⌘; the
                  hotkey handler accepts either, so showing ⌘ to someone on
                  Windows would be telling them the wrong key.
                */}
                  <span className={styles.searchKeys}>
                    <kbd className={styles.searchKbd}>{MODIFIER_KEY}</kbd>
                    <kbd className={styles.searchKbd}>K</kbd>
                  </span>
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

                  {/*
                  The design's top-right identity is the AVATAR and it goes to
                  Profile. Account keeps its sidebar destination; what the top
                  bar offers is "me", which is the thing people reach for up
                  there.
                */}
                  <NavLink
                    to="/profile"
                    className={styles.topIdentity ?? ''}
                    aria-label="Open profile"
                  >
                    <Avatar name={profile?.displayName ?? null} size={34} />
                  </NavLink>
                </div>
              </header>

              <main className={styles.main} id="main" ref={mainRef} tabIndex={-1}>
                {children}
              </main>
            </div>

            {/*
            THE BOTTOM BAR, from the approved design: four destinations and a
            way to reach everything else. No travelling marker — the design
            marks the active tab with ink, and a beam sliding under a thumb is
            motion nobody asked for.
          */}
            <nav className={`${styles.bottomNav ?? ''} surfaceNav`} aria-label="Main">
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
              <button
                type="button"
                className={styles.bottomLink}
                onClick={() => {
                  setMoreOpen(true);
                }}
                aria-haspopup="dialog"
                aria-expanded={moreOpen}
              >
                <Icon name="dashboard" size="medium" />
                More
              </button>
            </nav>

            {/*
            Everything the bar has no room for, as a bottom sheet — the same
            groups the sidebar shows, so a phone reaches every route the
            desktop does.
          */}
            <Sheet
              open={moreOpen}
              onClose={() => {
                setMoreOpen(false);
              }}
              side="bottom"
              title="Go to"
            >
              <div className={styles.moreSheet}>
                {GROUPS.map((group) => (
                  <Fragment key={group}>
                    <span className={styles.sideGroup}>{group}</span>
                    <div className={styles.moreGrid}>
                      {DESTINATIONS.filter((destination) => destination.group === group).map(
                        (item) => {
                          const isActive =
                            item.to === '/'
                              ? location.pathname === '/'
                              : location.pathname.startsWith(item.to);
                          return (
                            <NavLink
                              key={item.to}
                              to={item.to}
                              end={item.to === '/'}
                              onClick={() => {
                                setMoreOpen(false);
                              }}
                              className={`${styles.moreLink ?? ''} ${isActive ? (styles.moreLinkActive ?? '') : ''}`}
                            >
                              <Icon name={item.icon} size="nav" />
                              {item.label}
                            </NavLink>
                          );
                        },
                      )}
                    </div>
                  </Fragment>
                ))}
              </div>
            </Sheet>

            <GlobalSearch open={searchOpen} onClose={closeSearch} />
          </div>
        </OpenSearchProvider>
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
