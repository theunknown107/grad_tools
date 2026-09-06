/**
 * Island tabs — a segmented control with a sliding indicator.
 *
 * Authority: docs/05 §5.22 (M9.6B) · docs/27 §27.3 · Phase 7B §2, §12
 * Reference: 21st.dev @muhammad-binsalman/yield-card — the *island material*
 * only; see the correction below.
 * Provenance: behaviourally faithful shadcn/Radix implementation adapted to the
 * GradTools styling architecture. The behaviour is `@radix-ui/react-tabs`; the
 * island, the pill and the travelling animation are the frozen GradTools
 * design, in CSS Modules, and shadcn's Tailwind classes are not reproduced.
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
 * clearly above its background. That material is applied to a segmented
 * control, which is the interaction the product actually needed.
 *
 * ---------------------------------------------------------------------------
 * WHAT THE PORT FIXED: TABS THAT CONTROLLED NOTHING
 * ---------------------------------------------------------------------------
 *
 * `controlsPanel` used to exist as an escape hatch. Announcements,
 * Notifications and Timetable rendered `role="tab"` for controls with no
 * tabpanel anywhere on the page, so `aria-controls` pointed at an element that
 * had never been rendered — an invalid ARIA reference that axe reported. The
 * fix at the time was to drop the attribute, which silenced the report and left
 * the tabs still controlling nothing.
 *
 * Radix generates the `aria-controls` / `aria-labelledby` pair itself, from one
 * root spanning the list and its panels, and it will not let them disagree. So
 * the prop is gone and all five call sites now declare real panels — including
 * the two that filter one list, where both panels hold the same (already
 * filtered) node and Radix mounts whichever is selected.
 *
 * ---------------------------------------------------------------------------
 * THE INDICATOR MOVES; THE LABELS DO NOT
 * ---------------------------------------------------------------------------
 *
 * One absolutely-positioned pill translates between positions, measured from
 * the DOM rather than computed from `100 / count` — the items are sized by
 * their text, so equal division would drift on every label that is not the same
 * length as its neighbours.
 *
 * Measured on layout AND on resize, because a row that reflows at a breakpoint
 * would otherwise leave the pill behind the wrong label until the next click.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';
import * as TabsPrimitive from '@radix-ui/react-tabs';
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
}

/** Whether an `IslandTabGroup` is already above us. See `IslandTabs`. */
const InGroup = createContext(false);

/**
 * Wraps a tab list and its panels.
 *
 * Radix needs ONE root over both so a trigger and its panel can find each other
 * and generate matching ids. The previous implementation derived those ids from
 * the tab id by hand, which worked until two tab sets on one page used the same
 * id — `overview` appears on two pages already.
 */
export function IslandTabGroup({
  value,
  onChange,
  children,
}: {
  readonly value: string;
  readonly onChange: (id: string) => void;
  readonly children: ReactNode;
}): ReactNode {
  return (
    <TabsPrimitive.Root value={value} onValueChange={onChange} activationMode="automatic">
      <InGroup.Provider value={true}>{children}</InGroup.Provider>
    </TabsPrimitive.Root>
  );
}

/**
 * Measures the selected trigger and returns the pill's position.
 *
 * Split out because it is the one piece of this component that is genuinely
 * ours rather than the primitive's, and it has to survive both a value change
 * and a reflow.
 */
function useTravellingPill(
  listRef: RefObject<HTMLDivElement | null>,
  value: string,
  count: number,
): { left: number; width: number } | null {
  const [pill, setPill] = useState<{ left: number; width: number } | null>(null);

  const measure = useCallback(() => {
    const list = listRef.current;
    if (list === null) return;
    const active = list.querySelector<HTMLElement>('[data-state="active"]');
    if (active === null) return;
    setPill({ left: active.offsetLeft, width: active.offsetWidth });
  }, [listRef]);

  // Layout effect, not effect: measuring after paint shows the pill jumping
  // from 0 to its position on first render.
  useLayoutEffect(measure, [measure, value, count]);

  useEffect(() => {
    if (typeof ResizeObserver === 'undefined') return;
    const list = listRef.current;
    if (list === null) return;
    const observer = new ResizeObserver(measure);
    observer.observe(list);
    return () => observer.disconnect();
  }, [measure, listRef]);

  return pill;
}

export function IslandTabs({ label, tabs, value, onChange }: IslandTabsProps): ReactNode {
  const listRef = useRef<HTMLDivElement>(null);
  const pill = useTravellingPill(listRef, value, tabs.length);
  const grouped = useContext(InGroup);

  const list = (
    <TabsPrimitive.List
      ref={listRef}
      aria-label={label}
      className={`${styles.island ?? ''} surfaceCard`}
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

      {tabs.map((tab) => (
        <TabsPrimitive.Trigger key={tab.id} value={tab.id} className={styles.tab}>
          <span className={styles.tabInner}>
            <span>{tab.label}</span>
            {tab.count !== undefined ? <span className={styles.count}>{tab.count}</span> : null}
          </span>
        </TabsPrimitive.Trigger>
      ))}
    </TabsPrimitive.List>
  );

  if (grouped) return list;

  /*
   * A ROOT ONLY IF THERE ISN'T ONE.
   *
   * `Tabs.List` throws outside a `Tabs.Root`, which makes a bare `<IslandTabs>`
   * — in a component test, or a page that genuinely has no panels — a crash
   * rather than a contract. Standing one up here keeps the keyboard model and
   * simply has no panels to point at.
   */
  return (
    <TabsPrimitive.Root value={value} onValueChange={onChange} activationMode="automatic">
      {list}
    </TabsPrimitive.Root>
  );
}

/** The panel a tab controls. Radix mounts it only while its tab is selected. */
export function IslandTabPanel({
  id,
  children,
}: {
  readonly id: string;
  readonly children: ReactNode;
}): ReactNode {
  return (
    <TabsPrimitive.Content value={id} className={styles.panel}>
      {children}
    </TabsPrimitive.Content>
  );
}
