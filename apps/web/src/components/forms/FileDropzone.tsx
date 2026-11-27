/**
 * The design's drop surface: a dashed field that lifts its icon and fills with
 * the accent tint while a file is dragged over it.
 *
 * One control: "Browse files" is the only tab stop, and it opens a hidden file
 * input. Unsupported files are refused up front, by name, in a live region,
 * while the good files in the same batch go through.
 */

import { FileText, UploadCloud } from 'lucide-react';
import { useRef, useState, type DragEvent } from 'react';
import { cn } from '../../lib/cn.js';
import { INVALID_FORMAT_MESSAGE, fileKind } from '../../lib/result-file.js';
import { Button } from '../ui/button.js';
import { Callout } from '../ui/feedback.js';

/** Images, PDF, Word and Excel only (the allow-list in `lib/result-file`). */
const ACCEPTED = [
  'application/pdf,.pdf',
  'image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp',
  '.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
].join(',');

export function FileDropzone({
  onFiles,
  busy = false,
  title = 'Drag a document here',
  hint = 'A result card, an academic calendar, a scheme or a class timetable. GradTools works out which is which, then lets you review before saving.',
  disabled = false,
}: {
  readonly onFiles: (files: readonly File[]) => void;
  readonly busy?: boolean;
  readonly title?: string;
  readonly hint?: string;
  readonly disabled?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [rejected, setRejected] = useState<readonly string[]>([]);
  const depth = useRef(0);
  const inert = disabled || busy;

  /*
   * Refused here when the file declares a type, or carries an extension, that
   * is not on the allow-list. A file with neither (Android pickers hand over
   * photos named by a UUID) goes on, and its own first bytes decide (`sniffKind`).
   */
  const refused = (file: File): boolean =>
    fileKind(file) === 'unsupported' && (file.type !== '' || /\.[a-z0-9]+$/i.test(file.name));
  const accept = (files: readonly File[]): void => {
    const good = files.filter((file) => !refused(file));
    setRejected(files.filter(refused).map((file) => file.name));
    if (good.length > 0) onFiles(good);
  };

  const onDragEnter = (event: DragEvent<HTMLDivElement>): void => {
    event.preventDefault();
    if (inert) return;
    depth.current += 1;
    setDragging(true);
  };
  const onDragLeave = (event: DragEvent<HTMLDivElement>): void => {
    event.preventDefault();
    depth.current = Math.max(0, depth.current - 1);
    if (depth.current === 0) setDragging(false);
  };
  const onDrop = (event: DragEvent<HTMLDivElement>): void => {
    event.preventDefault();
    depth.current = 0;
    setDragging(false);
    if (inert) return;
    accept([...event.dataTransfer.files]);
  };

  return (
    <div className="flex flex-col gap-3">
      <div
        onDragEnter={onDragEnter}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        data-dragging={dragging}
        aria-busy={busy}
        className={cn(
          'flex flex-col items-center justify-center rounded-2xl border-2 border-dashed px-6 py-14 text-center transition-colors sm:py-16',
          dragging ? 'bg-accent-weak/40' : 'border-line-strong bg-panel',
          inert && 'opacity-70',
        )}
      >
        <div
          aria-hidden="true"
          className={cn(
            'mb-4 grid size-16 place-items-center rounded-2xl transition-[transform,background,color] duration-200',
            dragging ? 'scale-105 bg-accent text-on-accent' : 'bg-sunken text-ink-2',
          )}
        >
          <UploadCloud className="size-7" />
        </div>
        <h3 className="text-[17px] font-semibold text-ink">
          {busy ? 'Reading your document…' : dragging ? 'Drop to import' : title}
        </h3>
        <p className="mt-1 max-w-md text-[13px] text-ink-2">{hint}</p>
        <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
          <Button
            variant="primary"
            icon={<FileText />}
            loading={busy}
            disabled={inert}
            onClick={() => inputRef.current?.click()}
          >
            Browse files
          </Button>
        </div>
        <p className="mt-3 font-mono text-[12px] text-ink-3">
          PDF · DOCX · XLSX · JPEG · PNG · WebP
        </p>
        <input
          ref={inputRef}
          aria-hidden="true"
          type="file"
          multiple
          accept={ACCEPTED}
          disabled={inert}
          className="sr-only"
          tabIndex={-1}
          onChange={(event) => {
            const files = event.target.files === null ? [] : [...event.target.files];
            event.target.value = '';
            accept(files);
          }}
        />
      </div>
      {rejected.length > 0 && (
        <Callout
          tone="warning"
          role="status"
          title="Invalid format."
          action={
            <Button size="sm" variant="ghost" onClick={() => setRejected([])}>
              Dismiss
            </Button>
          }
        >
          {INVALID_FORMAT_MESSAGE.replace('Invalid format. ', '')}{' '}
          {rejected.length === 1
            ? `${rejected[0] ?? ''} was not added.`
            : `${rejected.join(', ')} were not added.`}
        </Callout>
      )}
    </div>
  );
}
