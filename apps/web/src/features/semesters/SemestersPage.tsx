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
import { useAcademicState } from '../../hooks/useAcademicState.js';
import { metricDisplay } from '../../lib/format.js';
import {
  analyseStrengths,
  sgpaReading,
  graduationProgress,
  subjectPerformance,
  type SemesterView,
  dataCompleteness,
  semesterHistory,
} from '../../domain/academics.js';
import type { SemesterComparison } from '../../domain/academics.js';
import type { SemesterRecord, SemesterStatus } from '../../domain/types.js';
import { asStudentProfileId } from '../../domain/identity.js';
import { PageHeader } from '../../components/AppShell.js';
import { Icon, type IconName } from '../../components/icons.js';
import { EmptyState, Notice, Panel, SelectField, StatusPill } from '../../components/ui/index.js';
import { Bar } from '../../components/ui/layout.js';
import { formatCount, formatGpa } from '../../lib/format.js';
import { newId, nowIso } from '../../lib/id.js';
import { useProfile, useResults, useSemesters } from '../../hooks/useCollection.js';
import { BacklogPanel } from './BacklogPanel.js';
import { SubjectInsights } from './SubjectInsights.js';
import { SemesterSubjects } from './SemesterSubjects.js';
import styles from './semesters.module.css';

const STATUS_LABEL: Record<SemesterStatus, string> = {
  planned: 'Planned',
  in_progress: 'In progress',
  completed: 'Completed',
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

/** How a semester's state is drawn on its card, from the approved design. */
const STATUS_PRESENTATION: Record<
  SemesterStatus,
  { readonly tone: 'neutral' | 'accent' | 'success'; readonly icon: IconName }
> = {
  planned: { tone: 'neutral', icon: 'empty' },
  in_progress: { tone: 'accent', icon: 'compass' },
  completed: { tone: 'success', icon: 'check' },
};

export function SemestersPage() {
  const { profile } = useProfile();
  const { items: results, loading: resultsLoading } = useResults();
  const { items: semesters, save: saveSemester } = useSemesters();
  const [openSemester, setOpenSemester] = useState<number | null>(null);

  const profileId = profile?.id ?? asStudentProfileId('00000000-0000-0000-0000-000000000000');

  /*
   * THE SHARED READING (18). This page built its own views and its own
   * standing; so did the dashboard, and so did the analytics page. Three
   * derivations of one record set is three chances to disagree about the same
   * student's CGPA, and no test catches a disagreement between two files.
   */
  const { statistics } = useAcademicState();
  const views = statistics.views;
  const performances = useMemo(() => subjectPerformance(views), [views]);
  const strengths = useMemo(() => analyseStrengths(performances), [performances]);

  /*
   * The credit requirement is NOT assumed. Nothing in this build establishes a
   * verified total for a scheme, so it is null and the page says so rather
   * than putting a made-up denominator under a real numerator (M6 §13).
   */
  const progress = useMemo(() => graduationProgress(views, null), [views]);
  const history = useMemo(() => semesterHistory(views), [views]);
  const completeness = useMemo(() => dataCompleteness(views), [views]);

  /*
   * The last semester worth putting in a HISTORY: the furthest one that has a
   * result or is being sat. Everything past it is the rest of the degree.
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

  const current = views.find((view) => view.status === 'in_progress') ?? null;
  const graded = statistics.semestersGraded.value ?? 0;
  /*
   * WHAT THE PROGRESS BAR MEASURES, AND WHY IT IS NOT CREDITS.
   *
   * The design fills this bar with credits earned against credits required.
   * GradTools does not have the second number for any scheme — see
   * `graduationProgress`, which returns null and says so — and a bar over an
   * invented denominator is the one thing docs/37 forbids outright. Semesters
   * graded against the eight a degree has is a proportion the record actually
   * supports, and the caption names it rather than letting the bar imply the
   * other one.
   */
  const progressPct = (graded / progress.semestersTotal) * 100;
  const openView = views.find((view) => view.number === openSemester) ?? null;

  const eyebrow =
    [profile?.branch, profile?.schemeId === 'vtu-2022' ? '2022 scheme' : null]
      .filter((part): part is string => part !== undefined && part !== null && part !== '')
      .join(' · ') || null;

  return (
    <div className={styles.page}>
      <PageHeader
        eyebrow="Programme progress"
        title="My degree"
        subtitle={
          eyebrow === null
            ? 'Eight semesters, from the ones behind you to the ones ahead. Everything here stays on this device.'
            : `${eyebrow} · eight semesters, from the ones behind you to the ones ahead.`
        }
      />

      {/* ---- The hero: where this degree stands ------------------------ */}
      <section className={styles.hero} aria-label="Degree standing">
        <div className={styles.heroMain}>
          <div className={styles.heroIdentity}>
            <span className={styles.heroMark} aria-hidden="true">
              <Icon name="degree" size="medium" />
            </span>
            <div className={styles.heroWho}>
              <p className={styles.heroProgramme}>{profile?.branch ?? 'Programme not set'}</p>
              <p className={styles.heroWhere}>
                {current === null
                  ? profile?.currentSemester === null || profile?.currentSemester === undefined
                    ? 'No semester marked as in progress'
                    : `Currently in semester ${String(profile.currentSemester)}`
                  : `Currently in semester ${String(current.number)}`}
              </p>
            </div>
          </div>

          <div className={styles.heroProgress}>
            <div className={styles.heroProgressHead}>
              <span>Semesters graded</span>
              <span className={styles.heroProgressValue}>
                {graded} of {progress.semestersTotal}
              </span>
            </div>
            <span className={styles.heroTrack} aria-hidden="true">
              <span className={styles.heroFill} style={{ inlineSize: `${String(progressPct)}%` }} />
            </span>
            <div className={styles.heroProgressFoot}>
              <span>{metricDisplay(statistics.creditsEarned).value} credits earned</span>
              <span>{progress.reason === null ? '' : 'Credits remaining unknown'}</span>
            </div>
          </div>
        </div>

        <dl className={styles.heroMetrics}>
          <HeroMetric
            label={statistics.cgpaBasis.pending.length > 0 ? 'Average so far' : 'CGPA'}
            value={
              statistics.cgpaBasis.pending.length > 0
                ? metricDisplay(statistics.provisionalCgpa, formatGpa).value
                : metricDisplay(statistics.cgpa, formatGpa).value
            }
            note={statistics.cgpaBasis.pending.length > 0 ? 'Not your CGPA' : 'Credit-weighted'}
          />
          <HeroMetric
            label="Standing"
            value={
              statistics.backlogsFromResults.value === null
                ? 'Unavailable'
                : statistics.backlogsFromResults.value === 0
                  ? 'Clear'
                  : 'To clear'
            }
            note={
              statistics.backlogsFromResults.value === null
                ? 'Backlogs could not be checked'
                : statistics.backlogsFromResults.value === 0
                  ? 'No backlogs'
                  : formatCount(statistics.backlogsFromResults.value, 'backlog')
            }
          />
          <HeroMetric
            label="Credits earned"
            value={metricDisplay(statistics.creditsEarned).value}
            note={`Across ${formatCount(graded, 'graded semester')}`}
          />
          <HeroMetric
            label="Credits left"
            value="Unavailable"
            /* Never a made-up denominator: the reason is the domain's own. */
            note="This scheme's total is not recorded"
          />
        </dl>

        <p className={styles.heroBasis}>{completeness.basis}</p>
        <p className={styles.heroNote}>{progress.reason}</p>
      </section>

      {/* ---- Semester progression -------------------------------------- */}
      <section className={styles.section} aria-label="Semester progression">
        <h2 className={styles.sectionTitle}>Semester progression</h2>
        <ol className={styles.semesterGrid}>
          {views.map((view) => {
            const sgpa = view.sgpaComputed;
            const presentation = STATUS_PRESENTATION[view.status];
            const selected = openSemester === view.number;
            return (
              <li key={view.number}>
                <button
                  type="button"
                  className={styles.semesterCard}
                  data-status={view.status}
                  data-selected={selected ? 'true' : undefined}
                  aria-expanded={selected}
                  /*
                    "S3" is an abbreviation the eye completes and a screen
                    reader does not. The card's name says the semester, its
                    state and its figure, in that order.
                  */
                  aria-label={`Semester ${String(view.number)}, ${STATUS_LABEL[
                    view.status
                  ].toLowerCase()}${sgpa === null ? '' : `, SGPA ${formatGpa(sgpa)}`}`}
                  onClick={() => {
                    setOpenSemester(selected ? null : view.number);
                  }}
                >
                  <span className={styles.semesterCardHead}>
                    <span className={styles.semesterIndex}>S{view.number}</span>
                    <StatusPill tone={presentation.tone} icon={presentation.icon}>
                      {STATUS_LABEL[view.status]}
                    </StatusPill>
                  </span>
                  <span
                    className={styles.semesterFigure}
                    data-absent={sgpa === null ? 'true' : undefined}
                  >
                    {sgpa === null ? (view.result === null ? '·' : '—') : formatGpa(sgpa)}
                  </span>
                  <span className={styles.semesterMeta}>
                    {view.subjectCount > 0
                      ? `${formatCount(view.subjectCount, 'course')} · ${String(view.credits)} cr`
                      : 'Not yet started'}
                  </span>
                  {view.credits > 0 && (
                    <span className={styles.semesterBar} aria-hidden="true">
                      <span
                        data-status={view.status}
                        style={{
                          inlineSize:
                            sgpa === null ? '100%' : `${String(Math.min(100, (sgpa / 10) * 100))}%`,
                        }}
                      />
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ol>

        {/*
          THE SEMESTER A CARD OPENS. One at a time, below the grid, so the
          eight cards stay on one screen — the shape of the degree is the thing
          this section is for, and eight expanded blocks destroy it.
        */}
        {openView !== null && (
          <SemesterDetail
            view={openView}
            profileId={profileId}
            onStatus={(status) => void setStatus(openView, status)}
            onClose={() => {
              setOpenSemester(null);
            }}
          />
        )}
      </section>

      {/* ---- History and standing -------------------------------------- */}
      <div className={styles.twoUp}>
        <Panel title="Semester history">
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
                  HISTORY STOPS AT THE PRESENT. Semesters not yet reached are
                  not gaps in a history — they are the rest of the degree, and
                  the grid above already shows them (M10A §34).
                */}
                {history.entries.slice(0, lastRelevantSemester).map((entry) => (
                  <li className={styles.historyRow} key={entry.number}>
                    <span className={styles.historySemester}>S{entry.number}</span>
                    {entry.sgpa === null ? (
                      /*
                        A semester with no comparable figure says WHY, in the
                        muted colour, and gets no bar. A missing semester is
                        not a low semester (M10A §6).
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
                graded.
              </p>
            </>
          )}
        </Panel>

        <Panel title="Backlog and standing">
          {/*
            THE STATE OF THE RECORD, said once and plainly. The design draws
            the clear case; a real record also has the other two, and each gets
            the same shape in its own tone rather than a red version of a green
            card.
          */}
          <div
            className={styles.standingBlock}
            data-tone={
              statistics.backlogsFromResults.value === null
                ? 'unknown'
                : statistics.backlogsFromResults.value === 0
                  ? 'clear'
                  : 'attention'
            }
          >
            <span className={styles.standingMark} aria-hidden="true">
              <Icon
                name={statistics.backlogsFromResults.value === 0 ? 'check' : 'warning'}
                size="medium"
              />
            </span>
            <div>
              <p className={styles.standingTitle}>
                {statistics.backlogsFromResults.value === null
                  ? 'Backlogs could not be checked'
                  : statistics.backlogsFromResults.value === 0
                    ? 'Clear academic record'
                    : `${formatCount(statistics.backlogsFromResults.value, 'backlog')} to clear`}
              </p>
              <p className={styles.standingBody}>
                {statistics.backlogsFromResults.value === null
                  ? (statistics.backlogsFromResults.reason ??
                    'Some courses cannot be read as passed or failed.')
                  : `${String(statistics.backlogsFromResults.value)}${
                      statistics.backlogsUndetermined > 0 ? ' or more' : ''
                    } across ${formatCount(statistics.grades.total, 'recorded course')}.`}
              </p>
            </div>
          </div>

          {statistics.backlogsUndetermined > 0 && (
            <p className={styles.note}>
              {formatCount(statistics.backlogsUndetermined, 'course')} could not be checked, because
              whether the course has a semester-end exam is not recorded. The count above is a
              floor.
            </p>
          )}

          {/*
            Semesters graded under different regulations cannot honestly be
            averaged into one number without saying so (M6 §6).
          */}
          {statistics.mixedRuleSets && (
            <Notice tone="warning">
              These semesters were graded under more than one set of rules. The combined figures are
              a simplification.
            </Notice>
          )}

          {completeness.gaps.map((gap) => (
            <p className={styles.gap} key={gap}>
              {gap}
            </p>
          ))}
        </Panel>
      </div>

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

/** One of the four figures beside the hero's progress. */
function HeroMetric({
  label,
  value,
  note,
}: {
  readonly label: string;
  readonly value: string;
  readonly note: string;
}) {
  return (
    <div className={`gt-metric ${styles.heroMetric ?? ''}`}>
      <dt>{label}</dt>
      <dd data-absent={/\d/.test(value) ? undefined : 'true'}>
        {value}
        <span>{note}</span>
      </dd>
    </div>
  );
}

/**
 * One semester, opened from its card.
 *
 * Everything the long list used to carry per semester — the status control,
 * the reason an SGPA is missing, the rule-set warnings and the subject list —
 * lives here, for the one semester being looked at.
 */
function SemesterDetail({
  view,
  profileId,
  onStatus,
  onClose,
}: {
  readonly view: SemesterView;
  readonly profileId: ReturnType<typeof asStudentProfileId>;
  readonly onStatus: (status: SemesterStatus) => void;
  readonly onClose: () => void;
}) {
  const sgpa = view.sgpaComputed;
  const reading = sgpaReading(view);

  return (
    <div className={styles.detail} data-status={view.status}>
      <div className={styles.detailHead}>
        <h3 className={styles.detailTitle}>Semester {view.number}</h3>
        <div className={styles.detailActions}>
          <SelectField
            label={`Semester ${String(view.number)} status`}
            hideLabel
            value={view.status}
            onChange={(event) => {
              onStatus(event.target.value as SemesterStatus);
            }}
          >
            <option value="planned">Planned</option>
            <option value="in_progress">In progress</option>
            <option value="completed">Completed</option>
          </SelectField>
          <button type="button" className={styles.linkButton} onClick={onClose}>
            Close
          </button>
        </div>
      </div>

      {/*
        NEVER A BARE DASH. The card above says a figure is absent; this says
        which subjects stopped it and what they are missing, which is the only
        version a student can act on (Phase 7C §13).
      */}
      {sgpa === null && reading.reason !== null && view.result !== null && (
        <p className={styles.note}>{reading.reason}</p>
      )}

      {view.sgpaDisagrees && (
        <p className={styles.disagree}>
          Your grade card says {formatGpa(view.sgpaAsserted ?? 0)}; these grades work out to{' '}
          {formatGpa(sgpa ?? 0)}. Both are shown — check the entry.
        </p>
      )}

      {/*
        A semester read under today's rules rather than its own is said out
        loud: a regulation change must not silently re-grade the past.
      */}
      {view.result !== null && view.ruleSetResolution === 'fallback' && (
        <p className={styles.note}>
          Saved before rule versions were recorded, so it is read under the current rules.
        </p>
      )}

      {/*
        THE RULES THIS SEMESTER WAS GRADED UNDER ARE MISSING. Nothing is
        calculated and nothing is substituted — an SGPA produced under a
        different regulation would look entirely normal and be wrong (M6 §6).
      */}
      {view.ruleSetResolution === 'unavailable' && (
        <Notice tone="warning">
          This semester was graded under rules this version of GradTools does not have (
          {view.missingRuleSetId}). Its SGPA is left blank rather than worked out under the current
          rules.
        </Notice>
      )}

      <SemesterSubjects semester={view.number} profileId={profileId} />
    </div>
  );
}

export { STATUS_LABEL as semesterStatusLabel };
