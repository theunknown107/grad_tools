/**
 * One positioned run of text from a document.
 *
 * Deliberately not pdf.js's own type: this package is pure and testable
 * without loading a PDF engine, and whatever produces these — the web app's
 * extraction, or the crawler's — is the only place that knows about pdf.js.
 *
 * Structurally identical to `apps/web/src/domain/pdf-layout.ts`'s
 * `PositionedText`, so either side's items satisfy the other.
 */
export interface PositionedText {
  readonly text: string;
  /** Left edge, in PDF user space. */
  readonly x: number;
  /** Baseline, in PDF user space. Larger is HIGHER on the page. */
  readonly y: number;
  readonly width: number;
  /** Rendered text height, used to scale tolerances. */
  readonly height: number;
}
