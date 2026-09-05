/**
 * The reference's pastel card, and the pieces that go on it.
 *
 * Authority: UI reference rebuild — Phase 4
 *
 * ---------------------------------------------------------------------------
 * ONE CARD, FOUR HUES, NO PAGE-LEVEL COLOUR
 * ---------------------------------------------------------------------------
 *
 * The reference's signature object is a soft filled block: a white status pill
 * at the top, a title, a line of description, and a progress bar along the
 * foot. A row of them cycles through four pastels so the row reads as a set
 * rather than as four copies of one card.
 *
 * The hue is a TONE, chosen from a fixed four, and the tone carries its own
 * ink. That is what stops this becoming the thing the brief forbids — a page
 * inventing its own colours — because no caller ever names a colour, only a
 * meaning, and the meanings are fixed:
 *
 *   sky    schedule and dates
 *   lilac  performance and analysis
 *   lime   progress and healthy status
 *   peach  attention, deadlines, anything pending
 *
 * `toneFor` exists so a list of things with no meaning of their own — eight
 * semesters, six subjects — still cycles rather than picking one hue and
 * repeating it.
 */

import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Icon } from '../icons.js';
import styles from './ui.module.css';

export const TONES = ['sky', 'lime', 'lilac', 'peach'] as const;
export type Tone = (typeof TONES)[number];

/** The hue for position `index` in a list that carries no meaning of its own. */
export function toneFor(index: number): Tone {
  return TONES[index % TONES.length] as Tone;
}

/**
 * A metadata pill: outlined, white, icon optional.
 *
 * The reference puts these beside a detail title — "10 lessons", "4,5 hours",
 * "Due Jul 15". Compact, and never more than a few.
 */
export function MetaPill({ children }: { readonly children: ReactNode }) {
  return <span className={styles.metaPill}>{children}</span>;
}

/**
 * A horizontal rail of cards.
 *
 * The reference lets the last card run off the edge rather than wrapping or
 * paginating, which is how it says "there are more of these" without spending
 * a control on saying it.
 */
export function Rail({ children, label }: { readonly children: ReactNode; readonly label: string }) {
  return (
    /*
     * FOCUSABLE, because it scrolls. A horizontally scrolling container that
     * cannot be reached by keyboard hides everything past its right edge from
     * anyone not using a mouse — which is exactly the card the reference lets
     * run off the edge. axe caught it at 320px.
     */
    <div className={styles.rail} role="group" aria-label={label} tabIndex={0}>
      {children}
    </div>
  );
}

export function PastelCard({
  tone,
  pill,
  title,
  body,
  progress,
  to,
}: {
  readonly tone: Tone;
  /** The white status pill: a due date, a status, a count. */
  readonly pill?: ReactNode;
  readonly title: string;
  readonly body?: string | undefined;
  /** 0-100. Omitted where the thing has no progress to show. */
  readonly progress?: number | undefined;
  /** Where it goes. A card with nowhere to go renders as a plain block. */
  readonly to?: string | undefined;
}) {
  const inner = (
    <>
      {pill !== undefined && <span className={styles.tonePill}>{pill}</span>}
      {/*
        A SPAN, not a heading. Eight of these in a rail would put eight h3s
        into the page outline competing with the page's own h1 — and where the
        card is a link, the link's accessible name already carries the title.
      */}
      <span className={styles.pastelTitle}>{title}</span>
      {body !== undefined && body !== '' && <p className={styles.pastelBody}>{body}</p>}
      {progress !== undefined && (
        <div className={styles.pastelFoot}>
          <span className={styles.toneTrack}>
            <span
              className={styles.toneFill}
              style={{ inlineSize: `${String(Math.max(0, Math.min(100, progress)))}%` }}
            />
          </span>
          <span className={styles.toneValue}>{Math.round(progress)}%</span>
        </div>
      )}
    </>
  );

  if (to !== undefined) {
    return (
      <Link className={styles.pastelCard} data-tone={tone} to={to}>
        {inner}
      </Link>
    );
  }
  return (
    <div className={styles.pastelCard} data-tone={tone}>
      {inner}
    </div>
  );
}

/**
 * A pastel accordion, cycling the same four tones.
 *
 * The reference's lesson list: a numbered title, a duration on the right, a
 * chevron, and sub-items revealed on the same fill so the group stays one
 * object. GradTools uses it for anything genuinely hierarchical — a semester
 * and its subjects, a day and its classes.
 *
 * Uncontrolled on purpose: which section is open is view state and belongs to
 * the component, not to a page that has real work to do.
 */
export function ToneAccordion({
  items,
  label,
  expanded = false,
}: {
  readonly label: string;
  readonly items: readonly {
    readonly id: string;
    readonly title: string;
    /** The right-hand fact: a count, a duration, an SGPA. */
    readonly meta?: string | undefined;
    readonly body: ReactNode;
  }[];
  /**
   * Start with every section open, and let them toggle independently.
   *
   * The reference collapses a LONG list, where hiding is the service. A week
   * is six short groups and the question is "what is my week" — collapsing
   * five-sixths of the answer is the opposite of helpful. Same pastel
   * sections, different default.
   */
  readonly expanded?: boolean;
}) {
  /*
   * DERIVED UNTIL TOUCHED.
   *
   * A useState initializer runs once, on the first render — which for a page
   * that loads its data afterwards is the render where `items` is still empty.
   * The week opened nothing at all, because "all of them" was computed from a
   * list that did not exist yet. So the default is derived from the CURRENT
   * items, and only becomes state once somebody actually clicks something.
   */
  const [chosen, setChosen] = useState<readonly string[] | null>(null);
  const open =
    chosen ?? (expanded ? items.map((item) => item.id) : items[0] === undefined ? [] : [items[0].id]);
  const setOpen = (next: (current: readonly string[]) => readonly string[]) => {
    setChosen(next(open));
  };

  return (
    <div className={styles.toneAccordion} role="group" aria-label={label}>
      {items.map((item, index) => {
        const isOpen = open.includes(item.id);
        return (
          <div
            key={item.id}
            className={styles.toneItem}
            data-tone={toneFor(index)}
            data-open={isOpen}
          >
            <button
              type="button"
              className={styles.toneSummary ?? ''}
              aria-expanded={isOpen}
              onClick={() =>
                setOpen((current) =>
                  current.includes(item.id)
                    ? current.filter((id) => id !== item.id)
                    : [...current, item.id],
                )
              }
            >
              <span className={styles.toneSummaryText}>{item.title}</span>
              {item.meta !== undefined && <span className={styles.toneMeta}>{item.meta}</span>}
              <Icon name="chevronRight" size="nav" className={styles.toneChevron} />
            </button>
            {isOpen && <div className={styles.toneBody}>{item.body}</div>}
          </div>
        );
      })}
    </div>
  );
}
