import type { Announcement, AnnouncementCategory } from '@gradtools/shared-types';
import {
  CalendarDays,
  CircleAlert,
  ClipboardList,
  ExternalLink,
  FilePen,
  GraduationCap,
  Info,
  Megaphone,
  Receipt,
  RefreshCw,
  Sun,
  type LucideIcon,
} from 'lucide-react';
import { useState } from 'react';
import { Badge, type Tone } from '../../components/ui/badge.js';
import { Button } from '../../components/ui/button.js';
import { Card } from '../../components/ui/card.js';
import { deadlineInfo, priorityOf, type Priority } from '../../domain/announcements.js';
import { cn } from '../../lib/cn.js';

export const CATEGORY_LABEL: Record<AnnouncementCategory, string> = {
  results: 'Results',
  exam_timetable: 'Exam timetable',
  exam_registration: 'Exam registration',
  backlog: 'Backlog',
  summer_semester: 'Summer semester',
  revaluation: 'Revaluation',
  fees: 'Fees',
  holiday: 'Holiday',
  academic_calendar: 'Academic calendar',
  college_notice: 'College notice',
  department_notice: 'Department notice',
  general: 'General',
};

export const CATEGORY_ICON: Record<AnnouncementCategory, LucideIcon> = {
  results: ClipboardList,
  exam_timetable: CalendarDays,
  exam_registration: FilePen,
  backlog: CircleAlert,
  summer_semester: Sun,
  revaluation: RefreshCw,
  fees: Receipt,
  holiday: CalendarDays,
  academic_calendar: CalendarDays,
  college_notice: Megaphone,
  department_notice: GraduationCap,
  general: Info,
};

export const CATEGORY_TONE: Record<AnnouncementCategory, Tone> = {
  results: 'accent',
  exam_timetable: 'warning',
  exam_registration: 'warning',
  backlog: 'danger',
  summer_semester: 'schedule',
  revaluation: 'info',
  fees: 'neutral',
  holiday: 'success',
  academic_calendar: 'schedule',
  college_notice: 'neutral',
  department_notice: 'neutral',
  general: 'neutral',
};

const PRIORITY: Record<Priority, { text: string; tone: Tone } | null> = {
  urgent: { text: 'Urgent', tone: 'danger' },
  important: { text: 'Important', tone: 'warning' },
  normal: null,
  informational: null,
};

export function formatNoticeDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function deadlineWording(daysLeft: number, passed: boolean): string {
  if (passed) return 'closed';
  if (daysLeft <= 0) return 'today';
  if (daysLeft === 1) return 'tomorrow';
  return `in ${String(daysLeft)} days`;
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return 'the original site';
  }
}

export function AnnouncementCard({
  announcement,
  relevant,
  targeted,
}: {
  readonly announcement: Announcement;
  readonly relevant: boolean;
  readonly targeted: boolean;
}) {
  const [open, setOpen] = useState(false);
  const now = new Date();
  const priority = PRIORITY[priorityOf(announcement, now)];
  const deadline = deadlineInfo(announcement, now);
  const long = announcement.body !== null && announcement.body.length > 220;

  return (
    <Card asChild className={cn('p-5', relevant && targeted && 'relative overflow-hidden')}>
      <article>
        {/*
          The "for you" edge is a FILLED span: a `border-l-accent` edge renders
          in the neutral hairline colour (index.css neutralises coloured borders
          by design). Decorative; "For you" below says it in words.
        */}
        {relevant && targeted && (
          <span aria-hidden="true" className="absolute inset-y-0 left-0 w-0.5 bg-accent" />
        )}
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={CATEGORY_TONE[announcement.category]}>
            {CATEGORY_LABEL[announcement.category]}
          </Badge>
          {priority !== null && <Badge tone={priority.tone}>{priority.text}</Badge>}
          {announcement.origin === 'demo_fixture' && <Badge tone="warning">Demo data</Badge>}
          {relevant && targeted && (
            <span className="text-[11px] font-medium text-accent-ink">● For you</span>
          )}
          {announcement.publishedAt !== null && (
            <time
              dateTime={announcement.publishedAt}
              className="ml-auto font-mono text-[11px] text-ink-3"
            >
              {formatNoticeDate(announcement.publishedAt)}
            </time>
          )}
        </div>
        <h3 className="mt-2.5 text-[17px] leading-snug font-semibold tracking-[-0.01em] text-ink">
          {announcement.title}
        </h3>
        {deadline !== null && (
          <p
            className={cn(
              'mt-1 text-[13px] font-medium',
              deadline.passed ? 'text-ink-3' : 'text-warning',
            )}
          >
            Deadline: <time dateTime={deadline.at}>{formatNoticeDate(deadline.at)}</time> (
            {deadlineWording(deadline.daysLeft, deadline.passed)})
          </p>
        )}
        {announcement.body !== null && (
          <p
            className={cn(
              'mt-1.5 max-w-2xl text-[13px] leading-relaxed whitespace-pre-line text-ink-2',
              long && !open && 'line-clamp-3',
            )}
          >
            {announcement.body}
          </p>
        )}
        {long && (
          <Button
            variant="link"
            size="text"
            className="mt-1"
            aria-expanded={open}
            onClick={() => setOpen((value) => !value)}
          >
            {open ? 'Show less' : 'Read the full notice'}
          </Button>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-ink-3">
          <span>{announcement.publisher}</span>
          {!relevant && targeted && <span>Not for your branch or semester</span>}
          {announcement.canonicalUrl !== null && (
            <a
              href={announcement.canonicalUrl}
              target="_blank"
              rel="noopener noreferrer nofollow"
              className="inline-flex items-center gap-1 font-medium text-accent-ink underline-offset-4 hover:underline"
            >
              <ExternalLink className="size-3.5" aria-hidden="true" />
              Open the original on {hostOf(announcement.canonicalUrl)}
              <span className="sr-only"> (opens in a new tab)</span>
            </a>
          )}
        </div>
      </article>
    </Card>
  );
}
