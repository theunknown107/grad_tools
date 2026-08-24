/**
 * Loading / error / empty presentation for server-backed data.
 *
 * Authority: M5a §21, docs/04 §4.4-§4.6
 *
 * Centralised so every reference-data surface handles the same six states the
 * same way, and so "we forgot the error state" cannot happen one screen at a
 * time. Uses the existing design system: no new tokens, no new components.
 */

import type { ReactNode } from 'react';
import type { AsyncState } from '../hooks/useReference.js';
import { Button, EmptyState, Notice } from './ui/index.js';
import styles from './AsyncSection.module.css';

export function AsyncSection<T>({
  state,
  retry,
  isEmpty,
  empty,
  children,
  label,
}: {
  state: AsyncState<T>;
  retry: () => void;
  /** Distinguishes "loaded, but there is nothing" from "loaded with data". */
  isEmpty?: (data: T) => boolean;
  empty?: ReactNode;
  children: (data: T) => ReactNode;
  label: string;
}) {
  if (state.status === 'loading') {
    /*
     * A text status rather than a spinner: this is a small inline region, and
     * `role="status"` announces it to a screen reader, which a bare spinner
     * does not (docs/04 §4.4).
     */
    return (
      <p className={styles.loading} role="status">
        Loading {label}…
      </p>
    );
  }

  if (state.status === 'error') {
    /*
     * The two failure kinds get different copy because they need different
     * actions from the reader. A network failure is worth retrying; a server
     * error usually is not, but retry is offered anyway since it costs nothing
     * and the distinction is not always right.
     */
    return (
      <div className={styles.error}>
        <Notice tone="warning">
          {state.kind === 'network' ? (
            <>
              Could not reach the GradTools server, so {label} are unavailable. Everything you have
              entered is stored on this device and is unaffected.
            </>
          ) : (
            <>{state.message}</>
          )}
        </Notice>
        <div className={styles.retry}>
          <Button onClick={retry}>Try again</Button>
        </div>
      </div>
    );
  }

  if (isEmpty?.(state.data) === true) {
    return <>{empty ?? <EmptyState>No {label} available yet.</EmptyState>}</>;
  }

  return <>{children(state.data)}</>;
}
