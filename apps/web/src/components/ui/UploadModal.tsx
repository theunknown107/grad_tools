/**
 * A file-selection modal with a drop zone.
 *
 * Authority: docs/05 §5.26 (M9.6B) · docs/13 §T-22 · docs/27 §27.4
 * Reference: 21st.dev @arihantcodes_1f7b8c4d/input-modal — RECREATED. Accessible
 * evidence was the preview and its described structure: a dashed drop zone with
 * a centred glyph, a "Browse files" fallback, status chips and a primary action.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS DELIBERATELY DOES NOT DO
 * ---------------------------------------------------------------------------
 *
 * It selects a file and hands it to a caller. It does not upload, parse, OCR or
 * store anything. M9.6 §17 is explicit that the presence of this UI is NOT
 * authorisation to build a result-OCR or scraping pipeline, and the surest way
 * to honour that is for the component to have no network code in it at all.
 *
 * ---------------------------------------------------------------------------
 * VALIDATION IS A TRUST BOUNDARY, NOT A CONVENIENCE
 * ---------------------------------------------------------------------------
 *
 * `accept` on an <input> is a filter in the file picker and nothing more: a
 * drag-and-drop bypasses it completely, and so does a renamed file. The type
 * and size are therefore re-checked here on the actual File object, and the
 * caller is expected to check again on the server. A client-side check is a
 * courtesy to the person, never a defence.
 */

import { useCallback, useId, useRef, useState, type ReactNode } from 'react';
import { Icon } from '../icons.js';
import { useDismissable, useFocusTrap } from '../../hooks/useDismissable.js';
import styles from './UploadModal.module.css';

export interface UploadModalProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly onSelect: (file: File) => void;
  readonly title: string;
  readonly description: string;
  /** MIME types allowed, e.g. `['application/pdf']`. */
  readonly accept: readonly string[];
  readonly maxBytes: number;
  readonly actionLabel?: string;
}

function readable(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function UploadModal({
  open,
  onClose,
  onSelect,
  title,
  description,
  accept,
  maxBytes,
  actionLabel = 'Use this file',
}: UploadModalProps): ReactNode {
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const id = useId();

  useDismissable({ open, onDismiss: onClose, surfaceRef: panelRef });
  useFocusTrap(open, panelRef);

  const take = useCallback(
    (candidate: File | undefined) => {
      if (candidate === undefined) return;
      if (!accept.includes(candidate.type)) {
        // Names the type it got: "not supported" alone leaves the person
        // guessing which of their files was wrong.
        setError(
          `That file is ${candidate.type === '' ? 'of an unknown type' : candidate.type}. Accepted: ${accept.join(', ')}.`,
        );
        setFile(null);
        return;
      }
      if (candidate.size > maxBytes) {
        setError(`That file is ${readable(candidate.size)}. The limit is ${readable(maxBytes)}.`);
        setFile(null);
        return;
      }
      setError(null);
      setFile(candidate);
    },
    [accept, maxBytes],
  );

  if (!open) return null;

  return (
    <div className={`${styles.scrim ?? ''} glassOverlay`}>
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        aria-describedby={`${id}-description`}
        className={`${styles.panel ?? ''} glassPanel`}
      >
        <div className={styles.head}>
          <div>
            <h2 id={`${id}-title`} className={styles.title}>
              {title}
            </h2>
            <p id={`${id}-description`} className={styles.description}>
              {description}
            </p>
          </div>
          <button type="button" className={styles.close} onClick={onClose} aria-label="Close">
            <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false">
              <path
                d="M6 6l12 12M18 6 6 18"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                fill="none"
              />
            </svg>
          </button>
        </div>

        {/*
          The drop zone is a BUTTON, not a div with a click handler: it has to
          be reachable by keyboard and announce itself, and a labelled button
          does both without any aria-* patching.
        */}
        <button
          type="button"
          className={styles.zone}
          data-dragging={dragging}
          data-invalid={error !== null}
          onClick={() => inputRef.current?.click()}
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            take(event.dataTransfer.files[0]);
          }}
        >
          <span className={styles.zoneIcon}>
            <Icon name="papers" size="large" />
          </span>
          <span className={styles.zoneTitle}>
            {dragging ? 'Drop it here' : 'Drop a file here, or click to browse'}
          </span>
          <span className={styles.zoneHint}>
            {accept.join(', ')} · up to {readable(maxBytes)}
          </span>
        </button>

        <input
          ref={inputRef}
          type="file"
          className={styles.hiddenInput}
          accept={accept.join(',')}
          onChange={(event) => take(event.target.files?.[0])}
        />

        {/* Errors are announced, not merely coloured: someone using a screen
            reader has no other way to learn the file was rejected. */}
        {error !== null ? (
          <p className={styles.error} role="alert">
            {error}
          </p>
        ) : null}

        {file !== null ? (
          <div className={styles.chosen}>
            <span className={styles.chosenIcon}>
              <Icon name="check" size="small" />
            </span>
            <span className={styles.chosenText}>
              {/* The name is rendered as text, never as markup: it is attacker
                  -controlled input (docs/13 T-22). */}
              <span className={styles.chosenName}>{file.name}</span>
              <span className={styles.chosenSize}>{readable(file.size)}</span>
            </span>
            <button type="button" className={styles.remove} onClick={() => setFile(null)}>
              Remove
            </button>
          </div>
        ) : null}

        <div className={styles.foot}>
          <button type="button" className={styles.cancel} onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className={styles.confirm}
            disabled={file === null}
            onClick={() => {
              if (file === null) return;
              onSelect(file);
              onClose();
            }}
          >
            {actionLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
