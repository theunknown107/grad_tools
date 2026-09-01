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
import { IslandTabs } from '../../components/ui/IslandTabs.js';
import { Select } from '../../components/ui/Select.js';
/* Aliased: layout.js already exports a row-count Skeleton used further down. */
import { Skeleton as ShapedSkeleton } from '../../components/ui/Skeleton.js';
import { EmptyState, Notice, Panel, StatusPill } from '../../components/ui/index.js';
import { Row, Rows, Skeleton } from '../../components/ui/layout.js';
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

      {/*
        -------------------------------------------------------------------
        M9.6F: THE FILTER IS A TOOLBAR, NOT A PANEL
        -------------------------------------------------------------------

        A bordered "Filter" card sat above the feed taking the same visual
        weight as the notices themselves — a control given the prominence of
        content. It is now a single quiet toolbar row: the relevance choice as
        island tabs (it is a view of the feed, not a setting), the category as
        the glass Select, and the count on the right so the feed says how much
        of itself is showing.
      */}
      <div className={styles.toolbar}>
        <IslandTabs
          label="Which announcements"
          controlsPanel={false}
          value={onlyRelevant ? 'mine' : 'all'}
          onChange={(id) => {
            setOnlyRelevant(id === 'mine');
          }}
          tabs={[
            { id: 'all', label: 'All', count: sorted.length },
            {
              id: 'mine',
              label: 'Applies to me',
              count: sorted.filter((item) => isRelevant(item, context)).length,
            },
          ]}
        />

        <div className={styles.toolbarEnd}>
          <Select
            label="Category"
            hideLabel
            icon="announcements"
            value={category}
            onChange={setCategory}
            options={CATEGORY_OPTIONS.map((option) => ({
              value: option,
              label: option === 'all' ? 'All categories' : CATEGORY_LABEL[option],
            }))}
          />
        </div>
      </div>

      {/*
        Relevance is a VIEW, never a default (M7 §14). Hiding notices a student
        has not been targeted by would make the feed silently incomplete, and
        they would have no way to know what they were not seeing — so the "All"
        tab is first and the counts on both tabs say what each one holds.
      */}

      {error !== null ? (
        <Notice tone="warning">
          {error}{' '}
          <button type="button" className={styles.linkButton} onClick={reload}>
            Try again
          </button>
        </Notice>
      ) : loading ? (
        <ShapedSkeleton lines={5} height="56px" radius="md" label="Loading announcements" />
      ) : shown.length === 0 ? (
        <EmptyState
          title={onlyRelevant ? 'Nothing applies to you right now' : 'No announcements yet'}
          icons={['announcements', 'notifications', 'empty']}
        >
          {onlyRelevant
            ? 'Switch to All to see every notice GradTools holds.'
            : 'Notices appear here once a source is connected or an operator adds one.'}
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
export function LatestAnnouncements({ limit = 4 }: { readonly limit?: number }) {
  const { items, loading, error } = useAnnouncements();
  const sorted = useSortedAnnouncements(items);

  /*
   * A dashboard is not the place to report that a secondary feed is
   * unreachable. The announcements page says so properly when a student goes
   * there, and a broken section here would just be noise beside their timetable.
   */
  if (error !== null || (!loading && sorted.length === 0)) return null;

  /*
   * A MODULE, not a section (M9.5). On the dashboard this sits in the rail
   * beside the student's own semester, and it passes the module test: lift it
   * off the page and it still makes sense, because it is not part of the
   * argument the page is making.
   */
  return (
    <Panel
      material="quiet"
      title="Latest"
      flush
      action={
        <Link to="/announcements" className={styles.viewAll}>
          All announcements
        </Link>
      }
    >
      {loading ? (
        <Skeleton rows={3} />
      ) : (
        /*
         * ROWS, NOT CARDS (M9.3 §15). Four notices in identical bordered boxes
         * read as four separate things demanding equal attention; as a list
         * they read as what is new, which is the question being answered.
         *
         * The category leads because it is how a student triages — "results"
         * and "fees" are attended to differently.
         */
        <Rows>
          {sorted.slice(0, limit).map((announcement) => (
            <Row
              key={announcement.id}
              title={announcement.title}
              meta={
                <>
                  {CATEGORY_LABEL[announcement.category]} · {announcement.publisher}
                </>
              }
            />
          ))}
        </Rows>
      )}
    </Panel>
  );
}

export type { Announcement };
export { StatusPill };
