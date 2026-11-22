/**
 * Dashboard — the design's hero, academic-standing row, two charts, and the
 * attention / today / what-changed row.
 *
 * Every figure is real: the rules engine's statistics, the stored timetable,
 * attendance counts and backlogs, the academic calendar and the verified
 * notices. Where a figure is not known the tile says so, with the reason.
 */

import { useEffect, useState } from 'react';
import { useSchemeRules } from '../../hooks/useSchemeRules.js';
import { useAuth } from '../auth/AuthContext.js';
import { anyAccountHoldsRecords } from '../../repositories/local/store.js';
import { calculateAttendance } from '@gradtools/academic-rules';
import {
  Activity,
  AlertTriangle,
  CalendarRange,
  ChevronRight,
  Clock,
  FileCheck2,
  GraduationCap,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { GradeDistributionChart, SgpaTrendChart } from '../../components/charts/lazy.js';
import { Badge } from '../../components/ui/badge.js';
import { Button } from '../../components/ui/button.js';
import { Card, CardHeader, CardRows, headerActionClass } from '../../components/ui/card.js';
import { Callout, EmptyState, ErrorState } from '../../components/ui/feedback.js';
import { Metric, MetricStrip } from '../../components/ui/metric.js';
import { Dot, Row, RowText, SectionTitle } from '../../components/ui/page.js';
import { Progress } from '../../components/ui/progress.js';
import { PageSkeleton, RowsSkeleton } from '../../components/ui/skeleton.js';
import { currentSemester } from '../../domain/academics.js';
import { effectiveState, occurrenceFor, statusOf } from '../../domain/attendance.js';
import { slotClassId } from '../../domain/timetable-identity.js';
import {
  activeCalendars,
  calendarConflicts,
  daysUntil,
  holidayOn,
  nextEvent,
  type CalendarConflict,
  type CalendarEvent,
  type SavedCalendar,
} from '../../domain/calendar-import.js';
import { hasNoBacklogs, type AcademicStatistics } from '../../domain/statistics.js';
import { timetableEntry } from '../../domain/timetable-import.js';
import {
  WEEKDAYS,
  type AttendanceRecord,
  type BacklogRecord,
  type DayOverride,
  type LedgerEntry,
  type SemesterSubject,
  type TimetableSlot,
  type Weekday,
} from '../../domain/types.js';
import { useAcademicState } from '../../hooks/useAcademicState.js';
import { useNow } from '../../hooks/useNow.js';
import { useAnnouncements, useNotifications } from '../../hooks/useAnnouncements.js';
import { CATEGORY_LABEL, SnapshotNote } from '../announcements/AnnouncementCard.js';
import {
  useAttendance,
  useAttendanceLedger,
  useBacklogs,
  useCalendars,
  useProfile,
  useResults,
  useSemesterSubjects,
  useTimetable,
  useTimetableImports,
  useTimetableOverrides,
} from '../../hooks/useCollection.js';
import { attendanceRules, useAttendanceCriteria } from '../../lib/attendance-criteria.js';
import { cn } from '../../lib/cn.js';
import {
  branchCode,
  formatCount,
  formatGpa,
  formatPercent,
  formatTime,
  localDay,
  metricDisplay,
} from '../../lib/format.js';
import { greetingFor, relativeTime } from '../../lib/time.js';

/* The VTU rules judged at the college's attendance criteria (lib/attendance-criteria). */
const rules = attendanceRules;

function todayWeekday(): Weekday {
  const index = new Date().getDay();
  return WEEKDAYS[index === 0 ? 0 : index - 1] ?? 'Mon';
}

function nameFor(code: string, subjects: readonly SemesterSubject[]): string | null {
  return subjects.find((subject) => subject.code === code)?.title ?? null;
}

function standingSentence(stats: AcademicStatistics, signedOut: boolean): string {
  if (!stats.hasAnyResult && signedOut)
    return 'You are signed out, so your account’s results are not shown.';
  if (!stats.hasAnyResult) {
    return 'No results are saved yet. Add a result card and your figures appear here.';
  }
  const graded = stats.semestersGraded.value ?? 0;
  const parts: string[] = [
    graded === 1 ? '1 semester graded' : `${String(graded)} semesters graded`,
  ];
  if (stats.creditsEarned.value !== null) {
    parts.push(`${formatCount(stats.creditsEarned.value, 'credit')} earned`);
  }
  if (hasNoBacklogs(stats)) parts.push('no backlogs');
  return `${parts.join(', ')}.`;
}

/*
 * SIGNED OUT, WITH AN ACCOUNT'S RECORDS STILL ON THIS DEVICE.
 *
 * Signed out, the dashboard reads the anonymous scope — usually empty — and so
 * said "No results are saved yet" straight after a sign-out, as though signing
 * out had deleted them. It had not: they are under the account's own scope,
 * shown only to that account (M9 §37). This asks storage one yes/no question —
 * does ANY account here hold records? — and reads none of them. Null while it
 * is being asked, so the screen never flips from one claim to the other.
 */
function useSignedOutWithRecords(): boolean | null {
  const { state, adapter } = useAuth();
  const signedOut = adapter !== null && state.status === 'signed_out';
  const [found, setFound] = useState<boolean | null>(null);
  useEffect(() => {
    if (!signedOut) return;
    let cancelled = false;
    void anyAccountHoldsRecords().then((value) => {
      if (!cancelled) setFound(value);
    });
    return () => {
      cancelled = true;
    };
  }, [signedOut]);
  return signedOut ? found : false;
}

export function DashboardPage() {
  /* Re-renders when the attendance criteria change (lib/attendance-criteria). */
  useAttendanceCriteria();
  const now = useNow();
  const { state: authState, adapter } = useAuth();
  const signedOutWithRecords = useSignedOutWithRecords();
  const { profile, loading: profileLoading } = useProfile();
  const schemeRules = useSchemeRules();
  const attendanceState = useAttendance();
  const resultsState = useResults();
  const timetableState = useTimetable();
  const { items: timetableImports } = useTimetableImports();
  const { items: ledger } = useAttendanceLedger();
  const { items: overrides } = useTimetableOverrides();
  const { items: semesterSubjects } = useSemesterSubjects();
  const backlogsState = useBacklogs();
  const { items: calendars } = useCalendars();
  const { statistics, loading: academicLoading } = useAcademicState();
  const attendance = attendanceState.items;
  const timetable = timetableState.items;
  const backlogs = backlogsState.items;

  /*
   * "No results are saved yet" is a claim, so the first screen waits until the
   * records it is about have actually been read — for the right account (see
   * repositories/context.tsx) — and never makes it from a failed read.
   */
  const core = [attendanceState, resultsState, timetableState, backlogsState];
  if (
    profileLoading ||
    academicLoading ||
    signedOutWithRecords === null ||
    core.some((state) => state.loading)
  ) {
    return <PageSkeleton label="Loading your dashboard" />;
  }
  if (core.some((state) => state.error)) {
    return (
      <ErrorState
        title="Your saved records could not be read"
        message="Nothing has been deleted. This device's storage did not answer, which is not the same as an empty account."
        onRetry={() => {
          for (const state of core) if (state.error) state.reload();
        }}
      />
    );
  }

  const current = currentSemester(statistics.views);
  const semesterNumber = current?.number ?? profile?.currentSemester ?? null;
  const thisSemester = attendance.filter(
    (record) => semesterNumber === null || record.semester === semesterNumber,
  );
  const inForce = activeCalendars(calendars);
  const holiday = holidayOn(inForce, localDay());
  const conflicts = calendarConflicts(calendars);

  const signedOut = signedOutWithRecords && !statistics.hasAnyResult;
  /*
   * A brand-new LOCAL user: no account, and nothing saved anywhere. Only this
   * case drops the empty metric sections below — a signed-in empty account and
   * a signed-out-with-records user keep the full dashboard, because their
   * emptiness means something different (Part 2 of the redesign brief).
   */
  const genuinelyNew =
    !(adapter !== null && authState.status === 'signed_in') &&
    !signedOut &&
    profile === null &&
    !statistics.hasAnyResult &&
    attendance.length === 0 &&
    timetable.length === 0 &&
    backlogs.length === 0;

  return (
    <div className="flex flex-col gap-8">
      {signedOut && (
        <Callout
          title="You’re signed out."
          action={
            <Button asChild size="sm" variant="primary">
              <Link to="/sign-in">Sign in</Link>
            </Button>
          }
        >
          Your academic records are still saved on this device. Sign in to view them again.
        </Callout>
      )}
      {/* A new student is oriented inside the hero itself: one block, one pair of actions. */}
      <Hero
        firstRun={profile === null && !signedOut && !statistics.hasAnyResult}
        signedOut={signedOut}
        stats={statistics}
        /* A greeting for the time of day; the semester is a badge beside the branch. */
        title={greetingFor(now.at.getHours(), profile?.displayName)}
        semester={
          semesterNumber ??
          [...timetableImports].sort((a, b) => b.importedAt.localeCompare(a.importedAt))[0]
            ?.semester ??
          null
        }
        branch={profile?.branch ?? null}
        schemeId={profile?.schemeId ?? null}
      />

      {/* Has results but skipped the profile: a terse nudge (the welcome is above). */}
      {profile === null && !signedOut && statistics.hasAnyResult && (
        <Callout
          action={
            <Button asChild size="sm" variant="primary">
              <Link to="/setup">Set up</Link>
            </Button>
          }
        >
          Add your college, branch and USN so GradTools can tailor your results. Every step is
          optional.
        </Callout>
      )}

      {!genuinelyNew && (
        <Standing stats={statistics} attendance={thisSemester} rulesKnown={schemeRules.builtIn} />
      )}

      {(statistics.semestersGraded.value ?? 0) >= 2 && (
        <section aria-label="Trends" className="grid gap-6 lg:grid-cols-[1.5fr_1fr]">
          <Card className="p-5">
            <SectionTitle
              action={
                statistics.cgpa.value !== null ? (
                  <Badge>CGPA {formatGpa(statistics.cgpa.value)}</Badge>
                ) : undefined
              }
            >
              SGPA progression
            </SectionTitle>
            <SgpaTrendChart points={statistics.trend} />
          </Card>
          {statistics.grades.total > 0 && (
            <Card className="p-5">
              <SectionTitle>Grade distribution</SectionTitle>
              <GradeDistributionChart grades={statistics.grades} />
              <p className="mt-2 text-[12px] text-ink-3">
                {formatCount(statistics.outcomes.passed, 'course')} passed across{' '}
                {formatCount(statistics.semestersGraded.value ?? 0, 'graded semester')}.
              </p>
            </Card>
          )}
        </section>
      )}

      {!genuinelyNew && (
        <section aria-label="Today" className="grid items-start gap-6 lg:grid-cols-3">
          <Attention
            rulesKnown={schemeRules.builtIn}
            attendance={thisSemester}
            subjects={semesterSubjects}
            backlogs={backlogs}
            clear={hasNoBacklogs(statistics)}
          />
          <Today
            timetable={timetable}
            subjects={semesterSubjects}
            holiday={holiday}
            entries={ledger}
            overrides={overrides}
          />
          <WhatChanged />
          <NextDate calendars={inForce} conflicts={conflicts} />
        </section>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------- Hero */

function Hero({
  firstRun,
  signedOut,
  stats,
  title,
  semester,
  branch,
  schemeId,
}: {
  /** A brand-new student: say what GradTools is and offer the first step instead. */
  readonly firstRun: boolean;
  readonly signedOut: boolean;
  readonly stats: AcademicStatistics;
  readonly title: string;
  readonly semester: number | null;
  readonly branch: string | null;
  readonly schemeId: string | null;
}) {
  const provisional = stats.cgpaBasis.pending.length > 0;
  const standing = provisional ? stats.provisionalCgpa : stats.cgpa;
  const graded = stats.semestersGraded.value ?? 0;
  /* The degree's modelled length (ED-71: eight semesters, always shown). */
  const planned = stats.views.length;
  const completed = stats.semestersCompleted.value;
  const note =
    standing.reason ??
    (graded === 0
      ? 'No semester has been graded yet.'
      : `Credit-weighted across ${formatCount(graded, 'graded semester')}.`);
  const trend = stats.trend.filter((point) => point.sgpa !== null);
  const first = trend[0]?.sgpa ?? null;
  const last = trend[trend.length - 1]?.sgpa ?? null;
  const delta = trend.length >= 2 && first !== null && last !== null ? last - first : null;

  return (
    <section
      aria-labelledby="dashboard-title"
      className="gt-surface relative overflow-hidden rounded-2xl border border-line"
    >
      <div
        className={cn(
          'relative grid gap-6 p-6 sm:p-8',
          // Two columns only when the standing column is there to fill the second.
          stats.hasAnyResult && 'lg:grid-cols-[1.4fr_1fr]',
        )}
      >
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            {branch !== null && branch !== '' && (
              <Badge tone="accent" icon={<GraduationCap />}>
                <abbr title={branch} className="no-underline">
                  {branchCode(branch)}
                </abbr>
              </Badge>
            )}
            {semester !== null && <Badge>Semester {semester}</Badge>}
            {schemeId === 'vtu-2022' && <Badge>2022 scheme</Badge>}
            {firstRun && (
              <span className="font-mono text-[12px] text-ink-3">Welcome to GradTools</span>
            )}
          </div>
          <h1
            id="dashboard-title"
            className="mt-4 font-display text-[28px] leading-[1.08] font-semibold tracking-[-0.02em] sm:text-[34px]"
          >
            {title}
          </h1>
          <p className="mt-2 max-w-md text-sm text-ink-2">
            {standingSentence(stats, signedOut)}
          </p>
          <div className="mt-5 flex flex-wrap gap-2">
            <Button asChild variant="glass-primary" icon={<FileCheck2 />}>
              <Link to="/import">{firstRun ? 'Add your first result' : 'Add result'}</Link>
            </Button>
            <Button asChild variant="glass">
              {firstRun ? (
                <Link to="/setup">Set up profile</Link>
              ) : (
                <Link to="/results/get">Get VTU result</Link>
              )}
            </Button>
          </div>
        </div>

        {/*
          The standing is a column of the hero, not a card inside it: one rule
          separates it (above on a phone, beside from lg), so the hero stays a
          single region with a single edge.
        */}
        {stats.hasAnyResult && (
          <div className="flex flex-col justify-center gap-3 border-t border-line pt-6 lg:border-t-0 lg:border-l lg:pt-0 lg:pl-8">
            <div className="flex items-end justify-between gap-3">
              <div className="min-w-0">
                <div className="text-[12px] font-medium text-ink-2">
                  {provisional ? 'Average so far' : 'Cumulative CGPA'}
                </div>
                {standing.value === null ? (
                  <div className="mt-1.5 text-[26px] leading-none font-semibold text-ink-3">
                    Unavailable
                  </div>
                ) : (
                  <div className="tnum mt-0.5 text-[44px] leading-none font-semibold tracking-[-0.03em]">
                    {formatGpa(standing.value)}
                  </div>
                )}
              </div>
              {delta !== null && Math.abs(delta) >= 0.005 && (
                <Badge
                  tone={delta > 0 ? 'success' : 'warning'}
                  icon={delta > 0 ? <TrendingUp /> : <TrendingDown />}
                >
                  {delta > 0 ? '+' : '−'}
                  {Math.abs(delta).toFixed(2)} SGPA vs Sem {trend[0]?.semester}
                </Badge>
              )}
            </div>
            <p className="text-[12px] text-ink-3">{note}</p>
            {/*
            THE dashboard's semester progress: the standing strip no longer
            repeats it. The row is what the eye reads; the bar says the same to
            assistive tech, once, as "4 of 8" rather than a bare percentage.
          */}
            <div>
              <div
                aria-hidden="true"
                className="mb-1.5 flex justify-between text-[12px] text-ink-2"
              >
                <span>Semesters graded</span>
                <span className="tnum font-medium text-ink">
                  {graded}/{planned}
                </span>
              </div>
              <Progress
                value={(graded / planned) * 100}
                label="Semesters graded"
                valueText={`${String(graded)} of ${String(planned)}`}
              />
              {completed !== null && completed !== graded && (
                <p className="mt-1.5 text-[12px] text-ink-3">
                  {formatCount(completed, 'semester')} marked complete
                </p>
              )}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

/* ------------------------------------------------------- Academic standing */

function Standing({
  stats,
  attendance,
  rulesKnown,
}: {
  readonly stats: AcademicStatistics;
  readonly attendance: readonly AttendanceRecord[];
  /** False on a scheme without verified rules: no threshold is judged. */
  readonly rulesKnown: boolean;
}) {
  /*
   * The CGPA is the hero's figure; repeating it here would say it twice. This
   * cell carries what follows from it instead, worded as My degree words it.
   */
  const percentage = metricDisplay(stats.percentage, formatPercent);
  const credits = metricDisplay(stats.creditsEarned);
  const backlogs = metricDisplay(stats.backlogs);
  const latest = stats.latestSgpa.value;

  const attended = attendance.reduce((total, record) => total + record.attended, 0);
  const conducted = attendance.reduce((total, record) => total + record.conducted, 0);
  const overall =
    rulesKnown && conducted > 0 ? calculateAttendance(attended, conducted, rules()) : null;
  const short = attendance.filter((record) => {
    const verdict = calculateAttendance(record.attended, record.conducted, rules());
    return verdict.ok && verdict.value.status !== 'safe';
  }).length;

  return (
    <section aria-labelledby="standing-title">
      <SectionTitle
        id="standing-title"
        action={
          <Link to="/academics" className={headerActionClass}>
            Open SGPA &amp; CGPA
          </Link>
        }
      >
        Academic standing
      </SectionTitle>
      {/*
        Five figures, every row filled: 1 + 2 + 2 on a phone (the percentage
        leads), 3 + 2 on a six-track grid from md, five across from xl.
      */}
      <MetricStrip
        data-testid="standing-strip"
        className="grid-cols-2 md:grid-cols-6 xl:grid-cols-5"
      >
        <Metric
          plain
          className="col-span-2 xl:col-span-1"
          label="Percentage"
          value={percentage.value}
          state={stats.percentage.value === null ? 'unavailable' : 'resolved'}
          sub={stats.percentage.value === null ? percentage.note : 'CGPA × 10 (22OB 6.7)'}
        />
        <Metric
          plain
          className="md:col-span-2 xl:col-span-1"
          label="Latest SGPA"
          value={latest === null ? 'Unavailable' : formatGpa(latest.sgpa)}
          state={latest === null ? 'unavailable' : 'resolved'}
          sub={
            latest !== null
              ? `Semester ${String(latest.semester)}`
              : (stats.latestSgpa.reason ?? undefined)
          }
        />
        <Metric
          plain
          className="md:col-span-2 xl:col-span-1"
          label="Credits earned"
          value={credits.value}
          state={credits.value === 'Unavailable' ? 'unavailable' : 'resolved'}
          sub={credits.note}
        />
        <Metric
          plain
          className="md:col-span-3 xl:col-span-1"
          label="Backlogs"
          value={backlogs.value}
          state={backlogs.value === 'Unavailable' ? 'unavailable' : 'resolved'}
          emphasis={(stats.backlogs.value ?? 0) > 0 ? 'warning' : undefined}
          sub={
            backlogs.note ??
            (hasNoBacklogs(stats)
              ? 'All cleared'
              : /* The count is what is recorded; say so when the results show more. */
                stats.backlogs.value === 0 && (stats.backlogsFromResults.value ?? 0) > 0
                ? `${formatCount(stats.backlogsFromResults.value ?? 0, 'backlog')} in your results`
                : undefined)
          }
        />
        <Metric
          plain
          className="md:col-span-3 xl:col-span-1"
          label="Attendance"
          value={overall?.ok === true ? overall.value.percentage.toFixed(1) : 'Not recorded'}
          unit={overall?.ok === true ? '%' : undefined}
          state={overall?.ok === true ? 'resolved' : 'unavailable'}
          emphasis={
            overall?.ok === true && overall.value.status !== 'safe'
              ? overall.value.status === 'dx_risk'
                ? 'danger'
                : 'warning'
              : undefined
          }
          sub={
            overall?.ok === true
              ? short > 0
                ? `${String(short)} below ${String(rules().attendanceRequiredPct)}%`
                : `Threshold ${String(rules().attendanceRequiredPct)}%`
              : rulesKnown
                ? 'No classes have been marked for this semester yet.'
                : 'Not calculated — your scheme’s attendance rules are not in GradTools yet.'
          }
        />
      </MetricStrip>

      {stats.hasAnyResult && stats.semestersGraded.value === 0 && (
        <Callout
          tone="warning"
          className="mt-3"
          action={
            <Button asChild size="sm">
              <Link to="/results">Check your results</Link>
            </Button>
          }
        >
          {stats.dataQuality.notes[0] ??
            'Your saved results could not be graded yet. Open Results to see what each one needs.'}
        </Callout>
      )}
      {!stats.hasAnyResult && (
        <Callout
          className="mt-3"
          action={
            <Button asChild size="sm" variant="primary">
              <Link to="/import">Add a result</Link>
            </Button>
          }
        >
          No results yet, so there is no CGPA to show.
        </Callout>
      )}
    </section>
  );
}

/* ------------------------------------------------------------ Attention */

function Attention({
  attendance,
  subjects,
  backlogs,
  clear,
  rulesKnown,
}: {
  /** False on a scheme without verified rules: no shortfall is claimed. */
  readonly rulesKnown: boolean;
  readonly attendance: readonly AttendanceRecord[];
  readonly subjects: readonly SemesterSubject[];
  readonly backlogs: readonly BacklogRecord[];
  /** `hasNoBacklogs`: whether "no backlog is outstanding" may be said at all. */
  readonly clear: boolean;
}) {
  const short = (rulesKnown ? attendance : [])
    .flatMap((record) => {
      const verdict = calculateAttendance(record.attended, record.conducted, rules());
      if (!verdict.ok || verdict.value.status === 'safe') return [];
      return [{ record, verdict: verdict.value }];
    })
    .sort((a, b) => a.verdict.percentage - b.verdict.percentage);
  const outstanding = backlogs.filter((backlog) => backlog.status !== 'cleared');
  const count = short.length + outstanding.length;

  return (
    <Card className="overflow-hidden">
      <CardHeader
        icon={
          <AlertTriangle className={count > 0 ? 'text-warning' : 'text-ink-2'} aria-hidden="true" />
        }
        title="Needs attention"
        action={<Badge tone={count > 0 ? 'warning' : 'success'}>{count}</Badge>}
      />
      {count === 0 ? (
        <EmptyState
          compact
          icon={<AlertTriangle />}
          title="Nothing needs attention"
          description={
            /*
             * This card lists RECORDED backlogs. With none recorded it still may
             * not say none is outstanding unless the results agree.
             */
            clear
              ? 'No subject is below the attendance requirement and no backlog is outstanding.'
              : 'No subject is below the attendance requirement.'
          }
        />
      ) : (
        <CardRows>
          {short.map(({ record, verdict }) => {
            const title = nameFor(record.subjectCode, subjects);
            const danger = verdict.status === 'dx_risk';
            return (
              <Row key={record.id} asChild>
                <Link to="/attendance">
                  <Dot tone={danger ? 'danger' : 'warning'} />
                  <RowText
                    title={title ?? record.subjectCode}
                    meta={`${title === null ? '' : `${record.subjectCode} · `}${String(record.attended)}/${String(record.conducted)} classes`}
                  />
                  <span
                    className={cn(
                      'tnum text-sm font-semibold',
                      danger ? 'text-danger' : 'text-warning',
                    )}
                  >
                    {formatPercent(verdict.percentage)}
                  </span>
                  <ChevronRight className="size-4 text-ink-3" aria-hidden="true" />
                </Link>
              </Row>
            );
          })}
          {outstanding.map((backlog) => (
            <Row key={backlog.id} asChild>
              <Link to="/semesters">
                <Dot tone="danger" />
                <RowText
                  title={backlog.subjectTitle}
                  meta={`${backlog.subjectCode} · from semester ${String(backlog.originSemester)}`}
                />
                <Badge tone="danger">Backlog</Badge>
                <ChevronRight className="size-4 text-ink-3" aria-hidden="true" />
              </Link>
            </Row>
          ))}
        </CardRows>
      )}
    </Card>
  );
}

/* ----------------------------------------------------------------- Today */

function Today({
  timetable,
  subjects,
  holiday,
  entries,
  overrides,
}: {
  readonly timetable: readonly TimetableSlot[];
  readonly subjects: readonly SemesterSubject[];
  readonly holiday: CalendarEvent | null;
  readonly entries: readonly LedgerEntry[];
  readonly overrides: readonly DayOverride[];
}) {
  const day = todayWeekday();
  const slots = timetable
    .filter((slot) => slot.day === day)
    .sort((a, b) => a.startTime.localeCompare(b.startTime));
  const now = new Date();
  const clock = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const nextSlot = slots.find((slot) => slot.endTime > clock);

  return (
    <Card className="overflow-hidden">
      <CardHeader
        icon={<Clock className="text-ink-2" aria-hidden="true" />}
        title={`Today · ${day}`}
        action={
          <Link to="/timetable" className={headerActionClass}>
            Full week
          </Link>
        }
      />
      {holiday !== null ? (
        <EmptyState
          compact
          icon={<CalendarRange />}
          title={`${holiday.title} — no classes today`}
          description="From your academic calendar."
        />
      ) : slots.length === 0 ? (
        <EmptyState
          compact
          icon={<Clock />}
          title="Nothing scheduled today."
          actions={
            <Button asChild size="sm">
              <Link to="/timetable">Add your timetable</Link>
            </Button>
          }
        />
      ) : (
        <CardRows
          tabIndex={0}
          role="region"
          aria-label={`Classes on ${day}`}
          className="max-h-[248px] overflow-y-auto scroll-quiet focus-visible:outline-offset-[-2px]"
        >
          {slots.map((slot) => {
            const entry = timetableEntry(
              slot,
              slot.subjectCode === null
                ? null
                : (nameFor(slot.subjectCode, subjects) ?? slot.subjectTitle ?? null),
            );
            /*
             * What the student recorded, read from the LEDGER — the same row
             * the figures are derived from, rather than the fortnightly guard
             * `classMarks` used to be.
             */
            const date = localDay();
            const classId = slotClassId(slot);
            const marked = effectiveState(
              occurrenceFor(entries, date, classId),
              statusOf(overrides, date, classId),
            );
            const isNext = slot.id === nextSlot?.id;
            return (
              <Row
                key={slot.id}
                aria-current={isNext ? 'true' : undefined}
                className={cn(isNext && 'bg-accent-weak/40')}
              >
                <span className="w-14 shrink-0 font-mono text-[12px] text-ink-3 tabular-nums">
                  {formatTime(slot.startTime)}
                </span>
                <span
                  aria-hidden="true"
                  className={cn(
                    'h-8 w-[3px] shrink-0 rounded-full',
                    entry.isCourse ? 'bg-accent' : 'bg-line-strong',
                  )}
                />
                <RowText
                  title={entry.name}
                  meta={[entry.detail, slot.room].filter(Boolean).join(' · ') || undefined}
                />
                {marked !== 'unmarked' && (
                  <Badge
                    tone={
                      marked === 'attended'
                        ? 'success'
                        : marked === 'missed'
                          ? 'warning'
                          : 'neutral'
                    }
                  >
                    {marked === 'attended'
                      ? 'Attended'
                      : marked === 'missed'
                        ? 'Missed'
                        : 'Cancelled'}
                  </Badge>
                )}
                {isNext && marked === 'unmarked' && <Badge tone="accent">Next</Badge>}
              </Row>
            );
          })}
        </CardRows>
      )}
    </Card>
  );
}

/* ---------------------------------------------------------- What changed */

function WhatChanged() {
  const { items, loading, error, reload, snapshotAt } = useAnnouncements();
  const { notifications } = useNotifications(items);
  const shown = notifications.filter((item) => item.state !== 'dismissed').slice(0, 4);
  const now = Date.now();
  return (
    <Card className="overflow-hidden">
      <CardHeader
        icon={<Activity className="text-ink-2" aria-hidden="true" />}
        title="What changed"
        action={
          <Link to="/notifications" className={headerActionClass}>
            All
          </Link>
        }
      />
      {snapshotAt !== null && <SnapshotNote at={snapshotAt} />}
      {loading ? (
        <RowsSkeleton rows={3} label="Loading notices" />
      ) : error !== null ? (
        <EmptyState
          compact
          icon={<Activity />}
          title="Notices are unavailable"
          description={error}
          actions={
            <Button size="sm" onClick={reload}>
              Try again
            </Button>
          }
        />
      ) : shown.length === 0 ? (
        <EmptyState
          compact
          icon={<Activity />}
          title="Nothing new"
          description="Verified notices will appear here."
        />
      ) : (
        <CardRows>
          {shown.map((item) => (
            <Row key={item.announcement.id} asChild className="items-start">
              <Link to="/announcements">
                <Dot
                  tone="accent"
                  hollow={item.state !== 'unread'}
                  className="mt-1.5"
                  {...(item.state === 'unread' ? { label: 'Unread' } : {})}
                />
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] leading-snug font-medium">
                    {item.announcement.title}
                  </span>
                  <span className="mt-0.5 block text-[12px] text-ink-3">
                    {CATEGORY_LABEL[item.announcement.category]} ·{' '}
                    {relativeTime(item.announcement.updatedAt, now)}
                  </span>
                </span>
              </Link>
            </Row>
          ))}
        </CardRows>
      )}
    </Card>
  );
}

/* ------------------------------------------------------------- Next date */

function formatDay(iso: string): string {
  const date = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}

function NextDate({
  calendars,
  conflicts,
}: {
  readonly calendars: readonly SavedCalendar[];
  readonly conflicts: readonly CalendarConflict[];
}) {
  const today = new Date().toISOString().slice(0, 10);
  const next = nextEvent(
    calendars.flatMap((calendar) => calendar.events),
    today,
  );
  if (next === null && conflicts.length === 0) return null;
  const days = next === null ? 0 : daysUntil(next, today);
  const when =
    days > 1
      ? `in ${String(days)} days`
      : days === 1
        ? 'tomorrow'
        : days === 0
          ? 'today'
          : 'under way';
  return (
    <Card className="overflow-hidden">
      <CardHeader
        icon={<CalendarRange className="text-ink-2" aria-hidden="true" />}
        title="Next on the calendar"
      />
      {conflicts.length > 0 && (
        <Callout tone="warning" className="m-4" title="Two calendars for this term disagree.">
          {conflicts.flatMap((conflict) => conflict.differences).join('; ')}
        </Callout>
      )}
      {next !== null && (
        <Row>
          <RowText
            title={next.title}
            meta={
              next.endDate === null
                ? formatDay(next.startDate)
                : `${formatDay(next.startDate)} – ${formatDay(next.endDate)}`
            }
          />
          <Badge tone="schedule">{when}</Badge>
        </Row>
      )}
    </Card>
  );
}
