/**
 * An announcement is called the student's, listed as a notification or sent to
 * the phone only on evidence of audience: a targeted notice whose every
 * constraint matches their profile, or one stated to be for every student.
 * Everything else stays in the archive (docs/55 §Announcements).
 */
import type { Announcement, AnnouncementAudience } from '@gradtools/shared-types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VTU_ANNOUNCEMENTS_SNAPSHOT } from '../src/data/vtu-announcements-snapshot.js';
import {
  isForYou,
  isRelevant,
  relevanceOf,
  type StudentContext,
} from '../src/domain/announcements.js';
import { DEFAULT_PREFERENCES, buildNotifications } from '../src/domain/notifications.js';

const native = vi.hoisted(() => ({ schedule: vi.fn(async (_options: unknown) => undefined) }));
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => true } }));
vi.mock('@capacitor/local-notifications', () => ({
  LocalNotifications: {
    checkPermissions: async () => ({ display: 'granted' }),
    requestPermissions: async () => ({ display: 'granted' }),
    createChannel: async () => undefined,
    schedule: native.schedule,
    cancel: async () => undefined,
    addListener: async () => ({ remove: async () => undefined }),
  },
}));

const { NOTIFY_WINDOW_DAYS, noticesToPost, postNewNotices, versionKey } =
  await import('../src/lib/system-notifications.js');

const NOW = new Date('2026-11-27T12:00:00Z');
const NONE: AnnouncementAudience = {
  schemeId: null,
  branchId: null,
  branchName: null,
  collegeId: null,
  collegeName: null,
  semester: null,
};

function notice(overrides: Partial<Announcement> = {}): Announcement {
  return {
    id: 'n1',
    sourceId: null,
    origin: 'operator_entry',
    publisher: 'Demo University (synthetic)',
    title: 'A notice',
    body: null,
    category: 'general',
    canonicalUrl: null,
    publishedAt: '2026-11-26T09:00:00Z',
    eventStartAt: null,
    deadlineAt: null,
    audience: NONE,
    firstSeenAt: '2026-11-26T09:00:00Z',
    lastSeenAt: '2026-11-26T09:00:00Z',
    updatedAt: '2026-11-26T09:00:00Z',
    ...overrides,
  };
}

const student: StudentContext = {
  schemeId: 'vtu-2022',
  branchName: 'Computer Science and Engineering',
  collegeName: 'Example Institute of Technology',
  currentSemester: 5,
};
const cse5 = { ...NONE, branchName: 'Computer Science and Engineering', semester: 5 };

describe('audience evidence', () => {
  it('an explicitly global notice is for everyone', () => {
    const global = notice({ audience: { ...NONE, scope: 'global' } });
    expect(relevanceOf(global, student)).toBe('global');
    expect(isForYou(global, student)).toBe(true);
  });

  it('a targeted notice that matches is for you; one that does not is not', () => {
    expect(isForYou(notice({ audience: cse5 }), student)).toBe(true);
    const civil = notice({ audience: { ...NONE, branchName: 'Civil Engineering' } });
    expect(relevanceOf(civil, student)).toBe('not_relevant');
  });

  it('a null audience is unknown: kept in the archive, never "for you"', () => {
    const unclassified = notice();
    expect(relevanceOf(unclassified, student)).toBe('unknown');
    expect(isRelevant(unclassified, student)).toBe(true);
    expect(isForYou(unclassified, student)).toBe(false);
  });

  it.each([
    ['branch', { ...student, branchName: null }],
    ['semester', { ...student, currentSemester: null }],
  ])('a targeted notice is unknown when the profile has no %s', (_axis, context) => {
    expect(relevanceOf(notice({ audience: cse5 }), context)).toBe('unknown');
    expect(isRelevant(notice({ audience: cse5 }), context)).toBe(true);
    expect(isForYou(notice({ audience: cse5 }), context)).toBe(false);
  });

  it('a category is not an audience: results, exams and sports need a stated audience', () => {
    for (const category of ['results', 'exam_timetable', 'sports'] as const) {
      expect(isForYou(notice({ category }), student)).toBe(false);
    }
    const otherCollegeSports = notice({
      category: 'sports',
      audience: { ...NONE, collegeName: 'Another College' },
    });
    expect(relevanceOf(otherCollegeSports, student)).toBe('not_relevant');
  });
});

describe('the notification list', () => {
  it('holds only established, unmuted notices', () => {
    const list = buildNotifications(
      [
        notice({ id: 'unknown' }),
        notice({ id: 'mine', audience: cse5 }),
        notice({ id: 'muted', category: 'sports', audience: { ...NONE, scope: 'global' } }),
      ],
      [],
      student,
      { ...DEFAULT_PREFERENCES, muted: ['sports'] },
      NOW,
    );
    expect(list.map((item) => item.announcement.id)).toEqual(['mine']);
  });

  it('never lists the unclassified bundled snapshot as the student’s', () => {
    expect(VTU_ANNOUNCEMENTS_SNAPSHOT.length).toBeGreaterThan(0);
    for (const entry of VTU_ANNOUNCEMENTS_SNAPSHOT) {
      expect(relevanceOf(entry, student)).toBe('unknown');
    }
    expect(
      buildNotifications(VTU_ANNOUNCEMENTS_SNAPSHOT, [], student, DEFAULT_PREFERENCES, NOW),
    ).toEqual([]);
  });
});

describe('Android notification eligibility', () => {
  const fresh = notice({ id: 'fresh', audience: cse5 });

  it('posts a recent, unseen notice', () => {
    expect(noticesToPost([fresh], new Set(), NOW, false)).toEqual([fresh]);
  });

  it('never posts from the snapshot, even a notice stated to be global', () => {
    const globalSnapshot = {
      ...VTU_ANNOUNCEMENTS_SNAPSHOT[0]!,
      audience: { ...NONE, scope: 'global' as const },
    };
    expect(noticesToPost([globalSnapshot, fresh], new Set(), NOW, true)).toEqual([]);
  });

  it(`skips a notice older than ${String(NOTIFY_WINDOW_DAYS)} days`, () => {
    const stale = notice({
      id: 'stale',
      publishedAt: '2026-11-01T00:00:00Z',
      updatedAt: '2026-11-01T00:00:00Z',
    });
    expect(noticesToPost([stale], new Set(), NOW, false)).toEqual([]);
  });

  it('posts once per version: a duplicate is skipped, an update is news', () => {
    const seen = new Set([versionKey(fresh)]);
    expect(noticesToPost([fresh], seen, NOW, false)).toEqual([]);
    const updated = { ...fresh, updatedAt: '2026-11-27T08:00:00Z' };
    expect(noticesToPost([updated], seen, NOW, false)).toEqual([updated]);
    /* An earlier build stored the bare id: that posting still counts. */
    expect(noticesToPost([fresh], new Set(['fresh']), NOW, false)).toEqual([]);
  });

  describe('on the device', () => {
    beforeEach(() => {
      window.localStorage.clear();
      native.schedule.mockClear();
      vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
    });
    afterEach(() => vi.useRealTimers());

    it('records what is already there on first sight and rings for nothing', async () => {
      expect(await postNewNotices([fresh], () => 'General', false)).toBe(0);
      expect(native.schedule).not.toHaveBeenCalled();
      const later = notice({ id: 'later', audience: cse5, updatedAt: '2026-11-27T10:00:00Z' });
      expect(await postNewNotices([fresh, later], () => 'General', false)).toBe(1);
      const sent = native.schedule.mock.calls[0]![0] as {
        notifications: { title: string; body: string; extra: Record<string, unknown> }[];
      };
      /* The payload is the notice's own title and id: no profile data. */
      expect(sent.notifications).toEqual([
        expect.objectContaining({
          title: 'VTU · General',
          body: 'A notice',
          extra: { announcementId: 'later' },
        }),
      ]);
    });

    it('posts nothing while the feed is the bundled snapshot', async () => {
      window.localStorage.setItem('gradtools:v1:notified-ids', '[]');
      expect(await postNewNotices([fresh], () => 'General', true)).toBe(0);
      expect(native.schedule).not.toHaveBeenCalled();
    });
  });
});
