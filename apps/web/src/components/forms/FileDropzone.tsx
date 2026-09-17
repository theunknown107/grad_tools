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
import { fileKind } from '../../lib/result-file.js';
import { Button } from '../ui/button.js';
import { Callout } from '../ui/feedback.js';

const ACCEPTED = 'application/pdf,image/jpeg,image/png,image/webp';

const isWord = (name: string): boolean => /\.docx?$/i.test(name);

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

  const accept = (files: readonly File[]): void => {
    const good = files.filter((file) => fileKind(file) !== 'unsupported');
    setRejected(files.filter((file) => fileKind(file) === 'unsupported').map((file) => file.name));
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
          dragging ? 'border-accent bg-accent-weak/40' : 'border-line-strong bg-panel',
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
        <p className="mt-3 font-mono text-[11px] tracking-[0.08em] text-ink-3">
          PDF · JPEG · PNG · WebP
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
          title="Not added."
          action={
            <Button size="sm" variant="ghost" onClick={() => setRejected([])}>
              Dismiss
            </Button>
          }
        >
          GradTools reads PDFs and photos (JPG, PNG, WebP).{' '}
          {rejected.length === 1
            ? `${rejected[0] ?? ''} is neither.`
            : `${rejected.join(', ')} are neither.`}
          {rejected.some(isWord) &&
            ' A Word document can be saved as a PDF from Word (File → Save As), then added here.'}
        </Callout>
      )}
    </div>
  );
}
