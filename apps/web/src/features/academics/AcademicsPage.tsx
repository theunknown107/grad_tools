/**
 * SGPA and CGPA calculators.
 *
 * Authority: docs/03 UF-04/UF-05, docs/16 §16.8, M3 continuation §15-§16.
 *
 * ---------------------------------------------------------------------------
 * NO ACADEMIC ARITHMETIC EXISTS IN THIS FILE.
 * ---------------------------------------------------------------------------
 * Every displayed number comes from @gradtools/academic-rules, resolved
 * against an explicit RuleSet. In particular the percentage conversion is NOT
 * implemented here: `calculatePercentage` applies the rule set's
 * `cgpa_x_10` formula (22OB 6.7). React never multiplies a CGPA by anything.
 */

import { useMemo, useState, type ReactNode } from 'react';
import {
  calculateCGPA,
  calculateClass,
  calculatePercentage,
  calculateRequiredMarks,
  calculateRequiredSGPA,
  calculateSGPA,
  vtu2022RuleSet,
  type BindingConstraint,
  type CourseGrade,
  type MarksTarget,
  type SemesterSummary,
} from '@gradtools/academic-rules';
import { Link } from 'react-router-dom';
import { PageHeader } from '../../components/AppShell.js';
import { MetaPill } from '../../components/ui/tone.js';
import { Tooltip } from '../../components/ui/Tooltip.js';
import { IslandTabs, IslandTabGroup, IslandTabPanel } from '../../components/ui/IslandTabs.js';
import { MetricStrip } from '../../components/ui/layout.js';
import { SgpaTrend, type SemesterPoint } from '../../components/SgpaTrend.js';
import { dataCompleteness } from '../../domain/academics.js';
import { Icon } from '../../components/icons.js';
import {
  EmptyState,
  Button,
  buttonClassName,
  ExplanationDisclosure,
  Notice,
  Panel,
  SelectField,
  StatusPill,
  TextField,
} from '../../components/ui/index.js';
import { formatCount, formatGpa, formatPercent, metricDisplay } from '../../lib/format.js';
import { newId } from '../../lib/id.js';
import { semesterSgpa } from '../../domain/results.js';
import { useAcademicState } from '../../hooks/useAcademicState.js';
import {
  OUTCOME_LABEL,
  type CourseOutcome,
  type GradeDistribution,
} from '../../domain/statistics.js';
import { metricStripEntry } from '../../lib/format.js';
import { useResults } from '../../hooks/useCollection.js';
import styles from './academics.module.css';

const ruleSet = vtu2022RuleSet;

/** Which of 22OB 6.3's three simultaneous thresholds decides the answer. */
const BINDING_LABEL: Record<BindingConstraint, string> = {
  see_minimum: 'the minimum mark the exam head itself requires',
  overall_target: 'the total the course needs overall',
};

/** Credit values a VTU course can carry. A select, not free text. */
const CREDIT_OPTIONS = [0.5, 1, 1.5, 2, 3, 4, 5] as const;

interface CourseRow {
  readonly id: string;
  readonly subjectCode: string;
  readonly credits: string;
  readonly gradeLetter: string;
}

function blankRow(): CourseRow {
  return { id: newId(), subjectCode: '', credits: '4', gradeLetter: 'A' };
}

export function AcademicsPage() {
  const [view, setView] = useState('yours');
  return (
    <>
      <PageHeader
        eyebrow="Academic performance"
        title="SGPA & CGPA"
        subtitle="Every figure is computed by the shared rules engine against the VTU 2022 regulation, and every one can show its working."
        /* The regulation is a fact about the page; the figures belong to the
           panels below, which own the data. No count is invented here. */
        pills={<MetaPill>VTU 2022 regulation</MetaPill>}
        /*
          The design gives this page one action, and it is the action that
          makes the figures exist. A student whose CGPA is unavailable is one
          result away from having one.
        */
        action={
          <Link className={buttonClassName('primary')} to="/import">
            <Icon name="plus" size="nav" />
            Add result
          </Link>
        }
      />
      {/*
        -------------------------------------------------------------------
        M9.6F: YOUR FIGURES FIRST, THE CALCULATOR SECOND
        -------------------------------------------------------------------

        The page was two blank calculators stacked on top of each other. But a
        student who has entered their results already HAS an SGPA and a CGPA —
        and this page, named after those two figures, made them type everything
        again to see one.

        So the page leads with what GradTools already knows: cumulative
        standing, the trend across eight semesters, and what those figures rest
        on. The calculators remain, one tab away, because they answer a
        different and still-real question — "what would I get if…" — for a
        semester that has not happened yet.
      */}
      {/*
        ONE RADIX ROOT OVER THE LIST AND ITS PANELS.
        
        The panels are no longer chosen by a ternary: `Tabs.Content` mounts only
        the active one itself, and it is what generates the matching
        `aria-controls` / `aria-labelledby` pair. Selecting by hand meant the
        inactive panel's id was referenced by a tab pointing at nothing.
      */}
      <IslandTabGroup value={view} onChange={setView}>
        <IslandTabs
          label="Figures"
          value={view}
          onChange={setView}
          tabs={[
            { id: 'yours', label: 'Your figures' },
            { id: 'calculator', label: 'Calculator' },
          ]}
        />

        <IslandTabPanel id="yours">
          <YourFigures />
        </IslandTabPanel>
        <IslandTabPanel id="calculator">
          <CalculatorPanel />
        </IslandTabPanel>
      </IslandTabGroup>
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Rendering a derived figure                                                 */
/* -------------------------------------------------------------------------- */

/**
 * The outcomes worth a row, in the order a student would read them.
 *
 * `unresolved` comes last because it is a task rather than a result, and
 * every one of the seven between "failed" and it is a state the regulation
 * names that is neither a pass nor a failure (8).
 */
const OUTCOME_ORDER: readonly CourseOutcome[] = [
  'passed',
  'failed',
  'absent',
  'attendance_shortage',
  'incomplete',
  'withdrawn',
  'audit',
  'non_credit_passed',
  'non_credit_not_passed',
  'unresolved',
];

/**
 * How many courses took each grade.
 *
 * Bars rather than a chart library: the only comparison worth making is
 * between the student's own counts, and a row of bars shows it without a
 * dependency (docs/05 5.12).
 */
function GradeDistributionRows({ grades }: { readonly grades: GradeDistribution }) {
  const rows = [
    ...grades.bands.map((band) => ({
      key: band.letter,
      label: band.letter,
      count: band.count,
      title: undefined as string | undefined,
    })),
    ...grades.specials
      .filter((special) => special.count > 0)
      .map((special) => ({
        key: special.letter,
        label: special.letter,
        count: special.count,
        title: special.meaning,
      })),
    ...(grades.unresolved > 0
      ? [
          {
            key: 'unresolved',
            label: 'Unresolved',
            count: grades.unresolved,
            /*
              NEVER FOLDED INTO A LETTER (7). Counting these as F would invent
              failures and counting them as P would invent passes; leaving them
              out would make the rows not add up to the courses on screen.
            */
            title: 'These courses have no grade this build can resolve yet.' as string | undefined,
          },
        ]
      : []),
  ];

  const peak = Math.max(1, ...rows.map((row) => row.count));

  return (
    <ul className={styles.gradeRows}>
      {rows.map((row, index) => (
        /*
          THE CHART FAMILY, not one flat colour. Every bar was `--accent`, so
          the distribution read as one block; the approved design walks a
          single-hue luminance ramp across the series. Because the ramp is
          derived from the accent, Mono resolves it to grayscale and no theme
          can produce a rainbow.
        */
        <li
          className={styles.gradeRow}
          key={row.key}
          data-zero={row.count === 0}
          data-series={Math.min(index + 1, 5)}
        >
          <span className={styles.gradeLetter} title={row.title}>
            {row.label}
          </span>
          <span
            className={styles.gradeTrack}
            role="img"
            aria-label={`${row.label}: ${String(row.count)} of ${String(grades.total)} courses`}
          >
            <span
              className={styles.gradeFill}
              style={{ inlineSize: `${String((row.count / peak) * 100)}%` }}
            />
          </span>
          <span className={styles.gradeCount}>{row.count}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * The hero figure, as the approved design sets it.
 *
 * ONE CARD, THREE STATES, AND THEY ARE NOT THE SAME SENTENCE (§5):
 *
 *   complete     the CGPA, credit-weighted across every completed semester;
 *   partial      "Average so far", said explicitly not to be the CGPA, with
 *                the semesters that are holding it back named;
 *   unavailable  the word, and the reason, and never a figure.
 *
 * The distinction is the domain's, not this component's: `statistics.cgpa` is
 * unresolved the moment a semester that ought to count cannot, and
 * `provisionalCgpa` is the figure over what HAS resolved. Nothing here decides
 * which is which, and nothing here averages anything.
 */
function StandingHero() {
  const { statistics } = useAcademicState();
  const pending = statistics.cgpaBasis.pending;
  const partial = pending.length > 0;
  const figure = partial ? statistics.provisionalCgpa : statistics.cgpa;
  const shown = metricDisplay(figure, formatGpa);

  return (
    <section className={styles.hero} aria-label={partial ? 'Average so far' : 'Cumulative CGPA'}>
      <span className={styles.heroBadge}>
        {partial ? (
          <StatusPill tone="warning">Not your CGPA</StatusPill>
        ) : (
          <StatusPill tone="success">Credit-weighted</StatusPill>
        )}
      </span>

      {/*
        THE UNAVAILABLE CGPA IS STATED, NOT IMPLIED. The design puts this above
        the figure that CAN be computed, so a student never reads the smaller
        number as the bigger one.
      */}
      {partial && (
        <p className={styles.heroPending}>
          <Icon name="warning" size="small" />
          Cumulative CGPA unavailable
        </p>
      )}

      <p className={styles.heroLabel}>{partial ? 'Average so far' : 'Cumulative CGPA'}</p>
      {/* A word is not a figure: "Unavailable" is set as a sentence, not at
          68px where a number belongs. The shape of the value decides. */}
      <p className={styles.heroValue} data-absent={/\d/.test(shown.value) ? undefined : 'true'}>
        {shown.value}
      </p>

      <p className={styles.heroNote}>
        <Icon name="info" size="small" />
        <span>
          {partial ? (
            <>
              Across {String(statistics.cgpaBasis.counted)} of{' '}
              {String(statistics.cgpaBasis.counted + pending.length)} completed semesters — a
              credit-weighted average of what has resolved, which is not the same figure as your
              CGPA.
            </>
          ) : (
            <>
              CGPA is calculated across every completed semester.{' '}
              <Tooltip content="Σ(SGPA × credits) ÷ Σ credits — weighted by the credits each semester carried. Clause 22OB 6.6.">
                <span className={styles.formula} tabIndex={0}>
                  formula
                </span>
              </Tooltip>
            </>
          )}
        </span>
      </p>

      {/* The reason, verbatim from the domain — it names the semesters. */}
      {figure.reason !== null && <p className={styles.heroReason}>{figure.reason}</p>}

      <dl className={styles.heroStats}>
        <MiniStat
          label="Latest SGPA"
          value={
            statistics.latestSgpa.value === null
              ? 'Unavailable'
              : formatGpa(statistics.latestSgpa.value.sgpa)
          }
        />
        <MiniStat label="Credits" value={metricDisplay(statistics.creditsEarned).value} />
        <MiniStat label="Backlogs" value={metricDisplay(statistics.backlogsFromResults).value} />
      </dl>
    </section>
  );
}

/** One of the three small figures under the hero. */
function MiniStat({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div className={styles.miniStat}>
      <dt>{label}</dt>
      <dd data-absent={/\d/.test(value) ? undefined : 'true'}>{value}</dd>
    </div>
  );
}

/**
 * Every graded semester, largest figure last — the design's SGPA history.
 *
 * The bar is the SGPA against the ten-point scale, which is what the design
 * draws. A semester with no computable SGPA keeps its row and says so, because
 * dropping it would make the history look shorter than the degree.
 */
function SgpaHistory() {
  const { statistics } = useAcademicState();
  const entries = statistics.semesters.filter((entry) => entry.hasResult);
  if (entries.length === 0) return null;

  return (
    <Panel title="SGPA history" flush>
      <ol className={styles.history}>
        {entries.map((entry) => {
          const sgpa = entry.sgpa.value;
          return (
            <li className={styles.historyRow} key={entry.number}>
              <span className={styles.historyTile}>S{entry.number}</span>
              <span className={styles.historyBody}>
                <span className={styles.historyName}>Semester {entry.number}</span>
                <span className={styles.historyMeta}>
                  {formatCount(entry.courseCount, 'course')}
                  {(entry.creditsAttempted.value ?? 0) > 0
                    ? ` · ${String(entry.creditsAttempted.value ?? 0)} credits`
                    : ''}
                </span>
              </span>
              <span className={styles.historyBar} aria-hidden="true">
                <span style={{ inlineSize: `${String(((sgpa ?? 0) / 10) * 100)}%` }} />
              </span>
              <span
                className={styles.historyFigure}
                data-absent={sgpa === null ? 'true' : undefined}
                title={entry.sgpa.reason ?? undefined}
              >
                {sgpa === null ? 'Unavailable' : formatGpa(sgpa)}
              </span>
            </li>
          );
        })}
      </ol>
    </Panel>
  );
}

function YourFigures() {
  /*
   * THE SHARED READING (18). This component used to build its own semester
   * views and its own standing, which is how the analytics page and the degree
   * page came to be two answers to one question.
   */
  const { statistics } = useAcademicState();
  const views = statistics.views;
  const completeness = useMemo(() => dataCompleteness(views), [views]);

  const points: readonly SemesterPoint[] = useMemo(
    () =>
      statistics.trend.map((point) => ({
        semester: point.semester,
        sgpa: point.sgpa,
        /* The second series the design draws, from the rules engine (§11). */
        cgpaSoFar: point.cgpaSoFar,
        state:
          point.sgpa !== null
            ? ('graded' as const)
            : views.find((view) => view.number === point.semester)?.status === 'in_progress'
              ? ('in_progress' as const)
              : ('planned' as const),
      })),
    [statistics.trend, views],
  );

  /*
   * EMPTY AND UNGRADEABLE ARE DIFFERENT (17).
   *
   * This page used to show "No figures yet — save a semester result" whenever
   * nothing was graded. A student who HAD saved four semesters, none of which
   * could be graded because their subjects carried no credits, was told to do
   * the thing they had already done, and never learnt what was actually
   * missing. Only a genuinely empty record gets the invitation; a record that
   * exists gets its figures and its reasons, however few of each there are.
   */
  if (!statistics.hasAnyResult) {
    return (
      <EmptyState
        title="No calculated figures yet"
        icons={['gpa', 'results', 'degree']}
        action={
          <div className={styles.emptyActions}>
            <Link className={buttonClassName('primary')} to="/import">
              <Icon name="plus" size="nav" />
              Add result
            </Link>
            <Link className={buttonClassName()} to="/results">
              Enter one by hand
            </Link>
          </div>
        }
      >
        Add a semester result to calculate SGPA and CGPA. Your figures update as records are
        confirmed, and the calculator tab works without any saved data.
      </EmptyState>
    );
  }

  return (
    <div className={styles.stack}>
      {/*
        THE STANDING AND ITS SHAPE, SIDE BY SIDE — the design's two-column
        opening. The hero answers "where am I"; the chart answers "how did I
        get here", and the two are read together.
      */}
      <div className={styles.figuresTop}>
        <StandingHero />
        <Panel title="CGPA progression">
          <SgpaTrend points={points} size="tall" />
        </Panel>
      </div>

      <SgpaHistory />

      {/*
        EVERY OTHER FIGURE THE RECORDS SUPPORT, and each one on its own inputs
        (4). An unresolved CGPA no longer takes the credits, the passes and the
        grade distribution down with it — which is what emptied this page.
      */}
      {/*
        CREDITS AND BACKLOGS ARE NOT REPEATED HERE. They are on the hero, three
        inches above, and a figure printed twice on one screen invites a reader
        to check whether the two agree.
      */}
      <MetricStrip
        metrics={[
          metricStripEntry('Percentage', statistics.percentage, formatPercent),
          metricStripEntry('Semesters graded', statistics.semestersGraded),
          {
            label: 'Passed',
            value: String(statistics.outcomes.passed),
            ...(statistics.outcomes.unresolved > 0
              ? { note: `${String(statistics.outcomes.unresolved)} still to review` }
              : {}),
          },
          metricStripEntry('Backlogs recorded', statistics.backlogs),
        ]}
      />

      {/*
        THE GRADE DISTRIBUTION (7). Unresolved courses are counted in their own
        row and in no band: adding them to F would invent failures, and leaving
        them out would make the columns not add up to the courses on screen.
      */}
      {statistics.grades.total > 0 && (
        <Panel title="Grades" material="quiet">
          <GradeDistributionRows grades={statistics.grades} />
        </Panel>
      )}

      {/*
        AND WHAT IS NOT A PASS OR A FAIL (8). An audited course and an absence
        are neither, and reporting them as failures would tell a student to
        re-sit something they did not fail.
      */}
      {OUTCOME_ORDER.some((key) => statistics.outcomes[key] > 0) && (
        <Panel title="Course outcomes" material="quiet">
          <dl className={styles.derived}>
            {OUTCOME_ORDER.filter((key) => statistics.outcomes[key] > 0).map((key) => (
              <div className={styles.derivedItem} key={key}>
                <dt className={styles.derivedLabel}>{OUTCOME_LABEL[key]}</dt>
                <dd>{statistics.outcomes[key]}</dd>
              </div>
            ))}
          </dl>
        </Panel>
      )}

      {/*
        DATA QUALITY (29). Reassurance first: a student whose records are 34
        courses good and one course short should not read a screen that looks
        like a failure.
      */}
      <Panel title="Academic data" material="quiet">
        <dl className={styles.derived}>
          <div className={styles.derivedItem}>
            <dt className={styles.derivedLabel}>Courses imported</dt>
            <dd>{statistics.dataQuality.coursesImported}</dd>
          </div>
          <div className={styles.derivedItem}>
            <dt className={styles.derivedLabel}>Credits resolved</dt>
            <dd>
              {statistics.dataQuality.creditsResolved} of {statistics.dataQuality.coursesImported}
            </dd>
          </div>
          <div className={styles.derivedItem}>
            <dt className={styles.derivedLabel}>Need review</dt>
            <dd>{statistics.dataQuality.coursesNeedingReview}</dd>
          </div>
          {/*
            AVAILABLE AND UNRESOLVED, SIDE BY SIDE (§13). "4 completed" and
            "1 fully resolved" are different facts, and showing only the first
            implies all four carry valid SGPA and CGPA inputs.
          */}
          <div className={styles.derivedItem}>
            <dt className={styles.derivedLabel}>Fully resolved</dt>
            <dd>
              {
                statistics.semesters.filter((entry) => entry.completeness === 'fully_resolved')
                  .length
              }{' '}
              of {statistics.semesters.filter((entry) => entry.hasResult).length} imported
            </dd>
          </div>
        </dl>
        {statistics.dataQuality.notes.map((note) => (
          <p className={styles.gap} key={note}>
            {note}
          </p>
        ))}
      </Panel>

      {/*
        WHAT THE FIGURES REST ON. A CGPA of 7.85 means something different
        across four semesters than across one, and a student cannot tell which
        they are looking at unless the page says (M10A §19).
      */}
      <p className={styles.basis}>{completeness.basis}</p>
      {completeness.gaps.map((gap) => (
        <p className={styles.gap} key={gap}>
          {gap}
        </p>
      ))}
    </div>
  );
}

/**
 * The answer, in the box the approved design gives it.
 *
 * Every calculator ends the same way — a label, the figure, and one line
 * saying what it rests on — so they share the block rather than each drawing
 * their own. A calculator that cannot answer says why in the caption and shows
 * a dash where the figure would be, never a zero.
 */
function AnswerBlock({
  label,
  value,
  caption,
  children,
}: {
  readonly label: string;
  /** Null when the inputs do not support an answer. */
  readonly value: string | null;
  readonly caption: string;
  readonly children?: ReactNode;
}) {
  return (
    <div className={styles.answer}>
      <p className={styles.answerLabel}>{label}</p>
      {value === null ? (
        <p className={styles.answerPlaceholder}>—</p>
      ) : (
        <p className={styles.answerValue}>{value}</p>
      )}
      <p className={styles.answerCaption}>{caption}</p>
      {children}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* The calculator, and how it works                                           */
/* -------------------------------------------------------------------------- */

const CALC_MODES = [
  { id: 'sgpa', label: 'SGPA' },
  { id: 'cgpa', label: 'CGPA' },
  { id: 'required-sgpa', label: 'Required SGPA' },
  { id: 'required-marks', label: 'Required marks' },
] as const;

type CalcMode = (typeof CALC_MODES)[number]['id'];

/**
 * The calculator, as the approved design composes it: one card carrying the
 * mode switch and the active calculator, and a companion card that states the
 * formulas the whole thing runs on.
 *
 * The four modes are the four the rules engine already answers —
 * `calculateSGPA`, `calculateCGPA`, `calculateRequiredSGPA` and
 * `calculateRequiredMarks`. Nothing was added to the engine to fill the row,
 * and no arithmetic happens in this file.
 */
function CalculatorPanel() {
  const [mode, setMode] = useState<CalcMode>('sgpa');

  return (
    <div className={styles.calcLayout}>
      {/*
        ITS OWN TAB ROOT, and it has to be. `IslandTabs` renders a bare list
        when a group is already above it, so these four would have become
        triggers of the PAGE's tab group — pressing "CGPA" switched the page
        back to Your figures and unmounted the calculator. Caught in the
        browser, not by a type.
      */}
      <IslandTabGroup
        value={mode}
        onChange={(next) => {
          setMode(next as CalcMode);
        }}
      >
        <div className={styles.calcMain}>
          <IslandTabs
            label="Calculator"
            value={mode}
            onChange={(next) => {
              setMode(next as CalcMode);
            }}
            tabs={CALC_MODES.map((entry) => ({ id: entry.id, label: entry.label }))}
          />
          <IslandTabPanel id="sgpa">
            <SgpaCalculator />
          </IslandTabPanel>
          <IslandTabPanel id="cgpa">
            <CgpaCalculator />
          </IslandTabPanel>
          <IslandTabPanel id="required-sgpa">
            <RequiredSgpaCalculator />
          </IslandTabPanel>
          <IslandTabPanel id="required-marks">
            <RequiredMarksCalculator />
          </IslandTabPanel>
        </div>
      </IslandTabGroup>

      <aside className={styles.calcAside}>
        <Panel title="How it works">
          <p className={styles.asideBody}>
            Every figure is credit-weighted, exactly as the regulation defines it. The engine that
            computes them is the same one your saved results go through.
          </p>
          <dl className={styles.formulaList}>
            <div className={styles.formulaLine}>
              <dt>SGPA</dt>
              <dd>Σ(grade point × credits) ÷ Σ credits</dd>
            </div>
            <div className={styles.formulaLine}>
              <dt>CGPA</dt>
              <dd>Σ(SGPA × semester credits) ÷ Σ credits</dd>
            </div>
            <div className={styles.formulaLine}>
              <dt>Percentage</dt>
              <dd>CGPA × 10 (22OB 6.7)</dd>
            </div>
            <div className={styles.formulaLine}>
              <dt>Grade points</dt>
              <dd>
                {[...ruleSet.gradeBands]
                  .filter((band) => band.points !== null)
                  .map((band) => `${band.letter}=${String(band.points)}`)
                  .join(' · ')}
              </dd>
            </div>
          </dl>
          <p className={styles.asideNote}>
            Figures here are estimates. Nothing is saved to your record — a result becomes part of
            it only when you confirm one on Results or Add document.
          </p>
        </Panel>
      </aside>
    </div>
  );
}

/**
 * The SGPA a coming semester would need for a target CGPA.
 *
 * Every input defaults to what the student's own record already says, so the
 * common case is "type the target, read the answer". `calculateRequiredSGPA`
 * does the arithmetic and reports unreachable targets itself — this never
 * decides that a target is out of range.
 */
function RequiredSgpaCalculator() {
  const { statistics } = useAcademicState();
  const currentCgpa = statistics.cgpa.value ?? statistics.provisionalCgpa.value;
  const creditsDone = statistics.creditsEarned.value;

  const [target, setTarget] = useState('8.00');
  const [current, setCurrent] = useState(currentCgpa === null ? '' : currentCgpa.toFixed(2));
  const [done, setDone] = useState(creditsDone === null ? '' : String(creditsDone));
  const [next, setNext] = useState('21');

  const result = useMemo(
    () =>
      calculateRequiredSGPA(Number(current), Number(done), Number(next), Number(target), ruleSet),
    [current, done, next, target],
  );

  return (
    <Panel title="Required SGPA for a target CGPA">
      <div className={styles.calcFields}>
        <TextField
          label="Target CGPA"
          inputMode="decimal"
          value={target}
          onChange={(event) => {
            setTarget(event.target.value);
          }}
        />
        <TextField
          label="Current CGPA"
          hint={currentCgpa === null ? 'No CGPA in your record yet.' : 'From your record.'}
          inputMode="decimal"
          value={current}
          onChange={(event) => {
            setCurrent(event.target.value);
          }}
        />
        <TextField
          label="Credits completed"
          hint={creditsDone === null ? undefined : 'From your record.'}
          inputMode="numeric"
          value={done}
          onChange={(event) => {
            setDone(event.target.value);
          }}
        />
        <TextField
          label="Credits next semester"
          inputMode="numeric"
          value={next}
          onChange={(event) => {
            setNext(event.target.value);
          }}
        />
      </div>

      {/* The engine's own words when it cannot answer: it knows when a target
          is unreachable and by how much, and rewording that here would lose
          the figure it quotes. */}
      <AnswerBlock
        label="Required SGPA next semester"
        value={result.ok ? formatGpa(result.value) : null}
        caption={
          result.ok
            ? `Score at least this across ${next} credits to reach a CGPA of ${target}.`
            : result.detail
        }
      />

      <ExplanationDisclosure explanation={result.explanation} />
    </Panel>
  );
}

/**
 * What the semester-end exam has to carry.
 *
 * The three thresholds of 22OB 6.3 apply at once, and the engine names which
 * one binds — that is the part a student can act on, so it is shown rather
 * than reduced to a single number.
 */
function RequiredMarksCalculator() {
  const [internal, setInternal] = useState('28');
  const [targetKind, setTargetKind] = useState('pass');

  const target: MarksTarget = useMemo(
    () => (targetKind === 'pass' ? { kind: 'pass' } : { kind: 'grade', letter: targetKind }),
    [targetKind],
  );
  const result = useMemo(
    () => calculateRequiredMarks(Number(internal), target, ruleSet),
    [internal, target],
  );

  return (
    <Panel title="Marks needed in the exam">
      <div className={styles.calcFields}>
        <TextField
          label={`Internal / CIE (of ${String(ruleSet.cieMax)})`}
          inputMode="numeric"
          value={internal}
          onChange={(event) => {
            setInternal(event.target.value);
          }}
        />
        <SelectField
          label="Target"
          value={targetKind}
          onChange={(event) => {
            setTargetKind(event.target.value);
          }}
        >
          <option value="pass">Pass the course</option>
          {ruleSet.gradeBands
            .filter((band) => band.points !== null)
            .map((band) => (
              <option key={band.letter} value={band.letter}>
                Grade {band.letter}
              </option>
            ))}
        </SelectField>
      </div>

      <AnswerBlock
        label="Required in the semester-end exam"
        value={
          result.ok
            ? `${String(result.value.rawSeeRequired)} / ${String(result.value.rawSeeMaximum)}`
            : null
        }
        caption={
          result.ok
            ? `On the exam script. That is ${result.value.printedExternalEquivalent.toFixed(1)} of ${String(result.value.printedExternalMaximum)} in the card's External column — the two scales are different, and confusing them halves or doubles the answer.`
            : result.detail
        }
      >
        {result.ok && (
          <p className={styles.answerCaption}>
            What decides it: {BINDING_LABEL[result.value.bindingConstraint]}.
          </p>
        )}
      </AnswerBlock>

      <ExplanationDisclosure explanation={result.explanation} />
    </Panel>
  );
}

/* -------------------------------------------------------------------------- */
/* SGPA                                                                       */
/* -------------------------------------------------------------------------- */

function SgpaCalculator() {
  const [rows, setRows] = useState<CourseRow[]>(() => [
    blankRow(),
    blankRow(),
    blankRow(),
    blankRow(),
    blankRow(),
  ]);

  const courses: CourseGrade[] = useMemo(
    () =>
      rows
        .filter((row) => row.gradeLetter !== '')
        .map((row) => ({
          credits: Number(row.credits),
          gradeLetter: row.gradeLetter,
          ...(row.subjectCode.trim() === '' ? {} : { subjectCode: row.subjectCode.trim() }),
        })),
    [rows],
  );

  const result = useMemo(() => calculateSGPA(courses, ruleSet), [courses]);

  const update = (id: string, patch: Partial<CourseRow>) => {
    setRows((current) => current.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  };

  const gradeOptions = [...ruleSet.gradeBands, ...ruleSet.specialGrades];

  return (
    <Panel
      title="SGPA for one semester"
      action={
        <Button small onClick={() => setRows((current) => [...current, blankRow()])}>
          <Icon name="plus" size="nav" />
          Add course
        </Button>
      }
      flush
    >
      <div className={styles.rowsHeader} aria-hidden="true">
        <span>Subject code</span>
        <span>Credits</span>
        <span>Grade</span>
        <span />
      </div>

      <ul className={styles.rows}>
        {rows.map((row, index) => (
          <li className={styles.row} key={row.id}>
            <TextField
              label={`Subject code, course ${String(index + 1)}`}
              placeholder="BCS301"
              value={row.subjectCode}
              mono
              onChange={(event) => {
                update(row.id, { subjectCode: event.target.value });
              }}
            />
            <SelectField
              label={`Credits, course ${String(index + 1)}`}
              value={row.credits}
              onChange={(event) => {
                update(row.id, { credits: event.target.value });
              }}
            >
              {CREDIT_OPTIONS.map((credit) => (
                <option key={credit} value={credit}>
                  {credit}
                </option>
              ))}
            </SelectField>
            <SelectField
              label={`Grade, course ${String(index + 1)}`}
              value={row.gradeLetter}
              onChange={(event) => {
                update(row.id, { gradeLetter: event.target.value });
              }}
            >
              {gradeOptions.map((grade) => (
                <option key={grade.letter} value={grade.letter}>
                  {'points' in grade && grade.points !== null
                    ? `${grade.letter} (${String(grade.points)} points)`
                    : grade.letter}
                </option>
              ))}
            </SelectField>
            <Button
              variant="danger"
              iconOnly
              aria-label={`Remove course ${String(index + 1)}`}
              disabled={rows.length === 1}
              onClick={() => {
                setRows((current) => current.filter((candidate) => candidate.id !== row.id));
              }}
            >
              <Icon name="trash" size="nav" />
            </Button>
          </li>
        ))}
      </ul>

      <AnswerBlock
        label="Estimated SGPA"
        value={result.ok ? formatGpa(result.value) : null}
        caption={
          result.ok
            ? `${String(courses.length)} courses · ${String(result.explanation.inputs.totalCredits ?? 0)} credits entered`
            : result.detail
        }
      />

      <ExplanationDisclosure explanation={result.explanation} />
    </Panel>
  );
}

/* -------------------------------------------------------------------------- */
/* CGPA                                                                       */
/* -------------------------------------------------------------------------- */

interface SemesterRow {
  readonly id: string;
  readonly semester: string;
  readonly credits: string;
  readonly sgpa: string;
}

function blankSemester(index: number): SemesterRow {
  return { id: newId(), semester: String(index + 1), credits: '', sgpa: '' };
}

function CgpaCalculator() {
  const { items: savedResults } = useResults();

  const [rows, setRows] = useState<SemesterRow[]>(() => [blankSemester(0), blankSemester(1)]);

  const semesters: SemesterSummary[] = useMemo(
    () =>
      rows
        .filter((row) => row.credits.trim() !== '' && row.sgpa.trim() !== '')
        .map((row) => ({
          credits: Number(row.credits),
          sgpa: Number(row.sgpa),
          semester: Number(row.semester),
        })),
    [rows],
  );

  const cgpa = useMemo(() => calculateCGPA(semesters, ruleSet), [semesters]);
  const percentage = useMemo(
    () => (cgpa.ok ? calculatePercentage(cgpa.value, ruleSet) : null),
    [cgpa],
  );
  const classBand = useMemo(
    () => (percentage?.ok === true ? calculateClass(percentage.value, ruleSet) : null),
    [percentage],
  );

  const update = (id: string, patch: Partial<SemesterRow>) => {
    setRows((current) => current.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  };

  return (
    <Panel
      title="CGPA across semesters"
      action={
        <Button
          small
          onClick={() => {
            setRows((current) => [...current, blankSemester(current.length)]);
          }}
        >
          <Icon name="plus" size="nav" />
          Add semester
        </Button>
      }
      flush
    >
      {savedResults.length > 0 && (
        <div className={styles.panelNotice}>
          <Notice>
            You have {String(savedResults.length)} saved semester result
            {savedResults.length === 1 ? '' : 's'}. Use <strong>Fill from saved results</strong> to
            load them.
            <div className={styles.noticeAction}>
              <Button
                small
                onClick={() => {
                  setRows(
                    savedResults.map((saved) => {
                      // Through `semesterSgpa`, so an incomplete semester fills
                      // in its credits and leaves the SGPA box empty for the
                      // student rather than arriving with a partial figure
                      // already typed in (OQ-049 §16).
                      const { sgpa, credits } = semesterSgpa(saved, ruleSet);
                      return {
                        id: saved.id,
                        semester: String(saved.semester),
                        credits: String(credits),
                        sgpa: sgpa === null ? '' : sgpa.toFixed(2),
                      };
                    }),
                  );
                }}
              >
                Fill from saved results
              </Button>
            </div>
          </Notice>
        </div>
      )}

      <div className={styles.semesterHeader} aria-hidden="true">
        <span>Semester</span>
        <span>Total credits</span>
        <span>SGPA</span>
        <span />
      </div>

      <ul className={styles.rows}>
        {rows.map((row, index) => (
          <li className={styles.semesterRow} key={row.id}>
            <SelectField
              label={`Semester number, row ${String(index + 1)}`}
              value={row.semester}
              onChange={(event) => {
                update(row.id, { semester: event.target.value });
              }}
            >
              {[1, 2, 3, 4, 5, 6, 7, 8].map((semester) => (
                <option key={semester} value={semester}>
                  Semester {semester}
                </option>
              ))}
            </SelectField>
            <TextField
              label={`Total credits, row ${String(index + 1)}`}
              inputMode="numeric"
              placeholder="22"
              value={row.credits}
              onChange={(event) => {
                update(row.id, { credits: event.target.value });
              }}
            />
            <TextField
              label={`SGPA, row ${String(index + 1)}`}
              inputMode="decimal"
              placeholder="8.43"
              value={row.sgpa}
              onChange={(event) => {
                update(row.id, { sgpa: event.target.value });
              }}
            />
            <Button
              variant="danger"
              iconOnly
              aria-label={`Remove semester row ${String(index + 1)}`}
              disabled={rows.length === 1}
              onClick={() => {
                setRows((current) => current.filter((candidate) => candidate.id !== row.id));
              }}
            >
              <Icon name="trash" size="nav" />
            </Button>
          </li>
        ))}
      </ul>

      <AnswerBlock
        label="Estimated CGPA"
        value={cgpa.ok ? formatGpa(cgpa.value) : null}
        caption={
          cgpa.ok
            ? `Credit-weighted across ${String(semesters.length)} entered semesters`
            : cgpa.detail
        }
      >
        {cgpa.ok && (
          <>
            <div className={styles.derived}>
              {percentage?.ok === true && (
                <span className={styles.derivedItem}>
                  <span className={styles.derivedLabel}>Percentage</span>
                  <span className="tabular">{formatPercent(percentage.value)}</span>
                </span>
              )}
              {classBand?.ok === true && (
                <span className={styles.derivedItem}>
                  <span className={styles.derivedLabel}>Class</span>
                  <StatusPill tone="accent">{classBand.value.label}</StatusPill>
                </span>
              )}
            </div>
          </>
        )}
      </AnswerBlock>

      <ExplanationDisclosure explanation={cgpa.explanation} />

      {percentage?.ok === true && (
        <div className={styles.percentageNote}>
          <Notice>
            <strong>Percentage = CGPA × 10</strong>, per clause 22OB 6.7 of the VTU 2022 regulation,
            which gives this worked example: CGPA 8.20 → 82.0%.
            <br />
            Many other calculators subtract 0.75 before multiplying, which returns a figure exactly
            7.5 percentage points lower. That formula does not appear in the 2022 regulation.
            GradTools follows the regulation.
          </Notice>
        </div>
      )}
    </Panel>
  );
}
