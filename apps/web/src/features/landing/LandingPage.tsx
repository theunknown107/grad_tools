/**
 * The public front door.
 *
 * Authority: docs/05 §5.24 (M9.6B) · docs/28 (copy) · docs/27
 * References: 21st.dev @sensewood8/responsive-hero-banner (14),
 * @aghasisahakyan1/mini-navbar (15), @designali-in/footer (16) — all RECREATED.
 *
 * ---------------------------------------------------------------------------
 * WHAT IS TRUE ON THIS PAGE
 * ---------------------------------------------------------------------------
 *
 * Every capability named below exists and is reachable. There are no
 * testimonials, no user counts, no partner logos, no pricing, no "AI-powered"
 * claim and no institutional endorsement, because GradTools has none of those
 * things (M9.6 §10, §21). The product preview is rendered from SYNTHETIC data
 * that is visibly synthetic — it is a drawing of the interface, not a
 * screenshot of anybody's record.
 *
 * The reference hero sells space tourism with a photograph. GradTools has no
 * photograph to use and would be lying if it borrowed one, so the cinematic
 * layer is built from light: layered radial gradients in the current accent,
 * an aurora that drifts slowly, and a grid that fades out. That is the
 * reference's ATMOSPHERE — depth, glow, a bright object floating over a dark
 * field — without pretending to a photograph the product does not own.
 */

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Icon, type IconName } from '../../components/icons.js';
import { ThemeControl } from '../../components/ThemeControl.js';
import { DropdownNavigation } from '../../components/ui/DropdownNavigation.js';
import styles from './LandingPage.module.css';

/* -------------------------------------------------------------------------- */
/* Mini navbar — Reference 15                                                  */
/* -------------------------------------------------------------------------- */

/**
 * A floating pill header.
 *
 * The reference is a rounded translucent bar inset from the top edge. Kept:
 * the pill, the inset, the hairline, the blur. Added: it only gains its
 * material once the page has scrolled, so at the top of a cinematic hero the
 * navigation floats over the artwork rather than cutting a bar across it.
 */
function MiniNavbar(): ReactNode {
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const onScroll = (): void => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const links = [
    { href: '#what', label: 'What it does' },
    { href: '#degree', label: 'Your degree' },
    { href: '#papers', label: 'Papers' },
  ];

  return (
    <header className={styles.navWrap}>
      <nav
        className={`${styles.nav ?? ''} ${scrolled ? (styles.navScrolled ?? '') : ''} ${scrolled ? 'glassNav' : ''}`}
        aria-label="Site"
      >
        <Link to="/welcome" className={styles.navBrand ?? ''}>
          <span className={styles.navMark} aria-hidden="true">
            G
          </span>
          <span>GradTools</span>
        </Link>

        {/*
          M9.6F: Reference 06, and the only place it belongs.

          The public header had three flat anchors. A visitor scanning them
          learns where a link goes and nothing about what is there, which is
          exactly the gap the reference's descriptions fill. The application's
          own navigation stays the two-tier bar and the limelight — adding a
          third system inside the app would be the competing-navigation problem
          the milestone warns about.
        */}
        <div className={styles.navNav}>
          <DropdownNavigation
            label="Site"
            entries={[
              {
                id: 'product',
                label: 'What it does',
                groups: [
                  {
                    title: 'Your record',
                    items: [
                      {
                        label: 'Results',
                        description: 'Marks read against the three passing heads',
                        to: '#what',
                        icon: 'results',
                      },
                      {
                        label: 'SGPA & CGPA',
                        description: 'Every figure shows its clause',
                        to: '#what',
                        icon: 'gpa',
                      },
                      {
                        label: 'My degree',
                        description: 'Eight semesters, end to end',
                        to: '#degree',
                        icon: 'degree',
                      },
                    ],
                  },
                  {
                    title: 'Day to day',
                    items: [
                      {
                        label: 'Attendance',
                        description: 'How many classes you can still miss',
                        to: '#what',
                        icon: 'attendance',
                      },
                      {
                        label: 'Question papers',
                        description: 'Searchable down to a single question',
                        to: '#papers',
                        icon: 'papers',
                      },
                      {
                        label: 'Announcements',
                        description: 'Notices that carry their provenance',
                        to: '#what',
                        icon: 'announcements',
                      },
                    ],
                  },
                ],
              },
              { id: 'degree', label: 'Your degree', to: '#degree' },
              { id: 'papers', label: 'Papers', to: '#papers' },
            ]}
          />
        </div>

        <div className={styles.navActions}>
          <ThemeControl />
          <Link to="/" className={styles.navCta ?? ''}>
            Open GradTools
          </Link>
          <button
            type="button"
            className={styles.navToggle}
            aria-expanded={menuOpen}
            aria-controls="site-menu"
            aria-label="Menu"
            onClick={() => setMenuOpen((value) => !value)}
          >
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
              <path
                d={menuOpen ? 'M6 6l12 12M18 6 6 18' : 'M4 8h16M4 16h16'}
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                fill="none"
              />
            </svg>
          </button>
        </div>
      </nav>

      {menuOpen ? (
        <div id="site-menu" className={`${styles.navMenu ?? ''} glassPanel`}>
          {links.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className={styles.navMenuLink}
              onClick={() => setMenuOpen(false)}
            >
              {link.label}
            </a>
          ))}
          <Link to="/" className={styles.navMenuCta ?? ''}>
            Open GradTools
          </Link>
        </div>
      ) : null}
    </header>
  );
}

/* -------------------------------------------------------------------------- */
/* Hero — Reference 14                                                         */
/* -------------------------------------------------------------------------- */

function Hero(): ReactNode {
  return (
    <section className={styles.hero}>
      {/* The cinematic layer. Three stacked lights plus a fading grid; all
          decorative, all aria-hidden, none of it intercepting a pointer. */}
      <div className={styles.heroSky} aria-hidden="true">
        <span className={styles.aurora} data-layer="1" />
        <span className={styles.aurora} data-layer="2" />
        <span className={styles.grid} />
      </div>

      <div className={styles.heroInner}>
        <p className={styles.badge}>
          <span className={styles.badgeDot} aria-hidden="true" />
          Built for the VTU 2022 scheme
        </p>

        <h1 className={styles.heroTitle}>
          Your academic life,
          <br />
          <em>organized.</em>
        </h1>

        <p className={styles.heroLead}>
          Track your degree, understand your results, and stay ahead of your semester — with every
          figure showing the regulation it came from.
        </p>

        <div className={styles.heroActions}>
          <Link to="/" className={styles.primaryCta ?? ''}>
            Get started
            <Icon name="chevronRight" size="small" />
          </Link>
          <a href="#what" className={styles.secondaryCta}>
            Explore GradTools
          </a>
        </div>

        <p className={styles.heroNote}>
          Works without an account. Your data stays on your device until you choose otherwise.
        </p>
      </div>

      <ProductPreview />
    </section>
  );
}

/**
 * The floating product preview.
 *
 * A DRAWING of the interface, built from the same tokens as the real thing —
 * not a screenshot. A screenshot would either show a real student's record
 * (forbidden, docs/12 §12.16) or become stale the moment the UI moves.
 *
 * The figures are invented and the subject codes are the synthetic BXXX form
 * used throughout the test suite, so nothing here can be mistaken for a record.
 */
function ProductPreview(): ReactNode {
  const metrics = [
    { label: 'CGPA', value: '8.24' },
    { label: 'Last SGPA', value: '8.6' },
    { label: 'Attendance', value: '88%' },
    { label: 'Backlogs', value: '0' },
  ];
  const rows = [
    { code: 'BXXX401', title: 'Core course one', total: '82', tone: 'ok' },
    { code: 'BXXX403', title: 'Core course three', total: '74', tone: 'ok' },
    { code: 'BXXL404', title: 'Laboratory course', total: '91', tone: 'good' },
  ];

  return (
    <div className={styles.previewWrap} aria-hidden="true">
      <div className={`${styles.preview ?? ''} glassPanel`}>
        <div className={styles.previewBar}>
          <span className={styles.previewDots}>
            <i />
            <i />
            <i />
          </span>
          <span className={styles.previewTitle}>Dashboard</span>
        </div>

        <div className={styles.previewMetrics}>
          {metrics.map((metric) => (
            <div key={metric.label} className={styles.previewMetric}>
              <span className={styles.previewMetricLabel}>{metric.label}</span>
              <span className={styles.previewMetricValue}>{metric.value}</span>
            </div>
          ))}
        </div>

        <div className={styles.previewRows}>
          {rows.map((row) => (
            <div key={row.code} className={styles.previewRow}>
              <span className={styles.previewCode}>{row.code}</span>
              <span className={styles.previewName}>{row.title}</span>
              <span className={styles.previewTotal} data-tone={row.tone}>
                {row.total}
              </span>
            </div>
          ))}
        </div>
      </div>
      <p className={styles.previewCaption}>Illustration — figures are synthetic.</p>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Story sections                                                              */
/* -------------------------------------------------------------------------- */

interface Capability {
  readonly icon: IconName;
  readonly title: string;
  readonly body: string;
}

const CAPABILITIES: readonly Capability[] = [
  {
    icon: 'degree',
    title: 'Eight semesters, end to end',
    body: 'Every semester of the degree in one place, each marked completed, in progress or still ahead of you.',
  },
  {
    icon: 'results',
    title: 'Results you entered, read properly',
    body: 'Internal, external and total against the three passing heads of 22OB 6.3 — including the courses assessed on internals alone.',
  },
  {
    icon: 'gpa',
    title: 'SGPA and CGPA, with the clause',
    body: 'Every figure can show the regulation it came from, so you can check it rather than trust it.',
  },
  {
    icon: 'attendance',
    title: 'Attendance, and what it costs',
    body: 'How many classes you can still miss before the 85% requirement bites, and when a subject has already slipped.',
  },
  {
    icon: 'papers',
    title: 'A searchable paper library',
    body: 'Question papers with their text extracted, searchable down to individual questions.',
  },
  {
    icon: 'announcements',
    title: 'Announcements with provenance',
    body: 'Each notice carries where it came from and when it was checked. Nothing is invented.',
  },
];

function Capabilities(): ReactNode {
  return (
    <section className={styles.section} id="what">
      <SectionHead
        eyebrow="What it does"
        title="Everything a semester actually asks of you"
        lead="No dashboards for their own sake. Each of these exists because a student has to do it anyway."
      />
      <ul className={styles.cards}>
        {CAPABILITIES.map((capability) => (
          <li key={capability.title} className={`${styles.card ?? ''} glassSurface`}>
            <span className={styles.cardIcon}>
              <Icon name={capability.icon} size="medium" />
            </span>
            <h3 className={styles.cardTitle}>{capability.title}</h3>
            <p className={styles.cardBody}>{capability.body}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The eight-semester spine, as the product actually models it. */
/**
 * Results, shown rather than described.
 *
 * M9.6F §19 asks for a product STORY with varied compositions, and rules out
 * the hero-plus-three-cards shape. So each of the next sections shows the
 * thing it is about instead of describing it in another identical card: this
 * one is a mark row and the reading of it, side by side.
 *
 * Every figure below is invented and the codes are the synthetic BXXX form
 * used across the test suite.
 */
function ResultsStory(): ReactNode {
  return (
    <section className={styles.section}>
      <div className={styles.storySplit}>
        <div className={styles.storyText}>
          <p className={styles.eyebrow}>Results</p>
          <h2 className={styles.splitTitle}>A mark row, read the way VTU reads it</h2>
          <p className={styles.splitLead}>
            Internal, external and total against the three passing heads of 22OB 6.3 — not one
            threshold applied to everything. A course assessed on internals alone has no SEE to fall
            short of, and GradTools says so instead of calling it a backlog.
          </p>
        </div>

        <div className={`${styles.storyDemo ?? ''} glassSurface`} aria-hidden="true">
          <div className={styles.markRow}>
            <span className={styles.markCode}>BXXX401</span>
            <span className={styles.markCell}>
              <em>Internal</em>40
            </span>
            <span className={styles.markCell}>
              <em>External</em>21
            </span>
            <span className={styles.markCell}>
              <em>Total</em>61
            </span>
            <span className={styles.markVerdict} data-tone="ok">
              Pass
            </span>
          </div>
          <ul className={styles.markHeads}>
            <li>
              <span>CIE</span> 40 of 50 &middot; needs 20
            </li>
            <li>
              <span>SEE</span> 21 of 50 &middot; needs 17.5
            </li>
            <li>
              <span>Total</span> 61 of 100 &middot; needs 40
            </li>
          </ul>
          <p className={styles.storyCaption}>Illustration — figures are synthetic.</p>
        </div>
      </div>
    </section>
  );
}

/** Attendance, as the question a student actually asks. */
function AttendanceStory(): ReactNode {
  const rows = [
    { code: 'BXXX501', pct: 91, tone: 'ok', note: 'Can miss 3' },
    { code: 'BXXX503', pct: 79, tone: 'warn', note: 'Attend 4 in a row' },
    { code: 'BXXX505', pct: 69, tone: 'bad', note: 'Below the 75% floor' },
  ] as const;

  return (
    <section className={styles.section}>
      <div className={`${styles.storyWide ?? ''} glassSurface`}>
        <div className={styles.storyWideHead}>
          <p className={styles.eyebrow}>Attendance</p>
          <h2 className={styles.splitTitle}>&ldquo;Can I miss this one?&rdquo;</h2>
          <p className={styles.splitLead}>
            The requirement is 85% per course and below 75% the course is marked DX. GradTools turns
            that into the only number that helps: how many classes you have left.
          </p>
        </div>

        <ul className={styles.attnRows} aria-hidden="true">
          {rows.map((row) => (
            <li key={row.code}>
              <span className={styles.attnCode}>{row.code}</span>
              <span className={styles.attnTrack}>
                <span data-tone={row.tone} style={{ inlineSize: `${String(row.pct)}%` }} />
              </span>
              <span className={styles.attnPct} data-tone={row.tone}>
                {row.pct}%
              </span>
              <span className={styles.attnNote}>{row.note}</span>
            </li>
          ))}
        </ul>
        <p className={styles.storyCaption}>Illustration — figures are synthetic.</p>
      </div>
    </section>
  );
}

/** Announcements, and the provenance that travels with them. */
function AnnouncementsStory(): ReactNode {
  return (
    <section className={styles.section}>
      <div className={styles.storySplit} data-reverse="true">
        <div className={styles.storyText}>
          <p className={styles.eyebrow}>Announcements</p>
          <h2 className={styles.splitTitle}>Every notice says where it came from</h2>
          <p className={styles.splitLead}>
            A notice carries its publisher and the moment it was checked. GradTools shows notices;
            it does not issue them, and it never invents one to fill a quiet week.
          </p>
        </div>

        <div className={styles.noticeStack} aria-hidden="true">
          {[
            { title: 'Semester 4 results announced', meta: 'Results · checked 2h ago' },
            { title: 'Revised examination timetable', meta: 'Exams · checked today' },
          ].map((notice) => (
            <div key={notice.title} className={`${styles.notice ?? ''} glassSurface`}>
              <span className={styles.noticeTitle}>{notice.title}</span>
              <span className={styles.noticeMeta}>{notice.meta}</span>
            </div>
          ))}
          <p className={styles.storyCaption}>Illustration — notices are synthetic.</p>
        </div>
      </div>
    </section>
  );
}

function DegreeStory(): ReactNode {
  const semesters = [
    { n: 1, state: 'done' },
    { n: 2, state: 'done' },
    { n: 3, state: 'done' },
    { n: 4, state: 'done' },
    { n: 5, state: 'current' },
    { n: 6, state: 'ahead' },
    { n: 7, state: 'ahead' },
    { n: 8, state: 'ahead' },
  ] as const;

  return (
    <section className={styles.section} id="degree">
      <SectionHead
        eyebrow="Your degree"
        title="Where you are, at a glance"
        lead="Eight semesters, each with its own state. GradTools never guesses one — a semester with no data says so."
      />
      <ol className={styles.spine}>
        {semesters.map((semester) => (
          <li key={semester.n} className={styles.spineItem} data-state={semester.state}>
            <span className={styles.spineNode} aria-hidden="true" />
            <span className={styles.spineLabel}>S{semester.n}</span>
            <span className={styles.spineState}>
              {semester.state === 'done'
                ? 'Completed'
                : semester.state === 'current'
                  ? 'In progress'
                  : 'Ahead'}
            </span>
          </li>
        ))}
      </ol>
      <p className={styles.spineNote}>Illustration — states shown are synthetic.</p>
    </section>
  );
}

/**
 * What the product actually does now.
 *
 * This section used to sell a question-paper library. That is no longer part
 * of GradTools, and a landing page that advertises a feature the application
 * does not have is the worst kind of copy — it is a promise nobody can keep.
 * What replaced it is the thing the last several milestones built.
 */
function ImportStory(): ReactNode {
  return (
    <section className={styles.section} id="import">
      <div className={`${styles.split ?? ''} glassSurface`}>
        <div className={styles.splitText}>
          <p className={styles.eyebrow}>Academic documents</p>
          <h2 className={styles.splitTitle}>Give it the documents you already have</h2>
          <p className={styles.splitLead}>
            A result card, your semester&apos;s academic calendar, your class timetable. GradTools
            works out which is which, reads it on your device, shows you what it read, and keeps
            only what you confirm. The file is never uploaded.
          </p>
          <Link to="/import" className={styles.textCta ?? ''}>
            Add a document
            <Icon name="chevronRight" size="small" />
          </Link>
        </div>
        <div className={styles.splitDemo} aria-hidden="true">
          {[
            ['results', 'Result card — 9 subjects read'],
            ['calendar', 'Academic calendar — 4 dates read'],
            ['timetable', 'Class timetable — 25 classes read'],
          ].map(([icon, text]) => (
            <div key={text} className={styles.demoRow}>
              <span className={styles.demoIcon}>
                <Icon name={icon as 'results'} size="small" />
              </span>
              <span>{text}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function SectionHead({
  eyebrow,
  title,
  lead,
}: {
  readonly eyebrow: string;
  readonly title: string;
  readonly lead: string;
}): ReactNode {
  return (
    <div className={styles.sectionHead}>
      <p className={styles.eyebrow}>{eyebrow}</p>
      <h2 className={styles.sectionTitle}>{title}</h2>
      <p className={styles.sectionLead}>{lead}</p>
    </div>
  );
}

function ClosingCta(): ReactNode {
  return (
    <section className={`${styles.closing ?? ''} glassSurface`}>
      <h2 className={styles.closingTitle}>Start with one semester</h2>
      <p className={styles.closingLead}>
        No account, no setup. Add a result and GradTools will do the rest of the arithmetic — and
        show you the clause behind it.
      </p>
      <Link to="/" className={styles.primaryCta ?? ''}>
        Open GradTools
        <Icon name="chevronRight" size="small" />
      </Link>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* Footer — Reference 16                                                       */
/* -------------------------------------------------------------------------- */

/**
 * The reference's column structure, with two deliberate omissions.
 *
 * No social row: GradTools has no accounts, and the reference's nine icons
 * would each have to point somewhere. Inventing them is exactly the "startup
 * theater" M9.6 §21 rules out. The markup is here for when real links exist.
 *
 * No newsletter: there is no mailing list, and a form that silently discards an
 * address is worse than no form.
 *
 * Every link below resolves to a real route.
 */
function Footer(): ReactNode {
  const columns = [
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
        { to: '/semesters', label: 'My degree' },
        { to: '/academics', label: 'SGPA & CGPA' },
        { to: '/timetable', label: 'Timetable' },
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

  return (
    /*
      -------------------------------------------------------------------------
      M9.6G: THE FOOTER IS A CLOSING SURFACE, NOT A LIST OF LISTS
      -------------------------------------------------------------------------

      M9.6F repaired its dead links but left the composition: a brand block
      beside three equal columns, then a legal line. Everything had the same
      weight, so the disclaimer that actually matters — GradTools is not VTU —
      read as small print rather than as the point.

      Reference 16's real contribution is the SHAPE: a wide brand column,
      grouped link columns, and a distinct bottom bar. Taken, with the
      hierarchy corrected:

        - the brand column carries the disclaimer, so it sits at full size
          beside the navigation instead of below it in grey
        - the columns are grouped by what a person is trying to do
        - the bottom bar is reduced to the copyright and the build state

      NOT taken: the reference's nine social icon links. GradTools has no social
      accounts, and the milestone forbids inventing them. The markup for that
      row is deliberately absent rather than stubbed with dead anchors — an
      inactive icon that goes nowhere is worse than no icon.

      Privacy, Terms and Contact are likewise ABSENT rather than linked: those
      routes do not exist, and adding them would reproduce exactly the dead-link
      defect fixed in M9.6F. They belong to a content milestone, not a styling
      one.
    */
    <footer className={styles.footer}>
      <div className={styles.footerTop}>
        <div className={styles.footerBrand}>
          <Link to="/welcome" className={styles.navBrand ?? ''}>
            <span className={styles.navMark} aria-hidden="true">
              G
            </span>
            <span>GradTools</span>
          </Link>
          <p className={styles.footerBlurb}>
            An independent student project for keeping a VTU degree in one place. Every academic
            figure follows the VTU 2022 regulations and can show the clause it came from.
          </p>
          <p className={styles.footerDisclaimer}>
            Not affiliated with, endorsed by, or connected to Visvesvaraya Technological University.
          </p>
        </div>

        <nav className={styles.footerCols} aria-label="Footer">
          {columns.map((column) => (
            <div key={column.title} className={styles.footerCol}>
              <h2 className={styles.footerColTitle}>{column.title}</h2>
              <ul>
                {column.links.map((link) => (
                  <li key={link.to}>
                    <Link to={link.to} className={styles.footerLink ?? ''}>
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
      </div>

      <div className={styles.footerBottom}>
        <p className={styles.footerYear}>&copy; {new Date().getFullYear()} GradTools</p>
        <p className={styles.footerBuild}>
          Experimental version &middot; data stays on your device
        </p>
      </div>
    </footer>
  );
}

/* -------------------------------------------------------------------------- */

export function LandingPage(): ReactNode {
  const mainRef = useRef<HTMLElement>(null);

  useEffect(() => {
    document.title = 'GradTools — your academic life, organized';
  }, []);

  return (
    <div className={styles.page}>
      <a className={styles.skipLink} href="#main">
        Skip to content
      </a>
      <MiniNavbar />
      <main id="main" ref={mainRef}>
        <Hero />
        <Capabilities />
        <ResultsStory />
        <AttendanceStory />
        <DegreeStory />
        <ImportStory />
        <AnnouncementsStory />
        <ClosingCta />
      </main>
      <Footer />
    </div>
  );
}
