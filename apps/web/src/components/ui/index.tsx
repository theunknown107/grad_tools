/**
 * Shared UI primitives.
 *
 * Authority: docs/05 §5.7, docs/27 (accessibility)
 *
 * Deliberately small and hand-written. No component library is imported: the
 * approved design system is specific enough that adapting a third-party kit
 * would cost more than the ~10 primitives below, and every one of them would
 * still need restyling to the tokens (docs/05 §5.13).
 */

import { Icon, type IconName } from '../icons.js';
import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react';
import { useId } from 'react';
import type { Explanation } from '@gradtools/academic-rules';
import styles from './ui.module.css';

/* -------------------------------------------------------------------------- */
/* Panel                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * A titled region.
 *
 * SECTION BY DEFAULT, box only when asked (M9.3 §7). See the note in
 * ui.module.css for why: 46 identical containers gave the app no hierarchy.
 */
export function Panel({
  title,
  action,
  children,
  flush = false,
  tone = 'default',
  material = 'glass',
}: {
  title?: string | undefined;
  action?: ReactNode;
  children: ReactNode;
  /** Body runs to the panel's edges, for lists that draw their own rows. */
  flush?: boolean | undefined;
  /** `attention` tints the heading. At most one per screen. */
  tone?: 'default' | 'attention' | undefined;
  /**
   * `quiet` drops the surface entirely and keeps only a hairline (M9.6C §7).
   *
   * Glass has to MARK hierarchy, which it cannot do if everything is glass. An
   * ordinary list — a set of links, a schedule — is quiet; a group that owns
   * its content and should read as elevated stays glass.
   */
  material?: 'glass' | 'quiet' | undefined;
}) {
  return (
    <section className={styles.panel} data-tone={tone} data-material={material}>
      {title !== undefined && (
        /* A div, not a <header>: inside an unnamed <section> a <header> still
           maps to the BANNER landmark, so a page of panels announces a page of
           banners. The <h2> does the labelling that matters. */
        <div className={styles.panelHeader}>
          <h2 className={styles.panelTitle}>{title}</h2>
          {action}
        </div>
      )}
      <div className={flush ? styles.panelBodyFlush : styles.panelBody}>{children}</div>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* Button                                                                     */
/* -------------------------------------------------------------------------- */

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

const buttonVariants: Record<ButtonVariant, string> = {
  primary: styles.primary ?? '',
  secondary: styles.secondary ?? '',
  ghost: styles.ghost ?? '',
  danger: styles.danger ?? '',
};

export function Button({
  variant = 'secondary',
  iconOnly = false,
  small = false,
  className,
  children,
  ...rest
}: {
  variant?: ButtonVariant;
  iconOnly?: boolean;
  small?: boolean;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const classes = [
    styles.button,
    buttonVariants[variant],
    iconOnly ? styles.iconButton : '',
    small ? styles.small : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <button type="button" className={classes} {...rest}>
      {children}
    </button>
  );
}

/**
 * Button styling for something that is semantically a LINK.
 *
 * Navigation must be an anchor, never a <button> wrapping one: nesting
 * interactive elements is invalid markup, breaks keyboard semantics, and stops
 * middle-click and open-in-new-tab from working.
 *
 * Returned as a class rather than a component so callers use the router's own
 * <Link> (client-side navigation) while still looking like a button. A plain
 * <a href> here would trigger a full page reload in an SPA.
 */
export function buttonClassName(variant: ButtonVariant = 'secondary'): string {
  return [styles.button, buttonVariants[variant], styles.linkButton].filter(Boolean).join(' ');
}

/* -------------------------------------------------------------------------- */
/* Fields                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Every input has a visible <label>. Placeholder-as-label is prohibited: it
 * disappears on input and fails contrast (docs/27 §27.11).
 */
export function TextField({
  label,
  hint,
  error,
  mono = false,
  icon,
  ...rest
}: {
  label: string;
  // `| undefined` is required under exactOptionalPropertyTypes so callers may
  // pass a computed value that is sometimes absent.
  hint?: string | undefined;
  error?: string | undefined;
  mono?: boolean | undefined;
  /**
   * A mark inside the field, before the text. For a field whose PURPOSE is not
   * obvious from its label alone — a search box is the case that earns it.
   * Decorative: the `<label>` is what names the field.
   */
  icon?: IconName | undefined;
} & InputHTMLAttributes<HTMLInputElement>) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ');

  return (
    <div className={styles.field}>
      <label className={styles.label} htmlFor={id}>
        {label}
      </label>
      <div className={styles.inputWrap}>
        {icon !== undefined && <Icon name={icon} size="nav" className={styles.inputIcon} />}
        <input
          id={id}
          className={`${styles.input ?? ''} ${mono ? (styles.mono ?? '') : ''} ${
            icon === undefined ? '' : (styles.inputWithIcon ?? '')
          }`}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy === '' ? undefined : describedBy}
          {...rest}
        />
      </div>
      {hint !== undefined && error === undefined && (
        <span className={styles.hint} id={hintId}>
          {hint}
        </span>
      )}
      {error !== undefined && (
        <span className={styles.error} id={errorId} role="alert">
          {error}
        </span>
      )}
    </div>
  );
}

export function SelectField({
  label,
  hint,
  hideLabel = false,
  children,
  ...rest
}: {
  label: string;
  hint?: string | undefined;
  /**
   * Hides the label VISUALLY ONLY. It stays in the accessibility tree, because
   * a select with no name is unusable with a screen reader. For a control whose
   * meaning is obvious from the row it sits in and would otherwise repeat eight
   * times down the page.
   */
  hideLabel?: boolean | undefined;
  children: ReactNode;
} & SelectHTMLAttributes<HTMLSelectElement>) {
  const id = useId();
  const hintId = `${id}-hint`;

  return (
    <div className={styles.field}>
      <label className={hideLabel ? (styles.srOnly ?? '') : styles.label} htmlFor={id}>
        {label}
      </label>
      <select
        id={id}
        className={styles.select}
        aria-describedby={hint === undefined ? undefined : hintId}
        {...rest}
      >
        {children}
      </select>
      {hint !== undefined && (
        <span className={styles.hint} id={hintId}>
          {hint}
        </span>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Status pill                                                                */
/* -------------------------------------------------------------------------- */

export type PillTone = 'success' | 'warning' | 'danger' | 'neutral' | 'accent';

const pillTones: Record<PillTone, string> = {
  success: styles.pillSuccess ?? '',
  warning: styles.pillWarning ?? '',
  danger: styles.pillDanger ?? '',
  neutral: styles.pillNeutral ?? '',
  accent: styles.pillAccent ?? '',
};

/**
 * Status is never conveyed by colour alone: every pill renders an icon with a
 * distinct SHAPE plus a text label (docs/05 §5.2, docs/27 §27.6).
 */
export function StatusPill({
  tone,
  icon,
  children,
}: {
  tone: PillTone;
  icon?: IconName;
  children: ReactNode;
}) {
  return (
    <span className={`${styles.pill ?? ''} ${pillTones[tone]}`}>
      {icon !== undefined && <Icon name={icon} size="micro" />}
      {children}
    </span>
  );
}

/**
 * Shape-differentiated icons for the three attendance states.
 *
 * A circle, a triangle and an octagon — the same three silhouettes road signs
 * use, and readable with no colour at all (docs/27 §27.5).
 */
export const statusIcons = {
  safe: 'success',
  below: 'warning',
  risk: 'danger',
} as const satisfies Record<string, IconName>;

/* -------------------------------------------------------------------------- */
/* Notice                                                                     */
/* -------------------------------------------------------------------------- */

export function Notice({
  tone = 'info',
  children,
}: {
  tone?: 'info' | 'warning' | 'danger';
  children: ReactNode;
}) {
  const toneClass =
    tone === 'warning'
      ? styles.noticeWarning
      : tone === 'danger'
        ? styles.noticeDanger
        : styles.noticeInfo;
  const name: IconName = tone === 'warning' ? 'warning' : tone === 'danger' ? 'danger' : 'info';

  return (
    <div className={`${styles.notice ?? ''} ${toneClass ?? ''}`}>
      <Icon name={name} size="nav" className={styles.noticeIcon} />
      <div>{children}</div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Empty state                                                                */
/* -------------------------------------------------------------------------- */

/**
 * What is empty, why that is normal, and exactly one action (docs/04 §4.5).
 * Never a shrug, never fake sample data presented as the student's own.
 */
/**
 * A panel with nothing in it yet.
 *
 * The icon is the ONLY one on the screen at that moment and it is drawn in the
 * subtle colour, which is the whole point: an empty state should read as a
 * quiet absence, not as an error. The one-line `Empty` in ui/layout.tsx gets no
 * icon at all — a mark beside a single sentence is decoration (M9.5.2 §9).
 */
export function EmptyState({
  children,
  action,
  title,
  icons,
}: {
  children: ReactNode;
  action?: ReactNode;
  /** A short headline above the sentence. Omit for a one-line absence. */
  title?: string;
  /**
   * Up to three icons, shown as a fanned cluster (M9.6B Reference 01). The
   * middle one is upright and forward; the outer two tilt away behind it.
   */
  icons?: readonly IconName[];
}) {
  const cluster = icons ?? [];
  return (
    <div className={styles.empty}>
      {cluster.length > 0 ? (
        <div className={styles.emptyCluster} aria-hidden="true">
          {cluster.slice(0, 3).map((name, index) => (
            <span
              key={name}
              className={styles.emptyChip}
              data-position={index - (cluster.length > 1 ? 1 : 0)}
            >
              <Icon name={name} size="medium" />
            </span>
          ))}
        </div>
      ) : (
        <Icon name="empty" size="large" className={styles.emptyIcon} />
      )}
      {title !== undefined ? <p className={styles.emptyTitle}>{title}</p> : null}
      <p className={styles.emptyText}>{children}</p>
      {action}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Table                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * A horizontally scrollable table container.
 *
 * `tabIndex={0}` because a region that scrolls must be reachable by keyboard —
 * without it a keyboard user cannot see the columns that are off-screen, which
 * axe reports as `scrollable-region-focusable` and which is a real dead end on
 * a narrow screen. No `role="region"` is added: an unnamed region would trade
 * this violation for a different one.
 */
export function TableScroll({ children }: { children: ReactNode }) {
  return (
    <div className={styles.tableScroll} tabIndex={0}>
      {children}
    </div>
  );
}

export const tableClass = styles.table ?? '';
export const numericClass = styles.numeric ?? '';
export const monoClass = styles.mono ?? '';

/* -------------------------------------------------------------------------- */
/* Meter                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * A linear meter with a marked threshold, not a radial gauge (docs/05 §5.12).
 * Accessible name and value come from the caller so the bar is never the only
 * carrier of the number.
 */
export function Meter({
  value,
  threshold,
  tone,
  label,
}: {
  value: number;
  threshold?: number | undefined;
  tone: 'success' | 'warning' | 'danger';
  label: string;
}) {
  const toneVar =
    tone === 'success' ? 'var(--success)' : tone === 'warning' ? 'var(--warning)' : 'var(--danger)';

  return (
    <div
      className={styles.meter}
      role="meter"
      aria-valuenow={Math.round(value)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
    >
      <div
        className={styles.meterFill}
        style={{ width: `${String(Math.max(0, Math.min(100, value)))}%`, background: toneVar }}
      />
      {threshold !== undefined && (
        <div className={styles.meterThreshold} style={{ left: `${String(threshold)}%` }} />
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Explanation                                                                */
/* -------------------------------------------------------------------------- */

/**
 * "How was this calculated?"
 *
 * The Explanation object comes straight from @gradtools/academic-rules and is
 * returned on EVERY call, success or failure. The UI therefore cannot show a
 * number without also being able to show its derivation and its cited clause
 * (docs/16 §16.10, FR-008).
 *
 * Rendered with native <details> so it is keyboard-operable and announced
 * correctly without any JavaScript or ARIA of our own.
 */
export function ExplanationDisclosure({ explanation }: { explanation: Explanation }) {
  const steps = explanation.steps;

  return (
    <details className={styles.explain}>
      <summary className={styles.explainSummary}>How was this calculated?</summary>
      <div className={styles.explainBody}>
        <div className={styles.formula}>{explanation.formula}</div>

        {steps.length > 0 && (
          <ul className={styles.stepList}>
            {steps.map((step, index) => (
              <li className={styles.step} key={`${step.label}-${String(index)}`}>
                <span>{step.label}</span>
                <span className="tabular">{formatStepValue(step.value)}</span>
              </li>
            ))}
          </ul>
        )}

        <p className={styles.provenance}>
          Rule set <code>{explanation.ruleSetId}</code> v{explanation.ruleSetVersion} · clause{' '}
          <strong>{explanation.clause}</strong>
          <br />
          <a href={explanation.sourceUrl} target="_blank" rel="noreferrer noopener">
            View the source regulation
          </a>
        </p>
      </div>
    </details>
  );
}

function formatStepValue(value: number): string {
  if (Number.isInteger(value)) return String(value);
  return value.toFixed(2);
}
