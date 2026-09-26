/**
 * Announcements — verified notices from the GradTools server, sorted for this
 * student, with the design's category chips and search. GradTools shows
 * notices; it does not issue them.
 */

import type { AnnouncementCategory } from '@gradtools/shared-types';
import { Megaphone, Search } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Badge } from '../../components/ui/badge.js';
import { EmptyState, ErrorState } from '../../components/ui/feedback.js';
import { Input } from '../../components/ui/field.js';
import { PageHeader } from '../../components/ui/page.js';
import { ChipGroup, Segmented } from '../../components/ui/segmented.js';
import { Skeleton } from '../../components/ui/skeleton.js';
import { isRelevant, isTargeted } from '../../domain/announcements.js';
import {
  useAnnouncements,
  useSortedAnnouncements,
  useStudentContext,
} from '../../hooks/useAnnouncements.js';
import { formatCount } from '../../lib/format.js';
import { AnnouncementCard, CATEGORY_LABEL } from './AnnouncementCard.js';

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

type Scope = 'all' | 'mine';

export function AnnouncementsPage() {
  const [category, setCategory] = useState<AnnouncementCategory | 'all'>('all');
  const [scope, setScope] = useState<Scope>('all');
  const [query, setQuery] = useState('');
  const { items, loading, error, reload } = useAnnouncements(category);
  const sorted = useSortedAnnouncements(items);
  const context = useStudentContext();

  /*
   * A notification links to `#announcement-<id>`. The router does not scroll to
   * a hash, and the shell resets scroll on navigation, so once the feed has
   * loaded bring that notice into view and give it focus.
   */
  const { hash } = useLocation();
  useEffect(() => {
    if (loading || hash === '') return;
    const target = document.getElementById(decodeURIComponent(hash.slice(1)));
    if (target === null) return;
    target.scrollIntoView?.({ block: 'start' });
    target.focus({ preventScroll: true });
  }, [hash, loading]);

  const needle = query.trim().toLowerCase();
  const forYou = sorted.filter((item) => isRelevant(item, context));
  const shown = (scope === 'mine' ? forYou : sorted).filter(
    (item) =>
      needle === '' ||
      `${item.title} ${item.body ?? ''} ${item.publisher}`.toLowerCase().includes(needle),
  );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Overview"
        title="Announcements"
        description="Official academic notices, sorted for you. GradTools shows them; it does not issue them."
        actions={
          sorted.length > 0 ? (
            <>
              <Badge>{formatCount(sorted.length, 'notice')}</Badge>
              <Badge tone="accent">{forYou.length} for you</Badge>
            </>
          ) : undefined
        }
      />

      <div className="flex flex-col gap-3">
        <Segmented<Scope>
          label="Which announcements"
          value={scope}
          onChange={setScope}
          options={[
            { value: 'all', label: `All · ${String(sorted.length)}` },
            { value: 'mine', label: `Applies to me · ${String(forYou.length)}` },
          ]}
          className="self-start"
        />
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <ChipGroup
            label="Category"
            value={category}
            onChange={setCategory}
            options={CATEGORY_OPTIONS.map((option) => ({
              value: option,
              label: option === 'all' ? 'All' : CATEGORY_LABEL[option],
            }))}
            className="min-w-0 lg:flex-1"
          />
          <div className="relative w-full shrink-0 lg:w-64">
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-3"
            />
            <Input
              type="search"
              aria-label="Search announcements"
              placeholder="Search announcements…"
              className="pl-9"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
        </div>
      </div>

      {error !== null ? (
        <ErrorState title="Notices are unavailable" message={error} onRetry={reload} />
      ) : loading ? (
        <div role="status" aria-live="polite" className="flex flex-col gap-3">
          <span className="sr-only">Loading announcements…</span>
          {[0, 1, 2].map((key) => (
            <Skeleton key={key} className="h-32 rounded-xl" />
          ))}
        </div>
      ) : shown.length === 0 ? (
        <EmptyState
          icon={<Megaphone />}
          title={
            needle !== ''
              ? 'No matching notices'
              : scope === 'mine'
                ? 'Nothing applies to you right now'
                : 'No announcements yet'
          }
          description={
            needle !== ''
              ? `Nothing in the feed matches “${query.trim()}”.`
              : scope === 'mine'
                ? 'Switch to All to see every notice GradTools holds.'
                : 'Notices appear here once a source is connected or an operator adds one.'
          }
        />
      ) : (
        <ul className="flex flex-col gap-3">
          {shown.map((announcement) => (
            <li key={announcement.id}>
              <AnnouncementCard
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
