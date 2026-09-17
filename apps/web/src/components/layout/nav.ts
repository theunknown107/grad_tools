/**
 * Where GradTools can take a student — ONE list.
 *
 * The sidebar, the mobile "More" sheet, the bottom bar and the command menu
 * all read this, so a destination cannot exist in one and be missing (or
 * misspelt) in another. `test/routes.test.ts` checks every `to:` here against
 * the route table in App.tsx.
 *
 * Labels and grouping are the design's. Paths are the product's existing ones
 * (`/semesters` is My Degree, `/academics` is SGPA & CGPA) so bookmarks and
 * links from before the redesign keep working.
 */

import {
  Bell,
  CalendarCheck2,
  CalendarClock,
  CalendarDays,
  Calculator,
  ClipboardList,
  FilePlus2,
  GraduationCap,
  LayoutDashboard,
  Megaphone,
  Settings2,
  UserCircle,
  type LucideIcon,
} from 'lucide-react';

export type NavGroup = 'Overview' | 'Academics' | 'Account';

export interface Destination {
  readonly to: string;
  readonly label: string;
  /** The bottom-bar label, where the destination is on the bottom bar. */
  readonly short: string;
  readonly icon: LucideIcon;
  readonly group: NavGroup;
  /** One line for the command menu. */
  readonly description: string;
  readonly keywords: string;
}

export const DESTINATIONS: readonly Destination[] = [
  {
    to: '/',
    label: 'Dashboard',
    short: 'Home',
    icon: LayoutDashboard,
    group: 'Overview',
    description: 'Your degree at a glance',
    keywords: 'home overview',
  },
  {
    to: '/announcements',
    label: 'Announcements',
    short: 'News',
    icon: Megaphone,
    group: 'Overview',
    description: 'Verified notices',
    keywords: 'news circular notice',
  },
  {
    to: '/notifications',
    label: 'Notifications',
    short: 'Alerts',
    icon: Bell,
    group: 'Overview',
    description: 'What GradTools has told you',
    keywords: 'alerts inbox',
  },
  {
    to: '/semesters',
    label: 'My Degree',
    short: 'Degree',
    icon: GraduationCap,
    group: 'Academics',
    description: 'Eight semesters, end to end',
    keywords: 'programme course plan backlog subjects',
  },
  {
    to: '/results',
    label: 'Results',
    short: 'Results',
    icon: ClipboardList,
    group: 'Academics',
    description: 'Marks and outcomes by semester',
    keywords: 'marks grades score',
  },
  {
    to: '/academics',
    label: 'SGPA & CGPA',
    short: 'GPA',
    icon: Calculator,
    group: 'Academics',
    description: 'Grade point figures and calculators',
    keywords: 'gpa average points calculator',
  },
  {
    to: '/attendance',
    label: 'Attendance',
    short: 'Attendance',
    icon: CalendarCheck2,
    group: 'Academics',
    description: 'Percentage and classes you can miss',
    keywords: 'bunk present absent planner',
  },
  {
    to: '/timetable',
    label: 'Timetable',
    short: 'Timetable',
    icon: CalendarDays,
    group: 'Academics',
    description: "Today's classes and the full week",
    keywords: 'schedule classes lab',
  },
  {
    to: '/exams',
    label: 'Exam timetable',
    short: 'Exams',
    icon: CalendarClock,
    group: 'Academics',
    description: 'Your examination dates',
    keywords: 'exam see cie schedule',
  },
  {
    to: '/import',
    label: 'Add document',
    short: 'Import',
    icon: FilePlus2,
    group: 'Academics',
    description: 'Result card, calendar, scheme or timetable',
    keywords: 'import upload calendar timetable result document pdf',
  },
  {
    to: '/account',
    label: 'Account',
    short: 'Account',
    icon: Settings2,
    group: 'Account',
    description: 'Sign in, sync, data and privacy',
    keywords: 'settings privacy delete export sync',
  },
  {
    to: '/profile',
    label: 'Profile',
    short: 'Profile',
    icon: UserCircle,
    group: 'Account',
    description: 'Identity, academic details and appearance',
    keywords: 'branch scheme semester appearance theme accent',
  },
];

export const NAV_GROUPS: readonly NavGroup[] = ['Overview', 'Academics', 'Account'];

/** The design's bottom bar: four destinations and "More". */
export const MOBILE_TABS: readonly Destination[] = [
  '/',
  '/results',
  '/timetable',
  '/attendance',
].map((path) => DESTINATIONS.find((destination) => destination.to === path) as Destination);

/** Whether `to` is the current section. Result detail belongs to Results. */
export function isActive(to: string, pathname: string): boolean {
  if (to === '/') return pathname === '/';
  return pathname === to || pathname.startsWith(`${to}/`);
}
