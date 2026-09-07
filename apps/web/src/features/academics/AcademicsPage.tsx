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

import { useMemo, useState } from 'react';
import {
  calculateCGPA,
  calculateClass,
  calculatePercentage,
  calculateSGPA,
  vtu2022RuleSet,
  type CourseGrade,
  type SemesterSummary,
} from '@gradtools/academic-rules';
import { PageHeader } from '../../components/AppShell.js';
import { MetaPill } from '../../components/ui/tone.js';
import { IslandTabs, IslandTabGroup, IslandTabPanel } from '../../components/ui/IslandTabs.js';
import { MetricStrip } from '../../components/ui/layout.js';
import { SgpaTrend, type SemesterPoint } from '../../components/SgpaTrend.js';
import { dataCompleteness } from '../../domain/academics.js';
import { Icon } from '../../components/icons.js';
import {
  EmptyState,
  Button,
  ExplanationDisclosure,
  Notice,
  Panel,
  SelectField,
  StatusPill,
  TextField,
} from '../../components/ui/index.js';
import { formatGpa, formatPercent } from '../../lib/format.js';
import { newId } from '../../lib/id.js';
import { semesterSgpa } from '../../domain/results.js';
import { useAcademicState } from '../../hooks/useAcademicState.js';
import {
  OUTCOME_LABEL,
  type CourseOutcome,
  type GradeDistribution,
  type Metric,
} from '../../domain/statistics.js';
import { metricDisplay } from '../../lib/format.js';
import { useResults } from '../../hooks/useCollection.js';
import styles from './academics.module.css';

const ruleSet = vtu2022RuleSet;

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
        title="SGPA & CGPA"
        subtitle="Every figure is computed by the shared rules engine against the VTU 2022 regulation, and every one can show its working."
        /* The regulation is a fact about the page; the figures belong to the
           panels below, which own the data. No count is invented here. */
        pills={<MetaPill>VTU 2022 regulation</MetaPill>}
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
          <div className={styles.stack}>
            <SgpaCalculator />
            <CgpaCalculator />
          </div>
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
 * One derived figure as a metric strip reads it.
 *
 * A figure with no value says "Unavailable" and carries its reason; a PARTIAL
 * one shows what it has with the caveat attached rather than hiding it (1, 4).
 */
function metric(
  label: string,
  value: Metric<number>,
  format: (n: number) => string = String,
): { label: string; value: string; note?: string } {
  const display = metricDisplay(value, format);
  return {
    label,
    value: display.value,
    ...(display.note === undefined ? {} : { note: display.note }),
  };
}

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
      {rows.map((row) => (
        <li className={styles.gradeRow} key={row.key} data-zero={row.count === 0}>
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
 * What GradTools already knows, from the results the student saved.
 *
 * Nothing here is computed in this component beyond summing credits: the SGPA,
 * the CGPA and the completeness statement all come from the rules engine and
 * the semester-view builder, so this page and My Degree cannot disagree.
 */
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
      <EmptyState title="No figures yet" icons={['gpa', 'results', 'degree']}>
        Save a semester result and your SGPA, CGPA and trend appear here. The calculator tab works
        without any saved data.
      </EmptyState>
    );
  }

  return (
    <div className={styles.stack}>
      {/*
        EVERY FIGURE THE RECORDS SUPPORT, and each one on its own inputs (4).
        An unresolved CGPA no longer takes the credits, the passes and the
        grade distribution down with it — which is what emptied this page.
      */}
      <MetricStrip
        metrics={[
          metric('CGPA', statistics.cgpa, formatGpa),
          metric('Percentage', statistics.percentage, formatPercent),
          metric('Credits earned', statistics.creditsEarned),
          metric('Semesters graded', statistics.semestersGraded),
          {
            label: 'Passed',
            value: String(statistics.outcomes.passed),
            ...(statistics.outcomes.unresolved > 0
              ? { note: `${String(statistics.outcomes.unresolved)} still to review` }
              : {}),
          },
          metric('Backlogs', statistics.backlogs),
        ]}
      />

      <Panel title="SGPA across the degree" material="quiet">
        <SgpaTrend points={points} />
      </Panel>

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

      <div className={styles.answer}>
        {result.ok ? (
          <>
            <p className={styles.answerValue}>{formatGpa(result.value)}</p>
            <p className={styles.answerCaption}>
              SGPA · {String(courses.length)} courses ·{' '}
              {String(result.explanation.inputs.totalCredits ?? 0)} credits
            </p>
          </>
        ) : (
          <>
            <p className={styles.answerPlaceholder}>—</p>
            <p className={styles.answerCaption}>{result.detail}</p>
          </>
        )}
      </div>

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

      <div className={styles.answer}>
        {cgpa.ok ? (
          <>
            <p className={styles.answerValue}>{formatGpa(cgpa.value)}</p>
            <p className={styles.answerCaption}>CGPA · {String(semesters.length)} semesters</p>
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
        ) : (
          <>
            <p className={styles.answerPlaceholder}>—</p>
            <p className={styles.answerCaption}>{cgpa.detail}</p>
          </>
        )}
      </div>

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
