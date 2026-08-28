/**
 * Application shell: navigation, skip link, page frame.
 *
 * Authority: docs/04 §4.3, docs/27 §27.4 (focus management)
 *
 * Stage 1 ships only the approved destinations. Unbuilt sections (Papers,
 * Syllabus, Notifications) are ABSENT rather than shown disabled — an app full
 * of dead links reads as broken, not as ambitious (docs/04 §4.3).
 */

import {
  BellIcon,
  CalendarDays,
  CalcIcon,
  ClipboardList,
  FileTextIcon,
  GraduationCap,
  LayoutDashboard,
  LibraryIcon,
  Megaphone,
  UserRound,
} from './icons.js';
import { NavLink, useLocation } from 'react-router-dom';
import { useEffect, useRef, type ReactNode } from 'react';
import styles from './AppShell.module.css';

interface Destination {
  readonly to: string;
  readonly label: string;
  readonly shortLabel: string;
  readonly icon: typeof LayoutDashboard;
  readonly group: string;
}

/** Stage 1 destinations only (docs/33 §33.2). */
const DESTINATIONS: readonly Destination[] = [
  {
    to: '/',
    label: 'Dashboard',
    shortLabel: 'Home',
    icon: LayoutDashboard,
    group: 'Overview',
  },
  {
    to: '/announcements',
    label: 'Announcements',
    shortLabel: 'News',
    icon: Megaphone,
    group: 'Overview',
  },
  {
    to: '/notifications',
    label: 'Notifications',
    shortLabel: 'Alerts',
    icon: BellIcon,
    group: 'Overview',
  },
  {
    to: '/semesters',
    label: 'My degree',
    shortLabel: 'Degree',
    icon: GraduationCap,
    group: 'Academics',
  },
  {
    to: '/academics',
    label: 'SGPA & CGPA',
    shortLabel: 'Academics',
    icon: CalcIcon,
    group: 'Academics',
  },
  {
    to: '/results',
    label: 'Results',
    shortLabel: 'Results',
    icon: GraduationCap,
    group: 'Academics',
  },
  {
    to: '/papers',
    label: 'Question papers',
    shortLabel: 'Papers',
    icon: LibraryIcon,
    group: 'Academics',
  },
  {
    to: '/documents',
    label: 'Documents',
    shortLabel: 'Docs',
    icon: FileTextIcon,
    group: 'Academics',
  },
  {
    to: '/attendance',
    label: 'Attendance',
    shortLabel: 'Attendance',
    icon: ClipboardList,
    group: 'Attendance',
  },
  {
    to: '/timetable',
    label: 'Timetable',
    shortLabel: 'Timetable',
    icon: CalendarDays,
    group: 'Planning',
  },
  {
    to: '/profile',
    label: 'Profile',
    shortLabel: 'Profile',
    icon: UserRound,
    group: 'Planning',
  },
];

/** Bottom bar carries 5 items: past five, labels stop being legible at 360px. */
const MOBILE_DESTINATIONS = DESTINATIONS.filter((d) => d.to !== '/profile');
const MOBILE_TABS: readonly Destination[] = [
  ...MOBILE_DESTINATIONS,
  DESTINATIONS.find((d) => d.to === '/profile') as Destination,
].slice(0, 5);

function groupedDestinations(): [string, Destination[]][] {
  const groups = new Map<string, Destination[]>();
  for (const destination of DESTINATIONS) {
    const existing = groups.get(destination.group);
    if (existing) existing.push(destination);
    else groups.set(destination.group, [destination]);
  }
  return [...groups.entries()];
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

  return (
    <div className={styles.shell}>
      <a className={styles.skipLink} href="#main">
        Skip to content
      </a>

      <header className={styles.topbar}>
        <NavLink to="/" className={styles.brand ?? ''}>
          <span className={styles.brandMark} aria-hidden="true">
            G
          </span>
          GradTools
        </NavLink>
      </header>

      <div className={styles.body}>
        <nav className={styles.sidebar} aria-label="Main">
          <NavLink to="/" className={styles.brand ?? ''}>
            <span className={styles.brandMark} aria-hidden="true">
              G
            </span>
            GradTools
          </NavLink>

          {groupedDestinations().map(([group, items]) => (
            <div className={styles.navGroup} key={group}>
              <h2 className={styles.navGroupLabel}>{group}</h2>
              {items.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.to === '/'}
                  className={({ isActive }) =>
                    `${styles.navLink ?? ''} ${isActive ? (styles.navLinkActive ?? '') : ''}`
                  }
                >
                  <item.icon size={16} aria-hidden="true" />
                  {item.label}
                </NavLink>
              ))}
            </div>
          ))}

          <p className={styles.sidebarFooter}>
            Independent student project. Not affiliated with or endorsed by VTU.
          </p>
        </nav>

        <main className={styles.main} id="main" ref={mainRef} tabIndex={-1}>
          {children}
        </main>
      </div>

      <nav className={styles.bottomNav} aria-label="Main">
        {MOBILE_TABS.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/'}
            className={({ isActive }) =>
              `${styles.bottomLink ?? ''} ${isActive ? (styles.bottomLinkActive ?? '') : ''}`
            }
          >
            <item.icon size={20} aria-hidden="true" />
            {item.shortLabel}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}

/** Consistent page heading block. */
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
      <div>
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
