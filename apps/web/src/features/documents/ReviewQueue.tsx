/**
 * The review queue.
 *
 * Authority: docs/21 §21.15 · M5A.6 §7
 *
 * ORDER, NOT SCORE. `review_required` first, then `low`, `medium`, `high` —
 * the records where the geometry agreed least, first. No number is computed and
 * none is shown: one would have to be invented, and it would blend two
 * incomparable things, how much the layout agreed and how much work a record
 * needs (docs/32 ED-46).
 *
 * One flat list across questions, sub-questions and MCQ items, because a
 * reviewer works through RECORDS. Three lists would make "what is left to
 * check?" three questions instead of one.
 */

import { SOURCE_ROUTES, type ReviewQueueItem } from '@gradtools/shared-types';
import { AsyncSection } from '../../components/AsyncSection.js';
import { useAsync } from '../../hooks/useReference.js';
import { apiBaseUrl } from '../../repositories/reference.js';
import styles from './documents.module.css';

const CONFIDENCE_LABEL: Record<string, string> = {
  review_required: 'Needs review',
  low: 'Unclear',
  medium: 'Partly clear',
  high: 'Clear',
};

const KIND_LABEL: Record<string, string> = {
  question: 'Question',
  'sub-question': 'Part',
  'mcq-item': 'Item',
};

export function ReviewQueue({ reloadToken }: { readonly reloadToken: number }) {
  const queue = useAsync<ReviewQueueItem[]>(async () => {
    const response = await fetch(`${apiBaseUrl()}${SOURCE_ROUTES.reviewQueue}?limit=50`);
    if (!response.ok) throw new Error(`Request failed (${String(response.status)}).`);
    const body = (await response.json()) as { data: ReviewQueueItem[] };
    return body.data;
  }, [reloadToken]);

  return (
    <section aria-labelledby="queue-heading">
      <h2 id="queue-heading">Waiting to be checked</h2>
      <AsyncSection
        state={queue.state}
        retry={queue.retry}
        label="review queue"
        isEmpty={(items) => items.length === 0}
        empty={
          <p className={styles.empty}>
            Nothing is waiting. Every question worked out so far has been checked.
          </p>
        }
      >
        {(items) => (
          <>
            <p className={styles.sectionCount}>
              {items.length === 50
                ? 'The 50 records'
                : `${String(items.length)} record${items.length === 1 ? '' : 's'}`}{' '}
              needing a look most, least clear first. Open the document below to check them.
            </p>
            <ul className={styles.queue}>
              {items.map((item) => (
                <li key={item.id} className={styles.queueItem} data-confidence={item.confidence}>
                  <span className={styles.queueLabel}>
                    {KIND_LABEL[item.kind] ?? item.kind} {item.label}
                  </span>
                  {/* Extracted text, rendered as text. Never markup. */}
                  <span className={styles.queueText}>{item.text.slice(0, 140)}</span>
                  <span className={styles.queueMeta}>
                    {item.documentTitle} · page {item.pageNumber} ·{' '}
                    {CONFIDENCE_LABEL[item.confidence] ?? item.confidence}
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </AsyncSection>
    </section>
  );
}
