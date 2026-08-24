/**
 * How material's origin and status are shown to a student.
 *
 * Authority: M5 §18 · docs/28 · docs/14 §14.7.1
 *
 * THE COPY RULE THIS COMPONENT EXISTS TO ENFORCE
 *
 * "Source: VTU" must never imply that GradTools has permission to redistribute
 * VTU's material (M5 §25). Attribution and permission are different claims, and
 * a badge that shows only the first invites the reader to assume the second.
 *
 * So every badge shows two things: WHERE it came from, and WHAT GradTools can
 * actually do with it. The status line is written in plain language — a student
 * should learn whether a link will open elsewhere, not read our licensing
 * position (M5 §18: no internal legal or operational jargon).
 */

import type { PresentationMode } from '@gradtools/shared-types';
import { ExternalLinkIcon, LockIcon, ShieldCheckIcon, SlashIcon } from './icons.js';
import styles from './SourceBadge.module.css';

export interface SourceBadgeProps {
  /** Who published the material. Shown as attribution, never as permission. */
  readonly publisher: string;
  readonly presentation: PresentationMode;
  /** Required when `presentation` is `link` — it is the whole point of a link. */
  readonly sourceUrl?: string | undefined;
  readonly title?: string | undefined;
}

/**
 * Plain-language status per presentation mode.
 *
 * `link` deliberately says the document opens on the publisher's site rather
 * than something like "rights unclear". The student's question is "what happens
 * when I click", and the honest answer to that is also the accurate one.
 */
const STATUS: Record<PresentationMode, { label: string; detail: string }> = {
  host: {
    label: 'Available here',
    detail: 'GradTools has permission to provide this document.',
  },
  link: {
    label: 'External document',
    detail: 'GradTools does not host this file. It opens on the publisher’s own site.',
  },
  private: {
    label: 'Private to you',
    detail: 'You added this. It stays on your device and is never shared.',
  },
  blocked: {
    label: 'Not available',
    detail: 'This material cannot be provided.',
  },
};

function StatusIcon({ mode }: { readonly mode: PresentationMode }) {
  switch (mode) {
    case 'host':
      return <ShieldCheckIcon aria-hidden="true" />;
    case 'link':
      return <ExternalLinkIcon aria-hidden="true" />;
    case 'private':
      return <LockIcon aria-hidden="true" />;
    case 'blocked':
      return <SlashIcon aria-hidden="true" />;
  }
}

export function SourceBadge({ publisher, presentation, sourceUrl, title }: SourceBadgeProps) {
  const status = STATUS[presentation];

  return (
    <div className={styles.badge} data-mode={presentation}>
      <div className={styles.row}>
        <span className={styles.key}>Source</span>
        <span className={styles.value}>{publisher}</span>
      </div>

      <div className={styles.row}>
        <span className={styles.key}>Status</span>
        <span className={styles.status}>
          <StatusIcon mode={presentation} />
          {status.label}
        </span>
      </div>

      <p className={styles.detail}>{status.detail}</p>

      {presentation === 'link' && sourceUrl !== undefined ? (
        <a
          className={styles.action}
          href={sourceUrl}
          // noopener/noreferrer on every outbound link: the destination is not
          // ours and must not receive a handle on this window.
          target="_blank"
          rel="noopener noreferrer external"
        >
          View original
          <ExternalLinkIcon aria-hidden="true" />
          {/* The destination is named for screen readers and for anyone who
              cannot see that the icon means "leaves this site". */}
          <span className={styles.srOnly}>
            {` — opens ${publisher}${title === undefined ? '' : `: ${title}`} in a new tab`}
          </span>
        </a>
      ) : null}
    </div>
  );
}
