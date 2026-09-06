/**
 * Item and Attachment.
 *
 * Authority: Phase 7B §2, §12, §25 · docs/27 §27.6
 * Provenance: behaviourally faithful shadcn implementation adapted to the
 * GradTools styling architecture. Neither has a Radix primitive — both are
 * composition and markup in the shadcn registry — so what is reproduced is the
 * anatomy (media, content, actions) and the semantics, not a dependency.
 *
 * ---------------------------------------------------------------------------
 * ITEM VS ROW
 * ---------------------------------------------------------------------------
 *
 * `Row` (ui/layout.tsx) already exists and stays. It is the DENSE list row: a
 * time, a title, a figure, a hairline, nothing else. Eight classes in a day are
 * `Row`s.
 *
 * `Item` is the richer sibling: it has a media slot, it can carry a description
 * on its own line, and it holds ACTIONS rather than a single trailing figure.
 * An uploaded file with a parse status and a remove button is an Item; it would
 * be a bad Row, because a Row has nowhere to put the button.
 *
 * The distinction matters because using Item everywhere is how a list of ten
 * things becomes ten cards, which M9.3 spent a milestone undoing.
 */

import type { ReactNode } from 'react';
import { Icon, type IconName } from '../icons.js';
import { StatusPill, type PillTone } from './index.js';
import styles from './Item.module.css';

export function Item({
  media,
  title,
  description,
  actions,
  trailing,
  tone = 'default',
}: {
  /** An icon, an avatar, a thumbnail. Decorative — the title carries meaning. */
  readonly media?: ReactNode;
  readonly title: ReactNode;
  readonly description?: ReactNode;
  /** Buttons. Rendered last so they are the last tab stop in the item. */
  readonly actions?: ReactNode;
  /** A status pill or a figure, before the actions. */
  readonly trailing?: ReactNode;
  readonly tone?: 'default' | 'danger';
}): ReactNode {
  return (
    <div className={styles.item} data-tone={tone}>
      {media !== undefined && (
        <span className={styles.media} aria-hidden="true">
          {media}
        </span>
      )}
      <span className={styles.content}>
        <span className={styles.title}>{title}</span>
        {description !== undefined && <span className={styles.description}>{description}</span>}
      </span>
      {trailing !== undefined && <span className={styles.trailing}>{trailing}</span>}
      {actions !== undefined && <span className={styles.actions}>{actions}</span>}
    </div>
  );
}

/** A list of `Item`s, separated by hairlines rather than boxed individually. */
export function ItemGroup({
  label,
  children,
}: {
  readonly label: string;
  readonly children: ReactNode;
}): ReactNode {
  return (
    <ul className={styles.group} aria-label={label}>
      {children}
    </ul>
  );
}

export function ItemRow({ children }: { readonly children: ReactNode }): ReactNode {
  return <li className={styles.groupRow}>{children}</li>;
}

/* -------------------------------------------------------------------------- */
/* Attachment                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * The state an uploaded document is in.
 *
 * These are the states the import pipeline actually produces (see `FileState`
 * in ResultImport), not a generic set. `queued` exists separately from
 * `reading` because OCR is sequential and a file waiting its turn must not say
 * "Reading…" for ninety seconds.
 */
export type AttachmentStatus = 'queued' | 'reading' | 'recognising' | 'read' | 'failed';

const STATUS_TEXT: Record<AttachmentStatus, string> = {
  queued: 'Waiting to be read',
  reading: 'Reading…',
  recognising: 'Recognising text…',
  read: 'Read',
  failed: 'Could not be read',
};

const STATUS_TONE: Record<AttachmentStatus, PillTone> = {
  queued: 'neutral',
  reading: 'neutral',
  recognising: 'neutral',
  read: 'success',
  failed: 'danger',
};

const STATUS_ICON: Record<AttachmentStatus, IconName> = {
  queued: 'info',
  reading: 'refresh',
  recognising: 'refresh',
  read: 'success',
  failed: 'danger',
};

/**
 * One uploaded file, with what happened to it.
 *
 * The FILENAME IS TEXT and is used for nothing else — not as evidence of a
 * semester, not as a path, not as identity (M10A.6 §22). It is shown because a
 * person who dropped four files needs to tell them apart, and for no other
 * reason.
 *
 * The status is a pill with an icon of a distinct SHAPE plus a word, never a
 * colour alone (docs/27 §27.6).
 */
export function Attachment({
  fileName,
  bytes,
  status,
  detail,
  error,
  onRemove,
}: {
  readonly fileName: string;
  readonly bytes?: number | undefined;
  readonly status: AttachmentStatus;
  /** What was found: "Semester 3 · 8 subjects", "Class timetable". */
  readonly detail?: string | undefined;
  /** Why it failed, in words a student can act on. */
  readonly error?: string | undefined;
  readonly onRemove?: (() => void) | undefined;
}): ReactNode {
  return (
    <Item
      tone={status === 'failed' ? 'danger' : 'default'}
      media={<Icon name="file" size="nav" />}
      title={fileName}
      description={
        error !== undefined
          ? error
          : (detail ?? (bytes === undefined ? undefined : formatBytes(bytes)))
      }
      trailing={
        <StatusPill tone={STATUS_TONE[status]} icon={STATUS_ICON[status]}>
          {STATUS_TEXT[status]}
        </StatusPill>
      }
      actions={
        onRemove === undefined ? undefined : (
          <button
            type="button"
            className={styles.remove}
            onClick={onRemove}
            /* Named with the file, because a list of five identical "Remove"
               buttons is unusable with a screen reader. */
            aria-label={`Remove ${fileName}`}
          >
            <Icon name="close" size="small" />
          </button>
        )
      }
    />
  );
}

/** Bytes as a person reads them. Binary units, one decimal, no rounding to 0. */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(kb < 10 ? 1 : 0)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}
