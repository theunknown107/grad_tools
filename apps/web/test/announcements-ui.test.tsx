/**
 * The announcements and notification screens.
 *
 * Authority: docs/28 §28.11 · docs/13 §13.15 · M7 §25, §26, §30, §32
 *
 * SYNTHETIC CONTENT ONLY. Every publisher below is fictional, and one fixture
 * is deliberately hostile so the rendering path is proven rather than assumed.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup } from '@testing-library/react';
import { screen, waitFor, within } from '@testing-library/dom';
import userEvent from '@testing-library/user-event';
import type { Announcement } from '@gradtools/shared-types';
import { AnnouncementsPage } from '../src/features/announcements/AnnouncementsPage.js';
import { DashboardPage } from '../src/features/dashboard/DashboardPage.js';
import {
  NotificationSettings,
  NotificationsPage,
} from '../src/features/announcements/NotificationsPage.js';
import { asStudentProfileId } from '../src/domain/identity.js';
import { useAnnouncements } from '../src/hooks/useAnnouncements.js';
import type { StudentProfile } from '../src/domain/types.js';
import { createMemoryRepositories, renderWith } from './helpers.js';

const profileId = asStudentProfileId('11111111-1111-1111-1111-111111111111');

function announcement(overrides: Partial<Announcement> = {}): Announcement {
  return {
    id: 'a1',
    sourceId: null,
    origin: 'operator_entry',
    publisher: 'Demo University (synthetic)',
    title: 'Semester 4 results announced',
    body: null,
    category: 'results',
    canonicalUrl: null,
    publishedAt: '2026-09-08T00:00:00Z',
    eventStartAt: null,
    deadlineAt: null,
    audience: {
      schemeId: null,
      branchId: null,
      branchName: null,
      collegeId: null,
      collegeName: null,
      semester: null,
    },
    firstSeenAt: '2026-09-08T00:00:00Z',
    lastSeenAt: '2026-09-08T00:00:00Z',
    updatedAt: '2026-09-08T00:00:00Z',
    ...overrides,
  };
}

function profile(overrides: Partial<StudentProfile> = {}): StudentProfile {
  return {
    id: profileId,
    authUserId: null,
    displayName: null,
    usn: null,
    collegeName: 'Demo Engineering College',
    schemeId: 'vtu-2022',
    programme: null,
    branch: 'Computer Science and Engineering',
    currentSemester: 5,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

/** Serves the announcement API and records what was requested. */
function mockFeed(items: Announcement[]) {
  const requests: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      requests.push(url);
      const body = url.includes('/filters')
        ? { categories: [], sources: [] }
        : { data: items, total: items.length, limit: 20, offset: 0 };
      return Promise.resolve({ ok: true, json: () => Promise.resolve(body) } as Response);
    }),
  );
  return requests;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/* -------------------------------------------------------------------------- */
/* The announcements list                                                     */
/* -------------------------------------------------------------------------- */

describe('the announcements page', () => {
  it('shows a notice with its publisher and category', async () => {
    mockFeed([announcement()]);
    renderWith(<AnnouncementsPage />);

    const title = await screen.findByText('Semester 4 results announced');
    // Scoped to the row: "Results" is also an option in the category filter.
    const row = title.closest('article') as HTMLElement;

    expect(within(row).getByText('Demo University (synthetic)')).toBeTruthy();
    expect(within(row).getByText('Results')).toBeTruthy();
  });

  /*
   * SYNTHETIC CONTENT SAYS SO (M7 §31). Driven by the record's own origin, so a
   * screen cannot forget to label it.
   */
  it('labels demo content as demo data', async () => {
    mockFeed([announcement({ origin: 'demo_fixture' })]);
    renderWith(<AnnouncementsPage />);

    expect(await screen.findByText('Demo data')).toBeTruthy();
  });

  it('does not label a real operator entry as demo data', async () => {
    mockFeed([announcement({ origin: 'operator_entry' })]);
    renderWith(<AnnouncementsPage />);

    await screen.findByText('Semester 4 results announced');
    expect(screen.queryByText('Demo data')).toBeNull();
  });

  /* Untrusted text is TEXT. It came from a source, not from a template. */
  it('renders a hostile title and body as text', async () => {
    mockFeed([
      announcement({
        title: '<img src=x onerror=alert(1)> Results out',
        body: '<script>alert(1)</script> Please check the portal.',
      }),
    ]);
    renderWith(<AnnouncementsPage />);

    expect(await screen.findByText(/<img src=x onerror=alert\(1\)> Results out/)).toBeTruthy();
    expect(document.querySelector('img')).toBeNull();
    expect(document.querySelector('script')).toBeNull();
  });

  /*
   * A DEADLINE ONLY FROM A REAL DATE (M7 §20). Wording never produces a
   * countdown.
   */
  it('shows a countdown only when a real deadline exists', async () => {
    vi.setSystemTime(new Date('2026-09-10T12:00:00Z'));
    mockFeed([
      announcement({ id: 'dated', category: 'backlog', deadlineAt: '2026-09-12T00:00:00Z' }),
      announcement({ id: 'vague', title: 'Apply soon', body: 'Apply soon. Urgent.' }),
    ]);
    renderWith(<AnnouncementsPage />);

    expect(await screen.findByText(/Deadline:/)).toBeTruthy();
    expect(screen.getByText(/in 2 days/)).toBeTruthy();
    // Exactly one deadline line: the vague notice produced none.
    expect(screen.getAllByText(/Deadline:/).length).toBe(1);
    vi.useRealTimers();
  });

  /*
   * LEAVING GRADTOOLS IS OBVIOUS (M7 §26). The host is shown before the student
   * follows the link, and the link cannot reach the opener.
   */
  it('names the host of an external link and blocks the opener', async () => {
    mockFeed([announcement({ canonicalUrl: 'https://example.edu/notices/1' })]);
    renderWith(<AnnouncementsPage />);

    const link = await screen.findByRole('link', { name: /example\.edu/ });
    expect(link.getAttribute('rel')).toContain('noopener');
    expect(link.getAttribute('rel')).toContain('noreferrer');
    expect(link.getAttribute('target')).toBe('_blank');
  });

  it('says so when there is nothing to show', async () => {
    mockFeed([]);
    renderWith(<AnnouncementsPage />);

    expect(await screen.findByText(/No announcements yet/)).toBeTruthy();
  });

  /* An unreachable feed is not an empty feed. */
  it('reports a server it cannot reach rather than showing nothing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new Error('network'))),
    );
    renderWith(<AnnouncementsPage />);

    expect(await screen.findByText(/Could not reach the GradTools server/)).toBeTruthy();
  });
});

/* -------------------------------------------------------------------------- */
/* Relevance in the browser                                                   */
/* -------------------------------------------------------------------------- */

describe('relevance on screen', () => {
  const targeted = announcement({
    id: 'other-branch',
    title: 'Civil Engineering department meeting',
    category: 'department_notice',
    audience: {
      schemeId: null,
      branchId: null,
      branchName: 'Civil Engineering',
      collegeId: null,
      collegeName: null,
      semester: null,
    },
  });

  /* Shown, but marked. A feed that hides things cannot be trusted (M7 §14). */
  it('keeps an announcement for another branch visible and marks it', async () => {
    mockFeed([targeted]);
    const { bundle } = createMemoryRepositories({ profile: profile() });
    renderWith(<AnnouncementsPage />, { repositories: bundle });

    expect(await screen.findByText('Civil Engineering department meeting')).toBeTruthy();
    expect(screen.getByText(/Not for your branch or semester/)).toBeTruthy();
  });

  it('edges an announcement for the student with a fill that renders', async () => {
    mockFeed([
      announcement({
        id: 'for-me',
        title: 'CSE lab schedule',
        audience: {
          schemeId: null,
          branchId: null,
          branchName: 'Computer Science and Engineering',
          collegeId: null,
          collegeName: null,
          semester: null,
        },
      }),
    ]);
    const { bundle } = createMemoryRepositories({ profile: profile() });
    renderWith(<AnnouncementsPage />, { repositories: bundle });

    const article = (await screen.findByText('CSE lab schedule')).closest('article');
    expect(within(article as HTMLElement).getByText(/For you/)).toBeTruthy();
    /*
     * A `border-l-accent` edge painted in the neutral hairline colour
     * (index.css neutralises coloured borders by design). The edge is a filled,
     * decorative span; "For you" says the same thing in words.
     */
    expect(article?.className).not.toContain('border-l-accent');
    const edge = article?.querySelector(':scope > span[aria-hidden="true"]');
    expect(edge?.className).toContain('bg-accent');
  });

  it('filters to what applies when the student asks', async () => {
    mockFeed([targeted, announcement({ id: 'mine', title: 'For everyone' })]);
    const { bundle } = createMemoryRepositories({ profile: profile() });
    renderWith(<AnnouncementsPage />, { repositories: bundle });

    await screen.findByText('For everyone');
    /*
     * M9.6F turned the relevance filter from a checkbox into island tabs — it
     * is a VIEW of the feed rather than a setting. The assertion is unchanged:
     * asking for "what applies to me" must filter the feed.
     */
    await userEvent.click(screen.getByRole('radio', { name: /applies to me/i }));

    await waitFor(() => {
      expect(screen.queryByText('Civil Engineering department meeting')).toBeNull();
    });
    expect(screen.getByText('For everyone')).toBeTruthy();
  });

  /*
   * THE STUDENT'S CONTEXT NEVER LEAVES THE DEVICE (M7 §23). The request carries
   * no branch, semester, college or profile of any kind.
   */
  it('sends no student context to the API', async () => {
    const requests = mockFeed([announcement()]);
    const { bundle } = createMemoryRepositories({ profile: profile({ usn: '1XX22CS001' }) });
    renderWith(<AnnouncementsPage />, { repositories: bundle });

    await screen.findByText('Semester 4 results announced');
    for (const url of requests) {
      expect(url).not.toMatch(/branch|semester|college|scheme|usn|1XX22CS001/i);
    }
  });
});

/* -------------------------------------------------------------------------- */
/* The dashboard summary                                                      */
/* -------------------------------------------------------------------------- */

describe('what changed, on the dashboard', () => {
  it('shows a compact list with a way to see everything', async () => {
    mockFeed([announcement(), announcement({ id: 'a2', title: 'Second notice' })]);
    renderWith(<DashboardPage />);

    const title = await screen.findByText('Semester 4 results announced');
    // The category is shown by its label, never the stored key.
    expect(title.closest('a')?.textContent).toMatch(/Results ·/);
    expect(screen.getByRole('link', { name: 'All' }).getAttribute('href')).toBe('/notifications');
  });

  it('says there is nothing new rather than showing an empty box', async () => {
    mockFeed([]);
    renderWith(<DashboardPage />);
    expect(await screen.findByText('Nothing new')).toBeTruthy();
  });
});

/* -------------------------------------------------------------------------- */
/* The notification centre                                                    */
/* -------------------------------------------------------------------------- */

describe('the notification centre', () => {
  it('counts what is unread', async () => {
    mockFeed([announcement(), announcement({ id: 'a2', title: 'Second notice' })]);
    renderWith(<NotificationsPage />);

    /*
     * The count moved off a panel heading and onto the Unread tab, where it
     * says what that view holds. Still counted, still shown in words nearby.
     */
    const unreadTab = await screen.findByRole('radio', { name: /unread/i });
    await waitFor(() => {
      expect(unreadTab.textContent).toContain('2');
    });
  });

  /* UNREAD IS A WORD, NOT ONLY A COLOUR (M7 §27). */
  it('says unread in words', async () => {
    mockFeed([announcement()]);
    renderWith(<NotificationsPage />);

    // A dot, named for assistive technology — the word, not only the colour.
    expect(await screen.findByRole('img', { name: 'Unread' })).toBeTruthy();
  });

  it('lands on the linked notice when opened from a notification', async () => {
    mockFeed([
      announcement({ id: 'a1', title: 'First notice' }),
      announcement({ id: 'a2', title: 'Second notice' }),
    ]);
    renderWith(<AnnouncementsPage />, { route: '/announcements#announcement-a2' });
    await screen.findByText('Second notice');
    await waitFor(() => {
      expect(document.activeElement?.id).toBe('announcement-a2');
    });
  });

  it('marks one as read when it is opened, and keeps it', async () => {
    mockFeed([announcement()]);
    const { bundle, peek } = createMemoryRepositories();
    renderWith(<NotificationsPage />, { repositories: bundle });

    // As in the design, the row is one control: opening it reads it.
    const row = await screen.findByRole('link', { name: /Semester 4 results announced/ });
    // It opens the notice itself, not the top of the list.
    expect(row.getAttribute('href')).toBe('/announcements#announcement-a1');
    await userEvent.click(row);

    await waitFor(() => {
      expect(peek.notificationState()[0]?.state).toBe('read');
    });
    await waitFor(() => {
      expect(document.querySelector('[data-state="read"]')).not.toBeNull();
    });
    expect(document.querySelector('[data-state="unread"]')).toBeNull();
  });

  it('marks everything as read at once', async () => {
    mockFeed([announcement(), announcement({ id: 'a2', title: 'Second' })]);
    const { bundle, peek } = createMemoryRepositories();
    renderWith(<NotificationsPage />, { repositories: bundle });

    await userEvent.click(await screen.findByRole('button', { name: 'Mark all read' }));

    await waitFor(() => {
      expect(peek.notificationState().filter((r) => r.state === 'read').length).toBe(2);
    });
    // Nothing unread: the tab count drops to zero and the action disables.
    await waitFor(() => {
      expect(screen.getByRole('radio', { name: /unread/i }).textContent).toContain('0');
    });
    expect(screen.getByRole('button', { name: 'Mark all read' }).hasAttribute('disabled')).toBe(
      true,
    );
  });

  it('filters to unread only', async () => {
    mockFeed([
      announcement({ title: 'Already read' }),
      announcement({ id: 'a2', title: 'New one' }),
    ]);
    const { bundle } = createMemoryRepositories({
      notificationState: [
        {
          id: 'a1',
          state: 'read',
          seenVersion: '2026-09-08T00:00:00Z',
          updatedAt: '2026-09-08T00:00:00Z',
        },
      ],
    });
    renderWith(<NotificationsPage />, { repositories: bundle });

    await screen.findByText('Already read');
    await userEvent.click(screen.getByRole('radio', { name: /unread/i }));

    await waitFor(() => {
      expect(screen.queryByText('Already read')).toBeNull();
    });
    expect(screen.getByText('New one')).toBeTruthy();
  });

  it('offers no per-row buttons the design does not have', async () => {
    mockFeed([announcement()]);
    renderWith(<NotificationsPage />);
    await screen.findByRole('link', { name: /Semester 4 results announced/ });
    expect(screen.queryByRole('button', { name: /mark as read|dismiss/i })).toBeNull();
    expect(screen.queryByRole('link', { name: /open in announcements/i })).toBeNull();
  });

  /*
   * MUTING STOPS INTERRUPTION, IT DOES NOT HIDE (M7 §18). The preference is
   * local and is never sent anywhere.
   */
  it('mutes a category locally', async () => {
    mockFeed([announcement({ category: 'holiday', title: 'Holiday notice' })]);
    const { bundle, peek } = createMemoryRepositories();
    const inbox = renderWith(<NotificationsPage />, { repositories: bundle });
    await screen.findByText('Holiday notice');
    inbox.unmount();

    // Settings → Notifications: on means it may interrupt; switching it off mutes it.
    const settings = renderWith(<NotificationSettings />, { repositories: bundle });
    const toggle = await screen.findByRole('switch', { name: 'Holiday' });
    expect(toggle.getAttribute('aria-checked')).toBe('true');
    await userEvent.click(toggle);
    await waitFor(() => {
      expect(peek.notificationPreferences()?.muted).toContain('holiday');
    });
    settings.unmount();

    // Back in Notifications, the muted category no longer interrupts.
    renderWith(<NotificationsPage />, { repositories: bundle });
    expect(await screen.findByText(/No notifications yet/)).toBeTruthy();
    expect(screen.queryByText('Holiday notice')).toBeNull();
  });

  /*
   * GradTools delivers nothing outside the app: no `Notification` call, no
   * service worker, no push. The settings used to offer a button that asked for
   * permission and then said notifications were on. They now say plainly that
   * there are none, ask for nothing, and offer no control wired to nothing.
   */
  it('asks for no browser permission and offers no browser-notification control', async () => {
    const requestPermission = vi.fn(() => Promise.resolve('granted'));
    const constructed = vi.fn();
    vi.stubGlobal(
      'Notification',
      Object.assign(constructed, { requestPermission, permission: 'default' }),
    );
    mockFeed([announcement()]);
    renderWith(<NotificationSettings />);

    expect(await screen.findByText(/Browser notifications aren’t available yet/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /notifications/i })).toBeNull();
    expect(screen.queryByText(/Notifications are on|Turn on notifications/)).toBeNull();

    // Using the rest of the page — muting a category — asks for nothing either.
    await userEvent.click(await screen.findByRole('switch', { name: 'Holiday' }));
    expect(requestPermission).not.toHaveBeenCalled();
    expect(constructed).not.toHaveBeenCalled();
  });

  it('says so when nothing is unread', async () => {
    mockFeed([]);
    renderWith(<NotificationsPage />);

    expect(await screen.findByText(/No notifications yet/)).toBeTruthy();
  });

  /* An announcement for another branch never interrupts. */
  it('leaves an irrelevant announcement out of notifications', async () => {
    mockFeed([
      announcement({
        title: 'Civil only',
        audience: {
          schemeId: null,
          branchId: null,
          branchName: 'Civil Engineering',
          collegeId: null,
          collegeName: null,
          semester: null,
        },
      }),
    ]);
    const { bundle } = createMemoryRepositories({ profile: profile() });
    renderWith(<NotificationsPage />, { repositories: bundle });

    expect(await screen.findByText(/No notifications yet/)).toBeTruthy();
  });
});

/* -------------------------------------------------------------------------- */
/* Priority on screen                                                         */
/* -------------------------------------------------------------------------- */

describe('priority on screen', () => {
  it('marks a close deadline urgent and a circular informational', async () => {
    vi.setSystemTime(new Date('2026-09-10T12:00:00Z'));
    mockFeed([
      announcement({ id: 'u', category: 'backlog', deadlineAt: '2026-09-11T00:00:00Z' }),
      announcement({ id: 'i', category: 'general', title: 'A general circular' }),
    ]);
    renderWith(<AnnouncementsPage />);

    /*
     * URGENT IS DERIVED FROM A REAL DEADLINE, and a circular with none is not
     * urgent. The design's card carries a priority badge only when there IS
     * one, so what is asserted is that exactly one notice is marked and the
     * general circular is not — rather than the wording of a badge that no
     * longer exists for the ordinary case.
     */
    expect(await screen.findByText('Urgent')).toBeTruthy();
    expect(screen.getAllByText('Urgent')).toHaveLength(1);
    expect(screen.queryByText('Important')).toBeNull();
    const circular = screen.getByText('A general circular').closest('article');
    expect(circular?.textContent).not.toMatch(/urgent|important/i);
    vi.useRealTimers();
  });

  /* NEVER URGENT WITHOUT A DATE (M7 §17). */
  it('never marks a notice urgent on its wording alone', async () => {
    mockFeed([
      announcement({ title: 'URGENT: act immediately', body: 'Apply soon.', category: 'general' }),
    ]);
    renderWith(<AnnouncementsPage />);

    await screen.findByText('URGENT: act immediately');
    const row = screen.getByText('URGENT: act immediately').closest('article') as HTMLElement;
    expect(within(row).queryByText('Urgent')).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* A feed longer than one page                                                */
/* -------------------------------------------------------------------------- */

/**
 * Serves the feed the way the API does: `limit` defaults to 20 and is clamped
 * to 100, `offset` skips, `category` filters, and `total` counts every match.
 * The plain `mockFeed` above ignores paging, which is how a client that only
 * ever saw the first 20 notices went unnoticed.
 */
function mockPagedFeed(items: Announcement[], options: { overlap?: boolean } = {}) {
  const requests: URL[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL) => {
      const url = new URL(String(input), 'http://api.test');
      requests.push(url);
      const category = url.searchParams.get('category');
      const matching = category === null ? items : items.filter((a) => a.category === category);
      const limit = Math.min(Math.max(1, Number(url.searchParams.get('limit') ?? 20)), 100);
      let offset = Number(url.searchParams.get('offset') ?? 0);
      // A notice published between two page requests shifts later pages by one.
      if (options.overlap === true && offset > 0) offset -= 1;
      const body = {
        data: matching.slice(offset, offset + limit),
        total: matching.length,
        limit,
        offset,
      };
      return Promise.resolve({ ok: true, json: () => Promise.resolve(body) } as Response);
    }),
  );
  return requests;
}

/** `count` notices, newest first, as the API orders them. */
function manyNotices(
  count: number,
  overrides: (index: number) => Partial<Announcement> = () => ({}),
) {
  return Array.from({ length: count }, (_, index) => {
    const day = new Date(Date.UTC(2026, 8, 30) - index * 3_600_000).toISOString();
    return announcement({
      id: `bulk-${String(index)}`,
      title: `Bulk notice ${String(index)}`,
      publishedAt: day,
      updatedAt: day,
      ...overrides(index),
    });
  });
}

function FeedTitles() {
  const { items, total, loading } = useAnnouncements();
  if (loading) return null;
  return (
    <ol aria-label={`feed of ${String(total)}`}>
      {items.map((item) => (
        <li key={item.id}>{item.title}</li>
      ))}
    </ol>
  );
}

describe('a feed longer than one page', () => {
  const civil = {
    schemeId: null,
    branchId: null,
    branchName: 'Civil Engineering',
    collegeId: null,
    collegeName: null,
    semester: null,
  };

  it('notifies about a relevant notice that sits beyond the first 20', async () => {
    const notices = manyNotices(25, (index) =>
      index === 23
        ? {
            id: 'old-cse',
            title: 'Older CSE lab notice',
            audience: { ...civil, branchName: 'Computer Science and Engineering' },
          }
        : { audience: civil },
    );
    mockPagedFeed(notices);
    const { bundle } = createMemoryRepositories({ profile: profile() });
    renderWith(<NotificationsPage />, { repositories: bundle });

    // The only notice for this student is the 24th: it must still reach them.
    const row = await screen.findByRole('link', { name: /Older CSE lab notice/ });
    expect(row.getAttribute('href')).toBe('/announcements#announcement-old-cse');
    expect(row.getAttribute('data-state')).toBe('unread');
    expect(screen.getByRole('radio', { name: /^Unread/ }).textContent).toBe('Unread · 1');
  });

  it('counts the API total and lists every notice, in the server order', async () => {
    const notices = manyNotices(130);
    const requests = mockPagedFeed(notices);
    renderWith(<FeedTitles />);

    const list = await screen.findByRole('list', { name: 'feed of 130' });
    const titles = within(list)
      .getAllByRole('listitem')
      .map((item) => item.textContent);
    expect(titles).toEqual(notices.map((notice) => notice.title));

    const feedPages = requests.filter((url) => url.pathname === '/api/v1/announcements');
    expect(feedPages.map((url) => url.searchParams.get('offset'))).toEqual(['0', '100']);
  });

  it('shows the API total in the Announcements header, not one page of it', async () => {
    mockPagedFeed(manyNotices(130));
    renderWith(<AnnouncementsPage />);
    expect(await screen.findByText('130 notices')).toBeTruthy();
    expect(screen.getByText('Bulk notice 129')).toBeTruthy();
  });

  it('never lists a notice twice when pages overlap', async () => {
    const notices = manyNotices(130);
    mockPagedFeed(notices, { overlap: true });
    renderWith(<FeedTitles />);

    const list = await screen.findByRole('list', { name: 'feed of 130' });
    const titles = within(list)
      .getAllByRole('listitem')
      .map((item) => item.textContent);
    expect(new Set(titles).size).toBe(titles.length);
    expect(titles).toEqual(notices.map((notice) => notice.title));
  });

  it('keeps filtering by category, across pages', async () => {
    const notices = manyNotices(130, (index) => ({
      category: index % 2 === 0 ? 'results' : 'fees',
    }));
    const requests = mockPagedFeed(notices);
    renderWith(<AnnouncementsPage />);
    await screen.findByText('130 notices');

    await userEvent.click(screen.getByRole('radio', { name: 'Results' }));
    expect(await screen.findByText('65 notices')).toBeTruthy();
    expect(screen.queryByText('Bulk notice 1')).toBeNull();
    expect(screen.getByText('Bulk notice 128')).toBeTruthy();
    expect(requests.some((url) => url.searchParams.get('category') === 'results')).toBe(true);
  });
});
