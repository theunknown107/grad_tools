/**
 * Demo announcements.
 *
 * Authority: docs/21 §21.18 · M7 §6, §36
 *
 * ---------------------------------------------------------------------------
 * THIS IS SYNTHETIC CONTENT AND IT SAYS SO
 * ---------------------------------------------------------------------------
 *
 * Every row is written with `origin = 'demo_fixture'`, which the UI turns into a
 * visible DEMO label. None of it is a real VTU or college notice, none carries a
 * real publisher's name as though it had issued it, and none links to a real
 * announcement page.
 *
 * NOT PART OF `seed.ts`. Reference data is run everywhere; this is run only when
 * someone deliberately asks for it:
 *
 *     pnpm --filter @gradtools/api seed:demo
 *
 * A deployment that never runs that command has no demo content, which is the
 * only safe default for a product whose whole claim is that it does not invent
 * academic facts.
 *
 * WHY IT EXISTS. VTU announcement polling is disabled pending the terms review
 * (`OQ-006` / `OQ-026`), so without a demo path there is nothing to look at and
 * nothing to test the relevance and notification behaviour against (M7 §5, §6).
 */

import { createClient, type Sql } from './client.js';
import { normalizeAnnouncement } from '../announcements/normalize.js';
import { publishAnnouncement, upsertAnnouncement } from '../announcements/store.js';
import type { AnnouncementCategory } from '@gradtools/shared-types';

/** Publisher names are deliberately fictional. No real college is named. */
const DEMO_PUBLISHER_UNIVERSITY = 'Demo University (synthetic)';
const DEMO_PUBLISHER_COLLEGE = 'Demo Engineering College (synthetic)';
const DEMO_PUBLISHER_DEPARTMENT = 'Demo Department of Computer Science (synthetic)';

function daysFromNow(days: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString();
}

interface DemoNotice {
  readonly publisher: string;
  readonly title: string;
  readonly body: string;
  readonly category: AnnouncementCategory;
  readonly publishedAt: string;
  readonly deadlineAt?: string;
  readonly eventStartAt?: string;
  readonly audience?: {
    schemeId?: string;
    branchName?: string;
    semester?: number;
    collegeName?: string;
  };
}

/**
 * A spread wide enough to exercise the product, not a realistic feed.
 *
 * It deliberately covers every audience shape — global, semester-targeted,
 * branch-targeted, college-targeted — and both a live deadline and a notice with
 * none, because "no deadline" is the case a product is most likely to get wrong.
 */
const NOTICES: readonly DemoNotice[] = [
  {
    publisher: DEMO_PUBLISHER_UNIVERSITY,
    title: 'Semester 4 results announced',
    body: 'Results for the fourth semester examinations have been published. Students may view their grade cards through the university result portal.',
    category: 'results',
    publishedAt: daysFromNow(-1),
    audience: { schemeId: 'vtu-2022' },
  },
  {
    publisher: DEMO_PUBLISHER_UNIVERSITY,
    title: 'Backlog examination registration closes on Friday',
    body: 'Registration for backlog examinations closes at the end of this week. Late registrations will not be accepted.',
    category: 'backlog',
    publishedAt: daysFromNow(-2),
    // A real, checkable deadline: the "days left" line must come from this and
    // from nothing else.
    deadlineAt: daysFromNow(3),
  },
  {
    publisher: DEMO_PUBLISHER_UNIVERSITY,
    title: 'Summer semester registration open',
    body: 'The summer semester registration window is open for students carrying backlogs. Details are available in the circular.',
    category: 'summer_semester',
    publishedAt: daysFromNow(-4),
    deadlineAt: daysFromNow(12),
  },
  {
    publisher: DEMO_PUBLISHER_UNIVERSITY,
    title: 'Revaluation applications for the previous semester',
    body: 'Students who wish to apply for revaluation or photocopy of answer scripts may do so within the notified window.',
    category: 'revaluation',
    publishedAt: daysFromNow(-6),
    deadlineAt: daysFromNow(1),
  },
  {
    publisher: DEMO_PUBLISHER_UNIVERSITY,
    title: 'Fifth semester examination timetable',
    body: 'The theory examination timetable for the fifth semester has been released. Practical examination dates will follow separately.',
    category: 'exam_timetable',
    publishedAt: daysFromNow(-3),
    eventStartAt: daysFromNow(40),
    // Semester-targeted: a third-year student sees this; a first-year does not.
    audience: { semester: 5 },
  },
  {
    publisher: DEMO_PUBLISHER_COLLEGE,
    title: 'Internal assessment schedule for this term',
    body: 'The first internal assessment will be conducted as per the schedule displayed on the department notice board.',
    category: 'college_notice',
    publishedAt: daysFromNow(-5),
    audience: { collegeName: 'Demo Engineering College (synthetic)' },
  },
  {
    publisher: DEMO_PUBLISHER_DEPARTMENT,
    title: 'Computer Science department seminar series',
    body: 'The department will host a weekly seminar series. Attendance is optional and does not affect attendance records.',
    category: 'department_notice',
    publishedAt: daysFromNow(-7),
    // Branch-targeted, by the NAME the profile actually stores.
    audience: { branchName: 'Computer Science and Engineering' },
  },
  {
    publisher: DEMO_PUBLISHER_UNIVERSITY,
    title: 'Revised academic calendar for the odd semester',
    body: 'The academic calendar has been revised. Working days and examination periods are listed in the attached circular.',
    category: 'academic_calendar',
    publishedAt: daysFromNow(-9),
  },
  {
    publisher: DEMO_PUBLISHER_UNIVERSITY,
    // No deadline anywhere. Nothing may invent one from "shortly".
    title: 'Examination fee notification will follow shortly',
    body: 'A separate notification regarding examination fees will be issued in due course. No action is required at this stage.',
    category: 'fees',
    publishedAt: daysFromNow(-10),
  },
  {
    publisher: DEMO_PUBLISHER_COLLEGE,
    title: 'Institution closed for a public holiday',
    body: 'The institution will remain closed on account of a public holiday. Classes will resume the following working day.',
    category: 'holiday',
    publishedAt: daysFromNow(-12),
  },
];

export async function seedDemoAnnouncements(sql: Sql): Promise<number> {
  let published = 0;

  for (const notice of NOTICES) {
    const normalized = normalizeAnnouncement({
      publisher: notice.publisher,
      title: notice.title,
      body: notice.body,
      category: notice.category,
      canonicalUrl: null,
      publishedAt: notice.publishedAt,
      eventStartAt: notice.eventStartAt ?? null,
      deadlineAt: notice.deadlineAt ?? null,
      externalId: null,
    });
    if (!normalized.ok) throw new Error(`demo notice rejected: ${normalized.reason}`);

    const outcome = await upsertAnnouncement(sql, {
      normalized: normalized.value,
      origin: 'demo_fixture',
      sourceId: null,
      audience: {
        schemeId: notice.audience?.schemeId ?? null,
        branchId: null,
        branchName: notice.audience?.branchName ?? null,
        collegeId: null,
        collegeName: notice.audience?.collegeName ?? null,
        semester: notice.audience?.semester ?? null,
      },
    });

    /*
     * Demo content still passes the publication gate rather than going round
     * it. If the gate can be bypassed "just for demo data", it is not a gate.
     */
    await publishAnnouncement(sql, outcome.id, 'demo-seed');
    published += 1;
  }

  return published;
}

/* Entry point: pnpm --filter @gradtools/api seed:demo */
if (process.argv[1]?.includes('seed-demo')) {
  const url = process.env.DATABASE_URL;
  if (url === undefined) {
    // eslint-disable-next-line no-console
    console.error('DATABASE_URL is not set.');
    process.exit(1);
  } else {
    const sql = createClient(url);
    seedDemoAnnouncements(sql)
      .then((count) => {
        // eslint-disable-next-line no-console
        console.log(`Seeded ${String(count)} DEMO announcements. They are labelled as synthetic.`);
      })
      .finally(() => sql.end());
  }
}
