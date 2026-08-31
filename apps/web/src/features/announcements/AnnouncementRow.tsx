/**
 * One announcement, in a list and in detail.
 *
 * Authority: docs/28 §28.11 · docs/13 §13.15 · M7 §9, §17, §18, §26, §31
 *
 * PROVENANCE IS NEVER OPTIONAL. Every row names its publisher, and synthetic
 * content carries a DEMO label that no styling choice can drop, because it is
 * driven by the record's own `origin` rather than by a prop someone might
 * forget to pass (M7 §36).
 */

import { useState } from 'react';
import type { Announcement, AnnouncementCategory } from '@gradtools/shared-types';
import { Icon } from '../../components/icons.js';
import { StatusPill } from '../../components/ui/index.js';
import { deadlineInfo, priorityOf, type Priority } from '../../domain/announcements.js';
import styles from './announcements.module.css';

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

/**
 * Priority, in words and shape as well as colour.
 *
 * The dot is decorative and hidden from assistive technology; the word beside
 * it carries the meaning. Colour is never the only signal (docs/27 §27.5).
 */
const PRIORITY_LABEL: Record<Priority, { text: string; tone: 'danger' | 'warning' | 'neutral' }> = {
  urgent: { text: 'Urgent', tone: 'danger' },
  important: { text: 'Important', tone: 'warning' },
  normal: { text: 'Notice', tone: 'neutral' },
  informational: { text: 'For information', tone: 'neutral' },
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

/** "in 3 days" / "today" / "closed" — only ever from a real timestamp. */
function deadlineWording(daysLeft: number, passed: boolean): string {
  if (passed) return 'closed';
  if (daysLeft <= 0) return 'today';
  if (daysLeft === 1) return 'tomorrow';
  return `in ${String(daysLeft)} days`;
}

export function AnnouncementRow({
  announcement,
  relevant,
  targeted,
  compact = false,
}: {
  readonly announcement: Announcement;
  readonly relevant: boolean;
  readonly targeted: boolean;
  readonly compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const now = new Date();
  const priority = priorityOf(announcement, now);
  const deadline = deadlineInfo(announcement, now);
  const label = PRIORITY_LABEL[priority];

  return (
    <article className={styles.row} data-priority={priority} data-relevant={relevant}>
      <div className={styles.rowHead}>
        <StatusPill tone={label.tone}>{label.text}</StatusPill>
        {/*
          DEMO CONTENT SAYS SO. Driven by the record's origin, so a synthetic
          notice cannot be shown as though it were official (M7 §36).
        */}
        {announcement.origin === 'demo_fixture' && <span className={styles.demo}>Demo data</span>}
        <span className={styles.category}>{CATEGORY_LABEL[announcement.category]}</span>
      </div>

      {/* External text, rendered as text. */}
      <h3 className={styles.title}>{announcement.title}</h3>

      <p className={styles.meta}>
        <span className={styles.publisher}>{announcement.publisher}</span>
        {announcement.publishedAt !== null && (
          <>
            {' · '}
            <time dateTime={announcement.publishedAt}>{formatDate(announcement.publishedAt)}</time>
          </>
        )}
        {!relevant && targeted && (
          <>
            {' · '}
            <span className={styles.notForYou}>Not for your branch or semester</span>
          </>
        )}
      </p>

      {/*
        A DEADLINE ONLY FROM A REAL DATE (M7 §18). Nothing here reads wording:
        an announcement without a `deadlineAt` shows no countdown at all.
      */}
      {deadline !== null && (
        <p className={styles.deadline} data-passed={deadline.passed}>
          Deadline: <time dateTime={deadline.at}>{formatDate(deadline.at)}</time>
          <span className={styles.daysLeft}>
            {' '}
            ({deadlineWording(deadline.daysLeft, deadline.passed)})
          </span>
        </p>
      )}

      {!compact && announcement.body !== null && (
        <>
          <p className={styles.body} data-expanded={open}>
            {announcement.body}
          </p>
          {announcement.body.length > 220 && (
            <button
              type="button"
              className={styles.linkButton}
              aria-expanded={open}
              onClick={() => {
                setOpen((current) => !current);
              }}
            >
              {open ? 'Show less' : 'Read the full notice'}
            </button>
          )}
        </>
      )}

      {!compact && announcement.canonicalUrl !== null && (
        /*
          LEAVING GRADTOOLS IS OBVIOUS. The host is shown so a student can see
          where they are going before they go, `rel` blocks the opener and the
          referrer, and the URL was already restricted to http(s) by both the
          normaliser and a database CHECK (M7 §26, §31).
        */
        <a
          className={styles.external}
          href={announcement.canonicalUrl}
          target="_blank"
          rel="noopener noreferrer nofollow"
        >
          <Icon name="external" size="small" />
          Open the original on {hostOf(announcement.canonicalUrl)}
          <span className={styles.visuallyHidden}> (opens in a new tab)</span>
        </a>
      )}
    </article>
  );
}

/** The host, so a student sees where a link goes before following it. */
function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return 'the original site';
  }
}
