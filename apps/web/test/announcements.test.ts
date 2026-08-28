/**
 * Relevance, priority, deadlines and notification identity.
 *
 * Authority: docs/12 §12.12 · M7 §13, §14, §17, §18, §22, §37
 *
 * SYNTHETIC CONTENT ONLY. No real VTU or college notice appears here, and the
 * publishers below are fictional.
 */

import { describe, expect, it } from 'vitest';
import type { Announcement, AnnouncementCategory } from '@gradtools/shared-types';
import {
  deadlineInfo,
  isRelevant,
  isTargeted,
  priorityOf,
  relevanceOf,
  sortForStudent,
  URGENT_WITHIN_DAYS,
  type StudentContext,
} from '../src/domain/announcements.js';
import {
  buildNotifications,
  DEFAULT_PREFERENCES,
  markAllRead,
  markState,
  stateFor,
  unreadCount,
  type NotificationRecord,
} from '../src/domain/notifications.js';

const NOW = new Date('2026-09-10T12:00:00Z');

function announcement(overrides: Partial<Announcement> = {}): Announcement {
  return {
    id: overrides.id ?? 'a1',
    sourceId: null,
    origin: 'operator_entry',
    publisher: 'Demo University (synthetic)',
    title: 'A notice',
    body: null,
    category: 'general',
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

const student: StudentContext = {
  schemeId: 'vtu-2022',
  branchName: 'Computer Science and Engineering',
  collegeName: 'Demo Engineering College',
  currentSemester: 5,
};

/* -------------------------------------------------------------------------- */
/* Relevance                                                                  */
/* -------------------------------------------------------------------------- */

describe('relevance', () => {
  it('shows an untargeted notice to everyone', () => {
    expect(relevanceOf(announcement(), student)).toBe('global');
    expect(isTargeted(announcement())).toBe(false);
  });

  it('matches a semester-targeted notice to the student semester', () => {
    const forFifth = announcement({
      audience: { ...announcement().audience, semester: 5 },
    });
    expect(relevanceOf(forFifth, student)).toBe('semester_relevant');
    expect(isRelevant(forFifth, { ...student, currentSemester: 3 })).toBe(false);
  });

  it('matches a branch by name, ignoring case and spacing', () => {
    const forCse = announcement({
      audience: { ...announcement().audience, branchName: '  computer science and ENGINEERING ' },
    });
    expect(isRelevant(forCse, student)).toBe(true);
    expect(isRelevant(forCse, { ...student, branchName: 'Mechanical Engineering' })).toBe(false);
  });

  it('matches a college by name', () => {
    const forCollege = announcement({
      audience: { ...announcement().audience, collegeName: 'Demo Engineering College' },
    });
    expect(relevanceOf(forCollege, student)).toBe('college_relevant');
    expect(isRelevant(forCollege, { ...student, collegeName: 'Another College' })).toBe(false);
  });

  it('matches a scheme by identifier', () => {
    const forScheme = announcement({
      audience: { ...announcement().audience, schemeId: 'vtu-2022' },
    });
    expect(isRelevant(forScheme, student)).toBe(true);
    expect(isRelevant(forScheme, { ...student, schemeId: 'vtu-2018' })).toBe(false);
  });

  /*
   * AN AUDIENCE IS A CONJUNCTION (M7 §14). Treating it as a disjunction would
   * broadcast a notice aimed at one branch's fifth semester to every fifth
   * semester in the university.
   */
  it('requires every stated constraint to match, not any of them', () => {
    const narrow = announcement({
      audience: {
        ...announcement().audience,
        branchName: 'Computer Science and Engineering',
        semester: 5,
      },
    });

    expect(isRelevant(narrow, student)).toBe(true);
    // Right semester, wrong branch: not for them.
    expect(isRelevant(narrow, { ...student, branchName: 'Civil Engineering' })).toBe(false);
    // Right branch, wrong semester: also not for them.
    expect(isRelevant(narrow, { ...student, currentSemester: 3 })).toBe(false);
  });

  /*
   * A student who has not filled in their branch still sees branch notices.
   * The alternative is silently losing notices with no way to know it is
   * happening; one irrelevant notice is visible and fixable.
   */
  it('does not hide a targeted notice from a student who has not said', () => {
    const forCse = announcement({
      audience: { ...announcement().audience, branchName: 'Computer Science and Engineering' },
    });
    const blank: StudentContext = {
      schemeId: null,
      branchName: null,
      collegeName: null,
      currentSemester: null,
    };
    expect(isRelevant(forCse, blank)).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* Deadlines                                                                  */
/* -------------------------------------------------------------------------- */

describe('deadlines', () => {
  it('reports nothing when there is no deadline', () => {
    expect(deadlineInfo(announcement(), NOW)).toBeNull();
  });

  /*
   * NOTHING IS READ FROM WORDING (M7 §18). "Apply soon" in the body must not
   * become a countdown a student plans around.
   */
  it('never derives a deadline from the body text', () => {
    const vague = announcement({
      body: 'Apply soon. The last date is approaching. Register immediately.',
    });
    expect(deadlineInfo(vague, NOW)).toBeNull();
    expect(priorityOf(vague, NOW)).not.toBe('urgent');
  });

  it('counts whole days to a real deadline', () => {
    const soon = announcement({ deadlineAt: '2026-09-12T23:59:00Z' });
    expect(deadlineInfo(soon, NOW)?.daysLeft).toBe(2);
    expect(deadlineInfo(soon, NOW)?.passed).toBe(false);
  });

  /* A deadline late tonight is "today", not "0.4 days". */
  it('treats a deadline later today as today', () => {
    const tonight = announcement({ deadlineAt: '2026-09-10T23:00:00Z' });
    expect(deadlineInfo(tonight, NOW)?.daysLeft).toBe(0);
  });

  it('marks a passed deadline as passed', () => {
    const gone = announcement({ deadlineAt: '2026-09-01T00:00:00Z' });
    expect(deadlineInfo(gone, NOW)?.passed).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* Priority                                                                   */
/* -------------------------------------------------------------------------- */

describe('priority', () => {
  it('makes a close real deadline urgent', () => {
    const closing = announcement({
      category: 'backlog',
      deadlineAt: '2026-09-11T00:00:00Z',
    });
    expect(priorityOf(closing, NOW)).toBe('urgent');
  });

  it('does not make a distant deadline urgent', () => {
    const later = announcement({
      category: 'backlog',
      deadlineAt: '2026-09-30T00:00:00Z',
    });
    expect(priorityOf(later, NOW)).toBe('important');
  });

  /* A passed deadline is history. Shouting about it helps nobody. */
  it('drops a passed deadline back to its category priority', () => {
    const over = announcement({ category: 'backlog', deadlineAt: '2026-09-01T00:00:00Z' });
    expect(priorityOf(over, NOW)).toBe('important');
  });

  it('treats results and examinations as important', () => {
    for (const category of ['results', 'exam_timetable', 'revaluation'] as AnnouncementCategory[]) {
      expect(priorityOf(announcement({ category }), NOW)).toBe('important');
    }
  });

  it('treats holidays and general circulars as informational', () => {
    for (const category of ['holiday', 'general', 'department_notice'] as AnnouncementCategory[]) {
      expect(priorityOf(announcement({ category }), NOW)).toBe('informational');
    }
  });

  /* NO URGENCY WITHOUT A DATE (M7 §17). */
  it('never invents urgency for a category alone', () => {
    expect(priorityOf(announcement({ category: 'results' }), NOW)).not.toBe('urgent');
    expect(URGENT_WITHIN_DAYS).toBe(2);
  });
});

/* -------------------------------------------------------------------------- */
/* Ordering                                                                   */
/* -------------------------------------------------------------------------- */

describe('the student feed order', () => {
  it('puts relevant, then urgent, then recent first', () => {
    const items = [
      announcement({ id: 'old-general', publishedAt: '2026-08-01T00:00:00Z' }),
      announcement({
        id: 'urgent',
        category: 'backlog',
        deadlineAt: '2026-09-11T00:00:00Z',
        publishedAt: '2026-07-01T00:00:00Z',
      }),
      announcement({
        id: 'irrelevant',
        audience: { ...announcement().audience, semester: 1 },
        category: 'results',
        publishedAt: '2026-09-09T00:00:00Z',
      }),
    ];

    const order = sortForStudent(items, student, NOW).map((item) => item.id);
    expect(order[0]).toBe('urgent');
    // Not relevant, so last however recent it is — but still present.
    expect(order[2]).toBe('irrelevant');
  });

  /* Sorting, not filtering: a feed that hides things cannot be trusted. */
  it('keeps irrelevant announcements in the list', () => {
    const items = [announcement({ audience: { ...announcement().audience, semester: 1 } })];
    expect(sortForStudent(items, student, NOW).length).toBe(1);
  });
});

/* -------------------------------------------------------------------------- */
/* Notifications                                                              */
/* -------------------------------------------------------------------------- */

describe('notification state', () => {
  it('treats an announcement nobody has touched as unread', () => {
    expect(stateFor(announcement(), [])).toBe('unread');
  });

  /*
   * DETERMINISTIC IDENTITY (M7 §22). One record per announcement, replaced
   * rather than appended, so refreshing cannot multiply notifications.
   */
  it('keeps one record per announcement however often it is marked', () => {
    let records: NotificationRecord[] = [];
    const item = announcement();
    records = markState(records, item, 'read', '2026-09-10T00:00:00Z');
    records = markState(records, item, 'unread', '2026-09-10T00:01:00Z');
    records = markState(records, item, 'read', '2026-09-10T00:02:00Z');

    expect(records.length).toBe(1);
    expect(stateFor(item, records)).toBe('read');
  });

  /*
   * A notice that CHANGED becomes unread again: the version that was read no
   * longer exists, and "registration closes Friday" moving matters.
   */
  it('makes a read announcement unread again when it changes', () => {
    const item = announcement({ updatedAt: '2026-09-08T00:00:00Z' });
    const records = markState([], item, 'read', '2026-09-08T00:00:00Z');

    expect(stateFor(item, records)).toBe('read');
    const edited = { ...item, updatedAt: '2026-09-09T00:00:00Z' };
    expect(stateFor(edited, records)).toBe('unread');
  });

  /* Dismissing is stronger than reading and survives an edit. */
  it('keeps a dismissal through an update', () => {
    const item = announcement({ updatedAt: '2026-09-08T00:00:00Z' });
    const records = markState([], item, 'dismissed', '2026-09-08T00:00:00Z');
    const edited = { ...item, updatedAt: '2026-09-09T00:00:00Z' };
    expect(stateFor(edited, records)).toBe('dismissed');
  });

  it('marks everything unread as read in one go', () => {
    const items = [announcement({ id: 'a' }), announcement({ id: 'b' })];
    const notifications = buildNotifications(items, [], student, DEFAULT_PREFERENCES, NOW);
    expect(unreadCount(notifications)).toBe(2);

    const records = markAllRead([], notifications, '2026-09-10T00:00:00Z');
    const after = buildNotifications(items, records, student, DEFAULT_PREFERENCES, NOW);
    expect(unreadCount(after)).toBe(0);
  });
});

describe('notification preferences', () => {
  it('leaves a muted category out of notifications', () => {
    const items = [
      announcement({ category: 'holiday' }),
      announcement({ id: 'r', category: 'results' }),
    ];
    const notifications = buildNotifications(
      items,
      [],
      student,
      { ...DEFAULT_PREFERENCES, muted: ['holiday'] },
      NOW,
    );

    expect(notifications.length).toBe(1);
    expect(notifications[0]?.announcement.category).toBe('results');
  });

  /* Muting stops interruption; it never hides the notice from the feed. */
  it('does not remove a muted announcement from the announcements list', () => {
    const items = [announcement({ category: 'holiday' })];
    expect(sortForStudent(items, student, NOW).length).toBe(1);
  });

  it('leaves an irrelevant announcement out of notifications', () => {
    const items = [announcement({ audience: { ...announcement().audience, semester: 1 } })];
    expect(buildNotifications(items, [], student, DEFAULT_PREFERENCES, NOW).length).toBe(0);
  });

  it('starts with nothing muted and browser notifications off', () => {
    expect(DEFAULT_PREFERENCES.muted).toEqual([]);
    expect(DEFAULT_PREFERENCES.browserNotifications).toBe(false);
  });
});
