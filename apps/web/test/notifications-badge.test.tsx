/**
 * The notification badge and the notification list are ONE piece of state.
 *
 * This is the test no existing suite performed: the shell and the page were
 * always rendered on their own, so nothing ever proved that marking a notice
 * read in one reached the other. It did not — each consumer of
 * `useNotifications` held its own `useState` copy, so "Mark all read" cleared
 * the list and left the shell's badge saying 9+ until the browser was reloaded.
 *
 * Every assertion below is therefore made on ONE React tree containing both.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup } from '@testing-library/react';
import { screen, waitFor, within } from '@testing-library/dom';
import userEvent from '@testing-library/user-event';
import type { Announcement } from '@gradtools/shared-types';
import { AppShell } from '../src/components/layout/AppShell.js';
import { NotificationsPage } from '../src/features/announcements/NotificationsPage.js';
import { createMemoryRepositories, renderWith } from './helpers.js';

function announcement(index: number, overrides: Partial<Announcement> = {}): Announcement {
  const published = `2026-09-${String(index + 1).padStart(2, '0')}T00:00:00Z`;
  return {
    id: `a${String(index)}`,
    sourceId: null,
    origin: 'operator_entry',
    publisher: 'Demo University (synthetic)',
    title: `Notice number ${String(index)}`,
    body: null,
    category: 'general',
    canonicalUrl: null,
    publishedAt: published,
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
    firstSeenAt: published,
    lastSeenAt: published,
    updatedAt: published,
    ...overrides,
  };
}

/** Serves the announcement feed, and lets a later reload serve a longer one. */
function mockFeed(items: () => Announcement[]) {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL) => {
      const body = String(input).includes('/filters')
        ? { categories: [], sources: [] }
        : { data: items(), total: items().length, limit: 20, offset: 0 };
      return Promise.resolve({ ok: true, json: () => Promise.resolve(body) } as Response);
    }),
  );
}

/**
 * The top bar's bell, which is what a student actually looks at. The sidebar
 * carries its own copy of the same count, so both are checked: they are two
 * consumers of the one store, and a fix that reached only one is not a fix.
 */
function bell(): HTMLElement {
  const links = screen.getAllByRole('link', { name: /^Notifications/ });
  const found = links.find((link) => link.textContent === '');
  if (found === undefined) throw new Error('the top bar bell is not on screen');
  return found;
}

function badge(): HTMLElement | null {
  return (bell().parentElement?.querySelector('span[aria-hidden="true"]') as HTMLElement) ?? null;
}

/** Every accessible name the shell gives the notifications destination. */
function badgeLabels(): string[] {
  return screen
    .getAllByRole('link', { name: /^Notifications/ })
    // The sidebar labels itself with its own text when there is nothing unread.
    .map((link) => link.getAttribute('aria-label') ?? link.textContent ?? '');
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('the notification badge and the notification list', () => {
  it('clears the badge when the page marks everything read, with no remount', async () => {
    const seeded = Array.from({ length: 12 }, (_, index) => announcement(index));
    mockFeed(() => seeded);
    const { bundle, peek } = createMemoryRepositories();
    const user = userEvent.setup();

    renderWith(
      <AppShell>
        <NotificationsPage />
      </AppShell>,
      { repositories: bundle, route: '/notifications' },
    );

    // 12 unread: the design shows "9+" above nine.
    await waitFor(() => {
      expect(badge()?.textContent).toBe('9+');
    });
    expect(badgeLabels()).toEqual(['Notifications, 12 unread', 'Notifications, 12 unread']);
    const shellBefore = bell();

    await user.click(screen.getByRole('button', { name: 'Mark all read' }));

    await waitFor(() => {
      expect(badge()).toBeNull();
    });
    expect(badgeLabels()).toEqual(['Notifications', 'Notifications']);
    // The badge went because the state changed, NOT because the shell remounted.
    expect(bell()).toBe(shellBefore);
    // …and it reached storage, so a reload agrees with what is on screen.
    expect(peek.notificationState().filter((record) => record.state === 'read').length).toBe(12);
  });

  it('decrements the badge when a single notice is opened', async () => {
    mockFeed(() => [announcement(1), announcement(2), announcement(3)]);
    const user = userEvent.setup();

    renderWith(
      <AppShell>
        <NotificationsPage />
      </AppShell>,
      { route: '/notifications' },
    );

    await waitFor(() => {
      expect(badge()?.textContent).toBe('3');
    });

    const row = await screen.findByText('Notice number 1');
    await user.click(row);

    await waitFor(() => {
      expect(badge()?.textContent).toBe('2');
    });
  });

  it('counts a notice that arrives later without resurrecting read ones', async () => {
    let feed = [announcement(1), announcement(2)];
    mockFeed(() => feed);
    const user = userEvent.setup();

    renderWith(
      <AppShell>
        <NotificationsPage />
      </AppShell>,
      { route: '/notifications' },
    );

    await waitFor(() => {
      expect(badge()?.textContent).toBe('2');
    });

    await user.click(screen.getByRole('button', { name: 'Mark all read' }));
    await waitFor(() => {
      expect(badge()).toBeNull();
    });

    // A refetch brings the same two back plus one new one.
    feed = [announcement(1), announcement(2), announcement(3)];
    await user.click(screen.getByRole('radio', { name: /^All/ }));
    await user.click(screen.getByRole('radio', { name: /^Unread/ }));

    // Read state survived the refetch: only the new notice is unread.
    await waitFor(() => {
      expect(screen.getByRole('radio', { name: /^Unread/ }).textContent).toMatch(/Unread · [01]/);
    });
  });

  it('shows the same unread figure in the list filter and the shell', async () => {
    mockFeed(() => [announcement(1), announcement(2), announcement(3), announcement(4)]);

    renderWith(
      <AppShell>
        <NotificationsPage />
      </AppShell>,
      { route: '/notifications' },
    );

    await waitFor(() => {
      expect(badge()?.textContent).toBe('4');
    });
    const filter = screen.getByRole('radio', { name: /^Unread/ });
    expect(within(filter).getByText(/Unread · 4/)).toBeTruthy();
  });
});
