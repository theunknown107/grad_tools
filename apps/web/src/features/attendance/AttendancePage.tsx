/**
 * Attendance, drawn as a register: a verdict, then one row per course on a
 * shared scale, worst first.
 *
 * THE RULE IS PER COURSE, so the page leads with how many courses clear it and
 * not with a pooled percentage, which can read as safe while one course is
 * below the DX floor. The pooled figure stays, labelled as what it is.
 *
 * Every percentage and verdict comes from @gradtools/academic-rules and the
 * official rule set, unmodified (lib/attendance-criteria): 85% per course is
 * the requirement, a shortage of up to 10 points may be condoned at the Vice
 * Chancellor's discretion, and below 75% the course is DX (22OB 3.7). A
 * personal target only adds its own line to the plan. No "attendance
 * over time" chart is drawn: the product stores counts, not a dated history,
 * and a trend line through numbers it does not have would be invented.
 */

import { SchemeNotice, useSchemeRules } from '../../hooks/useSchemeRules.js';
import {
  calculateAttendance,
  calculateClassesCanMiss,
  calculateClassesMustAttend,
  type AttendanceStatus,
} from '@gradtools/academic-rules';
import { CalendarCheck2, Check, MoreHorizontal, Plus, Trash2, X } from 'lucide-react';
import { useState } from 'react';
import { ExplanationDisclosure } from '../../components/academic/ExplanationDisclosure.js';
import { Button, IconButton } from '../../components/ui/button.js';
import { Card, CardHeader, CardRows } from '../../components/ui/card.js';
import { Dialog, DialogBody, DialogContent } from '../../components/ui/dialog.js';
import { Callout, EmptyState, Unavailable, toast } from '../../components/ui/feedback.js';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../../components/ui/menu.js';
import { Field, Input, Select } from '../../components/ui/field.js';
import { Metric, MetricStrip } from '../../components/ui/metric.js';
import { PageHeader } from '../../components/ui/page.js';
import { PageSkeleton } from '../../components/ui/skeleton.js';
import { Tooltip } from '../../components/ui/tooltip.js';
import {
  countDelta,
  markClass,
  openingFor,
  openingOf,
  shiftOpening,
  type ClassOutcome,
} from '../../domain/attendance.js';
import { buildSemesterViews, currentSemester } from '../../domain/academics.js';
import { asStudentProfileId } from '../../domain/identity.js';
import { type AttendanceRecord, type SemesterSubject } from '../../domain/types.js';
import { effectiveDay } from '../../domain/day-schedule.js';
import { Segmented } from '../../components/ui/segmented.js';
import {
  useAttendance,
  useAttendanceLedger,
  useProfile,
  useSemesterSubjects,
  useSemesters,
  useTimetable,
  useTimetableOverrides,
} from '../../hooks/useCollection.js';
import { SEMESTER_OPTIONS } from '../import/CalendarReview.js';
import { useNow, useTodayLabel } from '../../hooks/useNow.js';
import { DateView } from './DateView.js';
import { DayView, NowLine } from './DayView.js';
import { HistoryView } from './HistoryView.js';
import {
  PERSONAL_TARGET_OPTIONS,
  attendanceRules,
  setPersonalTarget,
  targetRules,
  usePersonalTarget,
} from '../../lib/attendance-criteria.js';
import { cn } from '../../lib/cn.js';
import { formatCount, formatPercent } from '../../lib/format.js';
import { newId, nowIso } from '../../lib/id.js';

/* The official VTU rules, unmodified (lib/attendance-criteria). */
const rules = attendanceRules;

const STATUS: Record<AttendanceStatus, { label: string; ink: string; fill: string }> = {
  safe: { label: 'Meets requirement', ink: 'text-ink', fill: 'bg-ink-2' },
  below_requirement: { label: 'Below requirement', ink: 'text-warning', fill: 'bg-warning' },
  dx_risk: { label: 'Below 75% (DX)', ink: 'text-danger', fill: 'bg-danger' },
};

/** Where one course stands, and the classes between it and the rule. */
function standingOf(record: AttendanceRecord) {
  const attendance = calculateAttendance(record.attended, record.conducted, rules());
  if (!attendance.ok) return null;
  const { percentage, status } = attendance.value;
  const canMiss = calculateClassesCanMiss(record.attended, record.conducted, rules());
  const mustAttend = calculateClassesMustAttend(record.attended, record.conducted, rules());
  const margin =
    status === 'safe'
      ? canMiss.ok && canMiss.value > 0
        ? `Margin of ${String(canMiss.value)}`
        : 'No margin'
      : mustAttend.ok && mustAttend.value > 0
        ? `Attend next ${String(mustAttend.value)}`
        : STATUS[status].label;
  return { percentage, status, margin };
}

/**
 * The student's own goal, at or above the requirement. It never changes a
 * verdict: it only adds its own line to each course's plan.
 */
function TargetPicker({ value }: { readonly value: number }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <span className="text-label font-medium text-ink" aria-hidden="true">
        Personal target
      </span>
      <Select
        aria-label="Personal target"
        aria-describedby="attendance-target-note"
        value={String(value)}
        onValueChange={(next) => setPersonalTarget(Number(next))}
        options={PERSONAL_TARGET_OPTIONS.map((percent) => ({
          value: String(percent),
          label:
            percent === rules().attendanceRequiredPct
              ? `${String(percent)}% (the VTU requirement)`
              : `${String(percent)}% per course`,
        }))}
        className="w-auto min-w-44"
      />
      <p id="attendance-target-note" className="basis-full text-caption text-ink-2">
        Your own goal. Every verdict on this page uses VTU&rsquo;s rule, whatever you pick here.
      </p>
    </div>
  );
}

/** The register's scale starts at 50%: the decisions all happen above it. */
const SCALE_FLOOR = 50;
const onScale = (percentage: number): number =>
  (Math.max(percentage - SCALE_FLOOR, 0) / (100 - SCALE_FLOOR)) * 100;

/** Today is the default: the screen is opened to mark the day's classes. */
type View = 'today' | 'courses' | 'calendar' | 'history';

function subjectName(code: string, subjects: readonly SemesterSubject[]): string | null {
  return subjects.find((subject) => subject.code === code)?.title ?? null;
}

/**
 * Attendance, gated on the scheme. Every verdict on this page — the 85% line,
 * the DX floor, what may be missed — is a 2022 rule, so a profile on another
 * scheme sees that plainly rather than figures judged by the wrong regulation.
 */
export function AttendancePage() {
  const rules = useSchemeRules();
  if (!rules.builtIn) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Attendance" />
        <SchemeNotice rules={rules} what="Attendance requirements" />
      </div>
    );
  }
  return <AttendanceBody />;
}

function AttendanceBody() {
  const { items, loading, save, remove } = useAttendance();
  const { items: ledger, save: saveEntry } = useAttendanceLedger();
  const { profile } = useProfile();
  const { items: semesters, loading: semestersLoading } = useSemesters();
  const { items: semesterSubjects } = useSemesterSubjects();
  const { items: timetable } = useTimetable();
  const { items: overrides } = useTimetableOverrides();
  const [planning, setPlanning] = useState<AttendanceRecord | null>(null);
  const [adding, setAdding] = useState(false);
  const [view, setView] = useState<View>('today');
  /*
   * The date comes from the clock, not from this render: a student who leaves
   * the app open across midnight must not mark tomorrow's class against
   * yesterday (hooks/useNow).
   */
  const now = useNow();
  const label = useTodayLabel();
  const target = usePersonalTarget();

  if (loading || semestersLoading) return <PageSkeleton label="Loading attendance" />;

  const profileId = profile?.id ?? asStudentProfileId('local');
  /* The degree first, the profile second — the Dashboard's rule. Null is unset. */
  const semester =
    currentSemester(buildSemesterViews(semesters, []))?.number ?? profile?.currentSemester ?? null;
  const pooled = items.reduce(
    (running, record) => ({
      attended: running.attended + record.attended,
      conducted: running.conducted + record.conducted,
    }),
    { attended: 0, conducted: 0 },
  );
  const overall =
    pooled.conducted === 0 ? null : calculateAttendance(pooled.attended, pooled.conducted, rules());
  const standings = items.map(standingOf);
  const dxCount = standings.filter((standing) => standing?.status === 'dx_risk').length;
  const belowCount = standings.filter(
    (standing) => standing?.status === 'below_requirement',
  ).length;
  const judged = standings.filter((standing) => standing !== null).length;
  const anyDx = dxCount > 0;
  /* Worst first: the course that needs attention is never below the fold. */
  const register = [...items].sort(
    (a, b) =>
      (standingOf(a)?.percentage ?? Number.POSITIVE_INFINITY) -
      (standingOf(b)?.percentage ?? Number.POSITIVE_INFINITY),
  );

  const todayClasses = effectiveDay(now.today, timetable, overrides);
  const markableToday = todayClasses.filter((entry) => entry.markable);

  /**
   * The quick mark on the course list: one more class, no date attached.
   *
   * It goes into the subject's OPENING BALANCE rather than inventing a
   * `ClassOccurrence`, because this control genuinely does not know which class
   * it was — the row is a subject, not an hour. Dated marking lives on Today,
   * where there is a class to point at.
   *
   * The ledger and the counter move together, so the derived figure and the one
   * on screen cannot drift apart between syncs.
   */
  const mark = (record: AttendanceRecord, outcome: ClassOutcome): AttendanceRecord => {
    const next = markClass(record, outcome);
    const opening = openingFor(ledger, record.subjectCode);
    void saveEntry(shiftOpening(opening, countDelta(null, outcome)));
    void save(next);
    toast(`Recorded a ${outcome} class for ${record.subjectCode}.`, {
      description: `${String(next.attended)}/${String(next.conducted)} classes`,
      tone: outcome === 'attended' ? 'success' : 'warning',
      action: {
        label: 'Undo',
        onClick: () => {
          void saveEntry(
            shiftOpening(openingFor(ledger, record.subjectCode), countDelta(outcome, null)),
          );
          void save(record);
        },
      },
    });
    return next;
  };

  const semesterLabel = semester === null ? 'Semester attendance' : `Semester ${String(semester)}`;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow={semesterLabel}
        title="Attendance"
        description={`VTU requires ${String(rules().attendanceRequiredPct)}% in each course (22OB 3.7). Between ${String(rules().attendanceDxFloorPct)}% and ${String(rules().attendanceRequiredPct)}% a shortage may be condoned, at the Vice Chancellor's discretion. Below ${String(rules().attendanceDxFloorPct)}% the course is marked DX and you cannot sit its exam.`}
        actions={
          /* When nothing is tracked yet the empty state below carries this action, once. */
          items.length === 0 && timetable.length === 0 ? undefined : (
            <Button variant="primary" icon={<Plus />} onClick={() => setAdding(true)}>
              Add a course
            </Button>
          )
        }
      />

      <TargetPicker value={target} />

      {items.length === 0 && timetable.length === 0 ? (
        <EmptyState
          icon={<CalendarCheck2 />}
          title="No courses tracked yet"
          description="Add the courses you are taking this semester, or import your timetable, and GradTools will show where each course stands against the requirement."
          actions={
            <Button variant="primary" icon={<Plus />} onClick={() => setAdding(true)}>
              Add a course
            </Button>
          }
        />
      ) : (
        <>
          <section aria-labelledby="attendance-verdict">
            <h2
              id="attendance-verdict"
              className={cn(
                'font-display text-[22px] leading-tight font-semibold',
                anyDx ? 'text-danger' : belowCount > 0 ? 'text-warning' : 'text-ink',
              )}
            >
              {judged === 0
                ? 'No classes counted yet'
                : anyDx
                  ? `${formatCount(dxCount, 'course')} below the DX floor`
                  : belowCount > 0
                    ? `${formatCount(belowCount, 'course')} below ${String(rules().attendanceRequiredPct)}%`
                    : `All ${formatCount(judged, 'course')} at ${String(rules().attendanceRequiredPct)}% or above`}
            </h2>
            {anyDx && belowCount > 0 && (
              <p className="mt-1 text-[13px] text-warning">
                {formatCount(belowCount, 'more course')} below {rules().attendanceRequiredPct}%
              </p>
            )}
            <MetricStrip className="mt-4 grid-cols-3">
              <Metric
                plain
                size="compact"
                label="Overall attendance"
                value={overall?.ok === true ? overall.value.percentage.toFixed(1) : 'Unavailable'}
                unit={overall?.ok === true ? '%' : undefined}
                state={overall?.ok === true ? 'resolved' : 'unavailable'}
                sub="Pooled"
              />
              <Metric
                plain
                size="compact"
                label="Classes today"
                value={markableToday.length}
                sub={
                  timetable.length === 0
                    ? 'No timetable saved'
                    : todayClasses.length === 0
                      ? 'Nothing scheduled'
                      : 'On the timetable'
                }
              />
              <Metric
                plain
                size="compact"
                label="Classes held"
                value={pooled.conducted}
                sub={`${String(pooled.attended)} attended`}
              />
            </MetricStrip>
          </section>

          <Segmented<View>
            label="Which attendance view"
            value={view}
            onChange={setView}
            options={[
              { value: 'today', label: 'Today' },
              { value: 'courses', label: 'Courses' },
              { value: 'calendar', label: 'Calendar' },
              { value: 'history', label: 'History' },
            ]}
            className="w-full"
          />

          {view === 'today' && (
            <div className="flex flex-col gap-4">
              <NowLine date={label.date} clock={label.clock} />
              <DayView
                date={now.today}
                time={now.time}
                slots={timetable}
                overrides={overrides}
                titleFor={(code) => subjectName(code, semesterSubjects)}
                standingFor={(code) => {
                  const record = items.find((item) => item.subjectCode === code);
                  const standing = record === undefined ? null : standingOf(record);
                  return standing === null
                    ? null
                    : `${formatPercent(standing.percentage)} · ${standing.margin}`;
                }}
                showTiming
                emptyTitle={timetable.length === 0 ? 'No timetable yet' : 'Nothing on today'}
                emptyDescription={
                  timetable.length === 0
                    ? 'Import or enter your weekly timetable and today’s classes appear here, ready to mark.'
                    : 'Your timetable has no classes for today. Enjoy it.'
                }
              />
            </div>
          )}

          {view === 'calendar' && (
            <DateView
              today={now.today}
              time={now.time}
              slots={timetable}
              entries={ledger}
              profile={profile ?? null}
              subjects={semesterSubjects}
              titleFor={(code) => subjectName(code, semesterSubjects)}
            />
          )}

          {view === 'history' && (
            <HistoryView
              entries={ledger}
              overrides={overrides}
              titleFor={(code) => subjectName(code, semesterSubjects)}
            />
          )}

          {view === 'courses' && (
            <div className="flex flex-col gap-4">
              <Card className="overflow-hidden">
                <CardHeader title="By course" />
                {items.length === 0 ? (
                  <div className="p-5">
                    <EmptyState
                      compact
                      icon={<CalendarCheck2 />}
                      title="No courses tracked yet"
                      description="Mark a class on Today, or add a course with the totals so far."
                    />
                  </div>
                ) : (
                  <>
                    <ScaleHeader />
                    <CardRows>
                      {register.map((record) => (
                        <CourseRow
                          key={record.id}
                          record={record}
                          name={subjectName(record.subjectCode, semesterSubjects)}
                          onPlan={() => setPlanning(record)}
                          onMark={(outcome) => void mark(record, outcome)}
                          onRemove={() => {
                            void remove(record.id);
                            toast(`Stopped tracking ${record.subjectCode}`);
                          }}
                        />
                      ))}
                    </CardRows>
                  </>
                )}
                {(belowCount > 0 || anyDx) && (
                  <p className="border-t border-line px-5 py-4 text-caption leading-relaxed text-ink-2">
                    Below {rules().attendanceRequiredPct}% a course does not meet the requirement. A
                    shortage of up to {rules().attendanceCondonablePct} points may be condoned by
                    the Vice Chancellor on the Principal&rsquo;s recommendation with supporting
                    documents. This is discretionary, not automatic. Below{' '}
                    {rules().attendanceDxFloorPct}% a course is marked DX and you are not permitted
                    to sit its Semester End Examination (clause 22OB 3.7(5)).
                  </p>
                )}
              </Card>
              <Standing pooled={pooled} />
            </div>
          )}
        </>
      )}

      <AddCourseDialog
        open={adding}
        onOpenChange={setAdding}
        subjects={semesterSubjects}
        semester={semester}
        onAdd={(record) => {
          /*
           * The totals the student types are an OPENING BALANCE: classes that
           * happened before this device was counting. Writing only the counter
           * would leave the ledger disagreeing with the screen, and the next
           * sync would re-derive the figure back down to nothing.
           */
          void saveEntry(
            openingOf(record.subjectCode, {
              attended: record.attended,
              conducted: record.conducted,
            }),
          );
          void save({ ...record, profileId });
          toast(`Tracking ${record.subjectCode}`, { tone: 'success' });
        }}
      />

      <BunkPlanner
        target={target}
        record={planning}
        name={planning === null ? null : subjectName(planning.subjectCode, semesterSubjects)}
        onClose={() => setPlanning(null)}
      />
    </div>
  );
}

/* --------------------------------------------------------------- Standing */

/** The pooled figure and its working, below the register that actually decides. */
function Standing({
  pooled,
}: {
  readonly pooled: { readonly attended: number; readonly conducted: number };
}) {
  if (pooled.conducted === 0) return null;
  const overall = calculateAttendance(pooled.attended, pooled.conducted, rules());
  if (!overall.ok) return null;
  return (
    <div className="px-1">
      <p className="text-[13px] leading-relaxed text-ink-2">
        {pooled.attended} of {pooled.conducted} classes attended across every course. The
        requirement applies per course (22OB 3.7), so the register above is what decides whether you
        can sit each exam.
      </p>
      <ExplanationDisclosure explanation={overall.explanation} className="mt-2" />
    </div>
  );
}

/* --------------------------------------------------------------- Register */

/** The two lines every row is read against, labelled once, above the rows. */
function ScaleHeader() {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] border-b border-line px-5 py-2 sm:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_11.5rem] sm:gap-4">
      <span className="hidden text-[12px] text-ink-3 sm:block">Course</span>
      <div className="relative h-4 font-mono text-[12px] text-ink-3" aria-hidden="true">
        <span
          className="absolute -translate-x-full pr-1 text-danger"
          style={{ left: `${String(onScale(rules().attendanceDxFloorPct))}%` }}
        >
          {rules().attendanceDxFloorPct}
        </span>
        <span
          className="absolute pl-1"
          style={{ left: `${String(onScale(rules().attendanceRequiredPct))}%` }}
        >
          {rules().attendanceRequiredPct}
        </span>
      </div>
      <span className="sr-only">
        Scale marks: {rules().attendanceDxFloorPct}% DX floor, {rules().attendanceRequiredPct}%
        requirement
      </span>
    </div>
  );
}

function Scale({ percentage, fill }: { readonly percentage: number; readonly fill: string }) {
  return (
    <div className="relative h-1.5 rounded-sm bg-sunken" aria-hidden="true">
      <div
        className={cn('h-full rounded-sm', fill)}
        style={{ width: `${String(onScale(percentage))}%` }}
      />
      <span
        className="absolute -top-1 h-3.5 w-px bg-danger"
        style={{ left: `${String(onScale(rules().attendanceDxFloorPct))}%` }}
      />
      <span
        className="absolute -top-1 h-3.5 w-px bg-ink"
        style={{ left: `${String(onScale(rules().attendanceRequiredPct))}%` }}
      />
    </div>
  );
}

function CourseRow({
  record,
  name,
  onMark,
  onPlan,
  onRemove,
}: {
  readonly record: AttendanceRecord;
  readonly name: string | null;
  readonly onMark: (outcome: ClassOutcome) => void;
  readonly onPlan: () => void;
  readonly onRemove: () => void;
}) {
  const attendance = calculateAttendance(record.attended, record.conducted, rules());
  const standing = standingOf(record);
  const title = name ?? record.subjectTitle;
  const meta = [
    title === record.subjectCode ? null : record.subjectCode,
    `${String(record.attended)}/${String(record.conducted)} classes`,
  ]
    .filter((part) => part !== null)
    .join(' · ');
  const actions = (
    <div className="flex shrink-0 items-center">
      <Button
        size="sm"
        variant="ghost"
        aria-label={`Plan against ${record.subjectCode}`}
        onClick={onPlan}
      >
        Plan
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <IconButton size="sm" label={`More actions for ${record.subjectCode}`}>
            <MoreHorizontal />
          </IconButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuLabel>Record a class</DropdownMenuLabel>
          <DropdownMenuItem
            icon={<Check />}
            label={`Mark a class attended for ${record.subjectCode}`}
            onSelect={() => onMark('attended')}
          >
            Attended
          </DropdownMenuItem>
          <DropdownMenuItem
            icon={<X />}
            label={`Mark a class missed for ${record.subjectCode}`}
            onSelect={() => onMark('missed')}
          >
            Missed
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            icon={<Trash2 />}
            destructive
            label={`Stop tracking ${record.subjectCode}`}
            onSelect={onRemove}
          >
            Stop tracking
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
  const heading = (
    <div className="min-w-0">
      <div className="truncate text-[14px] font-medium text-ink">{title}</div>
      <div className="truncate font-mono text-[12px] text-ink-3">{meta}</div>
    </div>
  );

  if (!attendance.ok || standing === null) {
    return (
      <div className="flex items-center gap-4 px-5 py-3.5">
        <div className="min-w-0 flex-1">{heading}</div>
        <Unavailable reason={attendance.ok ? 'Not available' : attendance.detail} />
        {actions}
      </div>
    );
  }
  const { percentage, status, margin } = standing;
  const presentation = STATUS[status];
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 px-5 py-3.5 sm:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_11.5rem]">
      <div className="sm:row-span-2">{heading}</div>
      <div className="col-span-2 row-start-2 sm:col-span-1 sm:col-start-2 sm:row-start-1">
        <Scale percentage={percentage} fill={presentation.fill} />
      </div>
      <div className="col-start-2 row-start-1 text-right sm:col-start-3">
        <Tooltip
          content={
            status === 'safe'
              ? `Meets VTU's ${String(rules().attendanceRequiredPct)}% requirement (22OB 3.7(1)).`
              : status === 'dx_risk'
                ? `Below ${String(rules().attendanceDxFloorPct)}%: the DX threshold is crossed. The course is marked DX and its exam cannot be sat (22OB 3.7(5)).`
                : `Below the ${String(rules().attendanceRequiredPct)}% requirement. A shortage of up to ${String(rules().attendanceCondonablePct)} points may be condoned at the Vice Chancellor's discretion; it is not automatic.`
          }
        >
          <button
            type="button"
            aria-label={`${formatPercent(percentage)}, ${presentation.label}. What this means`}
            className={cn(
              'tnum shrink-0 cursor-help text-right text-[16px] font-semibold',
              presentation.ink,
            )}
          >
            {formatPercent(percentage)}
          </button>
        </Tooltip>
      </div>
      <span
        className={cn(
          'row-start-3 text-[12px] sm:col-start-2 sm:row-start-2',
          status === 'safe' ? 'text-ink-2' : presentation.ink,
        )}
      >
        {status === 'safe' || margin === presentation.label
          ? margin
          : `${presentation.label} · ${margin}`}
      </span>
      <div className="col-start-2 row-start-3 flex justify-end sm:col-start-3 sm:row-start-2">
        {actions}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ Add course */

function AddCourseDialog({
  open,
  onOpenChange,
  subjects,
  semester,
  onAdd,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly subjects: readonly SemesterSubject[];
  /** The resolved current semester, pre-filled; null when the student has not said. */
  readonly semester: number | null;
  readonly onAdd: (record: AttendanceRecord) => void;
}) {
  const [code, setCode] = useState('');
  const [picked, setPicked] = useState<string | null>(null);
  const chosen = picked ?? (semester === null ? '' : String(semester));
  const [attended, setAttended] = useState('');
  const [conducted, setConducted] = useState('');
  const [error, setError] = useState<string | null>(null);

  const submit = (): void => {
    const cleaned = code.trim().toUpperCase();
    const attendedValue = Number(attended);
    const conductedValue = Number(conducted);
    if (cleaned === '') return setError('Enter a subject code.');
    if (chosen === '') return setError('Choose the semester this course is in.');
    if (
      attended.trim() === '' ||
      conducted.trim() === '' ||
      !Number.isInteger(attendedValue) ||
      !Number.isInteger(conductedValue)
    ) {
      return setError('Attended and conducted must be whole numbers.');
    }
    if (attendedValue > conductedValue) {
      return setError(
        `Attended (${String(attendedValue)}) cannot be more than conducted (${String(conductedValue)}).`,
      );
    }
    if (attendedValue < 0 || conductedValue < 1)
      return setError('Enter the classes held so far and how many you attended.');
    setError(null);
    onAdd({
      id: newId(),
      profileId: asStudentProfileId('local'),
      semester: Number(chosen),
      subjectCode: cleaned,
      subjectTitle: subjects.find((subject) => subject.code === cleaned)?.title ?? cleaned,
      attended: attendedValue,
      conducted: conductedValue,
      updatedAt: nowIso(),
    });
    setCode('');
    setPicked(null);
    setAttended('');
    setConducted('');
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="Add a course"
        description="Enter the counts so far. You can mark each class as it happens after this."
      >
        <DialogBody>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              submit();
            }}
            className="flex flex-col gap-4"
          >
            <Field
              label="Subject code"
              {...(subjects.length > 0 ? { hint: 'Your semester subjects are suggested.' } : {})}
            >
              <Input
                className="font-mono"
                placeholder="BCS304"
                list="semester-subject-codes"
                value={code}
                onChange={(event) => setCode(event.target.value)}
              />
            </Field>
            <datalist id="semester-subject-codes">
              {subjects.map((subject) => (
                <option key={subject.id} value={subject.code}>
                  {subject.title}
                </option>
              ))}
            </datalist>
            <Field
              label="Semester"
              {...(semester === null
                ? { hint: 'No current semester is set, so it cannot be guessed.' }
                : {})}
            >
              <Select
                value={chosen}
                onValueChange={setPicked}
                placeholder="Choose…"
                options={SEMESTER_OPTIONS}
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Attended">
                <Input
                  inputMode="numeric"
                  placeholder="42"
                  value={attended}
                  onChange={(event) => setAttended(event.target.value)}
                />
              </Field>
              <Field label="Conducted">
                <Input
                  inputMode="numeric"
                  placeholder="50"
                  value={conducted}
                  onChange={(event) => setConducted(event.target.value)}
                />
              </Field>
            </div>
            {error !== null && (
              <Callout tone="danger" role="alert">
                {error}
              </Callout>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" variant="primary" icon={<Plus />}>
                Add
              </Button>
            </div>
          </form>
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}

/* -------------------------------------------------------- Attendance plan */

function BunkPlanner({
  target,
  record,
  name,
  onClose,
}: {
  readonly target: number;
  readonly record: AttendanceRecord | null;
  readonly name: string | null;
  readonly onClose: () => void;
}) {
  const attendance =
    record === null ? null : calculateAttendance(record.attended, record.conducted, rules());
  const canMiss =
    record === null ? null : calculateClassesCanMiss(record.attended, record.conducted, rules());
  const mustAttend =
    record === null ? null : calculateClassesMustAttend(record.attended, record.conducted, rules());
  const safe = attendance?.ok === true && attendance.value.status === 'safe';
  /* The personal target, as its own line: never a verdict. */
  const aboveRequirement = target > rules().attendanceRequiredPct;
  const targetMiss =
    record === null || !aboveRequirement
      ? null
      : calculateClassesCanMiss(record.attended, record.conducted, targetRules(target));
  const targetAttend =
    record === null || !aboveRequirement
      ? null
      : calculateClassesMustAttend(record.attended, record.conducted, targetRules(target));

  return (
    <Dialog open={record !== null} onOpenChange={(open) => !open && onClose()}>
      {record !== null && (
        <DialogContent
          title="Attendance plan"
          description={
            name === null || name === record.subjectCode
              ? record.subjectCode
              : `${name} · ${record.subjectCode}`
          }
        >
          <DialogBody>
            {attendance?.ok === true ? (
              <>
                <p
                  role="status"
                  className={cn(
                    'font-display text-[20px] leading-snug font-semibold',
                    safe ? 'text-ink' : STATUS[attendance.value.status].ink,
                  )}
                >
                  {safe && canMiss?.ok === true
                    ? canMiss.value > 0
                      ? `Margin of ${formatCount(canMiss.value, 'class', 'classes')}`
                      : 'No margin left'
                    : mustAttend?.ok === true && mustAttend.value > 0
                      ? `Attend the next ${formatCount(mustAttend.value, 'class', 'classes')} to recover`
                      : 'Attendance is below the requirement'}
                </p>
                <p className="mt-1 text-[13px] text-ink-2">
                  {safe
                    ? `Missing more than this takes the course below ${String(attendance.value.requiredPct)}%.`
                    : `Reaching ${String(attendance.value.requiredPct)}% requires attending ${
                        mustAttend?.ok === true ? String(mustAttend.value) : 'the'
                      } consecutive upcoming sessions.`}
                </p>

                <dl className="mt-4 grid grid-cols-2 divide-x divide-line border-y border-line">
                  <div className="py-3 pr-4">
                    <dt className="text-[12px] text-ink-3">Current</dt>
                    <dd
                      className={cn(
                        'tnum mt-0.5 text-[22px] font-semibold',
                        STATUS[attendance.value.status].ink,
                      )}
                    >
                      {formatPercent(attendance.value.percentage)}
                    </dd>
                    <dd className="text-[12px] text-ink-3">
                      {record.attended} of {record.conducted} classes
                    </dd>
                  </div>
                  <div className="py-3 pl-4">
                    <dt className="text-[12px] text-ink-3">Required</dt>
                    <dd className="tnum mt-0.5 text-[22px] font-semibold">
                      {formatPercent(attendance.value.requiredPct)}
                    </dd>
                    <dd className="text-[12px] text-ink-3">University minimum</dd>
                  </div>
                </dl>

                {aboveRequirement && (
                  <p className="mt-3 text-label text-ink-2">
                    <span className="font-medium text-ink">Your {target}% target:</span>{' '}
                    {targetMiss?.ok === true && targetMiss.value > 0
                      ? `you can miss ${formatCount(targetMiss.value, 'class', 'classes')} and stay at it.`
                      : targetAttend?.ok === true && targetAttend.value > 0
                        ? `attend the next ${formatCount(targetAttend.value, 'class', 'classes')} to reach it.`
                        : targetAttend?.ok === false || targetMiss?.ok === false
                          ? 'not reachable with the classes recorded.'
                          : 'met, with no margin.'}{' '}
                    This is your goal, not the eligibility rule.
                  </p>
                )}
                <p className="mt-3 text-[12px] text-ink-3">
                  From recorded classes only, assuming the schedule stays fixed (22OB 3.7).
                </p>
              </>
            ) : (
              <Callout>
                {attendance?.ok === false ? attendance.detail : 'No classes recorded yet.'}
              </Callout>
            )}

            <div className="mt-5 flex justify-end gap-2">
              <Button onClick={onClose}>Close</Button>
            </div>
          </DialogBody>
        </DialogContent>
      )}
    </Dialog>
  );
}
