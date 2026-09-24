/**
 * SGPA & CGPA — the design's "Your figures" (hero CGPA, progression chart,
 * SGPA history) and "Calculator" (SGPA, CGPA, required SGPA, required marks).
 *
 * Every figure, on both tabs, is computed by @gradtools/academic-rules against
 * the VTU 2022 regulation and can show its working. The calculators save
 * nothing.
 */

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
import { Info, Plus, RotateCcw, Sigma, TriangleAlert, X } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ExplanationDisclosure } from '../../components/academic/ExplanationDisclosure.js';
import { GradeDistributionChart, SgpaTrendChart } from '../../components/charts/lazy.js';
import { Badge } from '../../components/ui/badge.js';
import { Button, IconButton } from '../../components/ui/button.js';
import { Card, CardHeader, CardRows } from '../../components/ui/card.js';
import { Callout, EmptyState } from '../../components/ui/feedback.js';
import { Field, Input, Select } from '../../components/ui/field.js';
import { Metric, MetricGrid, MiniStat } from '../../components/ui/metric.js';
import { PageHeader, Row, SectionTitle } from '../../components/ui/page.js';
import { Progress } from '../../components/ui/progress.js';
import { Segmented } from '../../components/ui/segmented.js';
import { PageSkeleton } from '../../components/ui/skeleton.js';
import { Tooltip } from '../../components/ui/tooltip.js';
import { dataCompleteness } from '../../domain/academics.js';
import { semesterSgpa } from '../../domain/results.js';
import { resolveSubject, type SubjectIdentity } from '../../domain/subjects.js';
import { useSubjectIndex } from '../../hooks/useSubjectIndex.js';
import { OUTCOME_LABEL, type CourseOutcome } from '../../domain/statistics.js';
import { useAcademicState } from '../../hooks/useAcademicState.js';
import { useResults } from '../../hooks/useCollection.js';
import { cn } from '../../lib/cn.js';
import { formatCount, formatGpa, formatPercent, metricDisplay } from '../../lib/format.js';
import { newId } from '../../lib/id.js';
import { SEMESTER_OPTIONS } from '../import/CalendarReview.js';

const ruleSet = vtu2022RuleSet;

type Tab = 'figures' | 'calculator';

export function AcademicsPage() {
  const [params, setParams] = useSearchParams();
  const tab: Tab = params.get('tab') === 'calculator' ? 'calculator' : 'figures';
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Academic performance"
        title="SGPA & CGPA"
        description="Your credit-weighted academic standing, and the tools to plan ahead."
        actions={
          <Button asChild variant="primary" icon={<Plus />}>
            <Link to="/import">Add result</Link>
          </Button>
        }
      />
      <Segmented<Tab>
        label="SGPA and CGPA view"
        value={tab}
        onChange={(next) => setParams(next === 'figures' ? {} : { tab: next }, { replace: true })}
        options={[
          { value: 'figures', label: 'Your figures' },
          { value: 'calculator', label: 'Calculator' },
        ]}
        className="self-start"
      />
      {tab === 'figures' ? <Figures /> : <CalculatorPanel />}
    </div>
  );
}

/* --------------------------------------------------------------- Figures */

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

function Figures() {
  const { statistics, loading } = useAcademicState();
  const completeness = useMemo(() => dataCompleteness(statistics.views), [statistics.views]);

  if (loading) return <PageSkeleton label="Loading your figures" />;

  if (!statistics.hasAnyResult) {
    return (
      <EmptyState
        icon={<Sigma />}
        title="No calculated figures yet"
        description="Add a semester result to calculate SGPA and CGPA. Your figures update as records are confirmed, and the calculator works without any saved data."
        actions={
          <>
            <Button asChild variant="primary" icon={<Plus />}>
              <Link to="/import">Add result</Link>
            </Button>
            <Button asChild>
              <Link to="/academics?tab=calculator">Open calculator</Link>
            </Button>
          </>
        }
      />
    );
  }

  const partial = statistics.cgpaBasis.pending.length > 0;
  const figure = partial ? statistics.provisionalCgpa : statistics.cgpa;
  const graded = statistics.semesters.filter((entry) => entry.hasResult);

  return (
    <div className="flex flex-col gap-6">
      {partial && (
        <Card className="flex flex-col gap-4 p-6 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <span
              aria-hidden="true"
              className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-lg bg-warning-weak text-warning"
            >
              <TriangleAlert className="size-5" />
            </span>
            <div>
              <div className="text-[12px] font-medium text-ink-2">Cumulative CGPA</div>
              <div className="text-[26px] leading-tight font-semibold text-ink-3">Unavailable</div>
              <p className="mt-1 text-[13px] text-ink-2">
                {formatCount(statistics.cgpaBasis.pending.length, 'completed semester')} (
                {statistics.cgpaBasis.pending.map((semester) => `S${String(semester)}`).join(', ')})
                still {statistics.cgpaBasis.pending.length === 1 ? 'needs' : 'need'} academic data
                before CGPA can be computed.
              </p>
            </div>
          </div>
          <Button asChild>
            <Link to="/results">Resolve on Results</Link>
          </Button>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-[0.9fr_1.1fr]">
        <Card
          className="relative overflow-hidden p-6"
          aria-label={partial ? 'Average so far' : 'Cumulative CGPA'}
        >
          <span className="absolute top-5 right-5">
            {partial ? (
              <Badge tone="warning">Not your CGPA</Badge>
            ) : (
              <Badge tone="success">Credit-weighted</Badge>
            )}
          </span>
          <div className="text-[12px] font-medium text-ink-2">
            {partial ? 'Average so far' : 'Cumulative CGPA'}
          </div>
          {figure.value === null ? (
            <div className="mt-3 text-[40px] leading-none font-semibold text-ink-3">
              Unavailable
            </div>
          ) : (
            <div className="tnum mt-1 text-[56px] leading-none font-semibold tracking-[-0.03em] sm:text-[68px]">
              {formatGpa(figure.value)}
            </div>
          )}
          <div className="mt-3 flex items-center gap-2 text-[13px] text-ink-2">
            <Info className="size-4 shrink-0 text-ink-3" aria-hidden="true" />
            {partial ? (
              <span>
                Across {statistics.cgpaBasis.counted} of{' '}
                {statistics.cgpaBasis.counted + statistics.cgpaBasis.pending.length} completed
                semesters — a credit-weighted average of what has resolved, which is not your CGPA.
              </span>
            ) : (
              <>
                <span>CGPA is calculated across every completed semester.</span>
                <Tooltip content="Σ(SGPA × credits) ÷ Σ credits — weighted by the credits each semester carried. Clause 22OB 6.6.">
                  <button
                    type="button"
                    className="cursor-help border-b border-dashed border-accent-ink font-mono text-[11px] text-accent-ink"
                  >
                    formula
                  </button>
                </Tooltip>
              </>
            )}
          </div>
          {figure.reason !== null && <p className="mt-2 text-[12px] text-ink-3">{figure.reason}</p>}
          <div className="mt-5 grid grid-cols-3 gap-3">
            <MiniStat
              label="Latest SGPA"
              value={
                statistics.latestSgpa.value === null
                  ? '—'
                  : formatGpa(statistics.latestSgpa.value.sgpa)
              }
            />
            <MiniStat
              label="Credits"
              value={
                metricDisplay(statistics.creditsEarned).value === 'Unavailable'
                  ? '—'
                  : metricDisplay(statistics.creditsEarned).value
              }
            />
            <MiniStat
              label="Backlogs"
              value={
                metricDisplay(statistics.backlogsFromResults).value === 'Unavailable'
                  ? '—'
                  : metricDisplay(statistics.backlogsFromResults).value
              }
            />
          </div>
        </Card>

        <Card className="p-5">
          <SectionTitle>CGPA progression</SectionTitle>
          {(statistics.semestersGraded.value ?? 0) >= 2 ? (
            <SgpaTrendChart points={statistics.trend} variant="line" height={208} />
          ) : (
            <EmptyState
              compact
              icon={<Sigma />}
              title="Not enough to draw a trend"
              description="A trend needs at least two graded semesters. One reading is a point, not a direction."
            />
          )}
        </Card>
      </div>

      {graded.length > 0 && (
        <Card className="overflow-hidden">
          <CardHeader title="SGPA history" />
          <CardRows>
            {graded.map((entry) => {
              const sgpa = entry.sgpa.value;
              return (
                <Row key={entry.number} asChild className="gap-4 px-5 py-3.5">
                  <Link to={`/results/${String(entry.number)}`}>
                    <span
                      aria-hidden="true"
                      className="grid size-9 place-items-center rounded-lg bg-sunken font-mono text-[13px] font-semibold"
                    >
                      S{entry.number}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13px] font-medium">Semester {entry.number}</span>
                      <span className="block text-[11px] text-ink-3">
                        {formatCount(entry.courseCount, 'course')}
                        {(entry.creditsAttempted.value ?? 0) > 0
                          ? ` · ${String(entry.creditsAttempted.value ?? 0)} credits`
                          : ''}
                      </span>
                    </span>
                    <span className="hidden w-28 sm:block" aria-hidden="true">
                      <Progress value={((sgpa ?? 0) / 10) * 100} />
                    </span>
                    {sgpa === null ? (
                      <span
                        className="w-24 text-right text-[13px] font-medium text-ink-3"
                        title={entry.sgpa.reason ?? undefined}
                      >
                        Unavailable
                      </span>
                    ) : (
                      <span className="tnum w-14 text-right text-lg font-semibold">
                        {formatGpa(sgpa)}
                      </span>
                    )}
                  </Link>
                </Row>
              );
            })}
          </CardRows>
        </Card>
      )}

      <MetricGrid>
        <Metric
          label="Percentage"
          value={metricDisplay(statistics.percentage, formatPercent).value}
          state={statistics.percentage.value === null ? 'unavailable' : 'resolved'}
          sub={
            statistics.percentage.value === null
              ? (statistics.percentage.reason ?? undefined)
              : 'CGPA × 10 (22OB 6.7)'
          }
        />
        <Metric label="Semesters graded" value={metricDisplay(statistics.semestersGraded).value} />
        <Metric
          label="Courses passed"
          value={statistics.outcomes.passed}
          sub={
            statistics.outcomes.unresolved > 0
              ? `${String(statistics.outcomes.unresolved)} still to review`
              : undefined
          }
        />
        <Metric
          label="Backlogs recorded"
          value={metricDisplay(statistics.backlogs).value}
          emphasis={(statistics.backlogs.value ?? 0) > 0 ? 'warning' : undefined}
        />
      </MetricGrid>

      <div className="grid items-start gap-6 lg:grid-cols-2">
        {statistics.grades.total > 0 && (
          <Card className="p-5">
            <SectionTitle>Grade distribution</SectionTitle>
            <GradeDistributionChart grades={statistics.grades} height={200} />
          </Card>
        )}
        <Card className="p-5">
          <SectionTitle>Academic data</SectionTitle>
          <dl className="grid grid-cols-2 gap-3">
            <DataStat
              label="Courses imported"
              value={String(statistics.dataQuality.coursesImported)}
            />
            <DataStat
              label="Credits resolved"
              value={`${String(statistics.dataQuality.creditsResolved)} of ${String(statistics.dataQuality.coursesImported)}`}
            />
            <DataStat
              label="Need review"
              value={String(statistics.dataQuality.coursesNeedingReview)}
            />
            <DataStat
              label="Fully resolved"
              value={`${String(statistics.semesters.filter((entry) => entry.completeness === 'fully_resolved').length)} of ${String(graded.length)} semesters`}
            />
          </dl>
          {OUTCOME_ORDER.some((key) => statistics.outcomes[key] > 0) && (
            <>
              <h3 className="mt-5 mb-2 text-[12px] font-semibold tracking-[0.08em] text-ink-2 uppercase">
                Course outcomes
              </h3>
              <ul className="flex flex-wrap gap-2">
                {OUTCOME_ORDER.filter((key) => statistics.outcomes[key] > 0).map((key) => (
                  <li key={key}>
                    <Badge
                      tone={
                        key === 'passed' ? 'success' : key === 'unresolved' ? 'neutral' : 'warning'
                      }
                    >
                      {OUTCOME_LABEL[key]} · {statistics.outcomes[key]}
                    </Badge>
                  </li>
                ))}
              </ul>
            </>
          )}
          {statistics.dataQuality.notes.length > 0 && (
            <ul className="mt-4 space-y-1 text-[12px] text-ink-2">
              {statistics.dataQuality.notes.map((note) => (
                <li key={note}>• {note}</li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <div className="text-[12px] leading-relaxed text-ink-3">
        <p>{completeness.basis}</p>
        {completeness.gaps.map((gap) => (
          <p key={gap}>{gap}</p>
        ))}
      </div>
    </div>
  );
}

function DataStat({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div className="rounded-lg border border-line bg-panel p-3">
      <dt className="text-[11px] text-ink-3">{label}</dt>
      <dd className="tnum mt-0.5 text-[15px] font-semibold text-ink">{value}</dd>
    </div>
  );
}

/* ------------------------------------------------------------ Calculator */

type CalcMode = 'sgpa' | 'cgpa' | 'required-sgpa' | 'required-marks';

function CalculatorPanel() {
  const [mode, setMode] = useState<CalcMode>('sgpa');
  const points = ruleSet.gradeBands
    .filter((band) => band.points !== null)
    .map((band) => `${band.letter}=${String(band.points)}`)
    .join(' · ');
  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
      <Card className="min-w-0 p-5">
        <Segmented<CalcMode>
          size="sm"
          label="Calculator"
          value={mode}
          onChange={setMode}
          options={[
            { value: 'sgpa', label: 'SGPA' },
            { value: 'cgpa', label: 'CGPA' },
            { value: 'required-sgpa', label: 'Required SGPA' },
            { value: 'required-marks', label: 'Required marks' },
          ]}
        />
        <div className="mt-5">
          {mode === 'sgpa' && <SgpaCalculator />}
          {mode === 'cgpa' && <CgpaCalculator />}
          {mode === 'required-sgpa' && <RequiredSgpaCalculator />}
          {mode === 'required-marks' && <RequiredMarksCalculator />}
        </div>
      </Card>
      <Card className="h-fit p-5">
        <SectionTitle>How it works</SectionTitle>
        <p className="text-[13px] leading-relaxed text-ink-2">
          Every figure is credit-weighted, exactly as the regulation defines it. The engine that
          computes them is the same one your saved results go through.
        </p>
        <dl className="mt-4 space-y-3 text-[12px]">
          <FormulaLine label="SGPA" formula="Σ(GPᵢ × Cᵢ) ÷ Σ Cᵢ" />
          <FormulaLine label="CGPA" formula="Σ(SGPAₛ × Cₛ) ÷ Σ Cₛ" />
          <FormulaLine label="Percentage" formula="CGPA × 10 (22OB 6.7)" />
          <FormulaLine label="Grade points" formula={points} />
        </dl>
        <p className="mt-4 text-[12px] text-ink-3">
          Figures here are estimates. Nothing is saved to your record — a result becomes part of it
          only when you confirm one on Results or Add document.
        </p>
      </Card>
    </div>
  );
}

function FormulaLine({ label, formula }: { readonly label: string; readonly formula: string }) {
  return (
    <div className="rounded-lg border border-line bg-panel px-3 py-2">
      <dt className="text-[11px] font-medium text-ink-2">{label}</dt>
      <dd className="mt-0.5 font-mono text-[12px] text-accent-ink">{formula}</dd>
    </div>
  );
}

function ResultBlock({
  label,
  value,
  caption,
  children,
}: {
  readonly label: string;
  readonly value: string | null;
  readonly caption: string;
  readonly children?: ReactNode;
}) {
  return (
    <div
      aria-live="polite"
      className="mt-6 rounded-xl border border-accent/30 bg-accent-weak/50 p-5"
    >
      <div className="text-[12px] font-medium text-ink-2">{label}</div>
      <div className="mt-1 flex items-baseline gap-1.5">
        <span
          className={cn(
            'tnum text-[40px] leading-none font-semibold',
            value === null ? 'text-ink-3' : 'text-accent-ink',
          )}
        >
          {value ?? '—'}
        </span>
      </div>
      <p className="mt-2 text-[12px] text-ink-2">{caption}</p>
      {children}
    </div>
  );
}

const CREDIT_OPTIONS = ['0.5', '1', '1.5', '2', '3', '4', '5'].map((value) => ({
  value,
  label: value,
}));
const GRADE_OPTIONS = [...ruleSet.gradeBands, ...ruleSet.specialGrades].map((grade) => ({
  value: grade.letter,
  label:
    'points' in grade && grade.points !== null
      ? `${grade.letter} (${String(grade.points)} points)`
      : grade.letter,
}));

interface CourseRow {
  readonly id: string;
  readonly credits: string;
  readonly gradeLetter: string;
}
const blankCourse = (): CourseRow => ({
  id: newId(),
  credits: '4',
  gradeLetter: 'A',
});

function SgpaCalculator() {
  const [rows, setRows] = useState<CourseRow[]>(() => Array.from({ length: 3 }, blankCourse));
  const courses: CourseGrade[] = useMemo(
    () =>
      rows
        .filter((row) => row.gradeLetter !== '')
        .map((row) => ({
          credits: Number(row.credits),
          gradeLetter: row.gradeLetter,
        })),
    [rows],
  );
  const result = useMemo(() => calculateSGPA(courses, ruleSet), [courses]);
  const update = (id: string, patch: Partial<CourseRow>): void =>
    setRows((current) => current.map((row) => (row.id === id ? { ...row, ...patch } : row)));

  return (
    <section aria-labelledby="sgpa-calc">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 id="sgpa-calc" className="text-sm font-semibold">
          Course grade points
        </h3>
        <Button
          size="sm"
          variant="ghost"
          icon={<RotateCcw />}
          onClick={() => setRows([blankCourse()])}
        >
          Reset
        </Button>
      </div>
      <ul className="space-y-2">
        {rows.map((row, index) => {
          const n = String(index + 1);
          return (
            <li key={row.id} className="grid grid-cols-[1fr_1fr_auto] items-center gap-2">
              <Select
                aria-label={`Credits, course ${n}`}
                value={row.credits}
                onValueChange={(value) => update(row.id, { credits: value })}
                options={CREDIT_OPTIONS}
              />
              <Select
                aria-label={`Grade, course ${n}`}
                value={row.gradeLetter}
                onValueChange={(value) => update(row.id, { gradeLetter: value })}
                options={GRADE_OPTIONS}
              />
              <IconButton
                label={`Remove course ${n}`}
                disabled={rows.length === 1}
                className="hover:text-danger"
                onClick={() =>
                  setRows((current) => current.filter((candidate) => candidate.id !== row.id))
                }
              >
                <X />
              </IconButton>
            </li>
          );
        })}
      </ul>
      <Button
        size="sm"
        className="mt-2"
        icon={<Plus />}
        onClick={() => setRows((current) => [...current, blankCourse()])}
      >
        Add course
      </Button>
      <ResultBlock
        label="Estimated SGPA"
        value={result.ok ? formatGpa(result.value) : null}
        caption={
          result.ok
            ? `${formatCount(courses.length, 'course')} · ${String(result.explanation.inputs['totalCredits'] ?? 0)} credits entered`
            : result.detail
        }
      />
      <ExplanationDisclosure explanation={result.explanation} className="mt-3" />
    </section>
  );
}

interface SemesterRowDraft {
  readonly id: string;
  readonly semester: string;
  readonly credits: string;
  readonly sgpa: string;
}
const blankSemester = (index: number): SemesterRowDraft => ({
  id: newId(),
  semester: String(Math.min(index + 1, 8)),
  credits: '',
  sgpa: '',
});

function CgpaCalculator() {
  const { index } = useSubjectIndex();
  const identify = (code: string | null): SubjectIdentity | null =>
    code === null ? null : resolveSubject(index, code);
  const { items: savedResults } = useResults();
  const [rows, setRows] = useState<SemesterRowDraft[]>(() => [blankSemester(0), blankSemester(1)]);
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
  const update = (id: string, patch: Partial<SemesterRowDraft>): void =>
    setRows((current) => current.map((row) => (row.id === id ? { ...row, ...patch } : row)));

  return (
    <section aria-labelledby="cgpa-calc">
      <h3 id="cgpa-calc" className="mb-3 text-sm font-semibold">
        CGPA across semesters
      </h3>
      {savedResults.length > 0 && (
        <Callout
          className="mb-3"
          action={
            <Button
              size="sm"
              onClick={() =>
                setRows(
                  [...savedResults]
                    .sort((a, b) => a.semester - b.semester)
                    .map((saved) => {
                      /* The same credit resolution the results screens use. */
                      const { sgpa, credits } = semesterSgpa(saved, ruleSet, identify);
                      return {
                        id: saved.id,
                        semester: String(saved.semester),
                        credits: String(credits),
                        sgpa: sgpa === null ? '' : sgpa.toFixed(2),
                      };
                    }),
                )
              }
            >
              Fill from saved results
            </Button>
          }
        >
          You have {formatCount(savedResults.length, 'saved semester result')}.
        </Callout>
      )}
      <div
        aria-hidden="true"
        className="mb-1.5 grid grid-cols-[1.2fr_1fr_1fr_auto] gap-2 text-[11px] font-medium text-ink-3"
      >
        <span>Semester</span>
        <span>Total credits</span>
        <span>SGPA</span>
        <span className="w-9" />
      </div>
      <ul className="space-y-2">
        {rows.map((row, index) => {
          const n = String(index + 1);
          return (
            <li key={row.id} className="grid grid-cols-[1.2fr_1fr_1fr_auto] items-center gap-2">
              <Select
                aria-label={`Semester number, row ${n}`}
                value={row.semester}
                onValueChange={(value) => update(row.id, { semester: value })}
                options={SEMESTER_OPTIONS}
              />
              <Input
                aria-label={`Total credits, row ${n}`}
                inputMode="numeric"
                placeholder="22"
                value={row.credits}
                onChange={(event) => update(row.id, { credits: event.target.value })}
              />
              <Input
                aria-label={`SGPA, row ${n}`}
                inputMode="decimal"
                placeholder="8.43"
                value={row.sgpa}
                onChange={(event) => update(row.id, { sgpa: event.target.value })}
              />
              <IconButton
                label={`Remove semester row ${n}`}
                disabled={rows.length === 1}
                className="hover:text-danger"
                onClick={() =>
                  setRows((current) => current.filter((candidate) => candidate.id !== row.id))
                }
              >
                <X />
              </IconButton>
            </li>
          );
        })}
      </ul>
      <Button
        size="sm"
        className="mt-2"
        icon={<Plus />}
        onClick={() => setRows((current) => [...current, blankSemester(current.length)])}
      >
        Add semester
      </Button>
      <ResultBlock
        label="Estimated CGPA"
        value={cgpa.ok ? formatGpa(cgpa.value) : null}
        caption={
          cgpa.ok
            ? `Credit-weighted across ${formatCount(semesters.length, 'entered semester')}.`
            : cgpa.detail
        }
      >
        {cgpa.ok && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {percentage?.ok === true && (
              <Badge>Percentage · {formatPercent(percentage.value)}</Badge>
            )}
            {classBand?.ok === true && <Badge tone="accent">{classBand.value.label}</Badge>}
          </div>
        )}
      </ResultBlock>
      <ExplanationDisclosure explanation={cgpa.explanation} className="mt-3" />
      {percentage?.ok === true && (
        <Callout className="mt-3" title="Percentage = CGPA × 10,">
          per clause 22OB 6.7 of the VTU 2022 regulation, which gives this worked example: CGPA 8.20
          → 82.0%. Many other calculators subtract 0.75 before multiplying, which returns a figure
          exactly 7.5 percentage points lower. That formula does not appear in the 2022 regulation.
          GradTools follows the regulation.
        </Callout>
      )}
    </section>
  );
}

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
    <section aria-labelledby="req-sgpa">
      <h3 id="req-sgpa" className="mb-3 text-sm font-semibold">
        Required SGPA for a target CGPA
      </h3>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Target CGPA">
          <Input
            inputMode="decimal"
            value={target}
            onChange={(event) => setTarget(event.target.value)}
          />
        </Field>
        <Field
          label="Current CGPA"
          hint={currentCgpa === null ? 'No CGPA in your record yet.' : 'From your record.'}
        >
          <Input
            inputMode="decimal"
            value={current}
            onChange={(event) => setCurrent(event.target.value)}
          />
        </Field>
        <Field
          label="Credits completed"
          {...(creditsDone === null ? {} : { hint: 'From your record.' })}
        >
          <Input
            inputMode="numeric"
            value={done}
            onChange={(event) => setDone(event.target.value)}
          />
        </Field>
        <Field label="Credits next semester">
          <Input
            inputMode="numeric"
            value={next}
            onChange={(event) => setNext(event.target.value)}
          />
        </Field>
      </div>
      <ResultBlock
        label="Required SGPA next semester"
        value={result.ok ? formatGpa(result.value) : null}
        caption={
          result.ok
            ? `Score at least this across ${next} credits to reach a CGPA of ${target}.`
            : result.detail
        }
      />
      <ExplanationDisclosure explanation={result.explanation} className="mt-3" />
    </section>
  );
}

const BINDING_LABEL: Record<BindingConstraint, string> = {
  see_minimum: 'the minimum mark the exam head itself requires',
  overall_target: 'the total the course needs overall',
};

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
    <section aria-labelledby="req-marks">
      <h3 id="req-marks" className="mb-3 text-sm font-semibold">
        Marks needed in the exam
      </h3>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label={`Internal / CIE (of ${String(ruleSet.cieMax)})`}>
          <Input
            inputMode="numeric"
            value={internal}
            onChange={(event) => setInternal(event.target.value)}
          />
        </Field>
        <Field label="Target">
          <Select
            value={targetKind}
            onValueChange={setTargetKind}
            options={[
              { value: 'pass', label: 'Pass the course' },
              ...ruleSet.gradeBands
                .filter((band) => band.points !== null)
                .map((band) => ({ value: band.letter, label: `Grade ${band.letter}` })),
            ]}
          />
        </Field>
      </div>
      <ResultBlock
        label="Required in the semester-end exam"
        value={
          result.ok
            ? `${String(result.value.rawSeeRequired)} / ${String(result.value.rawSeeMaximum)}`
            : null
        }
        caption={
          result.ok
            ? `On the exam script. That is ${result.value.printedExternalEquivalent.toFixed(1)} of ${String(result.value.printedExternalMaximum)} in the card's External column — the two scales differ, and confusing them halves or doubles the answer.`
            : result.detail
        }
      >
        {result.ok && (
          <p className="mt-1 text-[12px] text-ink-2">
            What decides it: {BINDING_LABEL[result.value.bindingConstraint]}.
          </p>
        )}
      </ResultBlock>
      <ExplanationDisclosure explanation={result.explanation} className="mt-3" />
    </section>
  );
}
