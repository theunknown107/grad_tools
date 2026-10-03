/**
 * Global search — the design's command menu (⌘K / Ctrl+K, or "/").
 *
 * cmdk supplies filtering and the listbox semantics; Radix Dialog supplies the
 * focus trap and Escape. Every row goes somewhere real: a route from the one
 * navigation list, an action, a preference, a semester the student has
 * results for, or a course code recorded in their own results.
 */

import * as DialogPrimitive from '@radix-ui/react-dialog';
import { Command } from 'cmdk';
import {
  BookOpen,
  Calculator,
  CalendarDays,
  ChevronRight,
  CornerDownLeft,
  FilePlus2,
  Monitor,
  Moon,
  Palette,
  Search,
  Settings2,
  Sun,
  type LucideIcon,
} from 'lucide-react';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useNavigate } from 'react-router-dom';
import { useResults } from '../../hooks/useCollection.js';
import { useSubjectIndex } from '../../hooks/useSubjectIndex.js';
import { useTheme } from '../../hooks/useTheme.js';
import { cn } from '../../lib/cn.js';
import { DESTINATIONS } from '../layout/nav.js';
import { overlayClass } from '../ui/dialog.js';
import { toast } from '../ui/feedback.js';
import { Kbd } from '../ui/kbd.js';
import { useReturnFocus } from '../ui/return-focus.js';

interface Entry {
  readonly id: string;
  readonly label: string;
  readonly hint?: string | undefined;
  readonly keywords?: string | undefined;
  readonly icon: LucideIcon;
  readonly group: string;
  readonly run: () => void;
}

/* ------------------------------------------------------------ open state */

const CommandContext = createContext<() => void>(() => undefined);

export function useOpenCommand(): () => void {
  return useContext(CommandContext);
}

export function CommandMenuProvider({ children }: { readonly children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const openMenu = useCallback(() => setOpen(true), []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const target = event.target;
      const typing =
        target instanceof HTMLElement &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable);
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setOpen((value) => !value);
      } else if (event.key === '/' && !typing && !event.metaKey && !event.ctrlKey) {
        event.preventDefault();
        setOpen(true);
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <CommandContext.Provider value={openMenu}>
      {children}
      <CommandMenu open={open} onOpenChange={setOpen} />
    </CommandContext.Provider>
  );
}

export const MODIFIER_KEY =
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl';

/* ------------------------------------------------------------------ menu */

function CommandMenu({
  open,
  onOpenChange,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}) {
  const navigate = useNavigate();
  const { resolved, setAppearance } = useTheme();
  const { index: subjects } = useSubjectIndex();
  const { items: results } = useResults();
  const [query, setQuery] = useState('');
  const returnFocus = useReturnFocus();

  useEffect(() => {
    if (!open) setQuery('');
  }, [open]);

  const entries = useMemo<readonly Entry[]>(() => {
    const go = (to: string) => () => {
      onOpenChange(false);
      navigate(to);
    };
    const pages: Entry[] = DESTINATIONS.map((destination) => ({
      id: `page:${destination.to}`,
      label: destination.label,
      hint: destination.description,
      keywords: destination.keywords,
      icon: destination.icon,
      group: 'Navigate',
      run: go(destination.to),
    }));
    const actions: Entry[] = [
      {
        id: 'act:result',
        label: 'Add result',
        hint: 'Import a document',
        keywords: 'upload marks card pdf',
        icon: FilePlus2,
        group: 'Actions',
        run: go('/import'),
      },
      {
        id: 'act:calc',
        label: 'Open SGPA calculator',
        keywords: 'cgpa required marks',
        icon: Calculator,
        group: 'Actions',
        run: go('/academics?tab=calculator'),
      },
      {
        id: 'act:tt',
        label: 'Import timetable',
        keywords: 'schedule classes',
        icon: CalendarDays,
        group: 'Actions',
        run: go('/import'),
      },
      {
        id: 'act:settings',
        label: 'Open settings',
        keywords: 'account sync export privacy',
        icon: Settings2,
        group: 'Actions',
        run: go('/account'),
      },
    ];
    const next = resolved === 'dark' ? 'light' : 'dark';
    const preferences: Entry[] = [
      {
        id: 'pref:toggle',
        label: next === 'light' ? 'Switch to light theme' : 'Switch to dark theme',
        hint: 'Toggle appearance',
        keywords: 'theme dark light mode',
        icon: next === 'light' ? Sun : Moon,
        group: 'Preferences',
        run: () => {
          setAppearance(next);
          toast(`Switched to ${next} theme`, { tone: 'accent' });
          onOpenChange(false);
        },
      },
      {
        id: 'pref:system',
        label: 'Follow system theme',
        keywords: 'theme auto device',
        icon: Monitor,
        group: 'Preferences',
        run: () => {
          setAppearance('system');
          toast('Following system theme', { tone: 'accent' });
          onOpenChange(false);
        },
      },
      {
        id: 'pref:appearance',
        label: 'Customise theme & accent',
        hint: 'Appearance',
        keywords: 'colour color accent density motion',
        icon: Palette,
        group: 'Preferences',
        run: go('/account?section=appearance'),
      },
    ];
    const records: Entry[] = [...new Set(results.map((result) => result.semester))]
      .sort((a, b) => a - b)
      .map((semester) => ({
        id: `sem:${String(semester)}`,
        label: `Semester ${String(semester)} — results`,
        keywords: `sem ${String(semester)} result marks`,
        icon: ChevronRight,
        group: 'Records',
        run: go(`/results/${String(semester)}`),
      }));
    const courses: Entry[] = [...subjects.values()]
      .map((identity) => {
        const title = identity.canonicalTitle ?? identity.titles[0]?.title ?? undefined;
        return {
          id: `course:${identity.code}`,
          label: title === undefined ? identity.code : `${identity.code} — ${title}`,
          hint: title === undefined ? 'Recorded in your own results' : undefined,
          keywords: title,
          icon: BookOpen,
          group: 'Courses',
          run: go('/results'),
        };
      })
      .sort((a, b) => a.label.localeCompare(b.label));
    return [...pages, ...actions, ...preferences, ...records, ...courses];
  }, [navigate, onOpenChange, resolved, setAppearance, results, subjects]);

  const groups = [...new Set(entries.map((entry) => entry.group))];

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay data-slot="overlay" className={cn(overlayClass, 'z-[80]')} />
        <DialogPrimitive.Content
          data-slot="popup"
          {...returnFocus}
          aria-describedby={undefined}
          className="fixed top-[12vh] left-1/2 z-[81] w-[calc(100%-2rem)] max-w-xl -translate-x-1/2 overflow-hidden rounded-2xl border border-line bg-panel shadow-e3 outline-none data-[state=open]:animate-pop"
        >
          <DialogPrimitive.Title className="sr-only">Search GradTools</DialogPrimitive.Title>
          <Command label="Search GradTools" loop className="flex flex-col">
            <div className="flex items-center gap-3 border-b border-line px-4">
              <Search className="size-4.5 shrink-0 text-ink-3" aria-hidden="true" />
              <Command.Input
                value={query}
                onValueChange={setQuery}
                placeholder="Search or jump to…"
                className="h-13 flex-1 bg-transparent py-4 text-[15px] text-ink placeholder:text-ink-3 focus:outline-none"
              />
              <Kbd>Esc</Kbd>
            </div>
            <Command.List className="max-h-[52vh] overflow-y-auto p-2 scroll-quiet">
              <Command.Empty className="px-3 py-10 text-center text-sm text-ink-3">
                No matches for “{query}”. Try a course code or an action.
              </Command.Empty>
              {groups.map((group) => (
                <Command.Group
                  key={group}
                  heading={group}
                  className="mb-1 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:font-mono [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:tracking-[0.16em] [&_[cmdk-group-heading]]:text-ink-3 [&_[cmdk-group-heading]]:uppercase"
                >
                  {entries
                    .filter((entry) => entry.group === group)
                    .map((entry) => {
                      const Icon = entry.icon;
                      return (
                        <Command.Item
                          key={entry.id}
                          value={entry.id}
                          keywords={[entry.label, entry.hint ?? '', entry.keywords ?? '']}
                          onSelect={entry.run}
                          className="group flex cursor-pointer items-center gap-3 rounded-lg px-2.5 py-2.5 text-left text-sm text-ink-2 data-[selected=true]:bg-accent-weak data-[selected=true]:text-accent-ink"
                        >
                          <Icon className="size-4 shrink-0" aria-hidden="true" />
                          <span className="truncate font-medium text-ink">{entry.label}</span>
                          {entry.hint !== undefined && (
                            <span className="hidden truncate text-[12px] text-ink-2 sm:inline">
                              {entry.hint}
                            </span>
                          )}
                          <CornerDownLeft
                            aria-hidden="true"
                            className="ml-auto size-3.5 shrink-0 opacity-0 group-data-[selected=true]:opacity-60"
                          />
                        </Command.Item>
                      );
                    })}
                </Command.Group>
              ))}
            </Command.List>
            <div className="flex items-center gap-4 border-t border-line px-4 py-2 text-[11px] text-ink-3">
              <span className="inline-flex items-center gap-1">
                <Kbd>↑</Kbd>
                <Kbd>↓</Kbd> to move
              </span>
              <span className="inline-flex items-center gap-1">
                <Kbd>↵</Kbd> to open
              </span>
            </div>
          </Command>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
