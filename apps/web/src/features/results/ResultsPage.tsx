/**
 * Results — the design's overview (metric row + semester ledger) and
 * semester-card grid, with search across semesters and course codes/titles.
 *
 * Every SGPA shown comes from the rules engine; a semester that cannot be
 * graded says "Unavailable" with its reason rather than a dash.
 */

import { vtu2022RuleSet } from '@gradtools/academic-rules';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  ClipboardList,
  Plus,
  Search,
} from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Badge } from '../../components/ui/badge.js';
import { Button } from '../../components/ui/button.js';
import { Card } from '../../components/ui/card.js';
import { Callout, EmptyState } from '../../components/ui/feedback.js';
import { Input } from '../../components/ui/field.js';
import { Metric, MetricGrid } from '../../components/ui/metric.js';
import { PageHeader } from '../../components/ui/page.js';
import { Progress } from '../../components/ui/progress.js';
import { Segmented } from '../../components/ui/segmented.js';
import { PageSkeleton } from '../../components/ui/skeleton.js';
import { ruleSetForResult } from '../../domain/academics.js';
import { asStudentProfileId } from '../../domain/identity.js';
import { semesterBacklogs } from '../../domain/results.js';
import { hasNoBacklogs, type SemesterStatistics } from '../../domain/statistics.js';
import type { SemesterResult } from '../../domain/types.js';
import { useAcademicState } from '../../hooks/useAcademicState.js';
import { useProfile, useResults } from '../../hooks/useCollection.js';
import { branchCode, formatCount, formatGpa, metricDisplay } from '../../lib/format.js';
import { ResultEditor } from './ResultEditor.js';

type View = 'overview' | 'semesters';

export function ResultsPage() {
  const { items, loading, save } = useResults();
  const { statistics } = useAcademicState();
  const { profile } = useProfile();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [view, setView] = useState<View>('overview');
  const [query, setQuery] = useState('');
  const editing = params.get('new') === '1';

  const closeEditor = (): void => {
    const next = new URLSearchParams(params);
    next.delete('new');
    setParams(next, { replace: true });
  };

  if (loading) return <PageSkeleton label="Loading your results" />;

  const eyebrow =
    [
      profile?.branch ? branchCode(profile.branch) : null,
      profile?.schemeId === 'vtu-2022' ? '2022 scheme' : null,
    ]
      .filter((part): part is string => part !== undefined && part !== null && part !== '')
      .join(' · ') || 'Academic record';
  const needle = query.trim().toLowerCase();
  const sorted = [...items]
    .filter(
      (item) =>
        needle === '' ||
        `semester ${String(item.semester)} s${String(item.semester)}`.includes(needle) ||
        item.subjects.some((subject) =>
          `${subject.subjectTitle} ${subject.subjectCode ?? ''}`.toLowerCase().includes(needle),
        ),
    )
    .sort((a, b) => a.semester - b.semester);
  const anyMismatch = statistics.views.some((entry) => entry.sgpaDisagrees);
  const statsFor = (semester: number): SemesterStatistics | null =>
    statistics.semesters.find((entry) => entry.number === semester) ?? null;

  const cgpa = metricDisplay(statistics.cgpa, formatGpa);
  const credits = metricDisplay(statistics.creditsEarned);
  const backlogCount = statistics.backlogsFromResults.value ?? 0;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow={eyebrow}
        title="Results"
        description="Every semester, course and grade in one academic record."
        actions={
          <>
            <Button asChild variant="secondary">
              <Link to="/academics">SGPA &amp; CGPA</Link>
            </Button>
            <Button asChild variant="primary" icon={<Plus />}>
              <Link to="/import">Add result</Link>
            </Button>
          </>
        }
      />

      {editing && (
        <ResultEditor
          existing={null}
          taken={items.map((item) => item.semester)}
          profileId={profile?.id ?? asStudentProfileId('local')}
          schemeId={profile?.schemeId ?? vtu2022RuleSet.schemeId}
          branch={profile?.branch ?? null}
          onCancel={closeEditor}
          onSave={(result) => {
            void save(result).then(() => navigate(`/results/${String(result.semester)}`));
          }}
        />
      )}

      {items.length === 0 ? (
        !editing && (
          <EmptyState
            icon={<ClipboardList />}
            title="No results yet"
            description="Import a result card or enter a semester by hand to see SGPA and CGPA."
            actions={
              <>
                <Button asChild variant="primary" icon={<Plus />}>
                  <Link to="/import">Add result</Link>
                </Button>
                <Button onClick={() => setParams({ new: '1' })}>Add a semester</Button>
              </>
            }
          />
        )
      ) : (
        <>
          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
            <Segmented<View>
              label="Results view"
              value={view}
              onChange={setView}
              options={[
                { value: 'overview', label: 'Overview' },
                { value: 'semesters', label: `Semesters · ${String(items.length)}` },
              ]}
            />
            <div className="relative w-full sm:w-72">
              <Search
                aria-hidden="true"
                className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-3"
              />
              <Input
                type="search"
                aria-label="Search semesters and subjects"
                placeholder="Search semester or course…"
                className="pl-9"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>
          </div>

          {anyMismatch && (
            <Callout tone="warning">
              Where a grade card and the calculated figure disagree, GradTools shows both rather
              than picking one. It usually means a subject entry has a typo, or a grade needs
              checking.
            </Callout>
          )}

          {view === 'overview' ? (
            <>
              <MetricGrid>
                <Metric
                  label="CGPA"
                  value={cgpa.value}
                  state={statistics.cgpa.value === null ? 'unavailable' : 'resolved'}
                  sub={cgpa.note ?? 'Credit-weighted'}
                />
                <Metric
                  label="Credits earned"
                  value={credits.value}
                  state={statistics.creditsEarned.value === null ? 'unavailable' : 'resolved'}
                  sub={credits.note}
                />
                <Metric
                  label="Courses passed"
                  value={statistics.outcomes.passed}
                  sub={
                    statistics.outcomes.unresolved > 0
                      ? `${String(statistics.outcomes.unresolved)} still to review`
                      : `of ${String(statistics.grades.total)} courses`
                  }
                />
                <Metric
                  /* The results' own figure; the unqualified "Backlogs" is the recorded one (OQ-056). */
                  label="Backlogs in your results"
                  value={
                    statistics.backlogsUndetermined > 0
                      ? `${String(backlogCount)}+`
                      : String(backlogCount)
                  }
                  emphasis={backlogCount > 0 ? 'warning' : undefined}
                  sub={
                    statistics.backlogsFromResults.reason ??
                    /*
                     * The figure is the results' own; "Clear record" is a claim
                     * about the student, so it also needs no recorded backlog.
                     */
                    (hasNoBacklogs(statistics) ? 'Clear record' : undefined)
                  }
                />
              </MetricGrid>
              {statistics.backlogsUndetermined > 0 && (
                <Callout tone="warning">
                  {formatCount(statistics.backlogsUndetermined, 'subject')} could not be checked for
                  a backlog, because whether the course has a semester-end exam is not recorded. The
                  backlog count is at least {backlogCount}.
                </Callout>
              )}
              {sorted.length === 0 ? (
                <NoMatches query={query} />
              ) : (
                <ol className="grid gap-3">
                  {sorted.map((result) => (
                    <li key={result.id}>
                      <SemesterRow result={result} stats={statsFor(result.semester)} />
                    </li>
                  ))}
                </ol>
              )}
            </>
          ) : sorted.length === 0 ? (
            <NoMatches query={query} />
          ) : (
            <ul className="grid gap-3 sm:grid-cols-2">
              {sorted.map((result) => (
                <li key={result.id}>
                  <SemesterCard result={result} stats={statsFor(result.semester)} />
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      <p className="text-[12px] leading-relaxed text-ink-3">
        GradTools does not fetch results from the university portal — that site asks automated tools
        not to access it, and we respect that. We never ask for your portal password either. Enter a
        result card as it is printed, or import it, and SGPA and CGPA follow from it.
      </p>
    </div>
  );
}

function NoMatches({ query }: { readonly query: string }) {
  return (
    <EmptyState
      icon={<Search />}
      title="No matching records"
      description={`Nothing in your record matches “${query.trim()}”. Search by semester, subject name or subject code.`}
    />
  );
}

/** The design's row status: an icon and a word, no pill. */
function StateText({
  backlogs,
  undetermined,
}: {
  readonly backlogs: number;
  readonly undetermined: number;
}) {
  const [tone, Icon, text] =
    backlogs > 0
      ? (['text-danger', AlertTriangle, formatCount(backlogs, 'backlog')] as const)
      : undetermined > 0
        ? (['text-warning', AlertTriangle, 'Needs review'] as const)
        : (['text-success', CheckCircle2, 'Completed'] as const);
  return (
    <span className={`flex items-center gap-1.5 text-[12px] font-medium ${tone}`}>
      <Icon className="size-4" aria-hidden="true" />
      <span className="sr-only md:not-sr-only">{text}</span>
    </span>
  );
}

function StateBadge({
  backlogs,
  undetermined,
}: {
  readonly backlogs: number;
  readonly undetermined: number;
}) {
  if (backlogs > 0) {
    return (
      <Badge tone="danger" icon={<AlertTriangle />}>
        {formatCount(backlogs, 'backlog')}
      </Badge>
    );
  }
  if (undetermined > 0) return <Badge>Needs review</Badge>;
  return (
    <Badge tone="success" icon={<CheckCircle2 />}>
      Completed
    </Badge>
  );
}

function SemesterRow({
  result,
  stats,
}: {
  readonly result: SemesterResult;
  readonly stats: SemesterStatistics | null;
}) {
  const { backlogs, undetermined } = semesterBacklogs(result, ruleSetForResult(result).ruleSet);
  const sgpa = stats?.sgpa.value ?? null;
  const credits = stats?.creditsAttempted.value ?? 0;
  return (
    <Card interactive asChild>
      <Link
        to={`/results/${String(result.semester)}`}
        aria-label={`Semester ${String(result.semester)}, SGPA ${sgpa === null ? 'unavailable' : formatGpa(sgpa)} — open the full record`}
        className="flex w-full items-center gap-4 p-4"
      >
        <span
          aria-hidden="true"
          className="grid size-11 shrink-0 place-items-center rounded-xl bg-sunken font-mono text-sm font-semibold"
        >
          S{result.semester}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] font-semibold">Semester {result.semester}</span>
          <span className="mt-0.5 block truncate text-[12px] text-ink-2">
            {formatCount(result.subjects.length, 'course')}
            {credits > 0 ? ` · ${String(credits)} credits` : ''}
            {stats !== null && stats.unresolvedCourses > 0
              ? ` · ${String(stats.unresolvedCourses)} need review`
              : ''}
          </span>
        </span>
        <span className="hidden text-right sm:block">
          <span className="block text-[11px] text-ink-3">SGPA</span>
          {sgpa === null ? (
            <span
              className="block text-sm font-medium text-ink-3"
              title={stats?.sgpa.reason ?? undefined}
            >
              Unavailable
            </span>
          ) : (
            <span className="tnum block text-lg font-semibold">{formatGpa(sgpa)}</span>
          )}
        </span>
        <span className="shrink-0">
          <StateText backlogs={backlogs} undetermined={undetermined} />
        </span>
        <ChevronRight className="size-4 shrink-0 text-ink-3" aria-hidden="true" />
      </Link>
    </Card>
  );
}

function SemesterCard({
  result,
  stats,
}: {
  readonly result: SemesterResult;
  readonly stats: SemesterStatistics | null;
}) {
  const { backlogs, undetermined } = semesterBacklogs(result, ruleSetForResult(result).ruleSet);
  const sgpa = stats?.sgpa.value ?? null;
  const credits = stats?.creditsAttempted.value ?? null;
  const checked = result.subjects.length - undetermined;
  const passRate = checked > 0 ? Math.round(((checked - backlogs) / checked) * 100) : null;
  return (
    <Card interactive asChild>
      <Link
        to={`/results/${String(result.semester)}`}
        aria-label={`Semester ${String(result.semester)} — open the full record`}
        className="flex h-full flex-col p-5"
      >
        <span className="flex items-start justify-between gap-3">
          <span>
            <span className="block font-mono text-[11px] tracking-[0.14em] text-ink-3 uppercase">
              Semester {result.semester}
            </span>
            {sgpa === null ? (
              <span className="mt-2 block text-[20px] leading-none font-semibold text-ink-3">
                Unavailable
              </span>
            ) : (
              <span className="tnum mt-1 block text-[32px] leading-none font-semibold">
                {formatGpa(sgpa)}
              </span>
            )}
            <span className="mt-0.5 block text-[12px] text-ink-2">SGPA</span>
          </span>
          <StateBadge backlogs={backlogs} undetermined={undetermined} />
        </span>
        <span className="mt-4 block">
          <span className="mb-1.5 flex justify-between text-[12px] text-ink-2">
            <span>
              {formatCount(result.subjects.length, 'course')}
              {credits !== null && credits > 0 ? ` · ${String(credits)} credits` : ''}
            </span>
            <span className="tnum">
              {passRate === null ? 'Pass rate unavailable' : `${String(passRate)}% pass`}
            </span>
          </span>
          <Progress value={passRate ?? 0} tone="success" />
        </span>
        {undetermined > 0 && (
          <span className="mt-3 block text-[12px] text-ink-3">
            {formatCount(undetermined, 'subject')} could not be checked — whether the course has a
            semester-end exam is not recorded.
          </span>
        )}
      </Link>
    </Card>
  );
}
