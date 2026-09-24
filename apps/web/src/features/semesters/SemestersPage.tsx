/**
 * My Degree — the design's degree hero, semester progression grid, and the
 * history / standing pair, then the student's subjects and backlogs.
 *
 * The domain has no credit requirement for a scheme, so nothing here invents
 * one: progress is counted in graded semesters, and "credits left" says it is
 * not known rather than guessing.
 */

import { Check, CircleDot, Circle, GraduationCap, TriangleAlert, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Badge, type Tone } from '../../components/ui/badge.js';
import { Button, IconButton } from '../../components/ui/button.js';
import { Card, cardInteractive } from '../../components/ui/card.js';
import { Callout } from '../../components/ui/feedback.js';
import { Field, Select } from '../../components/ui/field.js';
import { Metric } from '../../components/ui/metric.js';
import { IconTile, PageHeader, SectionTitle } from '../../components/ui/page.js';
import { Progress } from '../../components/ui/progress.js';
import { PageSkeleton } from '../../components/ui/skeleton.js';
import {
  analyseStrengths,
  dataCompleteness,
  graduationProgress,
  semesterHistory,
  sgpaReading,
  subjectPerformance,
  type SemesterComparison,
  type SemesterView,
} from '../../domain/academics.js';
import { asStudentProfileId } from '../../domain/identity.js';
import { hasNoBacklogs } from '../../domain/statistics.js';
import type { SemesterRecord, SemesterStatus } from '../../domain/types.js';
import { useAcademicState } from '../../hooks/useAcademicState.js';
import { useProfile, useResults, useSemesters } from '../../hooks/useCollection.js';
import { cn } from '../../lib/cn.js';
import { branchCode, formatCount, formatGpa, metricDisplay } from '../../lib/format.js';
import { newId, nowIso } from '../../lib/id.js';
import { BacklogPanel } from './BacklogPanel.js';
import { SemesterSubjects } from './SemesterSubjects.js';
import { SubjectInsights } from './SubjectInsights.js';

export const STATUS_LABEL: Record<SemesterStatus, string> = {
  planned: 'Planned',
  in_progress: 'In progress',
  completed: 'Completed',
};

const STATUS_PRESENTATION: Record<SemesterStatus, { tone: Tone; Icon: typeof Check }> = {
  planned: { tone: 'neutral', Icon: Circle },
  in_progress: { tone: 'schedule', Icon: CircleDot },
  completed: { tone: 'success', Icon: Check },
};

function absenceLabel(entry: SemesterComparison): string {
  if (entry.excluded === 'ruleset_unavailable') return 'Rule set unavailable';
  if (entry.excluded === 'not_gradeable') return 'Could not be graded';
  return entry.status === 'in_progress' ? 'In progress' : 'No result entered';
}

function formatDelta(delta: number): string {
  if (Math.abs(delta) < 0.005) return 'no change';
  return `${delta > 0 ? '+' : '−'}${Math.abs(delta).toFixed(2)}`;
}

export function SemestersPage() {
  const { profile } = useProfile();
  const { items: results, loading: resultsLoading } = useResults();
  const { items: semesters, save: saveSemester, loading: semestersLoading } = useSemesters();
  const [openSemester, setOpenSemester] = useState<number | null>(null);
  const profileId = profile?.id ?? asStudentProfileId('00000000-0000-0000-0000-000000000000');
  const { statistics } = useAcademicState();
  const views = statistics.views;
  const performances = useMemo(() => subjectPerformance(views), [views]);
  const strengths = useMemo(() => analyseStrengths(performances), [performances]);
  const progress = useMemo(() => graduationProgress(views, null), [views]);
  const history = useMemo(() => semesterHistory(views), [views]);
  const completeness = useMemo(() => dataCompleteness(views), [views]);
  const lastRelevant = useMemo(() => {
    const reached = views.filter((view) => view.result !== null || view.status !== 'planned');
    return reached.length === 0 ? 0 : Math.max(...reached.map((view) => view.number));
  }, [views]);

  if (resultsLoading || semestersLoading) return <PageSkeleton label="Loading your degree" />;

  const setStatus = async (view: SemesterView, status: SemesterStatus): Promise<void> => {
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
    if (status === 'in_progress') {
      for (const other of semesters) {
        if (other.number !== view.number && other.status === 'in_progress') {
          await saveSemester({ ...other, status: 'planned', updatedAt: nowIso() });
        }
      }
    }
  };

  const current = views.find((view) => view.status === 'in_progress') ?? null;
  const graded = statistics.semestersGraded.value ?? 0;
  const openView = views.find((view) => view.number === openSemester) ?? null;
  const provisional = statistics.cgpaBasis.pending.length > 0;
  /*
   * Two backlog figures, kept apart: what the student RECORDS (the list on this
   * page, and the dashboard's count) and what the imported results IMPLY. The
   * standing is "Good" only when neither shows one (`hasNoBacklogs`). "To
   * clear" comes from the recorded list alone: a failed result row is a fact
   * about the results, and the student may already have marked it cleared.
   */
  const recordedBacklogs = statistics.backlogs.value ?? 0;
  const resultBacklogs = statistics.backlogsFromResults.value ?? 0;
  const clear = hasNoBacklogs(statistics);
  const outstanding = recordedBacklogs > 0;
  /* Nothing recorded, yet the results show a failure: state both, claim neither. */
  const resultsOnly = !clear && !outstanding && resultBacklogs > 0;
  /*
   * Not clear, yet nothing to count: rows that could not be checked, or no
   * results at all to check. Either way the honest answer is "could not be
   * checked", never "Good" and never "0 to clear".
   */
  const uncheckedOnly = !clear && !outstanding && !resultsOnly;
  const scheme = profile?.schemeId === 'vtu-2022' ? '2022 scheme' : null;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Programme progress"
        title="My Degree"
        description={
          [profile?.branch ? `${branchCode(profile.branch)} — ${profile.branch}` : null, scheme]
            .filter((part) => part !== undefined && part !== null && part !== '')
            .join(' · ') ||
          'Eight semesters, from the ones behind you to the ones ahead. Everything here stays on this device.'
        }
      />

      <Card className="relative overflow-hidden p-6" aria-label="Degree standing">
        <div
          aria-hidden="true"
          className="absolute inset-y-0 right-0 w-1/3 bg-linear-to-l from-accent-weak/50 to-transparent"
        />
        <div className="relative grid gap-6 lg:grid-cols-[1.3fr_1fr] lg:items-center">
          <div>
            <div className="flex items-center gap-3">
              <IconTile tone="solid" size="lg">
                <GraduationCap />
              </IconTile>
              <div className="min-w-0">
                <div className="truncate text-[15px] font-semibold">
                  {profile?.branch ?? 'Branch not set'}
                </div>
                <div className="text-[12px] text-ink-2">
                  {current !== null
                    ? `Currently in semester ${String(current.number)}`
                    : profile?.currentSemester !== null && profile?.currentSemester !== undefined
                      ? `Currently in semester ${String(profile.currentSemester)}`
                      : 'No semester marked as in progress'}
                </div>
              </div>
            </div>
            <div className="mt-5">
              {/*
                Said once: the row is for the eye, the bar says "4 of 8" to
                assistive tech rather than a bare percentage.
              */}
              <div aria-hidden="true" className="mb-2 flex justify-between text-[13px]">
                <span className="text-ink-2">Semesters graded</span>
                <span className="tnum font-semibold">
                  {graded} of {progress.semestersTotal}
                </span>
              </div>
              <Progress
                value={(graded / progress.semestersTotal) * 100}
                className="h-2.5"
                label="Semesters graded"
                valueText={`${String(graded)} of ${String(progress.semestersTotal)}`}
              />
              <div className="mt-1.5 flex justify-between gap-3 text-[12px] text-ink-3">
                <span>{metricDisplay(statistics.creditsEarned).value} credits earned</span>
                {progress.reason !== null && <span>Credits remaining unknown</span>}
              </div>
            </div>
            {!profile?.branch && (
              <Button asChild size="sm" className="mt-4">
                <Link to="/account?section=academic">Set your branch</Link>
              </Button>
            )}
          </div>
          {/*
            Figures of the standing card, not tiles on it: `plain` drops the
            metric's own frame, as MiniStat does inside a card.
          */}
          <div className="grid grid-cols-2 gap-x-6 gap-y-5">
            <Metric
              plain
              className="bg-transparent p-0"
              label={provisional ? 'Average so far' : 'CGPA'}
              value={
                metricDisplay(provisional ? statistics.provisionalCgpa : statistics.cgpa, formatGpa)
                  .value
              }
              state={
                (provisional ? statistics.provisionalCgpa : statistics.cgpa).value === null
                  ? 'unavailable'
                  : 'resolved'
              }
              sub={provisional ? 'Not your CGPA' : 'Credit-weighted'}
            />
            <Metric
              plain
              className="bg-transparent p-0"
              label="Standing"
              value={
                clear
                  ? 'Good'
                  : outstanding
                    ? 'To clear'
                    : resultsOnly
                      ? '0 recorded'
                      : 'Unavailable'
              }
              state={uncheckedOnly ? 'unavailable' : 'resolved'}
              emphasis={outstanding ? 'warning' : undefined}
              sub={
                clear
                  ? 'No backlogs'
                  : outstanding
                    ? formatCount(recordedBacklogs, 'backlog')
                    : resultsOnly
                      ? /* Nothing recorded: say where the count comes from. */
                        `${formatCount(resultBacklogs, 'backlog')} in your results`
                      : 'Backlogs could not be checked'
              }
            />
            <Metric
              plain
              className="bg-transparent p-0"
              label="Credits earned"
              value={metricDisplay(statistics.creditsEarned).value}
              state={statistics.creditsEarned.value === null ? 'unavailable' : 'resolved'}
              sub={`Across ${formatCount(graded, 'graded semester')}`}
            />
            <Metric
              plain
              className="bg-transparent p-0"
              label="Credits left"
              value="Unavailable"
              state="unavailable"
              sub="The scheme total is not established in verified reference data"
            />
          </div>
        </div>
        <p className="relative mt-5 text-[12px] text-ink-3">{completeness.basis}</p>
      </Card>

      <section aria-labelledby="progression-title">
        <SectionTitle id="progression-title">Semester progression</SectionTitle>
        <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {views.map((view) => {
            const sgpa = view.sgpaComputed;
            const presentation = STATUS_PRESENTATION[view.status];
            const selected = openSemester === view.number;
            return (
              <li key={view.number}>
                <button
                  type="button"
                  aria-expanded={selected}
                  aria-controls="semester-detail"
                  aria-label={`Semester ${String(view.number)}, ${STATUS_LABEL[view.status].toLowerCase()}${sgpa === null ? '' : `, SGPA ${formatGpa(sgpa)}`}`}
                  onClick={() => setOpenSemester(selected ? null : view.number)}
                  className={cn(
                    'flex h-full w-full flex-col gap-3 rounded-xl border border-line bg-raised p-4',
                    cardInteractive,
                    view.status === 'in_progress' && 'ring-1 ring-schedule/40',
                    selected && 'ring-2 ring-accent/20',
                  )}
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="font-mono text-[12px] font-semibold text-ink-2">
                      S{view.number}
                    </span>
                    <Badge tone={presentation.tone} icon={<presentation.Icon />}>
                      {STATUS_LABEL[view.status]}
                    </Badge>
                  </span>
                  <span>
                    <span
                      className={cn(
                        'tnum block text-[26px] leading-none font-semibold',
                        sgpa === null && 'text-ink-3',
                      )}
                    >
                      {sgpa === null ? (view.result === null ? '·' : '—') : formatGpa(sgpa)}
                    </span>
                    <span className="mt-1 block text-[12px] text-ink-3">
                      {view.subjectCount > 0
                        ? `${formatCount(view.subjectCount, 'course')} · ${String(view.credits)} cr`
                        : 'Not yet started'}
                    </span>
                  </span>
                  {view.status === 'completed' && view.credits > 0 && (
                    <Progress value={100} tone="success" />
                  )}
                </button>
              </li>
            );
          })}
        </ol>
        {openView !== null && (
          <SemesterDetail
            view={openView}
            profileId={profileId}
            onStatus={(status) => void setStatus(openView, status)}
            onClose={() => setOpenSemester(null)}
          />
        )}
      </section>

      <div className="grid items-start gap-6 lg:grid-cols-2">
        <Card className="p-5">
          <SectionTitle>Semester history</SectionTitle>
          {!history.available ? (
            <p className="text-[13px] text-ink-2">{history.reason}</p>
          ) : (
            <>
              {history.mixedRuleSets && (
                <Callout tone="warning" className="mb-3">
                  These semesters were graded under more than one set of rules, so comparing their
                  SGPAs is a simplification.
                </Callout>
              )}
              <ol className="space-y-3">
                {history.entries.slice(0, lastRelevant).map((entry) => (
                  <li key={entry.number} className="flex items-center gap-3 text-[13px]">
                    <span className="w-7 shrink-0 font-mono text-[12px] font-semibold text-ink-2">
                      S{entry.number}
                    </span>
                    {entry.sgpa === null ? (
                      <span className="text-ink-3">{absenceLabel(entry)}</span>
                    ) : (
                      <>
                        <span className="tnum w-10 shrink-0 font-semibold">
                          {formatGpa(entry.sgpa)}
                        </span>
                        {/*
                          Decorative: the SGPA is the figure beside it. Labelled,
                          it was announced as a percentage ("86%" for 8.60).
                        */}
                        <Progress value={(entry.sgpa / 10) * 100} className="flex-1" />
                        <span
                          className={cn(
                            'tnum w-16 shrink-0 text-right text-[12px]',
                            entry.delta === null || Math.abs(entry.delta) < 0.005
                              ? 'text-ink-3'
                              : entry.delta > 0
                                ? 'text-success'
                                : 'text-warning',
                          )}
                        >
                          {entry.delta === null ? '' : formatDelta(entry.delta)}
                        </span>
                        <span className="w-14 shrink-0 text-right">
                          {entry.isHighest ? (
                            <Badge tone="success">Highest</Badge>
                          ) : entry.isLowest ? (
                            <Badge>Lowest</Badge>
                          ) : null}
                        </span>
                      </>
                    )}
                  </li>
                ))}
              </ol>
              <p className="mt-4 text-[12px] text-ink-3">
                Change is measured against the semester immediately before, and only when both were
                graded.
              </p>
            </>
          )}
        </Card>

        <Card className="p-5">
          <SectionTitle>Backlog &amp; standing</SectionTitle>
          <div
            className={cn(
              'rounded-xl border p-5',
              clear
                ? 'bg-success-weak/50'
                : outstanding
                  ? 'bg-warning-weak/50'
                  : 'border-line bg-panel',
            )}
          >
            <div className="flex items-center gap-3">
              <span
                aria-hidden="true"
                className={cn(
                  'grid size-10 shrink-0 place-items-center rounded-full text-canvas',
                  clear ? 'bg-success' : outstanding ? 'bg-warning' : 'bg-ink-3',
                )}
              >
                {clear ? <Check className="size-5" /> : <TriangleAlert className="size-5" />}
              </span>
              <div>
                <div className="text-[15px] font-semibold">
                  {clear
                    ? 'Clear academic record'
                    : outstanding
                      ? `${formatCount(recordedBacklogs, 'backlog')} to clear`
                      : resultsOnly
                        ? `${formatCount(resultBacklogs, 'backlog')} in your results`
                        : 'Backlogs could not be checked'}
                </div>
                <div className="text-[13px] text-ink-2">
                  {/* What the imported results say, whichever count the title shows. */}
                  {statistics.grades.total > 0 &&
                    `${String(resultBacklogs)}${statistics.backlogsUndetermined > 0 ? ' or more' : ''} across ${formatCount(statistics.grades.total, 'recorded course')}.`}
                </div>
              </div>
            </div>
          </div>
          {statistics.backlogsUndetermined > 0 && (
            <p className="mt-3 text-[12px] text-ink-2">
              {formatCount(statistics.backlogsUndetermined, 'course')} could not be checked, because
              whether the course has a semester-end exam is not recorded. The count above is a
              floor.
            </p>
          )}
          {statistics.mixedRuleSets && (
            <Callout tone="warning" className="mt-3">
              These semesters were graded under more than one set of rules. The combined figures are
              a simplification.
            </Callout>
          )}
          {completeness.gaps.map((gap) => (
            <p key={gap} className="mt-2 text-[12px] text-ink-3">
              {gap}
            </p>
          ))}
        </Card>
      </div>

      <SubjectInsights performances={performances} strengths={strengths} loading={resultsLoading} />
      <BacklogPanel profileId={profileId} clear={clear} />
      {results.length === 0 && (
        <Callout
          action={
            <Button asChild size="sm" variant="primary">
              <Link to="/import">Add result</Link>
            </Button>
          }
        >
          Nothing here yet. Add a semester result and this fills in.
        </Callout>
      )}
    </div>
  );
}

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
    <Card
      id="semester-detail"
      className="mt-3 animate-rise p-5"
      aria-labelledby="semester-detail-title"
    >
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 id="semester-detail-title" className="text-[16px] font-semibold">
            Semester {view.number}
          </h3>
          <p className="text-[12px] text-ink-3">
            {view.subjectCount > 0
              ? `${formatCount(view.subjectCount, 'course')} · ${String(view.credits)} credits`
              : 'No result entered yet'}
          </p>
        </div>
        <div className="flex items-end gap-2">
          <Field label="Status" className="w-44">
            <Select
              size="sm"
              aria-label={`Semester ${String(view.number)} status`}
              value={view.status}
              onValueChange={(value) => onStatus(value as SemesterStatus)}
              options={(Object.keys(STATUS_LABEL) as SemesterStatus[]).map((status) => ({
                value: status,
                label: STATUS_LABEL[status],
              }))}
            />
          </Field>
          {view.result !== null && (
            <Button asChild size="sm">
              <Link to={`/results/${String(view.number)}`}>View results</Link>
            </Button>
          )}
          <IconButton size="sm" label="Close semester detail" onClick={onClose}>
            <X />
          </IconButton>
        </div>
      </div>
      <div className="mb-4 flex flex-col gap-2">
        {sgpa === null && reading.reason !== null && view.result !== null && (
          <Callout>{reading.reason}</Callout>
        )}
        {view.sgpaDisagrees && (
          <Callout tone="warning">
            Your grade card says {formatGpa(view.sgpaAsserted ?? 0)}; these grades work out to{' '}
            {formatGpa(sgpa ?? 0)}. Both are shown — check the entry.
          </Callout>
        )}
        {view.result !== null && view.ruleSetResolution === 'fallback' && (
          <Callout>
            Saved before rule versions were recorded, so it is read under the current rules.
          </Callout>
        )}
        {view.ruleSetResolution === 'unavailable' && (
          <Callout tone="warning">
            This semester was graded under rules this version of GradTools does not have (
            {view.missingRuleSetId}). Its SGPA is left blank rather than worked out under the
            current rules.
          </Callout>
        )}
      </div>
      <SemesterSubjects semester={view.number} profileId={profileId} />
    </Card>
  );
}
