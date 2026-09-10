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
import { MetaPill } from '../../components/ui/tone.js';
import { formatCount } from '../../lib/format.js';
import { IslandTabs, IslandTabGroup, IslandTabPanel } from '../../components/ui/IslandTabs.js';
/* Aliased: layout.js already exports a row-count Skeleton used further down. */
import { Skeleton as ShapedSkeleton } from '../../components/ui/Skeleton.js';
import { EmptyState, Notice, Panel, StatusPill, TextField } from '../../components/ui/index.js';
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
  /** What the search box holds. Filters the feed; never the counts on the tabs. */
  const [query, setQuery] = useState('');
  const { items, loading, error, reload } = useAnnouncements(category);
  const sorted = useSortedAnnouncements(items);
  const context = useStudentContext();

  /*
   * SEARCH MATCHES THE NOTICE, not a category name: a student typing
   * "revaluation" means the word in the title or the body, and the chips above
   * are how a category is chosen.
   */
  const needle = query.trim().toLowerCase();
  const shown = (onlyRelevant ? sorted.filter((item) => isRelevant(item, context)) : sorted).filter(
    (item) =>
      needle === '' || `${item.title} ${item.body ?? ''} ${item.publisher}`.toLowerCase().includes(needle),
  );

  /*
   * THE FEED, HOISTED so it can be the content of BOTH tab panels.
   *
   * Radix mounts only the selected panel and `shown` is already derived from
   * the selected filter, so exactly one correctly-filtered feed is ever in the
   * document. Declaring both is what gives each tab a real tabpanel for
   * `aria-controls` to point at.
   */
  const feed =
    error !== null ? (
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
        title={
          needle !== ''
            ? 'No matching notices'
            : onlyRelevant
              ? 'Nothing applies to you right now'
              : 'No announcements yet'
        }
        icons={['announcements', 'notifications', 'empty']}
      >
        {needle !== ''
          ? `Nothing in the feed matches “${query.trim()}”.`
          : onlyRelevant
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
    );

  return (
    <div className={styles.page}>
      <PageHeader
        eyebrow="Overview"
        title="Announcements"
        subtitle="Academic notices. GradTools shows them; it does not issue them."
        /* Counts that already exist on the page — the feed's size and how much
           of it applies to this student. Nothing is invented to fill the row. */
        pills={
          sorted.length === 0 ? undefined : (
            <>
              <MetaPill>{formatCount(sorted.length, 'notice')}</MetaPill>
              <MetaPill>
                {formatCount(
                  sorted.filter((item) => isRelevant(item, context)).length,
                  'for you',
                  'for you',
                )}
              </MetaPill>
            </>
          )
        }
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
      <IslandTabGroup
        value={onlyRelevant ? 'mine' : 'all'}
        onChange={(id) => {
          setOnlyRelevant(id === 'mine');
        }}
      >
        <div className={styles.toolbar}>
          <IslandTabs
            label="Which announcements"
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

        </div>

        {/*
          THE DESIGN'S FILTER ROW: the categories as chips that scroll rather
          than a select that hides them, and a search box at the end. The chips
          are the categories this product actually has — twelve, not the five of
          a sample — so the row scrolls on a phone exactly as the design's does.
        */}
        <div className={styles.filterRow}>
          <div className={styles.chips}>
            {CATEGORY_OPTIONS.map((option) => (
              <button
                key={option}
                type="button"
                className={styles.chip}
                data-selected={category === option ? 'true' : undefined}
                aria-pressed={category === option}
                onClick={() => {
                  setCategory(option);
                }}
              >
                {option === 'all' ? 'All' : CATEGORY_LABEL[option]}
              </button>
            ))}
          </div>
          <div className={styles.search}>
            <TextField
              /*
                The design draws this field with no visible label. The label
                still exists — a search box with no accessible name is unusable
                with a screen reader (docs/27 §27.11).
              */
              label="Search announcements"
              hideLabel
              icon="search"
              type="search"
              placeholder="Search announcements…"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
              }}
            />
          </div>
        </div>

        {/*
        Relevance is a VIEW, never a default (M7 §14). Hiding notices a student
        has not been targeted by would make the feed silently incomplete, and
        they would have no way to know what they were not seeing — so the "All"
        tab is first and the counts on both tabs say what each one holds.
      */}

        <IslandTabPanel id="all">{feed}</IslandTabPanel>
        <IslandTabPanel id="mine">{feed}</IslandTabPanel>
      </IslandTabGroup>
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
