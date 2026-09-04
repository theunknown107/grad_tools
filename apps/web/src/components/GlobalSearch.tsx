/**
 * Global search — one modal, from anywhere.
 *
 * Authority: docs/05 §5.23 (M9.6B) · docs/27 §27.4
 * Reference: 21st.dev @efferd/search-modal — RECREATED. Accessible evidence was
 * the preview, the `CommandItem {id,title,description,category,icon}` shape and
 * the categorised-results model; the source was not retrievable.
 *
 * ---------------------------------------------------------------------------
 * A SEARCH, NOT A COMMAND PALETTE
 * ---------------------------------------------------------------------------
 *
 * The reference ships roughly forty commands across nine categories. That is a
 * command palette, and M9.6 §7 explicitly rules one out. The distinction is not
 * cosmetic: a palette is a second way to operate the whole product, so every
 * feature has to be added to it forever, and it competes with the navigation
 * instead of serving it.
 *
 * This searches DESTINATIONS and, when the API is reachable, QUESTIONS. It
 * performs no actions. Nothing here can delete, edit or sync anything, which is
 * also why it needs no confirmation states.
 *
 * ---------------------------------------------------------------------------
 * WHY QUESTION RESULTS ARE DEBOUNCED AND DESTINATIONS ARE NOT
 * ---------------------------------------------------------------------------
 *
 * Destinations are a fixed local list of eleven, so they filter on every
 * keystroke with no cost. Questions cross the network, so they wait 220ms after
 * typing stops. Mixing the two would make the whole list feel laggy for the
 * common case, which is someone typing "att" to reach Attendance.
 *
 * A stale response must never overwrite a fresh one, so each request carries a
 * sequence number and a late arrival is dropped.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon, type IconName } from './icons.js';
import { useDismissable, useFocusTrap } from '../hooks/useDismissable.js';
import styles from './GlobalSearch.module.css';

interface Destination {
  readonly to: string;
  readonly title: string;
  readonly description: string;
  readonly icon: IconName;
  readonly group: string;
  /** Extra words that should match but need not be shown. */
  readonly keywords?: string;
}

const DESTINATIONS: readonly Destination[] = [
  {
    to: '/',
    title: 'Dashboard',
    description: 'Your degree at a glance',
    icon: 'dashboard',
    group: 'Overview',
  },
  {
    to: '/announcements',
    title: 'Announcements',
    description: 'Verified notices',
    icon: 'announcements',
    group: 'Overview',
    keywords: 'news circular notice',
  },
  {
    to: '/notifications',
    title: 'Notifications',
    description: 'What GradTools has told you',
    icon: 'notifications',
    group: 'Overview',
    keywords: 'alerts inbox',
  },
  {
    to: '/semesters',
    title: 'My degree',
    description: 'Eight semesters, end to end',
    icon: 'degree',
    group: 'Academics',
    keywords: 'programme course plan',
  },
  {
    to: '/results',
    title: 'Results',
    description: 'Marks and outcomes by semester',
    icon: 'results',
    group: 'Academics',
    keywords: 'marks grades score',
  },
  {
    to: '/academics',
    title: 'SGPA & CGPA',
    description: 'Grade point calculations',
    icon: 'gpa',
    group: 'Academics',
    keywords: 'gpa average points',
  },
  {
    to: '/attendance',
    title: 'Attendance',
    description: 'Percentage and classes you can miss',
    icon: 'attendance',
    group: 'Academics',
    keywords: 'bunk present absent 85',
  },
  {
    to: '/timetable',
    title: 'Timetable',
    description: "Today's classes and the full week",
    icon: 'timetable',
    group: 'Academics',
    keywords: 'schedule classes lab',
  },
  {
    to: '/import',
    title: 'Add academic document',
    description: 'Result card, academic calendar or class timetable',
    icon: 'papers',
    group: 'Academics',
    keywords: 'import upload calendar timetable result document',
  },
  {
    to: '/profile',
    title: 'Profile',
    description: 'Branch, scheme and semester',
    icon: 'profile',
    group: 'Account',
  },
  {
    to: '/account',
    title: 'Account',
    description: 'Sign in, sync, export and deletion',
    icon: 'account',
    group: 'Account',
    keywords: 'settings privacy delete export',
  },
];

interface QuestionHit {
  readonly id: string;
  readonly subjectCode: string;
  readonly questionNumber: string;
  readonly text: string;
}

/** A flat row in the rendered list, so one index walks every group. */
type Row =
  | { readonly kind: 'destination'; readonly item: Destination }
  | { readonly kind: 'question'; readonly item: QuestionHit };

function matches(destination: Destination, query: string): boolean {
  const haystack =
    `${destination.title} ${destination.description} ${destination.keywords ?? ''}`.toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((term) => haystack.includes(term));
}

export function GlobalSearch({
  open,
  onClose,
}: {
  readonly open: boolean;
  readonly onClose: () => void;
}): ReactNode {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [questions, setQuestions] = useState<readonly QuestionHit[]>([]);
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const sequence = useRef(0);

  useDismissable({ open, onDismiss: onClose, surfaceRef: panelRef });
  useFocusTrap(open, panelRef);

  // A fresh modal every time: reopening onto the last query is disorienting.
  useEffect(() => {
    if (!open) return;
    setQuery('');
    setQuestions([]);
    setActive(0);
    inputRef.current?.focus();
  }, [open]);

  const trimmed = query.trim();

  const destinations = useMemo(
    () => (trimmed === '' ? DESTINATIONS : DESTINATIONS.filter((d) => matches(d, trimmed))),
    [trimmed],
  );

  useEffect(() => {
    // Two characters is the shortest query worth a round trip.
    if (!open || trimmed.length < 2) {
      setQuestions([]);
      return;
    }
    const ticket = (sequence.current += 1);
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const response = await fetch(
            `/api/v1/questions/search?q=${encodeURIComponent(trimmed)}&limit=5`,
          );
          if (!response.ok) return;
          const body: unknown = await response.json();
          // A response that arrived after a newer one must be discarded.
          if (ticket !== sequence.current) return;
          const items = (body as { items?: readonly QuestionHit[] }).items ?? [];
          setQuestions(items.slice(0, 5));
        } catch {
          // Search across the network is a bonus; local destinations still work.
          if (ticket === sequence.current) setQuestions([]);
        }
      })();
    }, 220);
    return () => clearTimeout(timer);
  }, [open, trimmed]);

  const rows = useMemo<readonly Row[]>(
    () => [
      ...destinations.map((item): Row => ({ kind: 'destination', item })),
      ...questions.map((item): Row => ({ kind: 'question', item })),
    ],
    [destinations, questions],
  );

  useEffect(() => setActive(0), [rows.length]);

  const go = useCallback(
    (row: Row) => {
      onClose();
      if (row.kind === 'destination') navigate(row.item.to);
      else navigate(`/papers?q=${encodeURIComponent(row.item.questionNumber)}`);
    },
    [navigate, onClose],
  );

  const onKeyDown = (event: React.KeyboardEvent): void => {
    if (rows.length === 0) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive((current) => (current + 1) % rows.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((current) => (current - 1 + rows.length) % rows.length);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const row = rows[active];
      if (row !== undefined) go(row);
    }
  };

  if (!open) return null;

  let index = -1;
  let lastGroup = '';

  return (
    <div className={`${styles.scrim ?? ''} glassOverlay`}>
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Search GradTools"
        className={`${styles.panel ?? ''} glassPanel`}
      >
        <div className={styles.inputRow}>
          <Icon name="search" size="medium" className={styles.inputIcon ?? ''} />
          <input
            ref={inputRef}
            type="search"
            className={styles.input}
            placeholder="Search pages and question papers…"
            value={query}
            role="combobox"
            aria-expanded="true"
            aria-controls="search-results"
            aria-autocomplete="list"
            aria-activedescendant={rows.length > 0 ? `search-row-${String(active)}` : undefined}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onKeyDown}
          />
          <kbd className={styles.kbd}>Esc</kbd>
        </div>

        <div className={styles.results} id="search-results" role="listbox" aria-label="Results">
          {rows.length === 0 ? (
            <p className={styles.none}>
              Nothing matches <strong>{trimmed}</strong>.
            </p>
          ) : null}

          {destinations.length > 0 ? <p className={styles.group}>Go to</p> : null}
          {destinations.map((item) => {
            index += 1;
            const rowIndex = index;
            return (
              <div
                key={item.to}
                id={`search-row-${String(rowIndex)}`}
                role="option"
                aria-selected={rowIndex === active}
                data-active={rowIndex === active}
                className={styles.row}
                onPointerEnter={() => setActive(rowIndex)}
                onPointerDown={(event) => {
                  event.preventDefault();
                  go({ kind: 'destination', item });
                }}
              >
                <span className={styles.rowIcon}>
                  <Icon name={item.icon} size="nav" />
                </span>
                <span className={styles.rowText}>
                  <span className={styles.rowTitle}>{item.title}</span>
                  <span className={styles.rowHint}>{item.description}</span>
                </span>
                <span className={styles.rowGroup}>{item.group}</span>
              </div>
            );
          })}

          {questions.length > 0 ? <p className={styles.group}>Questions</p> : null}
          {questions.map((item) => {
            index += 1;
            const rowIndex = index;
            lastGroup = item.subjectCode;
            return (
              <div
                key={item.id}
                id={`search-row-${String(rowIndex)}`}
                role="option"
                aria-selected={rowIndex === active}
                data-active={rowIndex === active}
                className={styles.row}
                onPointerEnter={() => setActive(rowIndex)}
                onPointerDown={(event) => {
                  event.preventDefault();
                  go({ kind: 'question', item });
                }}
              >
                <span className={styles.rowIcon}>
                  <Icon name="papers" size="nav" />
                </span>
                <span className={styles.rowText}>
                  {/* Plain text, never dangerouslySetInnerHTML: this string is
                      OCR output from an uploaded document (docs/13 T-22). */}
                  <span className={styles.rowTitle}>{item.text}</span>
                  <span className={styles.rowHint}>
                    {lastGroup} · Q{item.questionNumber}
                  </span>
                </span>
              </div>
            );
          })}
        </div>

        <div className={styles.foot}>
          <span>
            <kbd className={styles.kbd}>↑</kbd>
            <kbd className={styles.kbd}>↓</kbd> to move
          </span>
          <span>
            <kbd className={styles.kbd}>↵</kbd> to open
          </span>
        </div>
      </div>
    </div>
  );
}

/** Opens the modal on Cmd/Ctrl-K, and on `/` outside a text field. */
export function useSearchHotkey(onOpen: () => void): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const target = event.target;
      const typing =
        target instanceof HTMLElement &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        onOpen();
      } else if (event.key === '/' && !typing) {
        // `/` is the fast path, but only when it is not being typed into a
        // field — otherwise nobody could type a date.
        event.preventDefault();
        onOpen();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onOpen]);
}
