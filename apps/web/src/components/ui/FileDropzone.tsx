/**
 * Where a document is handed to GradTools.
 *
 * Authority: Phase 7B §4, §15, §25 · docs/08 §8.23 · docs/27 §27.11
 * Reference: 21st.dev Input Modal — the PATTERN, recreated. What is taken is
 * the anatomy the reference establishes: one large drop surface, a document
 * visualisation at its centre, the supported formats stated on the surface
 * rather than in a tooltip, and the selected files presented as a reviewable
 * list rather than a filename in a grey strip. The styling is GradTools tokens
 * throughout; none of the reference's own visual treatment is carried over.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS REPLACES, AND WHY IT WAS WRONG
 * ---------------------------------------------------------------------------
 *
 * The old surface was a one-line dashed strip: an icon, a sentence, and the
 * word "browse" underlined as a link, with a transparent `<input type="file">`
 * stretched over it inside a `<label>`. Three problems, in increasing order of
 * seriousness:
 *
 *   1. It read as a footnote. Automatic ingestion is the PRIMARY workflow of
 *      this product (docs/08 §8.23), and it was the smallest thing on its own
 *      page.
 *   2. The drop target was the strip. A person dragging a PDF at a 40px-tall
 *      ribbon misses, and a miss drops the file onto the page — which navigates
 *      the browser away from the app and loses the upload.
 *   3. `browse` was a styled `<label>`, not a control. It could be reached with
 *      Tab only because `:focus-within` caught the hidden input, it was not
 *      announced as a button, and Space did not open the picker.
 *
 * ---------------------------------------------------------------------------
 * VALIDATION HAPPENS HERE; PARSING DOES NOT
 * ---------------------------------------------------------------------------
 *
 * The pipeline is unchanged — selection, validation, parsing, normalisation,
 * review, confirmation, save — and this component owns exactly the first two
 * steps. It checks the file KIND with the same `fileKind` the reader uses, and
 * hands everything acceptable to `onFiles` untouched. It never reads a file,
 * never guesses at contents, and never decides what a document is; that is the
 * classifier's job, downstream, on the extracted text.
 *
 * A rejected file is NAMED and its format stated. "Unsupported file" tells a
 * person nothing about which of the four they dropped was the problem.
 */

import { useId, useRef, useState, type DragEvent, type ReactNode } from 'react';
import { fileKind } from '../../lib/result-file.js';
import { Icon } from '../icons.js';
import { Alert } from './Feedback.js';
import styles from './FileDropzone.module.css';

/** Stated on the surface, and the single source for both the copy and the `accept`. */
const ACCEPTED = 'application/pdf,image/jpeg,image/png,image/webp';
const FORMATS = ['PDF', 'JPEG', 'PNG', 'WebP'] as const;

export function FileDropzone({
  onFiles,
  busy = false,
  title = 'Drop a document here',
  hint = 'A result card, an academic calendar or a class timetable.',
  disabled = false,
}: {
  /** Receives only files that passed the kind check. Never called with none. */
  readonly onFiles: (files: readonly File[]) => void;
  /** True while the pipeline is reading; the surface says so and stops taking more. */
  readonly busy?: boolean;
  readonly title?: string;
  readonly hint?: string;
  readonly disabled?: boolean;
}): ReactNode {
  const inputRef = useRef<HTMLInputElement>(null);
  const inputId = useId();
  const [dragging, setDragging] = useState(false);
  const [rejected, setRejected] = useState<readonly string[]>([]);

  /*
   * A COUNTER, NOT A BOOLEAN.
   *
   * `dragleave` fires every time the pointer crosses into a CHILD element, so a
   * boolean flag makes the highlight flicker off as the cursor passes over the
   * icon and the text inside the surface. Counting enters against leaves is the
   * standard fix and the only one that survives nested children.
   */
  const depth = useRef(0);

  const accept = (files: readonly File[]) => {
    const good = files.filter((file) => fileKind(file) !== 'unsupported');
    const bad = files.filter((file) => fileKind(file) === 'unsupported');
    setRejected(bad.map((file) => file.name));
    if (good.length > 0) onFiles(good);
  };

  const inert = disabled || busy;

  return (
    <div className={styles.wrap}>
      {/*
        A DIV, not a <button>, and not a <label> wrapping everything.

        A button cannot legally contain the file input, and a label that wraps
        the whole surface makes every click anywhere — including on the format
        list — open the picker, which is startling. So the surface is a plain
        region that handles the DROP, and the keyboard route is the real button
        inside it.
      */}
      <div
        className={styles.zone}
        data-dragging={dragging}
        data-busy={busy}
        data-disabled={inert}
        onDragEnter={(event: DragEvent) => {
          event.preventDefault();
          if (inert) return;
          depth.current += 1;
          setDragging(true);
        }}
        onDragOver={(event: DragEvent) => {
          /* Without this the browser navigates to the dropped file and the
             application is simply gone. */
          event.preventDefault();
        }}
        onDragLeave={() => {
          depth.current -= 1;
          if (depth.current <= 0) {
            depth.current = 0;
            setDragging(false);
          }
        }}
        onDrop={(event: DragEvent) => {
          event.preventDefault();
          depth.current = 0;
          setDragging(false);
          if (inert) return;
          accept([...event.dataTransfer.files]);
        }}
      >
        {/*
          THE DOCUMENT VISUALISATION (§15): three sheets, fanned.

          Decorative and marked so — the surface's heading and the format list
          carry every word that matters, and a screen reader announcing three
          document icons would be reading the wallpaper.
        */}
        <div className={styles.sheets} aria-hidden="true">
          <span className={styles.sheet} data-position="-1">
            <Icon name="file" size="medium" />
          </span>
          <span className={styles.sheet} data-position="0">
            <Icon name={busy ? 'refresh' : 'upload'} size="medium" />
          </span>
          <span className={styles.sheet} data-position="1">
            <Icon name="file" size="medium" />
          </span>
        </div>

        <p className={styles.title}>{busy ? 'Reading your document…' : title}</p>
        <p className={styles.hint}>{hint}</p>

        <button
          type="button"
          className={styles.choose}
          disabled={inert}
          onClick={() => inputRef.current?.click()}
        >
          Choose a file
        </button>

        {/*
          The input is hidden from BOTH trees — it is `tabIndex={-1}` and
          `aria-hidden`, because the button above is the control. Two tab stops
          for one action is worse than one, and a screen reader announcing an
          unlabelled file input beside a labelled button is noise.
        */}
        <input
          ref={inputRef}
          id={inputId}
          className={styles.input}
          type="file"
          accept={ACCEPTED}
          multiple
          tabIndex={-1}
          aria-hidden="true"
          disabled={inert}
          onChange={(event) => {
            accept([...(event.target.files ?? [])]);
            /* Cleared so choosing the SAME file twice fires `change` again —
               without this, a person who fixed a file and re-picked it gets
               nothing at all. */
            event.target.value = '';
          }}
        />

        <p className={styles.formats}>{FORMATS.join(' · ')}</p>
      </div>

      {rejected.length > 0 && (
        <Alert
          tone="warning"
          live
          title={rejected.length === 1 ? 'That file cannot be read' : 'Some files cannot be read'}
          action={
            <button
              type="button"
              className={styles.dismiss}
              onClick={() => {
                setRejected([]);
              }}
            >
              Dismiss
            </button>
          }
        >
          {/* NAMED, so a person who dropped four files knows which one. */}
          {rejected.join(', ')} — GradTools reads {FORMATS.join(', ')}. A Word document can be saved
          as a PDF and imported that way.
        </Alert>
      )}
    </div>
  );
}
