/**
 * Documents — the private working set.
 *
 * Authority: M5A §14, §16 · docs/28
 *
 * WHAT THIS SCREEN IS HONEST ABOUT
 *
 * Every document here is the student's own and stays on this machine. The page
 * says so plainly rather than leaving it to be inferred, because "where did my
 * file go" is the question an upload screen actually raises.
 *
 * It also says what happens to a scan. In the 65-document corpus supplied for
 * testing, 56 produced no meaningful text (docs/32 OQ-019) — so for that sample
 * "this one is a scan" was the common outcome rather than an edge case, and a
 * screen that only showed the happy path would have been wrong most of the
 * time. That figure describes one local sample, not VTU papers in general.
 *
 * Retention is stated, not assumed. `OQ-028` is open, so the page says what is
 * true today — the file stays until you remove it — instead of implying a
 * policy that has not been decided (M5A §16).
 */

import { useCallback, useState } from 'react';
import { SOURCE_ROUTES, type DocumentRecord, type DocumentSection } from '@gradtools/shared-types';
import { AsyncSection } from '../../components/AsyncSection.js';
import { useAsync } from '../../hooks/useReference.js';
import { apiBaseUrl } from '../../repositories/reference.js';
import styles from './documents.module.css';

/**
 * Extraction outcomes, in the words a student would use.
 *
 * `tone` matters as much as the words. `ocr_required` is a LEGITIMATE
 * PROCESSING OUTCOME, not a failure: the document was read correctly and
 * correctly found to contain no text layer. Only `extraction_failed` means
 * something went wrong.
 *
 * The distinction is not cosmetic. In the supplied corpus 54 of 63 accepted
 * PDFs were scans (docs/32 OQ-019), so presenting that as an error would tell
 * most students their perfectly good paper had broken — and would train them to
 * ignore the one message that does mean something is wrong.
 */
const EXTRACTION_LABEL: Record<
  string,
  { label: string; detail: string; tone: 'neutral' | 'ok' | 'info' | 'error' }
> = {
  pending: {
    label: 'Not read yet',
    detail: 'This document has been checked but not read.',
    tone: 'neutral',
  },
  text_available: {
    label: 'Text read',
    detail: 'The text was read directly from the document.',
    tone: 'ok',
  },
  ocr_required: {
    label: 'Needs image reading',
    detail:
      'No usable text layer was found: this document is a scan of a printed page. Reading it would need image recognition, which GradTools does not do yet.',
    tone: 'info',
  },
  extraction_failed: {
    label: 'Could not read',
    detail: 'The document could not be read. It may be damaged.',
    tone: 'error',
  },
};

const STATE_LABEL: Record<string, string> = {
  quarantined: 'Checking',
  validated: 'Checked',
  extracted: 'Read',
  rejected: 'Not accepted',
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

async function fetchJson(path: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(`${apiBaseUrl()}${path}`, init);
  if (!response.ok) throw new Error(`Request failed (${String(response.status)}).`);
  return response.json();
}

export function DocumentsPage() {
  const [reloadToken, setReloadToken] = useState(0);
  const [selected, setSelected] = useState<DocumentRecord | null>(null);

  const documents = useAsync<DocumentRecord[]>(async () => {
    const body = (await fetchJson(SOURCE_ROUTES.documentsPrivate)) as {
      data: DocumentRecord[];
    };
    return body.data;
  }, [reloadToken]);

  const reload = useCallback(() => {
    setReloadToken((n) => n + 1);
  }, []);

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1>Documents</h1>
        <p className={styles.lede}>
          Question papers and notes you add for your own use. They are checked for safety, then read
          if they contain text.
        </p>
      </header>

      {/*
        Stated once, prominently, rather than buried. The two facts a student
        most needs are where the file lives and how long it stays.
      */}
      <aside className={styles.notice} aria-labelledby="privacy-heading">
        <h2 id="privacy-heading" className={styles.noticeHeading}>
          These documents are yours
        </h2>
        <p>
          They are stored on this machine only. GradTools does not share them, publish them, or send
          them anywhere. They stay until you remove them.
        </p>
      </aside>

      <ImportPanel onImported={reload} />

      <section aria-labelledby="library-heading">
        <h2 id="library-heading">Your documents</h2>
        <AsyncSection
          state={documents.state}
          retry={documents.retry}
          label="documents"
          isEmpty={(items) => items.length === 0}
          empty={
            <p className={styles.empty}>
              No documents yet. Add a PDF above and it will appear here.
            </p>
          }
        >
          {(items) => (
            <ul className={styles.list}>
              {items.map((doc) => (
                <li key={doc.id}>
                  <DocumentRow
                    document={doc}
                    isOpen={selected?.id === doc.id}
                    onToggle={() => {
                      setSelected(selected?.id === doc.id ? null : doc);
                    }}
                    onProcessed={reload}
                  />
                </li>
              ))}
            </ul>
          )}
        </AsyncSection>
      </section>
    </div>
  );
}

/** Adds a document by reading the file locally and sending its bytes. */
function ImportPanel({ onImported }: { readonly onImported: () => void }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'warn' | 'error'; text: string } | null>(
    null,
  );

  async function handleFiles(files: FileList | null) {
    if (files === null || files.length === 0) return;
    const file = files[0];
    if (file === undefined) return;

    setBusy(true);
    setMessage(null);
    try {
      const bytes = await file.arrayBuffer();
      const outcome = (await fetchJson(SOURCE_ROUTES.documentImport, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/pdf',
          'X-Document-Filename': encodeURIComponent(file.name),
        },
        body: bytes,
      })) as { kind: string; reason?: string };

      if (outcome.kind === 'rejected') {
        // A rejection is a normal outcome and is reported as information, not
        // as a failure of the app.
        setMessage({ tone: 'warn', text: outcome.reason ?? 'That file was not accepted.' });
      } else if (outcome.kind === 'duplicate') {
        setMessage({ tone: 'ok', text: 'You already have that document.' });
      } else {
        setMessage({ tone: 'ok', text: `Added ${file.name}.` });
      }
      onImported();
    } catch {
      setMessage({ tone: 'error', text: 'Could not reach the GradTools server.' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={styles.import} aria-labelledby="import-heading">
      <h2 id="import-heading">Add a document</h2>
      <label className={styles.fileLabel} htmlFor="document-file">
        Choose a PDF
      </label>
      <input
        id="document-file"
        className={styles.file}
        type="file"
        accept="application/pdf,.pdf"
        disabled={busy}
        onChange={(event) => {
          void handleFiles(event.target.files);
          event.target.value = '';
        }}
      />
      <p className={styles.hint}>PDF only, up to 20 MB.</p>

      {/* Announced to assistive technology: the outcome is the whole point. */}
      <p className={styles.message} data-tone={message?.tone} role="status" aria-live="polite">
        {busy ? 'Checking the document…' : (message?.text ?? '')}
      </p>
    </section>
  );
}

function DocumentRow({
  document: doc,
  isOpen,
  onToggle,
  onProcessed,
}: {
  readonly document: DocumentRecord;
  readonly isOpen: boolean;
  readonly onToggle: () => void;
  readonly onProcessed: () => void;
}) {
  const extraction = EXTRACTION_LABEL[doc.extractionStatus];

  return (
    <article className={styles.card} data-state={doc.state}>
      <div className={styles.cardHead}>
        <h3 className={styles.title}>{doc.title}</h3>
        <span className={styles.state} data-state={doc.state} data-tone={extraction?.tone}>
          {/*
            For a processed document the extraction outcome is the useful
            label. "Read" would be actively wrong on a scan that produced no
            text, even though its lifecycle state really is `extracted`.
          */}
          {doc.state === 'extracted' && extraction !== undefined
            ? extraction.label
            : (STATE_LABEL[doc.state] ?? doc.state)}
        </span>
      </div>

      <dl className={styles.meta}>
        <div>
          <dt>Size</dt>
          <dd>{formatBytes(doc.byteSize)}</dd>
        </div>
        <div>
          <dt>Pages</dt>
          <dd>{doc.pageCount === null ? 'Unknown' : String(doc.pageCount)}</dd>
        </div>
        <div>
          <dt>Added</dt>
          <dd>{doc.createdAt}</dd>
        </div>
        <div>
          <dt>Fingerprint</dt>
          {/* Short prefix: enough to tell two documents apart, not a wall of hex. */}
          <dd className={styles.hash}>{doc.sha256.slice(0, 12)}</dd>
        </div>
      </dl>

      {doc.state === 'rejected' ? (
        <p className={styles.rejection}>{doc.rejectionReason}</p>
      ) : (
        /*
         * `data-tone` carries the meaning, so a scan reads as information and
         * only a real failure reads as an error. Never colour alone: the
         * wording differs too.
         */
        <p className={styles.extraction} data-tone={extraction?.tone}>
          {extraction?.detail}
        </p>
      )}

      {doc.state !== 'rejected' && (
        <div className={styles.actions}>
          <ProcessButton document={doc} onProcessed={onProcessed} />
          {doc.state === 'extracted' && doc.extractionStatus === 'text_available' && (
            <button type="button" className={styles.secondary} onClick={onToggle}>
              {isOpen ? 'Hide text' : 'Show text'}
            </button>
          )}
        </div>
      )}

      {isOpen && <SectionList documentId={doc.id} />}
    </article>
  );
}

function ProcessButton({
  document: doc,
  onProcessed,
}: {
  readonly document: DocumentRecord;
  readonly onProcessed: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <>
      <button
        type="button"
        className={styles.primary}
        disabled={busy}
        onClick={() => {
          setBusy(true);
          setError(null);
          void fetchJson(SOURCE_ROUTES.documentProcess(doc.id), { method: 'POST' })
            .then(onProcessed)
            .catch(() => {
              setError('Could not read this document.');
            })
            .finally(() => {
              setBusy(false);
            });
        }}
      >
        {busy ? 'Reading…' : doc.state === 'extracted' ? 'Read again' : 'Read text'}
      </button>
      {error !== null && <span className={styles.error}>{error}</span>}
    </>
  );
}

function SectionList({ documentId }: { readonly documentId: string }) {
  const sections = useAsync<DocumentSection[]>(async () => {
    const body = (await fetchJson(SOURCE_ROUTES.documentSections(documentId))) as {
      data: DocumentSection[];
    };
    return body.data;
  }, [documentId]);

  return (
    <AsyncSection
      state={sections.state}
      retry={sections.retry}
      label="extracted text"
      isEmpty={(items) => items.length === 0}
      empty={<p className={styles.empty}>No text was found in this document.</p>}
    >
      {(items) => (
        <div className={styles.sections}>
          <p className={styles.sectionCount}>
            {items.length} block{items.length === 1 ? '' : 's'} of text across{' '}
            {new Set(items.map((s) => s.pageNumber)).size} page
            {new Set(items.map((s) => s.pageNumber)).size === 1 ? '' : 's'}
          </p>
          <ol className={styles.sectionList}>
            {items.slice(0, 20).map((section) => (
              <li key={section.id}>
                <span className={styles.pageTag}>Page {section.pageNumber}</span>
                <pre className={styles.sectionText}>{section.content}</pre>
              </li>
            ))}
          </ol>
          {items.length > 20 && (
            <p className={styles.hint}>Showing the first 20 blocks of {items.length}.</p>
          )}
        </div>
      )}
    </AsyncSection>
  );
}
