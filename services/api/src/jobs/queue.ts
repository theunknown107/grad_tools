/**
 * PostgreSQL-backed job queue.
 *
 * Authority: docs/09 §9.7 · docs/23 §23.10 · M5A.3 §4
 *
 * NO REDIS, NO BULLMQ, NO EXTERNAL BROKER. PostgreSQL already provides the two
 * hard parts — atomic claim and durable state — through
 * `FOR UPDATE SKIP LOCKED`. Adding a broker would add an operational
 * dependency, a second source of truth and a new failure mode, to solve a
 * problem one query already solves. docs/23 §23.10 rejects exactly this kind of
 * pre-emptive infrastructure.
 *
 * THE TWO GUARANTEES
 *
 * 1. **Two workers never process the same job.** `claim` selects with
 *    `FOR UPDATE SKIP LOCKED` inside a transaction: a row another worker holds
 *    is skipped rather than waited on, so workers never queue behind each other
 *    and never both get the same row.
 *
 * 2. **Enqueueing twice is a no-op.** A partial unique index permits at most one
 *    `queued`/`processing` job per document per type, so a user clicking twice
 *    cannot cost two runs of a seconds-long job. A completed or failed job does
 *    not block a later re-run.
 */

import type { Sql } from '../db/client.js';

export type JobType = 'ocr';
export type JobStatus = 'queued' | 'processing' | 'completed' | 'failed';

export interface Job {
  readonly id: string;
  readonly jobType: JobType;
  readonly documentId: string;
  readonly status: JobStatus;
  readonly attempts: number;
  readonly maxAttempts: number;
}

export const DEFAULT_MAX_ATTEMPTS = 3;

/**
 * Backoff before a failed attempt is retried.
 *
 * Deliberately minutes, not seconds. A failing OCR job is usually failing for a
 * reason that will not have changed a second later — a missing binary, a broken
 * file — and hammering it wastes a worker that could be doing real work.
 */
export function retryDelayMs(attempts: number): number {
  return Math.min(60_000 * 2 ** Math.max(attempts - 1, 0), 15 * 60_000);
}

export interface EnqueueResult {
  readonly job: Job | null;
  /** True when an active job already existed, so nothing new was created. */
  readonly alreadyQueued: boolean;
}

/**
 * Enqueues a job, or reports that one is already active.
 *
 * `ON CONFLICT DO NOTHING` against the partial unique index makes this
 * idempotent at the database rather than in a check-then-insert, which would
 * race two concurrent requests into two jobs.
 */
export async function enqueue(
  sql: Sql,
  jobType: JobType,
  documentId: string,
): Promise<EnqueueResult> {
  const rows = await sql<
    {
      id: string;
      job_type: JobType;
      document_id: string;
      status: JobStatus;
      attempts: number;
      max_attempts: number;
    }[]
  >`
    INSERT INTO jobs (job_type, document_id)
    VALUES (${jobType}, ${documentId}::uuid)
    ON CONFLICT DO NOTHING
    RETURNING id::text, job_type, document_id::text, status, attempts, max_attempts
  `;

  const row = rows[0];
  if (row === undefined) {
    const existing = await findActive(sql, jobType, documentId);
    return { job: existing, alreadyQueued: true };
  }
  return { job: toJob(row), alreadyQueued: false };
}

export async function findActive(
  sql: Sql,
  jobType: JobType,
  documentId: string,
): Promise<Job | null> {
  const rows = await sql`
    SELECT id::text, job_type, document_id::text, status, attempts, max_attempts
    FROM jobs
    WHERE document_id = ${documentId}::uuid
      AND job_type = ${jobType}
      AND status IN ('queued', 'processing')
  `;
  const row = rows[0];
  return row === undefined ? null : toJob(row as never);
}

/**
 * Claims one runnable job, atomically.
 *
 * `SKIP LOCKED` is the whole mechanism: concurrent claimants step over rows
 * that are already locked instead of blocking on them, so N workers pull N
 * distinct jobs with no coordination and no broker.
 *
 * `run_after` implements backoff — a job that failed recently is invisible
 * until its delay has elapsed.
 */
export async function claim(sql: Sql, jobType: JobType, workerId: string): Promise<Job | null> {
  const claimed = await sql.begin(async (tx) => {
    const candidates = await tx<{ id: string }[]>`
      SELECT id FROM jobs
      WHERE job_type = ${jobType}
        AND status = 'queued'
        AND run_after <= now()
      ORDER BY run_after, created_at
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    `;

    const candidate = candidates[0];
    if (candidate === undefined) return null;

    const updated = await tx`
      UPDATE jobs
         SET status = 'processing',
             attempts = attempts + 1,
             worker_id = ${workerId},
             started_at = now()
       WHERE id = ${candidate.id}
      RETURNING id::text, job_type, document_id::text, status, attempts, max_attempts
    `;
    return updated[0] ?? null;
  });

  return claimed === null ? null : toJob(claimed as never);
}

export async function complete(sql: Sql, jobId: string): Promise<void> {
  await sql`
    UPDATE jobs
       SET status = 'completed', completed_at = now(), error = NULL
     WHERE id = ${jobId}::uuid
  `;
}

/**
 * Records a failure and decides whether to retry.
 *
 * A job that has exhausted its attempts becomes `failed` and stays in the table
 * with its error. It is never deleted: a document whose OCR failed must remain
 * visible as such, and silently dropping the job would leave a document stuck
 * in a processing state with no explanation (M5A.3 §5).
 */
export async function fail(sql: Sql, jobId: string, error: string): Promise<'retry' | 'failed'> {
  const rows = await sql<{ attempts: number; max_attempts: number }[]>`
    SELECT attempts, max_attempts FROM jobs WHERE id = ${jobId}::uuid
  `;
  const row = rows[0];
  if (row === undefined) return 'failed';

  const message = error.slice(0, 2000);

  if (row.attempts < row.max_attempts) {
    const delay = retryDelayMs(row.attempts);
    await sql`
      UPDATE jobs
         SET status = 'queued',
             error = ${message},
             worker_id = NULL,
             run_after = now() + make_interval(secs => ${delay / 1000})
       WHERE id = ${jobId}::uuid
    `;
    return 'retry';
  }

  await sql`
    UPDATE jobs
       SET status = 'failed', error = ${message}, completed_at = now()
     WHERE id = ${jobId}::uuid
  `;
  return 'failed';
}

/**
 * Returns jobs stuck in `processing` past a deadline to the queue.
 *
 * A worker killed mid-job leaves its row `processing` forever, and the partial
 * unique index would then block the document from ever being retried. This is
 * the recovery path for that, and it is why the index is scoped to active
 * statuses rather than to all of them.
 */
export async function requeueStalled(sql: Sql, olderThanMs: number): Promise<number> {
  const rows = await sql<{ id: string }[]>`
    UPDATE jobs
       SET status = 'queued', worker_id = NULL, run_after = now()
     WHERE status = 'processing'
       AND started_at < now() - make_interval(secs => ${olderThanMs / 1000})
    RETURNING id
  `;
  return rows.length;
}

function toJob(row: {
  id: string;
  job_type: JobType;
  document_id: string;
  status: JobStatus;
  attempts: number;
  max_attempts: number;
}): Job {
  return {
    id: row.id,
    jobType: row.job_type,
    documentId: row.document_id,
    status: row.status,
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
  };
}
