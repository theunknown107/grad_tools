-- ===========================================================================
-- 0018 — is the monitor working?
-- ===========================================================================
--
-- Authority: Phase 7B.3.1 §63, §66–§69, §124–§125
--
-- Forward-only. 0001–0017 are released and are not edited.
--
-- ---------------------------------------------------------------------------
-- A QUIET SOURCE AND A BROKEN WORKER LOOK IDENTICAL UNTIL SOMEBODY MEASURES
-- ---------------------------------------------------------------------------
--
-- `monitor_runs` records every run including the refused and the empty ones.
-- What it cannot answer at a glance is the question an operator actually has:
-- has this family been checked recently, did the last check succeed, and how
-- many have failed in a row.
--
-- §68 and §69 are the distinction this view exists to preserve. A run that
-- found nothing is a SUCCESS — sources are quiet most of the time, and a
-- monitor that treated silence as failure would cry wolf daily. A run that
-- could not read the source is a FAILURE even though it also found nothing.
-- The two produce the same `discovered = 0` and must never produce the same
-- health.
--
-- `outcome = 'unauthorized'` is deliberately its own thing rather than a
-- failure: while VTU's terms are unreviewed, being refused is the system
-- working exactly as designed, and paging somebody about it every hour would
-- train them to ignore the alert that matters (docs/41).
-- ===========================================================================

CREATE VIEW monitor_health AS
WITH ordered AS (
  SELECT
    family,
    run_id,
    started_at,
    finished_at,
    outcome,
    detail,
    ROW_NUMBER() OVER (PARTITION BY family ORDER BY started_at DESC) AS recency
  FROM monitor_runs
),
/*
 * Consecutive failures are counted from the most recent run BACKWARDS, and
 * stop at the first run that succeeded. "17 failures somewhere in the history"
 * is not an operational fact; "the last 3 in a row failed" is.
 */
streak AS (
  SELECT family, count(*) AS consecutive_failures
  FROM ordered
  WHERE recency <= COALESCE(
    (SELECT min(recency) FROM ordered inner_ok
      WHERE inner_ok.family = ordered.family
        AND inner_ok.outcome IN ('ok', 'unauthorized')) - 1,
    (SELECT max(recency) FROM ordered all_runs WHERE all_runs.family = ordered.family)
  )
  AND outcome NOT IN ('ok', 'unauthorized')
  GROUP BY family
)
SELECT
  ordered.family,
  max(ordered.started_at) FILTER (WHERE ordered.recency = 1) AS last_run_at,
  max(ordered.outcome) FILTER (WHERE ordered.recency = 1) AS last_outcome,
  max(ordered.detail) FILTER (WHERE ordered.recency = 1) AS last_detail,
  max(ordered.started_at) FILTER (WHERE ordered.outcome = 'ok') AS last_success_at,
  max(ordered.started_at) FILTER (WHERE ordered.outcome = 'unauthorized') AS last_refusal_at,
  COALESCE(max(streak.consecutive_failures), 0)::integer AS consecutive_failures,
  count(*)::integer AS runs_recorded
FROM ordered
LEFT JOIN streak ON streak.family = ordered.family
GROUP BY ordered.family;

COMMENT ON VIEW monitor_health IS
  'Per family: when it was last checked, whether that worked, when it last '
  'genuinely succeeded, and how many runs have failed in a row. A run that '
  'found nothing is a success; a run that could not read the source is not '
  '(Phase 7B.3.1 §68, §69).';
