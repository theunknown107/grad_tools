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
import {
  AnnouncementsPage,
  LatestAnnouncements,
} from '../src/features/announcements/AnnouncementsPage.js';
import { NotificationsPage } from '../src/features/announcements/NotificationsPage.js';
import { asStudentProfileId } from '../src/domain/identity.js';
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
    await userEvent.click(screen.getByRole('tab', { name: /applies to me/i }));

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

describe('latest announcements on the dashboard', () => {
  it('shows a compact list with a way to see everything', async () => {
    mockFeed([announcement(), announcement({ id: 'a2', title: 'Second notice' })]);
    renderWith(<LatestAnnouncements />);

    expect(await screen.findByText('Semester 4 results announced')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'All announcements' })).toBeTruthy();
  });

  it('shows nothing at all rather than an empty box', async () => {
    mockFeed([]);
    const { container } = renderWith(<LatestAnnouncements />);
    await waitFor(() => {
      expect(container.textContent).not.toContain('Latest');
    });
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
    const unreadTab = await screen.findByRole('tab', { name: /unread/i });
    expect(unreadTab.textContent).toContain('2');
  });

  /* UNREAD IS A WORD, NOT ONLY A COLOUR (M7 §27). */
  it('says unread in words', async () => {
    mockFeed([announcement()]);
    renderWith(<NotificationsPage />);

    expect(await screen.findByText('Unread')).toBeTruthy();
  });

  it('marks one as read and keeps it', async () => {
    mockFeed([announcement()]);
    const { bundle, peek } = createMemoryRepositories();
    renderWith(<NotificationsPage />, { repositories: bundle });

    await userEvent.click(await screen.findByRole('button', { name: 'Mark as read' }));

    await waitFor(() => {
      expect(peek.notificationState()[0]?.state).toBe('read');
    });
    expect(await screen.findByText('Read')).toBeTruthy();
  });

  it('marks everything as read at once', async () => {
    mockFeed([announcement(), announcement({ id: 'a2', title: 'Second' })]);
    const { bundle, peek } = createMemoryRepositories();
    renderWith(<NotificationsPage />, { repositories: bundle });

    await userEvent.click(await screen.findByRole('button', { name: 'Mark all as read' }));

    await waitFor(() => {
      expect(peek.notificationState().filter((r) => r.state === 'read').length).toBe(2);
    });
    // Nothing unread: the tab count drops to zero and the action disables.
    await waitFor(() => {
      expect(screen.getByRole('tab', { name: /unread/i }).textContent).toContain('0');
    });
    expect(screen.getByRole('button', { name: 'Mark all as read' }).hasAttribute('disabled')).toBe(
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
    await userEvent.click(screen.getByRole('tab', { name: /unread/i }));

    await waitFor(() => {
      expect(screen.queryByText('Already read')).toBeNull();
    });
    expect(screen.getByText('New one')).toBeTruthy();
  });

  it('dismisses a notification', async () => {
    mockFeed([announcement()]);
    const { bundle, peek } = createMemoryRepositories();
    renderWith(<NotificationsPage />, { repositories: bundle });

    await userEvent.click(await screen.findByRole('button', { name: 'Dismiss' }));

    await waitFor(() => {
      expect(peek.notificationState()[0]?.state).toBe('dismissed');
    });
  });

  /*
   * MUTING STOPS INTERRUPTION, IT DOES NOT HIDE (M7 §18). The preference is
   * local and is never sent anywhere.
   */
  it('mutes a category locally', async () => {
    mockFeed([announcement({ category: 'holiday', title: 'Holiday notice' })]);
    const { bundle, peek } = createMemoryRepositories();
    renderWith(<NotificationsPage />, { repositories: bundle });

    await screen.findByText('Holiday notice');
    const checkbox = screen.getByRole('checkbox', { name: 'Holiday' });
    await userEvent.click(checkbox);

    await waitFor(() => {
      expect(peek.notificationPreferences()?.muted).toContain('holiday');
    });
    await waitFor(() => {
      expect(screen.queryByText('Holiday notice')).toBeNull();
    });
  });

  /*
   * PERMISSION IS NEVER REQUESTED ON LOAD (M7 §24). A prompt nobody asked for
   * is the fastest way to be refused permanently.
   */
  it('does not ask for notification permission until the student clicks', async () => {
    const requestPermission = vi.fn(() => Promise.resolve('granted'));
    vi.stubGlobal('Notification', { requestPermission, permission: 'default' });
    mockFeed([announcement()]);
    renderWith(<NotificationsPage />);

    await screen.findByText('Semester 4 results announced');
    expect(requestPermission).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: 'Turn on notifications' }));
    await waitFor(() => {
      expect(requestPermission).toHaveBeenCalledTimes(1);
    });
  });

  /* The limit is stated rather than implied: it cannot notify when closed. */
  it('says browser notifications only work while the app is open', async () => {
    mockFeed([announcement()]);
    renderWith(<NotificationsPage />);

    expect(await screen.findByText(/cannot notify you when the app is closed/)).toBeTruthy();
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

    const urgent = await screen.findByText('Urgent');
    expect(urgent).toBeTruthy();
    expect(screen.getByText('For information')).toBeTruthy();
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
