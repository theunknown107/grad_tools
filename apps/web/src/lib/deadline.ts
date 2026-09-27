/**
 * Bounds on document processing, and the one way they are enforced.
 *
 * WHY A DEADLINE AND NOT ONLY AN ERROR HANDLER. The OCR engine and pdf.js each
 * run in a Web Worker. A worker the WebView kills — memory pressure on a phone
 * is the usual reason — does not always fire `error`; the promise waiting on it
 * then never settles, and the screen said "Reading your document…" forever.
 * An error handler cannot catch a message that is never sent. The deadline is
 * the only signal left, so every stage that waits on a worker has one, and the
 * caller tears the worker down when it fires.
 *
 * The numbers are generous on purpose: they are for a mid-range phone reading
 * its first document, when the engine is fetched and compiled cold. A deadline
 * that fires on a slow-but-working device is a worse bug than the hang.
 * Timers pause while the app is backgrounded (Capacitor `KeepRunning: false`),
 * so time spent away from the app does not count against them.
 */

/** Fetching, compiling and initialising the OCR engine and its model. */
export const ENGINE_START_MS = 90_000;
/** One recognition pass over one page or photo. */
export const RECOGNITION_MS = 90_000;
/** Opening a PDF and extracting (or rendering) its pages. */
export const PDF_READ_MS = 60_000;

/**
 * `work`, or `timeout()`'s error once `ms` has passed — whichever is first.
 * The timer is always cleared, so a settled race leaves nothing running.
 */
export function withDeadline<T>(work: Promise<T>, ms: number, timeout: () => Error): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(timeout());
    }, ms);
  });
  return Promise.race([work, expired]).finally(() => {
    clearTimeout(timer);
  });
}
