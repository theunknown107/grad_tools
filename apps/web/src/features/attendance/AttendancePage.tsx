/**
 * Attendance — the design's metric row, standing card, course list and bunk
 * planner dialog.
 *
 * Every percentage and verdict comes from @gradtools/academic-rules under the
 * VTU 2022 regulation: 85% per course, DX below 75% (22OB 3.7). The design's
 * "attendance over time" chart is not drawn: the product stores counts, not a
 * dated history, and a trend line through numbers it does not have would be
 * invented. The standing card shows what is known instead.
 */

import {
  calculateAttendance,
  calculateClassesCanMiss,
  calculateClassesMustAttend,
  vtu2022RuleSet,
  type AttendanceStatus,
} from '@gradtools/academic-rules';
import {
  CalendarCheck2,
  CalendarClock,
  Check,
  CircleHelp,
  MoreHorizontal,
  OctagonAlert,
  Plus,
  ShieldCheck,
  Trash2,
  TriangleAlert,
  X,
} from 'lucide-react';
import { useState } from 'react';
import { ExplanationDisclosure } from '../../components/academic/ExplanationDisclosure.js';
import { Badge, type Tone } from '../../components/ui/badge.js';
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
import { Field, Input } from '../../components/ui/field.js';
import { Metric, MetricGrid } from '../../components/ui/metric.js';
import { IconTile, PageHeader, SectionTitle } from '../../components/ui/page.js';
import { Progress } from '../../components/ui/progress.js';
import { PageSkeleton } from '../../components/ui/skeleton.js';
import { Tooltip } from '../../components/ui/tooltip.js';
import { markClass, type ClassOutcome } from '../../domain/attendance.js';
import { asStudentProfileId } from '../../domain/identity.js';
import { WEEKDAYS, type AttendanceRecord, type SemesterSubject } from '../../domain/types.js';
import {
  useAttendance,
  useProfile,
  useSemesterSubjects,
  useTimetable,
} from '../../hooks/useCollection.js';
import { cn } from '../../lib/cn.js';
import { formatCount, formatPercent } from '../../lib/format.js';
import { newId, nowIso } from '../../lib/id.js';

const ruleSet = vtu2022RuleSet;

const STATUS: Record<
  AttendanceStatus,
  { tone: Tone; label: string; Icon: typeof ShieldCheck; ink: string }
> = {
  safe: { tone: 'success', label: 'Safe', Icon: ShieldCheck, ink: 'text-ink' },
  below_requirement: {
    tone: 'warning',
    label: 'Below requirement',
    Icon: TriangleAlert,
    ink: 'text-warning',
  },
  dx_risk: { tone: 'danger', label: 'DX risk', Icon: OctagonAlert, ink: 'text-danger' },
};

function subjectName(code: string, subjects: readonly SemesterSubject[]): string | null {
  return subjects.find((subject) => subject.code === code)?.title ?? null;
}

export function AttendancePage() {
  const { items, loading, save, remove } = useAttendance();
  const { profile } = useProfile();
  const { items: semesterSubjects } = useSemesterSubjects();
  const { items: timetable } = useTimetable();
  const [planning, setPlanning] = useState<AttendanceRecord | null>(null);
  const [adding, setAdding] = useState(false);

  if (loading) return <PageSkeleton label="Loading attendance" />;

  const profileId = profile?.id ?? asStudentProfileId('local');
  const tracked = items.filter((record) => record.conducted > 0);
  const pooled = items.reduce(
    (running, record) => ({
      attended: running.attended + record.attended,
      conducted: running.conducted + record.conducted,
    }),
    { attended: 0, conducted: 0 },
  );
  const overall =
    pooled.conducted === 0 ? null : calculateAttendance(pooled.attended, pooled.conducted, ruleSet);
  const verdicts = items.map((record) =>
    calculateAttendance(record.attended, record.conducted, ruleSet),
  );
  const atRisk = verdicts.filter((verdict) => verdict.ok && verdict.value.status !== 'safe').length;
  const anyDx = verdicts.some((verdict) => verdict.ok && verdict.value.status === 'dx_risk');

  const dayIndex = new Date().getDay();
  const today = dayIndex === 0 ? null : (WEEKDAYS[dayIndex - 1] ?? null);
  const classesToday =
    today === null
      ? 0
      : timetable.filter((slot) => slot.day === today && slot.subjectCode !== null).length;

  const mark = (record: AttendanceRecord, outcome: ClassOutcome): AttendanceRecord => {
    const next = markClass(record, outcome);
    void save(next);
    toast(`Recorded a ${outcome} class for ${record.subjectCode}.`, {
      description: `${String(next.attended)}/${String(next.conducted)} classes`,
      tone: outcome === 'attended' ? 'success' : 'warning',
      action: { label: 'Undo', onClick: () => void save(record) },
    });
    return next;
  };

  const semesterLabel =
    profile?.currentSemester === null || profile?.currentSemester === undefined
      ? 'Semester attendance'
      : `Semester ${String(profile.currentSemester)}`;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow={semesterLabel}
        title="Attendance"
        description={`The requirement is ${String(ruleSet.attendanceRequiredPct)}% per course (clause 22OB 3.7). Below ${String(ruleSet.attendanceDxFloorPct)}% a course is marked DX and you cannot sit its exam.`}
        actions={
          <Button variant="primary" icon={<Plus />} onClick={() => setAdding(true)}>
            Add a course
          </Button>
        }
      />

      {items.length === 0 ? (
        <EmptyState
          icon={<CalendarCheck2 />}
          title="No courses tracked yet"
          description="Add the courses you are taking this semester and GradTools will show how many classes you can still miss."
          actions={
            <Button variant="primary" icon={<Plus />} onClick={() => setAdding(true)}>
              Add a course
            </Button>
          }
        />
      ) : (
        <>
          <MetricGrid>
            <Metric
              label="Overall attendance"
              value={overall?.ok === true ? overall.value.percentage.toFixed(1) : 'Unavailable'}
              unit={overall?.ok === true ? '%' : undefined}
              state={overall?.ok === true ? 'resolved' : 'unavailable'}
              emphasis={
                overall?.ok === true && overall.value.status !== 'safe'
                  ? overall.value.status === 'dx_risk'
                    ? 'danger'
                    : 'warning'
                  : undefined
              }
              sub={`Threshold ${String(ruleSet.attendanceRequiredPct)}%`}
            />
            <Metric
              label="Courses at risk"
              value={atRisk}
              emphasis={atRisk > 0 ? 'warning' : undefined}
              sub={atRisk > 0 ? 'Action needed' : 'All clear'}
            />
            <Metric
              label="Classes today"
              value={today === null ? 'None' : classesToday}
              state={today === null ? 'unavailable' : 'resolved'}
              sub={
                today === null
                  ? 'Sunday'
                  : timetable.length === 0
                    ? 'No timetable saved'
                    : new Date().toLocaleDateString('en-GB', { weekday: 'long' })
              }
            />
            <Metric
              label="Tracked courses"
              value={tracked.length}
              sub={
                items.length - tracked.length > 0
                  ? `${String(items.length - tracked.length)} awaiting data`
                  : `${String(pooled.conducted)} classes held`
              }
            />
          </MetricGrid>

          <div className="grid items-start gap-6 lg:grid-cols-[1fr_1.1fr]">
            <Standing pooled={pooled} />

            <Card className="overflow-hidden">
              <CardHeader
                title="By course"
                action={anyDx ? <Badge tone="danger">DX rule applies</Badge> : undefined}
              />
              <CardRows>
                {items.map((record) => (
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
              {anyDx && (
                <p className="border-t border-line px-5 py-4 text-[12px] leading-relaxed text-ink-2">
                  Below {ruleSet.attendanceDxFloorPct}% a course is marked DX and you are not
                  permitted to sit its Semester End Examination (clause 22OB 3.7(5)). A shortage of
                  up to {ruleSet.attendanceCondonablePct} points may be condoned by the Vice
                  Chancellor on the Principal&rsquo;s recommendation with supporting documents. This
                  is discretionary, not automatic.
                </p>
              )}
            </Card>
          </div>
        </>
      )}

      <AddCourseDialog
        open={adding}
        onOpenChange={setAdding}
        subjects={semesterSubjects}
        onAdd={(record) => {
          void save({ ...record, profileId, semester: profile?.currentSemester ?? 1 });
          toast(`Tracking ${record.subjectCode}`, { tone: 'success' });
        }}
      />

      <BunkPlanner
        record={planning}
        name={planning === null ? null : subjectName(planning.subjectCode, semesterSubjects)}
        onClose={() => setPlanning(null)}
      />
    </div>
  );
}

/* --------------------------------------------------------------- Standing */

function Standing({
  pooled,
}: {
  readonly pooled: { readonly attended: number; readonly conducted: number };
}) {
  if (pooled.conducted === 0) {
    return (
      <Card className="p-5">
        <SectionTitle>Where you stand</SectionTitle>
        <EmptyState
          compact
          icon={<CircleHelp />}
          title="No classes recorded yet"
          description="Mark a class, or enter the counts so far, and your standing appears here."
        />
      </Card>
    );
  }
  const overall = calculateAttendance(pooled.attended, pooled.conducted, ruleSet);
  if (!overall.ok) return null;
  const { percentage, status } = overall.value;
  const presentation = STATUS[status];
  return (
    <Card className="p-5">
      <SectionTitle
        action={
          <Badge tone={presentation.tone} icon={<presentation.Icon />}>
            {presentation.label}
          </Badge>
        }
      >
        Where you stand
      </SectionTitle>
      <div
        className={cn(
          'tnum text-[44px] leading-none font-semibold tracking-[-0.03em]',
          presentation.ink,
        )}
      >
        {formatPercent(percentage)}
      </div>
      <div className="relative mt-5" aria-hidden="true">
        <Progress value={percentage} tone={presentation.tone} className="h-3" />
        <span
          className="absolute -top-1 h-5 w-0.5 rounded-full bg-danger"
          style={{ left: `${String(ruleSet.attendanceDxFloorPct)}%` }}
        />
        <span
          className="absolute -top-1 h-5 w-0.5 rounded-full bg-ink"
          style={{ left: `${String(ruleSet.attendanceRequiredPct)}%` }}
        />
      </div>
      <div className="relative mt-2 h-4 text-[11px]" aria-hidden="true">
        <span
          className="absolute -translate-x-full pr-1 text-danger"
          style={{ left: `${String(ruleSet.attendanceDxFloorPct)}%` }}
        >
          {ruleSet.attendanceDxFloorPct}% DX
        </span>
        <span
          className="absolute pl-1 text-ink-2"
          style={{ left: `${String(ruleSet.attendanceRequiredPct)}%` }}
        >
          {ruleSet.attendanceRequiredPct}%
        </span>
      </div>
      <p className="mt-3 text-[13px] leading-relaxed text-ink-2">
        {pooled.attended} of {pooled.conducted} classes attended, pooled across every course you
        track. The requirement is applied{' '}
        <strong className="font-semibold text-ink">per course</strong> (22OB 3.7), so the list
        beside this is what decides whether you can sit each exam.
      </p>
      <ExplanationDisclosure explanation={overall.explanation} className="mt-3" />
    </Card>
  );
}

/* ------------------------------------------------------------ Course row */

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
  const attendance = calculateAttendance(record.attended, record.conducted, ruleSet);
  const title = name ?? record.subjectCode;
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

  if (!attendance.ok) {
    return (
      <div className="flex items-center gap-4 px-5 py-3.5">
        <IconTile>
          <CircleHelp />
        </IconTile>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-medium">{title}</div>
          <div className="font-mono text-[11px] text-ink-3">{record.subjectCode}</div>
        </div>
        <Unavailable reason={attendance.detail} />
        {actions}
      </div>
    );
  }
  const { percentage, status } = attendance.value;
  const presentation = STATUS[status];
  const tile = status === 'safe' ? 'success' : status === 'dx_risk' ? 'danger' : 'warning';
  return (
    <div className="flex items-center gap-4 px-5 py-3.5">
      <IconTile tone={tile}>
        <presentation.Icon />
      </IconTile>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] font-medium">{title}</div>
        <div className="truncate font-mono text-[11px] text-ink-3">
          {record.subjectCode} · {record.attended}/{record.conducted} classes
        </div>
      </div>
      <div className="hidden w-20 sm:block" aria-hidden="true">
        <Progress value={percentage} tone={presentation.tone} />
      </div>
      <Tooltip
        content={
          status === 'safe'
            ? `At or above the ${String(ruleSet.attendanceRequiredPct)}% requirement (22OB 3.7).`
            : status === 'dx_risk'
              ? `Below the ${String(ruleSet.attendanceDxFloorPct)}% floor: the course carries a DX and cannot be sat.`
              : `Below the ${String(ruleSet.attendanceRequiredPct)}% requirement but above the ${String(ruleSet.attendanceDxFloorPct)}% floor.`
        }
      >
        <button
          type="button"
          className={cn(
            'tnum w-14 shrink-0 cursor-help text-right text-[15px] font-semibold',
            presentation.ink,
          )}
        >
          {formatPercent(percentage)}
        </button>
      </Tooltip>
      {actions}
    </div>
  );
}

/* ------------------------------------------------------------ Add course */

function AddCourseDialog({
  open,
  onOpenChange,
  subjects,
  onAdd,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly subjects: readonly SemesterSubject[];
  readonly onAdd: (record: AttendanceRecord) => void;
}) {
  const [code, setCode] = useState('');
  const [attended, setAttended] = useState('');
  const [conducted, setConducted] = useState('');
  const [error, setError] = useState<string | null>(null);

  const submit = (): void => {
    const cleaned = code.trim().toUpperCase();
    const attendedValue = Number(attended);
    const conductedValue = Number(conducted);
    if (cleaned === '') return setError('Enter a subject code.');
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
      semester: 1,
      subjectCode: cleaned,
      subjectTitle: subjects.find((subject) => subject.code === cleaned)?.title ?? cleaned,
      attended: attendedValue,
      conducted: conductedValue,
      updatedAt: nowIso(),
    });
    setCode('');
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

/* ----------------------------------------------------------- Bunk planner */

function BunkPlanner({
  record,
  name,
  onClose,
}: {
  readonly record: AttendanceRecord | null;
  readonly name: string | null;
  readonly onClose: () => void;
}) {
  const attendance =
    record === null ? null : calculateAttendance(record.attended, record.conducted, ruleSet);
  const canMiss =
    record === null ? null : calculateClassesCanMiss(record.attended, record.conducted, ruleSet);
  const mustAttend =
    record === null ? null : calculateClassesMustAttend(record.attended, record.conducted, ruleSet);
  const safe = attendance?.ok === true && attendance.value.status === 'safe';

  return (
    <Dialog open={record !== null} onOpenChange={(open) => !open && onClose()}>
      {record !== null && (
        <DialogContent
          title="Bunk planner"
          description={
            name === null || name === record.subjectCode
              ? record.subjectCode
              : `${name} · ${record.subjectCode}`
          }
        >
          <DialogBody>
            {attendance?.ok === true ? (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-xl border border-line bg-panel p-4">
                    <div className="text-[12px] text-ink-2">Current attendance</div>
                    <div
                      className={cn(
                        'tnum mt-1 text-3xl font-semibold',
                        STATUS[attendance.value.status].ink,
                      )}
                    >
                      {formatPercent(attendance.value.percentage)}
                    </div>
                    <div className="mt-0.5 text-[12px] text-ink-3">
                      {record.attended} of {record.conducted} classes
                    </div>
                  </div>
                  <div className="rounded-xl border border-line bg-panel p-4">
                    <div className="text-[12px] text-ink-2">Required</div>
                    <div className="tnum mt-1 text-3xl font-semibold">
                      {formatPercent(attendance.value.requiredPct)}
                    </div>
                    <div className="mt-0.5 text-[12px] text-ink-3">University minimum</div>
                  </div>
                </div>

                <div
                  role="status"
                  className={cn(
                    'mt-4 rounded-xl border p-4',
                    safe
                      ? 'border-success/30 bg-success-weak/40'
                      : 'border-danger/30 bg-danger-weak/40',
                  )}
                >
                  <div
                    className={cn(
                      'flex items-center gap-2 text-[13px] font-semibold',
                      safe ? 'text-success' : 'text-danger',
                    )}
                  >
                    {safe ? (
                      <ShieldCheck className="size-4" aria-hidden="true" />
                    ) : (
                      <CalendarClock className="size-4" aria-hidden="true" />
                    )}
                    {safe && canMiss?.ok === true
                      ? canMiss.value > 0
                        ? `You can miss ${formatCount(canMiss.value, 'more class', 'more classes')}`
                        : 'You cannot miss any more classes'
                      : mustAttend?.ok === true && mustAttend.value > 0
                        ? `Attend the next ${formatCount(mustAttend.value, 'class', 'classes')} to recover`
                        : 'Attendance is below the requirement'}
                  </div>
                  <p className="mt-1 text-[12px] text-ink-2">
                    {safe
                      ? `Attendance stays at or above ${String(attendance.value.requiredPct)}%.`
                      : `Reaching ${String(attendance.value.requiredPct)}% requires attending ${
                          mustAttend?.ok === true ? String(mustAttend.value) : 'the'
                        } consecutive upcoming sessions.`}{' '}
                    <span className="text-ink-3">
                      Calculated from recorded classes only (22OB 3.7).
                    </span>
                  </p>
                </div>

                <div className="mt-4 flex flex-wrap items-center gap-2 text-[11px] text-ink-3">
                  <Badge tone={safe ? 'success' : 'danger'}>
                    {safe ? 'Calculated' : 'Recovery'}
                  </Badge>
                  <Badge>Assumption: fixed schedule</Badge>
                </div>
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
