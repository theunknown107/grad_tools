/**
 * Grouped navigation, in a panel that resizes to its content.
 *
 * Authority: docs/05 §5.28 (M9.6F) · docs/27 §27.4
 * Reference: 21st.dev @ln-dev7/dorpdown-navigation — RECREATED. Source was not
 * retrievable; the accessible evidence was the preview, the `navItems` shape
 * (`{id, label, link?, subMenus: [{title, items: [{label, description, icon}]}]}`),
 * the hover activation, and the dependency list (framer-motion + lucide-react).
 *
 * ---------------------------------------------------------------------------
 * WHAT WAS TAKEN, AND THE ONE THING THAT WAS NOT
 * ---------------------------------------------------------------------------
 *
 * Taken: the grouped panel — sections with titles, items carrying a label AND a
 * one-line description — and the panel that MEASURES its content and animates
 * its own size between menus, which is the reference's signature move. A panel
 * that snaps between two heights reads as two panels; one that grows reads as
 * one surface showing different things.
 *
 * NOT taken: hover as the activator. The reference opens on hover, which on a
 * touchscreen means the first tap opens and the second navigates — and on a
 * desktop means the menu opens when the pointer merely crosses it on the way
 * somewhere else. This opens on CLICK and on Enter/Space, which behaves
 * identically on both, and closes on Escape, outside click and blur.
 *
 * Used only on the public site (M9.6F §21). The application's own navigation is
 * the two-tier bar and the limelight; adding a third system inside the app is
 * exactly the "competing navigation systems" the milestone warns against.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Icon, type IconName } from '../icons.js';
import { useDismissable } from '../../hooks/useDismissable.js';
import styles from './DropdownNavigation.module.css';

export interface NavGroupItem {
  readonly label: string;
  readonly description: string;
  readonly to: string;
  readonly icon: IconName;
}

export interface NavGroup {
  readonly title: string;
  readonly items: readonly NavGroupItem[];
}

export interface NavEntry {
  readonly id: string;
  readonly label: string;
  /** A plain link. Mutually exclusive with `groups`. */
  readonly to?: string;
  readonly groups?: readonly NavGroup[];
}

export function DropdownNavigation({
  label,
  entries,
}: {
  readonly label: string;
  readonly entries: readonly NavEntry[];
}): ReactNode {
  const [open, setOpen] = useState<string | null>(null);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);

  const close = useCallback(() => setOpen(null), []);
  useDismissable({ open: open !== null, onDismiss: close, surfaceRef: wrapRef });

  /*
   * The resize. Measured from the rendered content each time the open menu
   * changes, so the panel animates from its previous size to the next one
   * rather than snapping. Layout effect, because measuring after paint would
   * show one frame at the wrong size.
   */
  useLayoutEffect(() => {
    if (open === null) {
      setSize(null);
      return;
    }
    const inner = innerRef.current;
    if (inner === null) return;
    setSize({ width: inner.scrollWidth, height: inner.scrollHeight });
  }, [open]);

  useEffect(() => {
    if (open === null) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') close();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, close]);

  const active = entries.find((entry) => entry.id === open);

  return (
    <div className={styles.wrap} ref={wrapRef}>
      <nav aria-label={label}>
        <ul className={styles.bar}>
          {entries.map((entry) => (
            <li key={entry.id}>
              {entry.groups === undefined ? (
                <a href={entry.to ?? '#'} className={styles.item}>
                  {entry.label}
                </a>
              ) : (
                <button
                  type="button"
                  className={styles.item}
                  aria-expanded={open === entry.id}
                  aria-haspopup="true"
                  data-open={open === entry.id}
                  onClick={() => setOpen((current) => (current === entry.id ? null : entry.id))}
                >
                  {entry.label}
                  <Icon name="chevronRight" size="micro" className={styles.chevron ?? ''} />
                </button>
              )}
            </li>
          ))}
        </ul>
      </nav>

      {active?.groups !== undefined ? (
        <div
          ref={panelRef}
          className={`${styles.panel ?? ''} glassPanel`}
          style={
            size === null
              ? undefined
              : { width: `${String(size.width)}px`, height: `${String(size.height)}px` }
          }
        >
          <div className={styles.panelInner} ref={innerRef}>
            {active.groups.map((group) => (
              <section className={styles.group} key={group.title}>
                <h3 className={styles.groupTitle}>{group.title}</h3>
                <ul>
                  {group.items.map((item) => (
                    <li key={item.to}>
                      <a href={item.to} className={styles.link} onClick={close}>
                        <span className={styles.linkIcon}>
                          <Icon name={item.icon} size="nav" />
                        </span>
                        <span className={styles.linkText}>
                          <span className={styles.linkLabel}>{item.label}</span>
                          {/* The description is the reference's real contribution:
                              a nav label alone says where, not what. */}
                          <span className={styles.linkDescription}>{item.description}</span>
                        </span>
                      </a>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
