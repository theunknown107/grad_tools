/**
 * The application shell — the design's sidebar, top bar, bottom bar and
 * "More" sheet.
 *
 *   ≥1024   collapsible sidebar (256 ↔ 76) + sticky top bar
 *   <1024   top bar with brand, bottom bar with four tabs and More, which
 *           opens a draggable bottom sheet of every destination
 *
 * Route changes move focus to <main> (so a screen reader starts at the new
 * page), replay the design's rise-in, and reset the scroll position.
 */

import {
  Command as CommandIcon,
  GraduationCap,
  PanelLeft,
  PanelLeftClose,
  Search,
  Bell,
} from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { useAnnouncements, useNotifications } from '../../hooks/useAnnouncements.js';
import { useProfile } from '../../hooks/useCollection.js';
import { useTheme } from '../../hooks/useTheme.js';
import { cn } from '../../lib/cn.js';
import { APPEARANCES } from '../../lib/theme.js';
import { CommandMenuProvider, MODIFIER_KEY, useOpenCommand } from '../navigation/CommandMenu.js';
import { ThemeToggle } from '../navigation/ThemeToggle.js';
import { IconButton } from '../ui/button.js';
import { Toaster } from '../ui/feedback.js';
import { Kbd } from '../ui/kbd.js';
import { Avatar, initialsOf } from '../ui/page.js';
import { BottomSheet } from '../ui/sheet.js';
import { TooltipProvider } from '../ui/tooltip.js';
import { DESTINATIONS, MOBILE_TABS, NAV_GROUPS, isActive } from './nav.js';

const COLLAPSE_KEY = 'gradtools:v1:sidebar';

function readCollapsed(): boolean {
  try {
    return window.localStorage.getItem(COLLAPSE_KEY) === 'collapsed';
  } catch {
    return false;
  }
}

export function AppShell({
  children,
  footer,
}: {
  readonly children: ReactNode;
  readonly footer?: ReactNode;
}) {
  return (
    <TooltipProvider delayDuration={200}>
      <CommandMenuProvider>
        <Shell footer={footer}>{children}</Shell>
        <Toaster />
      </CommandMenuProvider>
    </TooltipProvider>
  );
}

function Shell({
  children,
  footer,
}: {
  readonly children: ReactNode;
  readonly footer?: ReactNode;
}) {
  const location = useLocation();
  const mainRef = useRef<HTMLElement>(null);
  const firstRender = useRef(true);
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [moreOpen, setMoreOpen] = useState(false);

  const { items: announcements } = useAnnouncements();
  const { unread } = useNotifications(announcements);
  const { profile } = useProfile();
  const name = profile?.displayName?.trim() || null;
  const initials = initialsOf(name);

  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    mainRef.current?.scrollTo?.({ top: 0 });
    mainRef.current?.focus({ preventScroll: true });
    setMoreOpen(false);
  }, [location.pathname]);

  const toggleCollapsed = (): void => {
    setCollapsed((value) => {
      try {
        window.localStorage.setItem(COLLAPSE_KEY, value ? 'expanded' : 'collapsed');
      } catch {
        /* A preference that cannot persist still applies for this session. */
      }
      return !value;
    });
  };

  return (
    <div className="flex h-full bg-canvas text-ink">
      <a
        href="#gt-main"
        className="sr-only z-[100] rounded-lg bg-raised px-3 py-2 text-sm font-medium shadow-e2 focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
      >
        Skip to content
      </a>

      <Sidebar
        collapsed={collapsed}
        unread={unread}
        name={name}
        initials={initials}
        usn={profile?.usn ?? null}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar
          collapsed={collapsed}
          onToggleCollapse={toggleCollapsed}
          onOpenMore={() => setMoreOpen(true)}
          unread={unread}
          initials={initials}
        />
        <main
          id="gt-main"
          ref={mainRef}
          tabIndex={-1}
          className="flex-1 overflow-y-auto pb-24 outline-none scroll-quiet lg:pb-0"
        >
          <div
            key={location.pathname}
            className="mx-auto w-full max-w-[1180px] animate-rise px-4 py-6 sm:px-6 sm:py-8 lg:px-10"
          >
            {children}
            {footer}
          </div>
        </main>
      </div>

      <MobileBottomNav onMore={() => setMoreOpen(true)} moreOpen={moreOpen} unread={unread} />
      <MobileNavSheet open={moreOpen} onOpenChange={setMoreOpen} unread={unread} />
    </div>
  );
}

/* ---------------------------------------------------------------- Sidebar */

function Brand({ collapsed }: { readonly collapsed: boolean }) {
  return (
    <Link
      to="/"
      aria-label="GradTools home"
      className={cn(
        'flex h-16 shrink-0 items-center gap-2.5 rounded-lg px-5',
        collapsed && 'justify-center px-0',
      )}
    >
      <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-accent font-semibold text-on-accent">
        <GraduationCap className="size-5" aria-hidden="true" />
      </span>
      {!collapsed && (
        <span className="leading-tight">
          <span className="block text-[15px] font-semibold tracking-[-0.01em]">GradTools</span>
          <span className="block font-mono text-[10px] tracking-[0.16em] text-ink-3 uppercase">
            Academic OS
          </span>
        </span>
      )}
    </Link>
  );
}

function Sidebar({
  collapsed,
  unread,
  name,
  initials,
  usn,
}: {
  readonly collapsed: boolean;
  readonly unread: number;
  readonly name: string | null;
  readonly initials: string;
  readonly usn: string | null;
}) {
  const { pathname } = useLocation();
  return (
    <aside
      id="gt-sidebar"
      aria-label="Sections"
      className={cn(
        'relative hidden shrink-0 flex-col border-r border-line bg-panel transition-[width] duration-300 ease-[var(--ease-out-quint)] lg:flex',
        collapsed ? 'w-[76px]' : 'w-[256px]',
      )}
    >
      <Brand collapsed={collapsed} />

      <nav
        aria-label="Destinations"
        className="relative flex-1 overflow-y-auto px-3 pb-4 scroll-quiet"
      >
        {NAV_GROUPS.map((group) => (
          <div key={group} className="mb-5">
            {collapsed ? (
              <span className="sr-only">{group}</span>
            ) : (
              <div className="mb-1.5 px-3 font-mono text-[10px] tracking-[0.16em] text-ink-3 uppercase">
                {group}
              </div>
            )}
            <ul className="flex flex-col gap-0.5">
              {DESTINATIONS.filter((destination) => destination.group === group).map((item) => {
                const active = isActive(item.to, pathname);
                const Icon = item.icon;
                const badge = item.to === '/notifications' && unread > 0 ? unread : null;
                return (
                  <li key={item.to}>
                    <NavLink
                      to={item.to}
                      end={item.to === '/'}
                      aria-current={active ? 'page' : undefined}
                      title={collapsed ? item.label : undefined}
                      aria-label={
                        badge === null ? undefined : `${item.label}, ${String(badge)} unread`
                      }
                      className={cn(
                        'group relative flex h-10 items-center gap-3 rounded-lg px-3 text-sm font-medium transition-colors duration-150',
                        collapsed && 'justify-center px-0',
                        active
                          ? 'bg-accent-weak text-accent-ink'
                          : 'text-ink-2 hover:bg-sunken hover:text-ink',
                      )}
                    >
                      <Icon
                        aria-hidden="true"
                        className={cn(
                          'size-[18px] shrink-0',
                          active ? 'text-accent-ink' : 'text-ink-3 group-hover:text-ink-2',
                        )}
                      />
                      <span className={collapsed ? 'sr-only' : 'truncate'}>{item.label}</span>
                      {!collapsed && badge !== null && (
                        <span className="tnum ml-auto text-[11px] font-semibold text-accent-ink">
                          {badge > 99 ? '99+' : badge}
                        </span>
                      )}
                      {collapsed && badge !== null && (
                        <span
                          aria-hidden="true"
                          className="absolute top-1.5 right-2 size-1.5 rounded-full bg-danger"
                        />
                      )}
                    </NavLink>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      <NavLink
        to="/profile"
        title={collapsed ? (name ?? 'Your profile') : undefined}
        className={cn(
          'flex items-center gap-3 border-t border-line px-4 py-3 text-left transition-colors hover:bg-sunken',
          collapsed && 'justify-center px-0',
        )}
      >
        <Avatar initials={initials} />
        {collapsed ? (
          <span className="sr-only">{name ?? 'Your profile'}</span>
        ) : (
          <span className="min-w-0">
            <span className="block truncate text-[13px] font-medium">{name ?? 'Your profile'}</span>
            <span className="block truncate font-mono text-[11px] text-ink-3">
              {usn !== null && usn !== '' ? usn : 'Add your details'}
            </span>
          </span>
        )}
      </NavLink>
    </aside>
  );
}

/* ----------------------------------------------------------------- TopBar */

function TopBar({
  collapsed,
  onToggleCollapse,
  onOpenMore,
  unread,
  initials,
}: {
  readonly collapsed: boolean;
  readonly onToggleCollapse: () => void;
  readonly onOpenMore: () => void;
  readonly unread: number;
  readonly initials: string;
}) {
  const openCommand = useOpenCommand();
  return (
    <header className="sticky top-0 z-40 flex h-16 shrink-0 items-center gap-3 border-b border-line bg-panel/95 px-4 backdrop-blur-sm sm:px-6">
      <IconButton
        label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        aria-expanded={!collapsed}
        aria-controls="gt-sidebar"
        onClick={onToggleCollapse}
        className="hidden lg:inline-grid"
      >
        {collapsed ? <PanelLeft /> : <PanelLeftClose />}
      </IconButton>

      <Link
        to="/"
        className="flex items-center gap-2 rounded-lg lg:hidden"
        aria-label="GradTools home"
      >
        <span className="grid size-8 place-items-center rounded-lg bg-accent text-on-accent">
          <GraduationCap className="size-4.5" aria-hidden="true" />
        </span>
        <span className="hidden font-semibold tracking-[-0.01em] min-[380px]:inline">
          GradTools
        </span>
      </Link>

      <button
        type="button"
        onClick={openCommand}
        aria-label="Search GradTools"
        aria-keyshortcuts="Control+K Meta+K"
        className="gt-glass group ml-auto hidden h-9.5 w-full max-w-sm items-center gap-2.5 rounded-lg px-3 text-sm text-ink-3 transition-colors sm:flex lg:ml-0"
      >
        <Search className="size-4 shrink-0" aria-hidden="true" />
        <span className="truncate">Search results, courses, actions…</span>
        <span className="ml-auto flex items-center gap-1" aria-hidden="true">
          <Kbd>{MODIFIER_KEY}</Kbd>
          <Kbd>K</Kbd>
        </span>
      </button>

      <div className="ml-auto flex items-center gap-1">
        <IconButton label="Search" onClick={openCommand} className="sm:hidden">
          <Search />
        </IconButton>
        <ThemeToggle />
        <div className="relative">
          <IconButton
            asChild
            label={unread > 0 ? `Notifications, ${String(unread)} unread` : 'Notifications'}
          >
            <Link to="/notifications">
              <Bell aria-hidden="true" />
            </Link>
          </IconButton>
          {unread > 0 && (
            <span
              aria-hidden="true"
              className="tnum pointer-events-none absolute top-1 right-1 grid h-4 min-w-4 place-items-center rounded-full bg-danger px-1 text-[10px] font-semibold text-canvas"
            >
              {unread > 9 ? '9+' : unread}
            </span>
          )}
        </div>
        <Link
          to="/profile"
          aria-label="Open profile"
          className="ml-1 rounded-full ring-offset-2 ring-offset-panel focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          <Avatar initials={initials} size={34} />
        </Link>
        <IconButton label="Open navigation" onClick={onOpenMore} className="lg:hidden">
          <PanelLeft />
        </IconButton>
      </div>
    </header>
  );
}

/* ------------------------------------------------------ Mobile navigation */

function MobileBottomNav({
  onMore,
  moreOpen,
  unread,
}: {
  readonly onMore: () => void;
  readonly moreOpen: boolean;
  readonly unread: number;
}) {
  const { pathname } = useLocation();
  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-panel/98 backdrop-blur-sm lg:hidden"
    >
      <div className="grid grid-cols-5">
        {MOBILE_TABS.map((item) => {
          const Icon = item.icon;
          const active = isActive(item.to, pathname);
          return (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'flex min-h-14 flex-col items-center justify-center gap-1 py-2.5 text-[11px] font-medium transition-colors',
                active ? 'text-accent-ink' : 'text-ink-3 hover:text-ink-2',
              )}
            >
              <Icon className="size-[21px]" aria-hidden="true" />
              {item.short}
            </NavLink>
          );
        })}
        <button
          type="button"
          onClick={onMore}
          aria-haspopup="dialog"
          aria-expanded={moreOpen}
          aria-label={unread > 0 ? `More, ${String(unread)} unread notifications` : 'More'}
          className="relative flex min-h-14 flex-col items-center justify-center gap-1 py-2.5 text-[11px] font-medium text-ink-3 transition-colors hover:text-ink-2"
        >
          <CommandIcon className="size-[21px]" aria-hidden="true" />
          More
          {unread > 0 && (
            <span
              aria-hidden="true"
              className="absolute top-2 right-[calc(50%-18px)] size-1.5 rounded-full bg-danger"
            />
          )}
        </button>
      </div>
      <div className="h-[env(safe-area-inset-bottom)]" />
    </nav>
  );
}

const APPEARANCE_LABEL = { light: 'Light', dark: 'Dark', system: 'System' } as const;

function MobileNavSheet({
  open,
  onOpenChange,
  unread,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly unread: number;
}) {
  const { pathname } = useLocation();
  const { preference, setAppearance } = useTheme();
  return (
    <BottomSheet open={open} onOpenChange={onOpenChange} title="Go to" className="lg:hidden">
      <nav aria-label="All destinations">
        {NAV_GROUPS.map((group) => (
          <div key={group} className="mb-4">
            <div className="mb-1 px-2 font-mono text-[10px] tracking-[0.16em] text-ink-3 uppercase">
              {group}
            </div>
            <div className="grid grid-cols-2 gap-2">
              {DESTINATIONS.filter((destination) => destination.group === group).map((item) => {
                const Icon = item.icon;
                const active = isActive(item.to, pathname);
                return (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={item.to === '/'}
                    onClick={() => onOpenChange(false)}
                    aria-current={active ? 'page' : undefined}
                    className={cn(
                      'flex min-h-12 items-center gap-2.5 rounded-xl border p-3 text-sm font-medium transition-colors',
                      active
                        ? 'border-accent bg-accent-weak text-accent-ink'
                        : 'border-line bg-raised text-ink-2 hover:bg-sunken',
                    )}
                  >
                    <Icon className="size-[18px] shrink-0" aria-hidden="true" />
                    <span className="truncate">{item.label}</span>
                    {item.to === '/notifications' && unread > 0 && (
                      <span className="tnum ml-auto text-[11px] font-semibold text-danger">
                        {unread}
                      </span>
                    )}
                  </NavLink>
                );
              })}
            </div>
          </div>
        ))}
      </nav>
      <div
        className="mb-1 px-2 font-mono text-[10px] tracking-[0.16em] text-ink-3 uppercase"
        id="sheet-appearance"
      >
        Appearance
      </div>
      <div className="flex gap-2" role="group" aria-labelledby="sheet-appearance">
        {APPEARANCES.map((option) => (
          <button
            key={option}
            type="button"
            aria-pressed={preference.appearance === option}
            onClick={() => setAppearance(option)}
            className={cn(
              'min-h-11 flex-1 rounded-lg border py-2 text-[13px] font-medium transition-colors',
              preference.appearance === option
                ? 'border-accent bg-accent-weak text-accent-ink'
                : 'border-line text-ink-2 hover:bg-sunken',
            )}
          >
            {APPEARANCE_LABEL[option]}
          </button>
        ))}
      </div>
    </BottomSheet>
  );
}

/** The product disclaimer at the foot of every page. */
export function Disclaimer({ children }: { readonly children: ReactNode }) {
  return (
    <p className="mt-12 border-t border-line pt-5 text-[12px] leading-relaxed text-ink-3">
      {children}
    </p>
  );
}
