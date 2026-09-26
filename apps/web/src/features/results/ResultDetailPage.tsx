/**
 * One semester's record — the design's result detail: metric row, then a
 * course table (desktop) / course list (phone) whose rows expand into every
 * figure the rules engine has for that course, each with its provenance.
 */

import { vtu2022RuleSet, type RuleSet } from '@gradtools/academic-rules';
import { ChevronDown, ClipboardList, FileText, Pencil, Trash2 } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Badge } from '../../components/ui/badge.js';
import { Button } from '../../components/ui/button.js';
import { Card } from '../../components/ui/card.js';
import { ConfirmDialog } from '../../components/ui/dialog.js';
import { Callout, EmptyState, toast } from '../../components/ui/feedback.js';
import { Metric, MetricGrid } from '../../components/ui/metric.js';
import { BackLink, PageHeader } from '../../components/ui/page.js';
import { PageSkeleton } from '../../components/ui/skeleton.js';
import { resultForSemester, ruleSetForResult } from '../../domain/academics.js';
import { asStudentProfileId } from '../../domain/identity.js';
import {
  evaluateResultSubject,
  semesterBacklogs,
  semesterCsv,
  semesterSgpa,
  type SubjectEvaluation,
} from '../../domain/results.js';
import { enrichRow, type RowEnrichment } from '../../domain/enrichment.js';
import { otherTitles, resolveSubject, type SubjectIdentity } from '../../domain/subjects.js';
import type { ResultSubject } from '../../domain/types.js';
import { useProfile, useResults } from '../../hooks/useCollection.js';
import { useSubjectIndex } from '../../hooks/useSubjectIndex.js';
import { gradeTone } from '../../components/academic/grade-tone.js';
import { cn } from '../../lib/cn.js';
import { formatCount, formatGpa } from '../../lib/format.js';
import { ResultEditor } from './ResultEditor.js';

const ruleSet = vtu2022RuleSet;
const COLUMNS = 'grid-cols-[minmax(0,1.6fr)_repeat(5,minmax(0,0.6fr))_minmax(0,0.8fr)]';

export function ResultDetailPage() {
  const { semester: param } = useParams();
  const navigate = useNavigate();
  const { items, loading, save, remove } = useResults();
  const { profile } = useProfile();
  const { index } = useSubjectIndex();
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  /* One resolution of a subject code, shared by the figures and the rows. */
  const identify = (code: string | null): SubjectIdentity | null =>
    code === null ? null : resolveSubject(index, code);

  const number = Number(param);
  const result = resultForSemester(items, number);
  const resolved = result === null ? null : ruleSetForResult(result);
  const evaluations = useMemo(
    () =>
      new Map(
        (result?.subjects ?? []).map((subject) => [
          subject.id,
          evaluateResultSubject(subject, resolved?.ruleSet),
        ]),
      ),
    [result, resolved],
  );

  if (loading) return <PageSkeleton label="Loading this semester" />;

  if (result === null || resolved === null) {
    return (
      <div className="flex flex-col gap-6">
        <BackLink to="/results">Back to results</BackLink>
        <EmptyState
          icon={<ClipboardList />}
          title={
            Number.isInteger(number)
              ? `No result for semester ${String(number)}`
              : 'No such semester'
          }
          description="Nothing is saved for this semester yet."
          actions={
            <Button asChild variant="primary">
              <Link to="/import">Add result</Link>
            </Button>
          }
        />
      </div>
    );
  }

  const { sgpa, credits, creditsKnown, inputs, gradePoints } = semesterSgpa(
    result,
    resolved.ruleSet,
    identify,
  );
  const { backlogs, undetermined } = semesterBacklogs(result, resolved.ruleSet);
  const asserted = result.sgpaAsserted;
  const discrepancy = sgpa !== null && asserted !== null && Math.abs(sgpa - asserted) >= 0.005;
  /* No courses means nothing was checked — zero backlogs out of zero is not a pass. */
  const empty = result.subjects.length === 0;
  const allPassed = !empty && backlogs === 0 && undetermined === 0;
  const exportCsv = (): void => {
    const blob = new Blob([semesterCsv(result, resolved.ruleSet)], {
      type: 'text/csv;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `gradtools-semester-${String(result.semester)}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
    toast(`Semester ${String(result.semester)} exported`, { tone: 'success' });
  };

  return (
    <div className="flex flex-col gap-6">
      <BackLink to="/results">Back to results</BackLink>
      <PageHeader
        eyebrow={`Semester ${String(result.semester)}`}
        title={`Semester ${String(result.semester)}`}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <Badge>{formatCount(result.subjects.length, 'course')}</Badge>
            {creditsKnown && <Badge>{credits} credits</Badge>}
            {backlogs > 0 ? (
              <Badge tone="danger">{formatCount(backlogs, 'backlog')}</Badge>
            ) : undetermined > 0 ? (
              <Badge tone="warning">Needs review</Badge>
            ) : (
              allPassed && <Badge tone="success">Completed</Badge>
            )}
          </span>
        }
        actions={
          <Button icon={<FileText />} onClick={exportCsv}>
            Export
          </Button>
        }
      />

      {editing && (
        <ResultEditor
          existing={result}
          taken={items.filter((item) => item.id !== result.id).map((item) => item.semester)}
          profileId={profile?.id ?? asStudentProfileId('local')}
          schemeId={profile?.schemeId ?? ruleSet.schemeId}
          branch={profile?.branch ?? null}
          onCancel={() => setEditing(false)}
          onSave={(next) => {
            void save(next).then(() => {
              setEditing(false);
              toast('Semester updated', { tone: 'success' });
              if (next.semester !== result.semester)
                navigate(`/results/${String(next.semester)}`, { replace: true });
            });
          }}
        />
      )}

      <MetricGrid>
        <Metric
          label="SGPA"
          value={sgpa === null ? 'Unavailable' : formatGpa(sgpa)}
          state={sgpa === null ? 'unavailable' : 'resolved'}
          sub={asserted !== null ? `Grade card ${formatGpa(asserted)}` : 'This semester'}
        />
        <Metric
          label="Credits"
          value={creditsKnown ? credits : 'Not recorded'}
          state={creditsKnown ? 'resolved' : 'unavailable'}
        />
        <Metric
          label="Grade points"
          value={gradePoints === null ? 'Unavailable' : gradePoints}
          state={gradePoints === null ? 'unavailable' : 'resolved'}
          sub={
            gradePoints === null
              ? `${String(inputs.courses.length)} of ${String(result.subjects.length)} courses graded`
              : 'Credit-weighted'
          }
        />
        <Metric
          label="Result"
          state={empty ? 'unavailable' : 'resolved'}
          value={
            empty
              ? 'Unavailable'
              : allPassed
                ? 'PASS'
                : backlogs > 0
                  ? `${String(backlogs)}${undetermined > 0 ? '+' : ''} backlog`
                  : 'Review'
          }
          emphasis={backlogs > 0 ? 'danger' : undetermined > 0 ? 'warning' : undefined}
          sub={
            empty
              ? 'No courses are recorded for this semester.'
              : undetermined > 0
                ? `${String(undetermined)} could not be checked`
                : undefined
          }
        />
      </MetricGrid>

      {discrepancy && (
        <Callout tone="warning" title="These disagree.">
          Grade card {formatGpa(asserted ?? 0)} · calculated {formatGpa(sgpa ?? 0)}. Both are shown;
          neither is corrected.
        </Callout>
      )}
      {sgpa === null && inputs.missing.length > 0 && (
        <Callout tone="warning" title="No SGPA yet.">
          SGPA needs a grade and credits for every subject, and{' '}
          {inputs.missing.map((entry) => entry.subjectCode).join(', ')} still{' '}
          {inputs.missing.length === 1 ? 'has' : 'have'} none. The marks below are unaffected.
        </Callout>
      )}
      {resolved.resolution === 'unavailable' && (
        <Callout tone="warning">
          This semester was graded under rule set {resolved.missingRuleSetId ?? ''}, which this
          version of GradTools does not have. Nothing is calculated from it — no other rule set is
          substituted.
        </Callout>
      )}

      <Card className="overflow-hidden">
        <div
          aria-hidden="true"
          className={cn(
            'hidden gap-2 border-b border-line bg-panel px-5 py-3 text-[11px] font-semibold tracking-wide text-ink-3 uppercase md:grid',
            COLUMNS,
          )}
        >
          <span>Course</span>
          <span className="text-right">Internal</span>
          <span className="text-right">External</span>
          <span className="text-right">Total</span>
          <span className="text-right">Credits</span>
          <span className="text-center">Grade</span>
          <span className="text-right">Result</span>
        </div>
        <ul
          aria-label={`Courses in semester ${String(result.semester)}`}
          className="divide-y divide-line"
        >
          {result.subjects.map((subject) => (
            <CourseRow
              key={subject.id}
              subject={subject}
              evaluation={evaluations.get(subject.id)}
              identity={identify(subject.subjectCode)}
              ruleSet={resolved.ruleSet}
              open={expanded === subject.id}
              onToggle={() => setExpanded(expanded === subject.id ? null : subject.id)}
            />
          ))}
        </ul>
      </Card>

      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button
          size="sm"
          variant="ghost"
          icon={<Pencil />}
          onClick={() => setEditing(true)}
          disabled={editing}
        >
          Edit this semester
        </Button>
        <Button
          size="sm"
          variant="ghost"
          icon={<Trash2 />}
          className="text-danger hover:text-danger"
          onClick={() => setConfirming(true)}
        >
          Delete this semester
        </Button>
      </div>

      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        destructive
        title={`Delete semester ${String(result.semester)}?`}
        description="Its courses, marks and grades are removed from this device, and SGPA, CGPA and backlogs are recalculated without it. This cannot be undone."
        confirmLabel="Delete semester"
        onConfirm={() => {
          setConfirming(false);
          void remove(result.id).then(() => {
            toast(`Semester ${String(result.semester)} deleted`, { tone: 'neutral' });
            navigate('/results', { replace: true });
          });
        }}
      />
    </div>
  );
}

/*
 * The row is one <button>, so nothing inside it may be focusable: an unknown
 * value is a plain dash with its meaning in text, and the reason lives in the
 * expanded detail. Each cell carries its column name for screen readers,
 * because the visual header row is decorative.
 */
function mark(value: number | null) {
  return value === null ? (
    <>
      <span aria-hidden="true" className="text-ink-3">
        —
      </span>
      <span className="sr-only">not recorded</span>
    </>
  ) : (
    <span className="tnum">{value}</span>
  );
}

function Cell({
  label,
  className,
  children,
}: {
  readonly label: string;
  readonly className?: string;
  readonly children: ReactNode;
}) {
  return (
    <span className={cn('hidden text-right text-[13px] md:block', className)}>
      <span className="sr-only">, {label} </span>
      {children}
    </span>
  );
}

function OutcomeBadge({
  evaluation,
  status,
  hasSee,
}: {
  readonly evaluation: SubjectEvaluation | undefined;
  readonly status: string | null;
  readonly hasSee: boolean | null;
}) {
  if (status !== null)
    return (
      <Badge tone={status === 'P' ? 'success' : status === 'F' ? 'danger' : 'neutral'}>
        {status}
      </Badge>
    );
  if (evaluation?.backlog === true) return <Badge tone="danger">Backlog</Badge>;
  if (evaluation?.backlog === false) return <Badge tone="success">Passed</Badge>;
  return <Badge>{hasSee === null ? 'SEE unknown' : 'Not checked'}</Badge>;
}

function CourseRow({
  subject,
  evaluation,
  identity,
  ruleSet: pinned,
  open,
  onToggle,
}: {
  readonly subject: ResultSubject;
  readonly evaluation: SubjectEvaluation | undefined;
  readonly identity: SubjectIdentity | null;
  readonly ruleSet: RuleSet | undefined;
  readonly open: boolean;
  readonly onToggle: () => void;
}) {
  /*
   * THE SAME READING THE REVIEW SCREEN SHOWS (domain/enrichment).
   *
   * This row used to read `subject.credits` and `subject.gradeLetter` raw, so
   * a course the catalogue does not carry — a PE or self-study row whose
   * credits the student recorded in their semester plan — showed a dash here
   * while the import screen had just resolved it. One function now answers
   * both, and where it has no answer the row still says so rather than
   * guessing.
   */
  const enriched = enrichRow(subject, identity, pinned);
  const grade = enriched.grade.value;
  const credits = enriched.credits.value;
  const detailId = `course-${subject.id}`;
  return (
    <li>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={detailId}
        onClick={onToggle}
        className={cn(
          'w-full px-4 py-3 text-left transition-colors hover:bg-panel md:grid md:items-center md:gap-2 md:px-5',
          COLUMNS,
        )}
      >
        <span className="flex min-w-0 items-center gap-3">
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] font-medium text-ink">
              {subject.subjectTitle}
            </span>
            <span className="block truncate font-mono text-[11px] text-ink-3">
              {subject.subjectCode}
              {credits !== null ? <span className="md:hidden"> · {credits} cr</span> : null}
            </span>
          </span>
          <span className="flex shrink-0 items-center gap-2 md:hidden">
            {grade === null ? (
              <Badge tone="warning">No grade</Badge>
            ) : (
              <Badge tone={gradeTone(grade)}>{grade}</Badge>
            )}
            <ChevronDown
              aria-hidden="true"
              className={cn('size-4 text-ink-3 transition-transform', open && 'rotate-180')}
            />
          </span>
        </span>
        <Cell label="Internal">{mark(subject.internal)}</Cell>
        <Cell label="External">
          {subject.hasSee === false ? (
            <>
              <span aria-hidden="true" className="text-ink-3">
                —
              </span>
              <span className="sr-only">no semester-end exam</span>
            </>
          ) : (
            mark(subject.external)
          )}
        </Cell>
        <Cell label="Total">
          {subject.total === null &&
          evaluation?.computedTotal !== null &&
          evaluation !== undefined ? (
            <span className="tnum text-ink-2">
              {evaluation.computedTotal}
              <span className="sr-only"> (calculated)</span>
            </span>
          ) : (
            mark(subject.total)
          )}
        </Cell>
        <Cell label="Credits">{mark(credits)}</Cell>
        <Cell label="Grade" className="md:flex md:justify-center">
          {grade === null ? mark(null) : <Badge tone={gradeTone(grade)}>{grade}</Badge>}
        </Cell>
        <Cell label="Result">
          <OutcomeBadge
            evaluation={evaluation}
            status={subject.resultStatus}
            hasSee={subject.hasSee}
          />
        </Cell>
      </button>
      {open && (
        <div id={detailId} className="animate-fade border-t border-line bg-panel px-5 py-4">
          <SubjectDetail
            subject={subject}
            evaluation={evaluation}
            identity={identity}
            enriched={enriched}
          />
        </div>
      )}
    </li>
  );
}

function SubjectDetail({
  subject,
  evaluation,
  identity,
  enriched,
}: {
  readonly subject: ResultSubject;
  readonly evaluation: SubjectEvaluation | undefined;
  readonly identity: SubjectIdentity | null;
  /** Computed once by the row, so the summary and the detail cannot disagree. */
  readonly enriched: RowEnrichment;
}) {
  const seeMax = ruleSet.courseMax - ruleSet.cieMax;
  const computedGrade = evaluation?.computedGrade ?? null;
  const variants = otherTitles(identity, subject.subjectTitle);
  const sourcePoints = evaluation?.sourceGrade?.points ?? null;
  const computedPoints = computedGrade?.points ?? null;
  const entries: { term: string; value: string | null; wide?: boolean }[] = [
    { term: 'Internal / CIE', value: subject.internal === null ? null : String(subject.internal) },
    {
      term: 'External / SEE',
      value:
        subject.hasSee === false
          ? 'Not applicable — no semester-end exam'
          : subject.external === null
            ? null
            : `${String(subject.external)} / ${String(seeMax)}`,
    },
    {
      term: 'Total',
      value:
        subject.total !== null
          ? `${String(subject.total)} · from the card`
          : evaluation?.computedTotal === null || evaluation === undefined
            ? null
            : `${String(evaluation.computedTotal)} · calculated`,
    },
    { term: 'Result', value: subject.resultStatus },
    {
      term: 'Grade',
      value:
        subject.gradeLetter !== null
          ? `${subject.gradeLetter} · from the card`
          : computedGrade !== null
            ? `${computedGrade.letter} · calculated`
            : null,
    },
    {
      term: 'Grade point',
      value:
        subject.gradePoint !== null
          ? `${String(subject.gradePoint)} · from the card`
          : sourcePoints !== null
            ? `${String(sourcePoints)} · calculated`
            : computedPoints !== null
              ? `${String(computedPoints)} · calculated`
              : null,
    },
    {
      /*
       * The source is `enrichRow`'s, not a guess from `provenance`: a figure
       * the student typed must never be labelled the catalogue's (§14), and
       * one resolved from their own earlier record says exactly that.
       */
      term: 'Credits',
      value:
        enriched.credits.value === null
          ? null
          : `${String(enriched.credits.value)}${
              enriched.credits.source === null ? '' : ` · ${enriched.credits.source}`
            }`,
    },
    {
      term: 'Backlog',
      value:
        evaluation === undefined || evaluation.backlog === null
          ? `Not known — ${evaluation?.unavailableReason ?? 'not enough information'}`
          : evaluation.backlog
            ? 'Yes'
            : 'No',
    },
  ];
  if (subject.announcedOn !== null)
    entries.push({ term: 'Announced on', value: subject.announcedOn });
  if (variants.length > 0)
    entries.push({
      term: 'Also recorded as',
      value: variants.map((entry) => entry.title).join(' · '),
      wide: true,
    });
  entries.push({
    term: 'Provenance',
    wide: true,
    value: `${subject.provenance === 'manual' ? 'Entered manually' : 'Read from your result card'}${
      subject.catalogueCode === null
        ? subject.provenance === 'manual'
          ? ' — not matched to the subject catalogue'
          : ''
        : ` — linked to ${subject.catalogueCode} in the VTU catalogue`
    }`,
  });

  return (
    <>
      {evaluation?.totalDisagrees === true && (
        <Callout tone="warning" className="mb-3" title="Total does not add up.">
          The card prints {String(subject.total)}, the columns add to{' '}
          {String(evaluation.computedTotal)}. Both are shown; neither is corrected.
        </Callout>
      )}
      <dl className="grid grid-cols-2 gap-x-8 gap-y-3 text-[12px] sm:grid-cols-4">
        {entries.map((entry) => (
          <div key={entry.term} className={cn(entry.wide === true && 'col-span-2')}>
            <dt className="text-ink-3">{entry.term}</dt>
            <dd
              className={cn(
                'mt-0.5 font-medium',
                entry.value === null ? 'text-ink-3' : 'tnum text-ink',
              )}
            >
              {entry.value ?? 'Unavailable'}
            </dd>
          </div>
        ))}
      </dl>
    </>
  );
}
