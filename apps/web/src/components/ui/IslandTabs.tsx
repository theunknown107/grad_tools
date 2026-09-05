/**
 * Island tabs — a segmented control with a sliding indicator.
 *
 * Authority: docs/05 §5.22 (M9.6B) · docs/27 §27.3
 * Reference: 21st.dev @muhammad-binsalman/yield-card — RECREATED, and the
 * reference does not contain this pattern.
 *
 * ---------------------------------------------------------------------------
 * A CORRECTION WORTH RECORDING
 * ---------------------------------------------------------------------------
 *
 * Reference 18 was supplied as the "island tabs" reference. It is not one. The
 * published component is a financial *yield card* — a gradient border, an
 * analytics glyph, gold accents on dark. There are no tabs in it, no pill
 * container and no indicator. Building "island tabs" from it would have meant
 * inventing the component and attributing it to a source that does not contain
 * it.
 *
 * So what is taken from Reference 18 is the thing it genuinely has: the
 * *island* material — a self-contained rounded object with a lit edge, sitting
 * clearly above its background. That material is applied to a segmented tab
 * control, which is the interaction the product actually needed.
 *
 * ---------------------------------------------------------------------------
 * THE INDICATOR MOVES; THE LABELS DO NOT
 * ---------------------------------------------------------------------------
 *
 * One absolutely-positioned pill translates between tab positions, measured
 * from the DOM rather than computed from `100 / count` — the tabs are sized by
 * their text, so equal division would drift on every label that is not the same
 * length as its neighbours.
 *
 * Measured on layout AND on resize, because a tab row that reflows at a
 * breakpoint would otherwise leave the pill behind the wrong label until the
 * next click.
 *
 * Follows the WAI-ARIA tabs pattern: arrows move between tabs, and only the
 * selected tab is in the tab order.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import styles from './IslandTabs.module.css';

export interface IslandTab {
  readonly id: string;
  readonly label: string;
  /** Shown as a small count beside the label — papers, subjects, unread. */
  readonly count?: number;
}

export interface IslandTabsProps {
  readonly label: string;
  readonly tabs: readonly IslandTab[];
  readonly value: string;
  readonly onChange: (id: string) => void;
  /**
   * False when the tabs FILTER content in place rather than switching between
   * separate panels — Announcements and Notifications both re-filter one list.
   *
   * This is not cosmetic. `aria-controls` must reference an element that
   * exists; pointing it at a panel that was never rendered is an invalid ARIA
   * reference, and axe reports it as one. Caught by the M9.6F sweep.
   */
  readonly controlsPanel?: boolean;
}

export function IslandTabs({
  label,
  tabs,
  value,
  onChange,
  controlsPanel = true,
}: IslandTabsProps): ReactNode {
  const listRef = useRef<HTMLDivElement>(null);
  const [pill, setPill] = useState<{ left: number; width: number } | null>(null);

  const measure = useCallback(() => {
    const list = listRef.current;
    if (list === null) return;
    const active = list.querySelector<HTMLElement>('[aria-selected="true"]');
    if (active === null) return;
    setPill({ left: active.offsetLeft, width: active.offsetWidth });
  }, []);

  // Layout effect, not effect: measuring after paint shows the pill jumping
  // from 0 to its position on first render.
  useLayoutEffect(measure, [measure, value, tabs]);

  useEffect(() => {
    if (typeof ResizeObserver === 'undefined') return;
    const list = listRef.current;
    if (list === null) return;
    const observer = new ResizeObserver(measure);
    observer.observe(list);
    return () => observer.disconnect();
  }, [measure]);

  const index = tabs.findIndex((tab) => tab.id === value);

  const onKeyDown = (event: React.KeyboardEvent): void => {
    const count = tabs.length;
    let next = -1;
    if (event.key === 'ArrowRight') next = (index + 1) % count;
    else if (event.key === 'ArrowLeft') next = (index - 1 + count) % count;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = count - 1;
    if (next === -1) return;

    event.preventDefault();
    const tab = tabs[next];
    if (tab === undefined) return;
    onChange(tab.id);
    // Selection follows focus for tabs, so focus has to move with it.
    listRef.current?.querySelectorAll<HTMLElement>('[role="tab"]')[next]?.focus();
  };

  return (
    <div
      ref={listRef}
      role="tablist"
      aria-label={label}
      className={`${styles.island ?? ''} surfaceCard`}
      onKeyDown={onKeyDown}
    >
      {pill !== null ? (
        <span
          className={styles.pill}
          aria-hidden="true"
          style={{
            transform: `translateX(${String(pill.left)}px)`,
            width: `${String(pill.width)}px`,
          }}
        />
      ) : null}

      {tabs.map((tab) => {
        const selected = tab.id === value;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            id={`tab-${tab.id}`}
            aria-selected={selected}
            {...(controlsPanel ? { 'aria-controls': `panel-${tab.id}` } : {})}
            // Only the selected tab is tabbable; arrows move within the set.
            tabIndex={selected ? 0 : -1}
            className={styles.tab}
            onClick={() => onChange(tab.id)}
          >
            <span>{tab.label}</span>
            {tab.count !== undefined ? <span className={styles.count}>{tab.count}</span> : null}
          </button>
        );
      })}
    </div>
  );
}

/** The panel a tab controls. Rendered only when its tab is selected. */
export function IslandTabPanel({
  id,
  children,
}: {
  readonly id: string;
  readonly children: ReactNode;
}): ReactNode {
  return (
    <div
      role="tabpanel"
      id={`panel-${id}`}
      aria-labelledby={`tab-${id}`}
      tabIndex={0}
      className={styles.panel}
    >
      {children}
    </div>
  );
}
