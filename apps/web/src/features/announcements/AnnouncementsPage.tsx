/**
 * Announcements.
 *
 * Authority: docs/28 §28.11 · docs/13 §13.15 · M7 §25, §26, §30, §31
 *
 * ---------------------------------------------------------------------------
 * GRADTOOLS IS NEVER THE AUTHORITY
 * ---------------------------------------------------------------------------
 * Every notice names who published it and links to the original where one
 * exists. Synthetic content is labelled DEMO wherever it appears. Nothing on
 * this screen presents GradTools as the issuer of a notice (M7 §9, §26).
 *
 * ALL ANNOUNCEMENT TEXT IS RENDERED AS TEXT. Titles and bodies are external
 * content stored as plain text and rendered by React, which escapes them; there
 * is no `dangerouslySetInnerHTML` anywhere in this milestone (docs/13 §T-21).
 */

import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { Announcement, AnnouncementCategory } from '@gradtools/shared-types';
import { PageHeader } from '../../components/AppShell.js';
import { EmptyState, Notice, Panel, SelectField, StatusPill } from '../../components/ui/index.js';
import {
  useAnnouncements,
  useSortedAnnouncements,
  useStudentContext,
} from '../../hooks/useAnnouncements.js';
import { isRelevant, isTargeted } from '../../domain/announcements.js';
import { AnnouncementRow, CATEGORY_LABEL } from './AnnouncementRow.js';
import styles from './announcements.module.css';

const CATEGORY_OPTIONS: readonly (AnnouncementCategory | 'all')[] = [
  'all',
  'results',
  'exam_timetable',
  'exam_registration',
  'backlog',
  'summer_semester',
  'revaluation',
  'fees',
  'holiday',
  'academic_calendar',
  'college_notice',
  'department_notice',
  'general',
];

export function AnnouncementsPage() {
  const [category, setCategory] = useState<string>('all');
  const [onlyRelevant, setOnlyRelevant] = useState(false);
  const { items, loading, error, reload } = useAnnouncements(category);
  const sorted = useSortedAnnouncements(items);
  const context = useStudentContext();

  const shown = onlyRelevant ? sorted.filter((item) => isRelevant(item, context)) : sorted;

  return (
    <div className={styles.page}>
      <PageHeader
        title="Announcements"
        subtitle="Academic notices. GradTools shows them; it does not issue them."
      />

      <Panel title="Filter">
        <div className={styles.filters}>
          <SelectField
            label="Category"
            value={category}
            onChange={(event) => {
              setCategory(event.target.value);
            }}
          >
            {CATEGORY_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option === 'all' ? 'All categories' : CATEGORY_LABEL[option]}
              </option>
            ))}
          </SelectField>

          {/*
            A filter, never a default. Hiding notices the student has not been
            targeted by would make the feed silently incomplete, and they have
            no way to know what they are not seeing (M7 §14).
          */}
          <label className={styles.checkbox}>
            <input
              type="checkbox"
              checked={onlyRelevant}
              onChange={(event) => {
                setOnlyRelevant(event.target.checked);
              }}
            />
            Only what applies to me
          </label>
        </div>
      </Panel>

      {error !== null ? (
        <Notice tone="warning">
          {error}{' '}
          <button type="button" className={styles.linkButton} onClick={reload}>
            Try again
          </button>
        </Notice>
      ) : loading ? (
        <p className={styles.loading}>Loading announcements…</p>
      ) : shown.length === 0 ? (
        <EmptyState>
          {onlyRelevant
            ? 'Nothing here applies to you right now. Turn off the filter to see everything.'
            : 'No announcements yet. Notices appear here once a source is connected or an operator adds one.'}
        </EmptyState>
      ) : (
        <ul className={styles.list}>
          {shown.map((announcement) => (
            <li key={announcement.id}>
              <AnnouncementRow
                announcement={announcement}
                relevant={isRelevant(announcement, context)}
                targeted={isTargeted(announcement)}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** The compact "latest" list for the dashboard (M7 §25). */
export function LatestAnnouncements({ limit = 3 }: { readonly limit?: number }) {
  const { items, loading, error } = useAnnouncements();
  const sorted = useSortedAnnouncements(items);
  const context = useStudentContext();

  if (error !== null || (!loading && sorted.length === 0)) return null;

  return (
    <Panel
      title="Latest"
      action={
        <Link to="/announcements" className={styles.viewAll}>
          View all
        </Link>
      }
    >
      {loading ? (
        <p className={styles.loading}>Loading…</p>
      ) : (
        <ul className={styles.compactList}>
          {sorted.slice(0, limit).map((announcement) => (
            <li key={announcement.id}>
              <AnnouncementRow
                announcement={announcement}
                relevant={isRelevant(announcement, context)}
                targeted={isTargeted(announcement)}
                compact
              />
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

export type { Announcement };
export { StatusPill };
