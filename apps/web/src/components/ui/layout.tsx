/**
 * Layout primitives.
 *
 * Authority: docs/05 §5.12 · M9.3 §7, §8, §31
 *
 * ---------------------------------------------------------------------------
 * WHY THESE EXIST
 * ---------------------------------------------------------------------------
 *
 * Before M9.3 the app had one container — `Panel` — and used it 46 times, 17 of
 * them on the dashboard alone. Every section therefore carried the same border,
 * the same background and the same visual weight, so nothing could be more
 * important than anything else. A screen made entirely of equal boxes has no
 * hierarchy at all; it just has boxes.
 *
 * M9.5.1 revised that. The correction had kept going: with no container drawn
 * anywhere, a page became one column of hairlines on the page ground, and both
 * references put their content ON something. `Panel` (ui/index.tsx) is the
 * surface again, and these primitives are what goes INSIDE one — a strip of
 * figures, a list of rows, a bar, a quiet empty state.
 *
 * THE RULE THEY ENCODE: hierarchy comes from size, position and type, not from
 * which regions are allowed a border. Every panel may have one; not every panel
 * may be the largest thing on the screen.
 */

import type { ReactNode } from 'react';
import { Icon } from '../icons.js';
import styles from './layout.module.css';

/* -------------------------------------------------------------------------- */
/* Metrics                                                                    */
/* -------------------------------------------------------------------------- */

export interface Metric {
  readonly label: string;
  /**
   * Already formatted.
   *
   * A value carrying NO DIGIT — "Unavailable", "Not recorded", "Not set" — is
   * an answer rather than a figure, and is set smaller and muted instead of
   * rendered at 30px where a number belongs. The shape of the value decides
   * that, so no call site has to remember to say so.
   */
  readonly value: string;
  /** Small qualifier under the value: "of 8", "sem 4", "22OB". */
  readonly note?: string | undefined;
  readonly tone?: 'default' | 'warning' | 'danger' | undefined;
}

/**
 * A grid of instruments.
 *
 * This was one bordered module with the figures set inside it, on the argument
 * that giving each a card makes four announcements out of one summary. The
 * approved design answers that differently and better: the tiles share ONE
 * material and one grid, so they still read as a set, and each figure gets the
 * room to be legible at six across on a wide screen.
 *
 * What the old rule was really protecting against is still enforced — the
 * tiles are monochrome, they carry no coloured stripe, and the value is 30px
 * rather than the 40px that makes a dashboard shout. A larger number does not
 * become more true.
 */
export function MetricStrip({ metrics }: { readonly metrics: readonly Metric[] }) {
  return (
    <dl className={styles.metrics}>
      {metrics.map((metric) => (
        /*
         * `gt-metric` is a GLOBAL material, not a module class, because the
         * same surface is used by tiles this component does not own. It is
         * monochrome in every accent theme by design.
         */
        <div key={metric.label} className={`gt-metric ${styles.metric ?? ''}`}>
          <dt className={styles.metricLabel}>{metric.label}</dt>
          <dd
            className={styles.metricValue}
            data-tone={metric.tone ?? 'default'}
            data-absent={/\d/.test(metric.value) ? undefined : 'true'}
          >
            {metric.value}
            {metric.note !== undefined && <span className={styles.metricNote}>{metric.note}</span>}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/* -------------------------------------------------------------------------- */
/* Rows                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * One item in a list, separated by a hairline rather than boxed.
 *
 * A list of ten things should read as one list, not as ten cards. The hairline
 * is enough to separate them and costs no vertical space.
 */
export function Rows({ children }: { readonly children: ReactNode }) {
  return <ul className={styles.rows}>{children}</ul>;
}

export function Row({
  lead,
  title,
  meta,
  trailing,
  href,
  to,
  current = false,
}: {
  /** A time, a code, an index — the thing that anchors the row on the left. */
  readonly lead?: ReactNode;
  readonly title: ReactNode;
  /** Secondary line: subject name, room, source, date. */
  readonly meta?: ReactNode;
  readonly trailing?: ReactNode;
  readonly href?: string | undefined;
  readonly to?: ReactNode;
  /**
   * The one row in this list the student is looking for right now — the next
   * class, today. AT MOST ONE PER LIST: an accent on three rows is a palette,
   * not a pointer (M9.4 §16).
   *
   * Marked in words as well as colour. `Next` is read aloud by a screen reader
   * and survives a monochrome display, which a violet tick does not.
   */
  readonly current?: boolean;
}) {
  const body = (
    <>
      {lead !== undefined && (
        <span className={styles.rowLead}>
          {lead}
          {current && <span className={styles.rowNext}>Next</span>}
        </span>
      )}
      <span className={styles.rowBody}>
        <span className={styles.rowTitle}>{title}</span>
        {meta !== undefined && <span className={styles.rowMeta}>{meta}</span>}
      </span>
      {trailing !== undefined && <span className={styles.rowTrailing}>{trailing}</span>}
    </>
  );

  return (
    <li className={styles.row} data-current={current ? 'true' : undefined}>
      {href !== undefined ? (
        <a className={styles.rowLink} href={href}>
          {body}
        </a>
      ) : to !== undefined ? (
        to
      ) : (
        <span className={styles.rowInner}>{body}</span>
      )}
    </li>
  );
}

/* -------------------------------------------------------------------------- */
/* Attendance bar                                                             */
/* -------------------------------------------------------------------------- */

/**
 * A percentage, as a number and a bar.
 *
 * A plain horizontal bar, not a gauge and not a ring (M9.3 §13). The figure is
 * the information; the bar exists only so a column of them can be compared
 * without reading every number.
 *
 * The tone is derived from the rules engine's verdict by the caller, never from
 * a threshold written here — the 85% rule belongs to `@gradtools/academic-rules`
 * and must not be duplicated in a component (M9.3 §44).
 */
export function Bar({
  value,
  tone = 'default',
  label,
}: {
  /** 0–100. */
  readonly value: number;
  readonly tone?: 'default' | 'warning' | 'danger';
  /** For assistive technology, since the bar itself is decorative. */
  readonly label: string;
}) {
  const clamped = Math.max(0, Math.min(100, value));
  return (
    <div
      className={styles.bar}
      role="img"
      aria-label={`${label}: ${clamped.toFixed(0)}%`}
      data-tone={tone}
    >
      <span className={styles.barFill} style={{ inlineSize: `${String(clamped)}%` }} />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Quiet states                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Nothing here yet.
 *
 * ONE SENTENCE AND AT MOST ONE ACTION (M9.3 §19). The old empty state was a
 * bordered card with a paragraph and a large button, which made "you have not
 * added anything" the loudest thing on the screen.
 */
export function Empty({
  children,
  action,
}: {
  readonly children: ReactNode;
  readonly action?: ReactNode;
}) {
  return (
    <p className={styles.empty}>
      {children}
      {action !== undefined && <span className={styles.emptyAction}>{action}</span>}
    </p>
  );
}

/**
 * Something did not load.
 *
 * Compact and actionable (M9.3 §20). A failure to reach the server is not an
 * emergency and does not get a red panel; it gets a sentence and a retry.
 */
export function LoadError({
  children,
  onRetry,
}: {
  readonly children: ReactNode;
  readonly onRetry?: () => void;
}) {
  return (
    <p className={styles.loadError}>
      {children}
      {onRetry !== undefined && (
        <button type="button" className={styles.retry} onClick={onRetry}>
          <Icon name="refresh" size="micro" />
          Retry
        </button>
      )}
    </p>
  );
}

/**
 * A placeholder while something loads.
 *
 * Shaped like the content it replaces, so the layout does not jump when the
 * real thing arrives. Motion is suppressed under `prefers-reduced-motion`
 * (M9.3 §21).
 */
export function Skeleton({ rows = 3 }: { readonly rows?: number }) {
  return (
    <div className={styles.skeleton} aria-hidden="true">
      {Array.from({ length: rows }, (_, index) => (
        <span key={index} className={styles.skeletonRow} />
      ))}
    </div>
  );
}
