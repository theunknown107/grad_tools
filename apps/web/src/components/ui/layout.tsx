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
 * These primitives exist so that a section can be a section and a row can be a
 * row. `Panel` is kept for the handful of places where a genuine container
 * earns itself — a form, an embedded document, a distinct sub-surface — and is
 * no longer the default answer to "how do I group these things".
 *
 * THE RULE THEY ENCODE: a border is for clarifying a grouping, not for drawing
 * a box. Where a heading and some space already say "these belong together",
 * the border adds nothing but weight.
 */

import type { ReactNode } from 'react';
import styles from './layout.module.css';

/* -------------------------------------------------------------------------- */
/* Section                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * A titled region of a page. **No border and no background by default.**
 *
 * The heading, the spacing and the reading order do the grouping. This is the
 * default way to divide a screen; reach for `Panel` only when a container is
 * genuinely doing something a heading cannot.
 */
export function Section({
  title,
  action,
  description,
  children,
  tone = 'default',
}: {
  readonly title?: string | undefined;
  /** A link or control belonging to the section, aligned with its heading. */
  readonly action?: ReactNode;
  readonly description?: string | undefined;
  readonly children: ReactNode;
  /**
   * `attention` tints the heading only — never the whole region. A section that
   * needs a student's eye does not need a coloured box around it (M9.3 §14).
   */
  readonly tone?: 'default' | 'attention';
}) {
  return (
    <section className={styles.section}>
      {title !== undefined && (
        <div className={styles.sectionHeader}>
          <h2 className={styles.sectionTitle} data-tone={tone}>
            {title}
          </h2>
          {action}
        </div>
      )}
      {description !== undefined && <p className={styles.sectionDescription}>{description}</p>}
      {children}
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* Module                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * A bordered surface holding one self-contained thing.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS COMES BACK IN M9.5
 * ---------------------------------------------------------------------------
 *
 * M9.3 removed containers because the app had one and used it for everything,
 * which flattened every page into equal boxes. The correction overshot: with no
 * container at all, a page became a single vertical column of hairlines and the
 * eye had nothing to rest against.
 *
 * The application reference is neither. It is a wide main column of content
 * with a rail of small bordered modules beside it — and the modules are
 * bordered precisely because they are NOT part of the main reading order. A
 * module says "this is a separate thing you may look at". A section says "this
 * is the next part of what you were already reading".
 *
 * So: `Section` remains the default for the page's own content, and `Module` is
 * for the things beside it. The test before reaching for one is whether the
 * content would still make sense lifted off this page entirely. If yes, it is a
 * module. If it is the next paragraph of the page's argument, it is a section.
 */
export function Module({
  title,
  action,
  children,
  tone = 'default',
}: {
  readonly title?: string | undefined;
  readonly action?: ReactNode;
  readonly children: ReactNode;
  /** `accent` marks the single most important module on a screen. At most one. */
  readonly tone?: 'default' | 'accent';
}) {
  return (
    <section className={styles.module} data-tone={tone}>
      {title !== undefined && (
        /*
          A div, not a <header>. Inside a <section> with no accessible name a
          <header> still maps to the BANNER landmark, so a page of modules
          announces a page of banners. The heading inside does the labelling
          that matters.
        */
        <div className={styles.moduleHeader}>
          <h2 className={styles.moduleTitle}>{title}</h2>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* Metrics                                                                    */
/* -------------------------------------------------------------------------- */

export interface Metric {
  readonly label: string;
  /** Already formatted. An em dash where the figure does not exist yet. */
  readonly value: string;
  /** Small qualifier under the value: "of 8", "sem 4", "22OB". */
  readonly note?: string | undefined;
  readonly tone?: 'default' | 'warning' | 'danger' | undefined;
}

/**
 * A dense row of figures.
 *
 * NOT FOUR FLOATING CARDS (M9.3 §10). Numbers a student reads together should
 * sit together and be comparable at a glance; giving each one a card makes four
 * separate announcements out of one summary.
 *
 * The value is large enough to scan and no larger. A 40px number does not
 * become more true.
 */
export function MetricStrip({ metrics }: { readonly metrics: readonly Metric[] }) {
  return (
    <dl className={styles.metrics}>
      {metrics.map((metric) => (
        <div key={metric.label} className={styles.metric}>
          <dt className={styles.metricLabel}>{metric.label}</dt>
          <dd className={styles.metricValue} data-tone={metric.tone ?? 'default'}>
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
