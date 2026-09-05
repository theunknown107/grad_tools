/**
 * The degree — eight semesters, past and ahead.
 *
 * Authority: docs/18 §18.9 · docs/28 · M6 §2, §11, §12, §13
 *
 * ---------------------------------------------------------------------------
 * NO ACADEMIC ARITHMETIC EXISTS IN THIS FILE
 * ---------------------------------------------------------------------------
 * Every SGPA, CGPA and percentage is read from `../../domain/academics.js`,
 * which reads it from `@gradtools/academic-rules`. React multiplies nothing.
 *
 * THE WHOLE DEGREE IS ALWAYS VISIBLE. A student in their third year sees the
 * four semesters behind them, the one they are in, and the three ahead — the
 * shape of the degree does not depend on how much has been typed in (M6 §2).
 *
 * Student-entered text (subject titles, notes) is rendered as TEXT. React
 * escapes it and nothing here uses `dangerouslySetInnerHTML` (docs/13 §T-21).
 */

import { useMemo, useState } from 'react';
import {
  analyseStrengths,
  buildSemesterViews,
  cumulativeStanding,
  graduationProgress,
  subjectPerformance,
  summariseBacklogs,
  type SemesterView,
  dataCompleteness,
  semesterHistory,
} from '../../domain/academics.js';
import type { SemesterComparison } from '../../domain/academics.js';
import type { SemesterRecord, SemesterStatus } from '../../domain/types.js';
import { asStudentProfileId } from '../../domain/identity.js';
import { PageHeader } from '../../components/AppShell.js';
import { MetaPill } from '../../components/ui/tone.js';
import { EmptyState, Notice, Panel, SelectField, StatusPill } from '../../components/ui/index.js';
import { Bar } from '../../components/ui/layout.js';
import { formatCount, formatGpa, formatPercent } from '../../lib/format.js';
import { newId, nowIso } from '../../lib/id.js';
import { useBacklogs, useProfile, useResults, useSemesters } from '../../hooks/useCollection.js';
import { BacklogPanel } from './BacklogPanel.js';
import { SubjectInsights } from './SubjectInsights.js';
import { SemesterSubjects } from './SemesterSubjects.js';
import styles from './semesters.module.css';

const STATUS_LABEL: Record<SemesterStatus, string> = {
  planned: 'Planned',
  in_progress: 'In progress',
  completed: 'Completed',
};

const STATUS_TONE: Record<SemesterStatus, 'neutral' | 'accent' | 'success'> = {
  planned: 'neutral',
  in_progress: 'accent',
  completed: 'success',
};

/** Why a semester carries no comparable figure. Shown verbatim. */
/**
 * Why a semester carries no comparable figure.
 *
 * `no_result` depends on WHERE the student is. The semester being sat has no
 * result because it has not finished, and telling someone mid-semester that
 * their current semester has "no result entered" reads as a gap in their
 * records rather than as the normal state of the present (M10A §19).
 */
function absenceLabel(entry: SemesterComparison): string {
  if (entry.excluded === 'ruleset_unavailable') return 'Rule set unavailable';
  if (entry.excluded === 'not_gradeable') return 'Could not be graded';
  return entry.status === 'in_progress' ? 'In progress' : 'No result entered';
}

/** A signed change, so a student can read direction without the colour. */
function formatDelta(delta: number): string {
  if (Math.abs(delta) < 0.005) return 'no change';
  return `${delta > 0 ? '+' : '\u2212'}${Math.abs(delta).toFixed(2)}`;
}

function directionOf(delta: number | null): 'up' | 'down' | 'flat' | 'none' {
  if (delta === null) return 'none';
  if (Math.abs(delta) < 0.005) return 'flat';
  return delta > 0 ? 'up' : 'down';
}

export function SemestersPage() {
  const { profile } = useProfile();
  const { items: results, loading: resultsLoading } = useResults();
  const { items: semesters, save: saveSemester } = useSemesters();
  const { items: backlogs } = useBacklogs();
  const [openSemester, setOpenSemester] = useState<number | null>(null);

  const profileId = profile?.id ?? asStudentProfileId('00000000-0000-0000-0000-000000000000');

  const views = useMemo(() => buildSemesterViews(semesters, results), [semesters, results]);
  const standing = useMemo(() => cumulativeStanding(views), [views]);
  const performances = useMemo(() => subjectPerformance(views), [views]);
  const strengths = useMemo(() => analyseStrengths(performances), [performances]);
  const backlogSummary = useMemo(() => summariseBacklogs(backlogs), [backlogs]);

  /*
   * The credit requirement is NOT assumed. Nothing in this build establishes a
   * verified total for a scheme, so it is null and the panel says so rather
   * than putting a made-up denominator under a real numerator (M6 §13).
   */
  const progress = useMemo(() => graduationProgress(views, null), [views]);
  const history = useMemo(() => semesterHistory(views), [views]);
  const completeness = useMemo(() => dataCompleteness(views), [views]);

  /*
   * The last semester worth putting in a HISTORY: the furthest one that has a
   * result or is being sat. Everything past it is the rest of the degree, and
   * the Semesters panel below is where the future belongs.
   */
  const lastRelevantSemester = useMemo(() => {
    const reached = views.filter((view) => view.result !== null || view.status !== 'planned');
    return reached.length === 0 ? 0 : Math.max(...reached.map((view) => view.number));
  }, [views]);

  async function setStatus(view: SemesterView, status: SemesterStatus) {
    const existing = semesters.find((candidate) => candidate.number === view.number);
    const record: SemesterRecord = {
      id: existing?.id ?? newId(),
      profileId,
      number: view.number,
      status,
      startedOn: existing?.startedOn ?? null,
      completedOn: existing?.completedOn ?? null,
      updatedAt: nowIso(),
    };
    await saveSemester(record);

    /*
     * At most one semester runs at a time. Standing the others down here means
     * the student never has to tidy up after themselves, and no screen has to
     * cope with two "current" semesters.
     */
    if (status === 'in_progress') {
      for (const other of semesters) {
        if (other.number !== view.number && other.status === 'in_progress') {
          await saveSemester({ ...other, status: 'planned', updatedAt: nowIso() });
        }
      }
    }
  }

  const maxSgpa = 10;

  return (
    <div className={styles.page}>
      <PageHeader
        title="My degree"
        subtitle="Eight semesters, from the ones behind you to the ones ahead. Everything here stays on this device."
        pills={
          <>
            <MetaPill>{`${String(standing.semestersCompleted)} of 8 done`}</MetaPill>
            {standing.cgpa !== null && <MetaPill>CGPA {formatGpa(standing.cgpa)}</MetaPill>}
            {standing.creditsCompleted > 0 && (
              <MetaPill>{formatCount(standing.creditsCompleted, 'credit')}</MetaPill>
            )}
          </>
        }
      />

      {/* ---- Standing ------------------------------------------------- */}
      <Panel title="Where you stand">
        <dl className={styles.standing}>
          <div>
            <dt>CGPA</dt>
            <dd>{standing.cgpa === null ? '—' : formatGpa(standing.cgpa)}</dd>
          </div>
          <div>
            <dt>Percentage</dt>
            <dd>{standing.percentage === null ? '—' : formatPercent(standing.percentage)}</dd>
          </div>
          <div>
            <dt>Credits earned</dt>
            <dd>{standing.creditsCompleted}</dd>
          </div>
          <div>
            <dt>Semesters done</dt>
            <dd>
              {standing.semestersCompleted} of {progress.semestersTotal}
            </dd>
          </div>
          <div>
            <dt>Backlogs</dt>
            <dd>{backlogSummary.outstanding}</dd>
          </div>
        </dl>

        {/*
          WHAT THESE FIGURES REST ON (M10A §19). A CGPA of 7.85 means something
          different across four semesters than across one, and a student cannot
          tell which they are looking at unless the page says.
        */}
        <p className={styles.basis}>{completeness.basis}</p>

        {completeness.gaps.map((gap) => (
          <p className={styles.gap} key={gap}>
            {gap}
          </p>
        ))}

        {standing.reason !== null && <p className={styles.note}>{standing.reason}</p>}

        {/*
          Semesters graded under different regulations cannot honestly be
          averaged into one number without saying so (M6 §6).
        */}
        {standing.mixedRuleSets && (
          <Notice tone="warning">
            These semesters were graded under more than one set of rules. The combined figures are a
            simplification.
          </Notice>
        )}

        {/* The remainder is unknown, and the panel says which part is unknown. */}
        <p className={styles.note}>
          {progress.creditsRequired === null
            ? progress.reason
            : `${String(progress.creditsRemaining)} credits remaining of ${String(progress.creditsRequired)}.`}
        </p>
      </Panel>

      {/* ---- Semester history ------------------------------------------ */}
      {/*
        A TREND ONLY WHERE THERE IS SOMETHING TO TREND (M10A §7). Below two
        comparable semesters this is one sentence saying so, not a line drawn
        through a single point.

        The bars are proportional to the ten-point scale and carry no axis: they
        are there so the shape of four numbers is visible at a glance, and the
        numbers themselves are always beside them. No chart library (OQ-040).
      */}
      {/* Quiet: the trend is context for the figures above, not a peer of
          them. Glass on every region marks no hierarchy at all (ui §7). */}
      <Panel title="Semester history" material="quiet">
        {!history.available ? (
          <p className={styles.note}>{history.reason}</p>
        ) : (
          <>
            {history.mixedRuleSets && (
              <Notice tone="warning">
                These semesters were graded under more than one set of rules, so comparing their
                SGPAs is a simplification.
              </Notice>
            )}
            <ol className={styles.historyList}>
              {/*
                HISTORY STOPS AT THE PRESENT. Semesters not yet reached are not
                gaps in a history — they are the rest of the degree. Listing
                them here would pad the panel with empty rows (M10A §34).
              */}
              {history.entries.slice(0, lastRelevantSemester).map((entry) => (
                <li className={styles.historyRow} key={entry.number}>
                  <span className={styles.historySemester}>S{entry.number}</span>

                  {entry.sgpa === null ? (
                    /*
                      A semester with no comparable figure says WHY, in the muted
                      colour, and gets no bar. A missing semester is not a low
                      semester (M10A §6).
                    */
                    <span className={styles.historyAbsent}>{absenceLabel(entry)}</span>
                  ) : (
                    <>
                      <span className={styles.historySgpa}>{formatGpa(entry.sgpa)}</span>
                      <span className={styles.historyBar}>
                        <Bar
                          value={(entry.sgpa / 10) * 100}
                          label={`Semester ${String(entry.number)} SGPA`}
                        />
                      </span>
                      <span
                        className={styles.historyDelta}
                        data-direction={directionOf(entry.delta)}
                      >
                        {entry.delta === null ? '' : formatDelta(entry.delta)}
                      </span>
                      <span className={styles.historyMark}>
                        {entry.isHighest ? 'Highest' : entry.isLowest ? 'Lowest' : ''}
                      </span>
                    </>
                  )}
                </li>
              ))}
            </ol>
            <p className={styles.note}>
              Change is measured against the semester immediately before, and only when both were
              graded. SGPA is the figure computed from your subjects.
            </p>
          </>
        )}
      </Panel>

      {/* ---- The eight semesters --------------------------------------- */}
      {/* Quiet, because each semester inside it is already its own raised
          surface — glass here put cards inside cards. */}
      <Panel title="Semesters" material="quiet">
        <p className={styles.note}>
          Set where you are. A semester with a saved result counts as completed.
        </p>

        {/*
          -------------------------------------------------------------------
          M9.6E: THE DEGREE IS A JOURNEY, SO SHOW IT AS ONE
          -------------------------------------------------------------------

          This page listed eight equally-weighted blocks stacked vertically,
          which answers "what is semester 6" but never "where am I". The spine
          answers the second question in one glance and is the primary control:
          picking a node selects the semester whose detail is shown below.

          Each node carries its own state and its SGPA. Height encodes the
          SGPA across the PASSING range 4-10 rather than 0-10 — below 4 a
          course is failed, so the bottom 40% of a 0-10 scale is a region no
          real reading can occupy.

          No gamification (§9): no levels, no badges, no streaks. A node is a
          semester, its fill is a grade point, and the current one is lit.
        */}
        <ol className={styles.spine} aria-label="Semester progression">
          {views.map((view) => {
            const sgpa = view.sgpaComputed;
            const selected = openSemester === view.number;
            return (
              <li key={`node-${String(view.number)}`}>
                <button
                  type="button"
                  className={styles.spineNode}
                  data-status={view.status}
                  data-selected={selected}
                  aria-pressed={selected}
                  aria-label={`Semester ${String(view.number)}, ${STATUS_LABEL[view.status]}${
                    sgpa === null ? '' : `, SGPA ${formatGpa(sgpa)}`
                  }`}
                  onClick={() => setOpenSemester(selected ? null : view.number)}
                >
                  <span className={styles.spineTrack} aria-hidden="true">
                    <span
                      className={styles.spineFill}
                      style={{
                        blockSize:
                          sgpa === null
                            ? '0%'
                            : `${String(Math.max(6, Math.min(100, ((sgpa - 4) / 6) * 100)))}%`,
                      }}
                    />
                  </span>
                  <span className={styles.spineLabel}>S{view.number}</span>
                </button>
              </li>
            );
          })}
        </ol>

        <ul className={styles.semesterList}>
          {views.map((view) => {
            const sgpa = view.sgpaComputed;
            const isOpen = openSemester === view.number;
            return (
              <li key={view.number}>
                <div className={styles.semester} data-status={view.status}>
                  <div className={styles.semesterHead}>
                    <h3 className={styles.semesterName}>Semester {view.number}</h3>
                    <StatusPill tone={STATUS_TONE[view.status]}>
                      {STATUS_LABEL[view.status]}
                    </StatusPill>
                  </div>

                  {/*
                    A bar per semester rather than a chart library: the only
                    comparison worth making is between the student's own
                    semesters, and a row of bars shows it without a dependency
                    (docs/05 §5.12).
                  */}
                  <div className={styles.sgpaRow}>
                    <span className={styles.sgpaValue}>
                      {sgpa === null ? '—' : formatGpa(sgpa)}
                    </span>
                    <span
                      className={styles.sgpaTrack}
                      role="img"
                      aria-label={
                        sgpa === null
                          ? `Semester ${String(view.number)}: no SGPA yet`
                          : `Semester ${String(view.number)}: SGPA ${formatGpa(sgpa)} of 10`
                      }
                    >
                      <span
                        className={styles.sgpaFill}
                        style={{ width: `${String(((sgpa ?? 0) / maxSgpa) * 100)}%` }}
                      />
                    </span>
                    <span className={styles.semesterMeta}>
                      {view.subjectCount > 0
                        ? `${String(view.subjectCount)} subjects · ${String(view.credits)} credits`
                        : 'No result entered'}
                    </span>
                  </div>

                  {view.sgpaDisagrees && (
                    <p className={styles.disagree}>
                      Your grade card says {formatGpa(view.sgpaAsserted ?? 0)}; these grades work
                      out to {formatGpa(sgpa ?? 0)}. Both are shown — check the entry.
                    </p>
                  )}

                  {/*
                    A semester read under today's rules rather than its own is
                    said out loud: a regulation change must not silently
                    re-grade the past.
                  */}
                  {view.result !== null && view.ruleSetResolution === 'fallback' && (
                    <p className={styles.note}>
                      Saved before rule versions were recorded, so it is read under the current
                      rules.
                    </p>
                  )}

                  {/*
                    THE RULES THIS SEMESTER WAS GRADED UNDER ARE MISSING. Nothing
                    is calculated and nothing is substituted - an SGPA produced
                    under a different regulation would look entirely normal and
                    be wrong (M6 section 6).
                  */}
                  {view.ruleSetResolution === 'unavailable' && (
                    <Notice tone="warning">
                      This semester was graded under rules this version of GradTools does not have (
                      {view.missingRuleSetId}). Its SGPA is left blank rather than worked out under
                      the current rules.
                    </Notice>
                  )}

                  <div className={styles.semesterActions}>
                    <SelectField
                      label={`Semester ${String(view.number)} status`}
                      hideLabel
                      value={view.status}
                      onChange={(event) => {
                        void setStatus(view, event.target.value as SemesterStatus);
                      }}
                    >
                      <option value="planned">Planned</option>
                      <option value="in_progress">In progress</option>
                      <option value="completed">Completed</option>
                    </SelectField>
                    <button
                      type="button"
                      className={styles.linkButton}
                      aria-expanded={isOpen}
                      onClick={() => {
                        setOpenSemester(isOpen ? null : view.number);
                      }}
                    >
                      {isOpen ? 'Hide subjects' : 'Subjects'}
                    </button>
                  </div>

                  {isOpen && <SemesterSubjects semester={view.number} profileId={profileId} />}
                </div>
              </li>
            );
          })}
        </ul>
      </Panel>

      {/* ---- Subjects --------------------------------------------------- */}
      <SubjectInsights performances={performances} strengths={strengths} loading={resultsLoading} />

      {/* ---- Backlogs --------------------------------------------------- */}
      <BacklogPanel profileId={profileId} />

      {results.length === 0 && !resultsLoading && (
        <EmptyState>
          Nothing here yet. Add a semester result on the Results page and this fills in.
        </EmptyState>
      )}
    </div>
  );
}

export { STATUS_LABEL as semesterStatusLabel };
