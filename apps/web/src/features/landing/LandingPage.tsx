/**
 * The public front door (/welcome) — outside the app shell.
 *
 * The same design system as the app: canvas, raised cards, the monochrome
 * accent. No marketing furniture the design bans (glow, gradients, fake
 * figures): the examples are labelled as worked examples of the regulation,
 * not as anybody's record.
 */

import {
  ArrowRight,
  Bell,
  Calculator,
  CalendarCheck2,
  CalendarDays,
  ClipboardList,
  FilePlus2,
  GraduationCap,
  Lock,
  Megaphone,
  type LucideIcon,
} from 'lucide-react';
import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { ThemeToggle } from '../../components/navigation/ThemeToggle.js';
import { Badge } from '../../components/ui/badge.js';
import { Button } from '../../components/ui/button.js';
import { Card } from '../../components/ui/card.js';
import { Toaster } from '../../components/ui/feedback.js';
import { GradToolsLogo } from '../../brand/GradToolsLogo.js';
import { IconTile } from '../../components/ui/page.js';
import { Progress } from '../../components/ui/progress.js';
import { TooltipProvider } from '../../components/ui/tooltip.js';

const CAPABILITIES: readonly { icon: LucideIcon; title: string; body: string }[] = [
  {
    icon: ClipboardList,
    title: 'Results you can read',
    body: 'Internal, external and total against the three passing heads of the regulation — and the reason whenever a figure is unavailable.',
  },
  {
    icon: Calculator,
    title: 'SGPA & CGPA that show their working',
    body: 'Credit-weighted exactly as VTU defines it. Every figure opens to its formula, inputs and clause.',
  },
  {
    icon: CalendarCheck2,
    title: 'Attendance, per course',
    body: 'How many classes you can still miss before the 85% requirement bites, and when a subject has already slipped.',
  },
  {
    icon: CalendarDays,
    title: 'Timetable and exam dates',
    body: 'Your week, today’s classes, and the examination papers that apply to you — marked as they happen.',
  },
  {
    icon: FilePlus2,
    title: 'Documents, read on your device',
    body: 'Result cards, calendars, schemes and timetables are parsed locally and saved only after you confirm.',
  },
  {
    icon: Megaphone,
    title: 'Notices with provenance',
    body: 'Every announcement carries its publisher and where it came from. Nothing is invented to fill a quiet week.',
  },
];

const FOOTER: readonly { title: string; links: readonly { to: string; label: string }[] }[] = [
  {
    title: 'Product',
    links: [
      { to: '/', label: 'Dashboard' },
      { to: '/results', label: 'Results' },
      { to: '/attendance', label: 'Attendance' },
      { to: '/import', label: 'Add a document' },
    ],
  },
  {
    title: 'Academics',
    links: [
      { to: '/semesters', label: 'My Degree' },
      { to: '/academics', label: 'SGPA & CGPA' },
      { to: '/timetable', label: 'Timetable' },
      { to: '/exams', label: 'Exam timetable' },
      { to: '/announcements', label: 'Announcements' },
    ],
  },
  {
    title: 'Account',
    links: [
      { to: '/account', label: 'Your account' },
      { to: '/profile', label: 'Profile' },
      { to: '/sign-in', label: 'Sign in' },
    ],
  },
];

const SEMESTERS = [
  { n: 1, label: 'Completed', tone: 'success' },
  { n: 2, label: 'Completed', tone: 'success' },
  { n: 3, label: 'Completed', tone: 'success' },
  { n: 4, label: 'Completed', tone: 'success' },
  { n: 5, label: 'In progress', tone: 'schedule' },
  { n: 6, label: 'Planned', tone: 'neutral' },
  { n: 7, label: 'Planned', tone: 'neutral' },
  { n: 8, label: 'Planned', tone: 'neutral' },
] as const;

export function LandingPage() {
  useEffect(() => {
    document.title = 'GradTools — your academic life, organized';
    return () => {
      document.title = 'GradTools';
    };
  }, []);

  return (
    <TooltipProvider>
      <div className="min-h-full bg-canvas text-ink">
        <a
          href="#welcome-main"
          className="sr-only z-[100] rounded-lg bg-raised px-3 py-2 text-sm font-medium shadow-e2 focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
        >
          Skip to content
        </a>
        <header className="sticky top-0 z-40 border-b border-line bg-panel/95 backdrop-blur-sm">
          <nav
            aria-label="Site"
            className="mx-auto flex h-16 max-w-[1180px] items-center gap-3 px-4 sm:px-6 lg:px-10"
          >
            <Link
              to="/welcome"
              className="flex items-center gap-2.5 rounded-lg"
              aria-label="GradTools"
            >
              <GradToolsLogo />
              <span className="leading-tight">
                <span className="block text-[15px] font-semibold tracking-[-0.01em]">
                  GradTools
                </span>
                <span className="hidden font-mono text-[10px] tracking-[0.16em] text-ink-3 uppercase sm:block">
                  Academic OS
                </span>
              </span>
            </Link>
            <div className="ml-6 hidden items-center gap-1 md:flex">
              {[
                ['#what', 'What it does'],
                ['#degree', 'Your degree'],
                ['#privacy', 'Privacy'],
              ].map(([href, label]) => (
                <a
                  key={href}
                  href={href}
                  className="rounded-lg px-3 py-2 text-sm font-medium text-ink-2 transition-colors hover:bg-sunken hover:text-ink"
                >
                  {label}
                </a>
              ))}
            </div>
            <div className="ml-auto flex items-center gap-1">
              <ThemeToggle />
              <Button asChild variant="primary" size="sm" className="ml-1">
                <Link to="/">Open GradTools</Link>
              </Button>
            </div>
          </nav>
        </header>

        <main
          id="welcome-main"
          className="mx-auto flex max-w-[1180px] flex-col gap-20 px-4 py-12 sm:px-6 sm:py-16 lg:px-10"
        >
          <section
            aria-labelledby="welcome-title"
            className="grid animate-rise items-center gap-10 lg:grid-cols-[1.15fr_1fr]"
          >
            <div>
              <Badge tone="accent" icon={<GraduationCap />}>
                Built for the VTU 2022 scheme
              </Badge>
              <h1
                id="welcome-title"
                className="mt-5 font-display text-[40px] leading-[1.02] font-semibold tracking-[-0.03em] sm:text-[56px]"
              >
                Your academic life, organized.
              </h1>
              <p className="mt-4 max-w-lg text-[15px] leading-relaxed text-ink-2">
                Track your degree, understand your results and stay ahead of your semester — with
                every figure showing the regulation it came from.
              </p>
              <div className="mt-7 flex flex-wrap gap-2">
                <Button asChild variant="glass-primary" size="lg">
                  <Link to="/">
                    Get started <ArrowRight className="size-4" aria-hidden="true" />
                  </Link>
                </Button>
                <Button asChild variant="glass" size="lg">
                  <a href="#what">Explore GradTools</a>
                </Button>
              </div>
              <p className="mt-4 text-[12px] text-ink-3">
                Works without an account. Your data stays on your device until you choose otherwise.
              </p>
            </div>

            <Card
              className="p-5 sm:p-6"
              aria-label="Worked example: one course against the three passing heads"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="font-mono text-[11px] tracking-[0.16em] text-ink-3 uppercase">
                  Worked example · 22OB 6.3
                </div>
                <Badge tone="success">Pass</Badge>
              </div>
              <div className="mt-4 grid grid-cols-3 gap-3">
                {[
                  ['Internal', '40', '50'],
                  ['External', '21', '50'],
                  ['Total', '61', '100'],
                ].map(([label, value, max]) => (
                  <div key={label} className="gt-metric rounded-xl p-3">
                    <div className="text-[11px] font-medium text-ink-2">{label}</div>
                    <div className="tnum mt-1 text-2xl font-semibold">
                      {value}
                      <span className="text-sm text-ink-3">/{max}</span>
                    </div>
                  </div>
                ))}
              </div>
              <ul className="mt-4 divide-y divide-line rounded-xl border border-line text-[13px]">
                {[
                  ['CIE', '40 of 50', 'needs 20'],
                  ['SEE', '21 of 50', 'needs 17.5'],
                  ['Total', '61 of 100', 'needs 40'],
                ].map(([head, got, needs]) => (
                  <li key={head} className="flex items-center gap-3 px-4 py-2.5">
                    <span className="w-12 font-mono text-[11px] text-ink-3">{head}</span>
                    <span className="tnum flex-1 font-medium">{got}</span>
                    <span className="text-[12px] text-ink-3">{needs}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-[12px] text-ink-3">
                Three heads, three thresholds — not one pass mark applied to everything. A course
                assessed on internals alone has no SEE to fall short of.
              </p>
            </Card>
          </section>

          <section id="what" aria-labelledby="what-title" className="scroll-mt-24">
            <div className="max-w-2xl">
              <div className="mb-2 font-mono text-[11px] tracking-[0.16em] text-ink-3 uppercase">
                What it does
              </div>
              <h2
                id="what-title"
                className="font-display text-[28px] leading-tight font-semibold tracking-[-0.02em] sm:text-[34px]"
              >
                Everything a semester actually asks of you
              </h2>
              <p className="mt-2 text-sm text-ink-2">
                No dashboards for their own sake. Each of these exists because a student has to do
                it anyway.
              </p>
            </div>
            <ul className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {CAPABILITIES.map((capability) => (
                <li key={capability.title}>
                  <Card className="h-full p-5">
                    <IconTile tone="accent">
                      <capability.icon />
                    </IconTile>
                    <h3 className="mt-4 text-[15px] font-semibold">{capability.title}</h3>
                    <p className="mt-1 text-[13px] leading-relaxed text-ink-2">{capability.body}</p>
                  </Card>
                </li>
              ))}
            </ul>
          </section>

          <section
            id="degree"
            aria-labelledby="degree-title"
            className="grid scroll-mt-24 items-center gap-8 lg:grid-cols-[1fr_1.2fr]"
          >
            <div>
              <div className="mb-2 font-mono text-[11px] tracking-[0.16em] text-ink-3 uppercase">
                Your degree
              </div>
              <h2
                id="degree-title"
                className="font-display text-[28px] leading-tight font-semibold tracking-[-0.02em] sm:text-[34px]"
              >
                Where you are, at a glance
              </h2>
              <p className="mt-2 text-sm text-ink-2">
                Eight semesters, each with its own state. GradTools never guesses one — a semester
                with no data says so.
              </p>
              <Card className="mt-6 p-5" aria-label="Worked example: attendance">
                <div className="flex items-center justify-between gap-2 text-[13px]">
                  <span className="font-medium">Attendance, worked example</span>
                  <Badge tone="warning">Attend 4 in a row</Badge>
                </div>
                <div className="tnum mt-2 text-3xl font-semibold text-warning">79%</div>
                <Progress value={79} tone="warning" className="mt-3" />
                <p className="mt-2 text-[12px] text-ink-3">
                  The requirement is 85% per course; below 75% a course is marked DX.
                </p>
              </Card>
            </div>
            <ol
              className="grid grid-cols-2 gap-3 sm:grid-cols-4"
              aria-label="Example semester states"
            >
              {SEMESTERS.map((semester) => (
                <li key={semester.n}>
                  <Card
                    className={semester.tone === 'schedule' ? 'p-4 ring-1 ring-schedule/40' : 'p-4'}
                  >
                    <div className="font-mono text-[12px] font-semibold text-ink-2">
                      S{semester.n}
                    </div>
                    <Badge tone={semester.tone} className="mt-3">
                      {semester.label}
                    </Badge>
                  </Card>
                </li>
              ))}
            </ol>
          </section>

          <section id="privacy" aria-labelledby="privacy-title" className="scroll-mt-24">
            <Card className="flex flex-col items-start gap-6 p-6 sm:p-10 lg:flex-row lg:items-center lg:justify-between">
              <div className="max-w-xl">
                <IconTile tone="solid" size="lg">
                  <Lock />
                </IconTile>
                <h2
                  id="privacy-title"
                  className="mt-4 font-display text-[26px] leading-tight font-semibold tracking-[-0.02em]"
                >
                  Start in a minute. Keep it on your device.
                </h2>
                <p className="mt-2 text-sm text-ink-2">
                  No account, no setup. Add a result and GradTools does the arithmetic — and shows
                  you the clause behind it. Sign in only if you want your records on another device.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button asChild variant="primary" size="lg">
                  <Link to="/">
                    Open GradTools <ArrowRight className="size-4" aria-hidden="true" />
                  </Link>
                </Button>
                <Button asChild size="lg" icon={<Bell />}>
                  <Link to="/announcements">See notices</Link>
                </Button>
              </div>
            </Card>
          </section>
        </main>

        <footer className="border-t border-line bg-panel">
          <div className="mx-auto grid max-w-[1180px] gap-8 px-4 py-10 sm:px-6 lg:grid-cols-[1.4fr_2fr] lg:px-10">
            <div>
              <Link to="/welcome" className="inline-flex items-center gap-2.5 rounded-lg">
                <GradToolsLogo />
                <span className="text-[15px] font-semibold">GradTools</span>
              </Link>
              <p className="mt-3 max-w-sm text-[13px] text-ink-2">
                An independent student project for keeping a VTU degree in one place. Every academic
                figure follows the VTU 2022 regulations and can show the clause it came from.
              </p>
              <p className="mt-2 max-w-sm text-[12px] text-ink-3">
                Not affiliated with, endorsed by, or connected to Visvesvaraya Technological
                University.
              </p>
            </div>
            <nav aria-label="Footer" className="grid grid-cols-2 gap-6 sm:grid-cols-3">
              {FOOTER.map((column) => (
                <div key={column.title}>
                  <h2 className="mb-2 font-mono text-[10px] tracking-[0.16em] text-ink-3 uppercase">
                    {column.title}
                  </h2>
                  <ul className="space-y-1.5">
                    {column.links.map((link) => (
                      <li key={link.to}>
                        <Link
                          to={link.to}
                          className="text-[13px] text-ink-2 transition-colors hover:text-ink"
                        >
                          {link.label}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </nav>
          </div>
          <div className="border-t border-line px-4 py-4 text-center text-[12px] text-ink-3">
            Experimental version · data stays on your device
          </div>
        </footer>
        <Toaster />
      </div>
    </TooltipProvider>
  );
}
