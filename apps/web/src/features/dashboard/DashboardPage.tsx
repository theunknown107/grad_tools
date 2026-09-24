/**
 * Dashboard — the design's hero, academic-standing row, two charts, and the
 * attention / today / what-changed row.
 *
 * Every figure is real: the rules engine's statistics, the stored timetable,
 * attendance counts and backlogs, the academic calendar and the verified
 * notices. Where a figure is not known the tile says so, with the reason.
 */

import { calculateAttendance, vtu2022RuleSet } from '@gradtools/academic-rules';
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
import { Callout, EmptyState } from '../../components/ui/feedback.js';
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
import type { AcademicStatistics } from '../../domain/statistics.js';
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
import { useAnnouncements, useNotifications } from '../../hooks/useAnnouncements.js';
import { CATEGORY_LABEL } from '../announcements/AnnouncementCard.js';
import {
  useAttendance,
  useAttendanceLedger,
  useBacklogs,
  useCalendars,
  useProfile,
  useResults,
  useSemesterSubjects,
  useTimetable,
  useTimetableOverrides,
} from '../../hooks/useCollection.js';
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
import { relativeTime } from '../../lib/time.js';

const ruleSet = vtu2022RuleSet;

function todayWeekday(): Weekday {
  const index = new Date().getDay();
  return WEEKDAYS[index === 0 ? 0 : index - 1] ?? 'Mon';
}

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

function nameFor(code: string, subjects: readonly SemesterSubject[]): string | null {
  return subjects.find((subject) => subject.code === code)?.title ?? null;
}

function standingSentence(stats: AcademicStatistics, semester: number | null): string {
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
  if (stats.backlogs.value === 0 && stats.backlogsUndetermined === 0) parts.push('no backlogs');
  const where = semester === null ? '' : ` You are in semester ${String(semester)}.`;
  return `${parts.join(', ')}.${where}`;
}

export function DashboardPage() {
  const { profile } = useProfile();
  const { items: attendance, loading: attendanceLoading } = useAttendance();
  const { loading: resultsLoading } = useResults();
  const { items: timetable, loading: timetableLoading } = useTimetable();
  const { items: ledger } = useAttendanceLedger();
  const { items: overrides } = useTimetableOverrides();
  const { items: semesterSubjects } = useSemesterSubjects();
  const { items: backlogs } = useBacklogs();
  const { items: calendars } = useCalendars();
  const { statistics } = useAcademicState();

  if (attendanceLoading || resultsLoading || timetableLoading) {
    return <PageSkeleton label="Loading your dashboard" />;
  }

  const current = currentSemester(statistics.views);
  const semesterNumber = current?.number ?? profile?.currentSemester ?? null;
  const thisSemester = attendance.filter(
    (record) => semesterNumber === null || record.semester === semesterNumber,
  );
  const inForce = activeCalendars(calendars);
  const holiday = holidayOn(inForce, localDay());
  const conflicts = calendarConflicts(calendars);

  return (
    <div className="flex flex-col gap-8">
      <Hero
        stats={statistics}
        semester={semesterNumber}
        name={profile?.displayName?.trim() ?? ''}
        branch={profile?.branch ?? null}
        schemeId={profile?.schemeId ?? null}
      />

      <Standing stats={statistics} attendance={thisSemester} />

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

      <section aria-label="Today" className="grid items-start gap-6 lg:grid-cols-3">
        <Attention attendance={thisSemester} subjects={semesterSubjects} backlogs={backlogs} />
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
    </div>
  );
}

/* ------------------------------------------------------------------- Hero */

function Hero({
  stats,
  semester,
  name,
  branch,
  schemeId,
}: {
  readonly stats: AcademicStatistics;
  readonly semester: number | null;
  readonly name: string;
  readonly branch: string | null;
  readonly schemeId: string | null;
}) {
  const provisional = stats.cgpaBasis.pending.length > 0;
  const standing = provisional ? stats.provisionalCgpa : stats.cgpa;
  const graded = stats.semestersGraded.value ?? 0;
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
      className="relative overflow-hidden rounded-2xl border border-line bg-raised"
    >
      <div className="relative grid gap-6 p-6 sm:p-8 lg:grid-cols-[1.4fr_1fr]">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            {branch !== null && branch !== '' && (
              <Badge tone="accent" icon={<GraduationCap />}>
                <abbr title={branch} className="no-underline">
                  {branchCode(branch)}
                </abbr>
              </Badge>
            )}
            {schemeId === 'vtu-2022' && <Badge>2022 scheme</Badge>}
            {semester !== null && <Badge>Semester {semester}</Badge>}
          </div>
          <h1
            id="dashboard-title"
            className="mt-4 font-display text-[28px] leading-[1.08] font-semibold tracking-[-0.02em] sm:text-[34px]"
          >
            {name !== '' ? `${greeting()}, ${name.split(' ')[0] ?? name}.` : `${greeting()}.`}
          </h1>
          <p className="mt-2 max-w-md text-sm text-ink-2">{standingSentence(stats, semester)}</p>
          <div className="mt-5 flex flex-wrap gap-2">
            <Button asChild variant="glass-primary" icon={<FileCheck2 />}>
              <Link to="/import">Add result</Link>
            </Button>
            <Button asChild variant="glass">
              <Link to="/results">View results</Link>
            </Button>
          </div>
        </div>

        {/*
          The standing is a column of the hero, not a card inside it: one rule
          separates it (above on a phone, beside from lg), so the hero stays a
          single region with a single edge.
        */}
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
          <div>
            <div className="mb-1.5 flex justify-between text-[12px] text-ink-2">
              <span>Semesters graded</span>
              <span className="tnum font-medium text-ink">
                {graded}/{Math.max(stats.views.length, 8)}
              </span>
            </div>
            <Progress
              value={(graded / Math.max(stats.views.length, 8)) * 100}
              label="Semesters graded"
            />
          </div>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------- Academic standing */

function Standing({
  stats,
  attendance,
}: {
  readonly stats: AcademicStatistics;
  readonly attendance: readonly AttendanceRecord[];
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
  const overall = conducted > 0 ? calculateAttendance(attended, conducted, ruleSet) : null;
  const short = attendance.filter((record) => {
    const verdict = calculateAttendance(record.attended, record.conducted, ruleSet);
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
      <MetricStrip data-testid="standing-strip">
        <Metric
          plain
          label="Percentage"
          value={percentage.value}
          state={stats.percentage.value === null ? 'unavailable' : 'resolved'}
          sub={stats.percentage.value === null ? percentage.note : 'CGPA × 10 (22OB 6.7)'}
        />
        <Metric
          plain
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
          label="Credits earned"
          value={credits.value}
          state={credits.value === 'Unavailable' ? 'unavailable' : 'resolved'}
          sub={credits.note}
        />
        <Metric
          plain
          label="Backlogs"
          value={backlogs.value}
          state={backlogs.value === 'Unavailable' ? 'unavailable' : 'resolved'}
          emphasis={(stats.backlogs.value ?? 0) > 0 ? 'warning' : undefined}
          sub={
            backlogs.note ??
            (stats.backlogs.value === 0 && stats.backlogsUndetermined === 0
              ? 'All cleared'
              : undefined)
          }
        />
        <Metric
          plain
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
                ? `${String(short)} below ${String(ruleSet.attendanceRequiredPct)}%`
                : `Threshold ${String(ruleSet.attendanceRequiredPct)}%`
              : 'No classes have been marked for this semester yet.'
          }
        />
        <Metric
          plain
          label="Semesters"
          value={`${String(stats.semestersGraded.value ?? 0)}/8`}
          sub={
            stats.semestersCompleted.value !== null &&
            stats.semestersCompleted.value !== (stats.semestersGraded.value ?? 0)
              ? `${String(stats.semestersCompleted.value)} marked complete`
              : 'Graded'
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
}: {
  readonly attendance: readonly AttendanceRecord[];
  readonly subjects: readonly SemesterSubject[];
  readonly backlogs: readonly BacklogRecord[];
}) {
  const short = attendance
    .flatMap((record) => {
      const verdict = calculateAttendance(record.attended, record.conducted, ruleSet);
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
          description="No subject is below the attendance requirement and no backlog is outstanding."
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
              slot.subjectCode === null ? null : nameFor(slot.subjectCode, subjects),
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
                <span className="w-14 shrink-0 font-mono text-[11px] text-ink-3 tabular-nums">
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
  const { items, loading, error, reload } = useAnnouncements();
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
                  <span className="mt-0.5 block text-[11px] text-ink-3">
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
