/**
 * Profile — the design's profile hero, identity and academic snapshot, with
 * the sections that shape the rest of the app: academic details, personal
 * details, Appearance, and what happens to the data.
 *
 * Every field is optional and stored only on this device. Nothing here is
 * needed to calculate anything.
 */

import { vtu2022RuleSet } from '@gradtools/academic-rules';
import {
  Building2,
  CalendarDays,
  Database,
  ExternalLink,
  FileText,
  GraduationCap,
  Hash,
  LayoutDashboard,
  Palette,
  Pencil,
  RotateCcw,
  UserRound,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Badge } from '../../components/ui/badge.js';
import { Button } from '../../components/ui/button.js';
import { Card } from '../../components/ui/card.js';
import { ConfirmDialog } from '../../components/ui/dialog.js';
import { Callout, EmptyState, ErrorState, toast } from '../../components/ui/feedback.js';
import { Field, Input, Select } from '../../components/ui/field.js';
import { MiniStat } from '../../components/ui/metric.js';
import { Avatar, PageHeader, SectionTitle, initialsOf } from '../../components/ui/page.js';
import { Segmented } from '../../components/ui/segmented.js';
import { PageSkeleton, Skeleton } from '../../components/ui/skeleton.js';
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  numeric,
} from '../../components/ui/table.js';
import { asStudentProfileId } from '../../domain/identity.js';
import type { StudentProfile } from '../../domain/types.js';
import { useAcademicState } from '../../hooks/useAcademicState.js';
import { useProfile, useResults, useTimetable } from '../../hooks/useCollection.js';
import { useBranches, useSchemes, useSubjects } from '../../hooks/useReference.js';
import { cn } from '../../lib/cn.js';
import { formatCount, formatGpa, metricDisplay } from '../../lib/format.js';
import { newId, nowIso } from '../../lib/id.js';
import { isStorageAvailable } from '../../repositories/local/store.js';
import { SEMESTER_OPTIONS } from '../import/CalendarReview.js';
import { AppearanceSettings } from './AppearanceSettings.js';

const PROGRAMMES = ['B.E.', 'B.Tech.', 'B.Arch.', 'M.Tech.', 'M.Arch.', 'MBA', 'MCA'] as const;
const NOT_SET = '__not_set__';

const SECTIONS = [
  { key: 'overview', label: 'Overview', icon: LayoutDashboard },
  { key: 'academic', label: 'Academic', icon: GraduationCap },
  { key: 'identity', label: 'You', icon: UserRound },
  { key: 'appearance', label: 'Appearance', icon: Palette },
  { key: 'data', label: 'Your data', icon: Database },
] as const satisfies readonly { key: string; label: string; icon: LucideIcon }[];
type Section = (typeof SECTIONS)[number]['key'];

function isSection(value: string | null): value is Section {
  return SECTIONS.some((section) => section.key === value);
}

export function ProfilePage() {
  const { profile, loading, save } = useProfile();
  const [params, setParams] = useSearchParams();
  const [storageOk, setStorageOk] = useState(true);
  const requested = params.get('section');
  const section: Section = isSection(requested) ? requested : 'overview';
  const go = (next: Section): void =>
    setParams(next === 'overview' ? {} : { section: next }, { replace: true });

  useEffect(() => {
    void isStorageAvailable().then(setStorageOk);
  }, []);

  if (loading) return <PageSkeleton label="Loading your profile" />;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Account"
        title="Profile"
        description="Optional, and stored only on this device. Every field can be left blank."
        actions={
          section === 'overview' ? (
            <Button icon={<Pencil />} onClick={() => go('academic')}>
              Edit profile
            </Button>
          ) : undefined
        }
      />

      {!storageOk && (
        <Callout tone="warning">
          Your browser is blocking storage, so nothing will be saved between visits. The calculators
          still work.
        </Callout>
      )}

      <div className="grid gap-6 lg:grid-cols-[220px_1fr]">
        <nav aria-label="Profile sections" className="h-fit min-w-0 lg:sticky lg:top-6">
          <ul className="relative -mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1 scroll-quiet lg:flex-col">
            {SECTIONS.map((item) => {
              const active = section === item.key;
              return (
                <li key={item.key} className="shrink-0">
                  <button
                    type="button"
                    onClick={() => go(item.key)}
                    aria-current={active ? 'page' : undefined}
                    className={cn(
                      'flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] font-medium whitespace-nowrap transition-colors',
                      active
                        ? 'bg-accent-weak text-accent-ink'
                        : 'text-ink-2 hover:bg-sunken hover:text-ink',
                    )}
                  >
                    <item.icon className="size-4" aria-hidden="true" /> {item.label}
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>

        <div key={section} className="min-w-0 animate-rise">
          {section === 'overview' && (
            <Overview profile={profile ?? null} onEdit={() => go('academic')} />
          )}
          {section === 'academic' && <AcademicForm profile={profile ?? null} save={save} />}
          {section === 'identity' && <IdentityForm profile={profile ?? null} save={save} />}
          {section === 'appearance' && <AppearanceSettings />}
          {section === 'data' && <DataNotes />}
        </div>
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- Overview */

function Overview({
  profile,
  onEdit,
}: {
  readonly profile: StudentProfile | null;
  readonly onEdit: () => void;
}) {
  const { statistics } = useAcademicState();
  const name = profile?.displayName ?? null;
  const usn = profile?.usn ?? null;
  const provisional = statistics.cgpaBasis.pending.length > 0;
  const backlogs = statistics.backlogsFromResults.value;
  const fields: readonly {
    icon: LucideIcon;
    label: string;
    value: string | null;
    mono?: boolean;
  }[] = [
    { icon: Hash, label: 'USN', value: usn, mono: true },
    { icon: Building2, label: 'College', value: profile?.collegeName ?? null },
    { icon: GraduationCap, label: 'Branch', value: profile?.branch ?? null },
    { icon: GraduationCap, label: 'Programme', value: profile?.programme ?? null },
    {
      icon: FileText,
      label: 'Scheme',
      value: profile?.schemeId === 'vtu-2022' ? 'VTU 2022 (22OB)' : null,
    },
    {
      icon: CalendarDays,
      label: 'Current semester',
      value:
        profile?.currentSemester === null || profile?.currentSemester === undefined
          ? null
          : `Semester ${String(profile.currentSemester)}`,
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <Card className="relative overflow-hidden" aria-label="Who you are">
        <div aria-hidden="true" className="h-24 bg-linear-to-r from-accent to-accent-ink" />
        <div className="px-6 pb-6">
          <div className="-mt-9 flex items-end gap-4">
            <span className="rounded-full ring-4 ring-raised">
              <Avatar initials={initialsOf(name ?? usn)} size={72} />
            </span>
            <div className="min-w-0 pb-1">
              <h2
                className={cn(
                  'truncate text-[20px] leading-tight font-semibold',
                  name === null && 'text-ink-3',
                )}
              >
                {name ?? 'Name not set'}
              </h2>
              <div className="font-mono text-[12px] text-ink-3">{usn ?? 'No USN recorded'}</div>
            </div>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            {profile?.branch !== null && profile?.branch !== undefined && profile.branch !== '' && (
              <Badge tone="accent">{profile.branch}</Badge>
            )}
            {profile?.currentSemester !== null && profile?.currentSemester !== undefined && (
              <Badge>Semester {profile.currentSemester}</Badge>
            )}
            {profile?.schemeId === 'vtu-2022' && <Badge>2022 scheme</Badge>}
            {backlogs === 0 ? (
              <Badge tone="success">No backlogs</Badge>
            ) : backlogs !== null ? (
              <Badge tone="warning">{formatCount(backlogs, 'backlog')}</Badge>
            ) : null}
          </div>
          {profile === null && (
            <Button variant="primary" size="sm" className="mt-4" icon={<Pencil />} onClick={onEdit}>
              Add your details
            </Button>
          )}
        </div>
      </Card>

      <div className="grid items-start gap-6 lg:grid-cols-[1.4fr_1fr]">
        <Card className="p-6">
          <SectionTitle>Identity</SectionTitle>
          <ul className="grid gap-x-8 gap-y-4 sm:grid-cols-2">
            {fields.map((field) => (
              <li key={field.label} className="flex items-start gap-3">
                <span
                  aria-hidden="true"
                  className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg bg-sunken text-ink-3"
                >
                  <field.icon className="size-4" />
                </span>
                <dl className="min-w-0">
                  <dt className="text-[11px] tracking-wide text-ink-3 uppercase">{field.label}</dt>
                  <dd
                    className={cn(
                      'truncate text-[13px] font-medium',
                      field.mono === true && field.value !== null && 'font-mono',
                      field.value === null && 'font-normal text-ink-3',
                    )}
                  >
                    {field.value ?? 'Not set'}
                  </dd>
                </dl>
              </li>
            ))}
          </ul>
        </Card>
        <Card className="p-6">
          <SectionTitle>Academic snapshot</SectionTitle>
          <div className="grid grid-cols-2 gap-3">
            <MiniStat
              label={provisional ? 'Average so far' : 'CGPA'}
              value={
                metricDisplay(provisional ? statistics.provisionalCgpa : statistics.cgpa, formatGpa)
                  .value
              }
              valueClassName={cn(
                'text-2xl',
                (provisional ? statistics.provisionalCgpa : statistics.cgpa).value === null
                  ? 'text-base text-ink-3'
                  : 'text-accent-ink',
              )}
            />
            <MiniStat
              label="Credits"
              value={metricDisplay(statistics.creditsEarned).value}
              valueClassName={cn(
                'text-2xl',
                statistics.creditsEarned.value === null && 'text-base text-ink-3',
              )}
            />
            <MiniStat
              label="Semesters"
              value={`${String(statistics.semestersGraded.value ?? 0)}/8`}
              valueClassName="text-2xl"
            />
            <MiniStat
              label="Backlogs"
              value={metricDisplay(statistics.backlogsFromResults).value}
              valueClassName={cn(
                'text-2xl',
                backlogs === 0 && 'text-success',
                backlogs === null && 'text-base text-ink-3',
                (backlogs ?? 0) > 0 && 'text-warning',
              )}
            />
          </div>
          <Button asChild className="mt-4 w-full">
            <Link to="/semesters">View degree progress</Link>
          </Button>
        </Card>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- Forms */

type SaveProfile = (profile: StudentProfile) => Promise<void>;

function withChanges(
  profile: StudentProfile | null,
  patch: Partial<StudentProfile>,
): StudentProfile {
  return {
    id: profile?.id ?? asStudentProfileId(newId()),
    authUserId: null,
    displayName: profile?.displayName ?? null,
    usn: profile?.usn ?? null,
    collegeName: profile?.collegeName ?? null,
    schemeId: vtu2022RuleSet.schemeId,
    programme: profile?.programme ?? null,
    branch: profile?.branch ?? null,
    currentSemester: profile?.currentSemester ?? null,
    createdAt: profile?.createdAt ?? nowIso(),
    ...patch,
    updatedAt: nowIso(),
  };
}

const blankToNull = (value: string): string | null => (value.trim() === '' ? null : value.trim());

function FormCard({
  title,
  children,
  note,
}: {
  readonly title: string;
  readonly children: ReactNode;
  readonly note?: ReactNode;
}) {
  return (
    <Card className="p-6">
      <SectionTitle>{title}</SectionTitle>
      {note !== undefined && <div className="mb-5 space-y-1 text-[13px] text-ink-2">{note}</div>}
      {children}
    </Card>
  );
}

function AcademicForm({
  profile,
  save,
}: {
  readonly profile: StudentProfile | null;
  readonly save: SaveProfile;
}) {
  const schemes = useSchemes();
  const branches = useBranches();
  const [collegeName, setCollegeName] = useState(profile?.collegeName ?? '');
  const [branch, setBranch] = useState(profile?.branch ?? '');
  const [programme, setProgramme] = useState(profile?.programme ?? '');
  const [semester, setSemester] = useState(
    profile?.currentSemester === null || profile?.currentSemester === undefined
      ? ''
      : String(profile.currentSemester),
  );
  const dirty =
    collegeName !== (profile?.collegeName ?? '') ||
    branch !== (profile?.branch ?? '') ||
    programme !== (profile?.programme ?? '') ||
    semester !==
      (profile?.currentSemester === null || profile?.currentSemester === undefined
        ? ''
        : String(profile.currentSemester));

  const reset = (): void => {
    setCollegeName(profile?.collegeName ?? '');
    setBranch(profile?.branch ?? '');
    setProgramme(profile?.programme ?? '');
    setSemester(
      profile?.currentSemester === null || profile?.currentSemester === undefined
        ? ''
        : String(profile.currentSemester),
    );
  };
  const commit = (): void => {
    void save(
      withChanges(profile, {
        collegeName: blankToNull(collegeName),
        branch: blankToNull(branch),
        programme: blankToNull(programme),
        currentSemester: semester === '' ? null : Number(semester),
      }),
    ).then(() => toast('Saved on this device.', { tone: 'success' }));
  };

  return (
    <div className="flex flex-col gap-4">
      <FormCard
        title="Academic configuration"
        note="These values shape how results, notices, credits and the timetable are interpreted."
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            commit();
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="College">
              <Input value={collegeName} onChange={(event) => setCollegeName(event.target.value)} />
            </Field>
            {branches.state.status === 'loading' ? (
              <Field label="Branch" hint="Loading branches…">
                <Input disabled value={branch} />
              </Field>
            ) : branches.state.status === 'ready' && branches.state.data.length > 0 ? (
              <Field label="Branch" hint="From the GradTools reference data.">
                <Select
                  value={branch === '' ? NOT_SET : branch}
                  onValueChange={(value) => setBranch(value === NOT_SET ? '' : value)}
                  options={[
                    { value: NOT_SET, label: 'Not set' },
                    ...branches.state.data.map((item) => ({ value: item.name, label: item.name })),
                    ...(branch !== '' && !branches.state.data.some((item) => item.name === branch)
                      ? [{ value: branch, label: branch }]
                      : []),
                  ]}
                />
              </Field>
            ) : (
              <Field
                label="Branch"
                hint={
                  branches.state.status === 'error'
                    ? 'Branches could not be loaded; type yours instead.'
                    : 'No branches available from the server; type yours instead.'
                }
              >
                <Input
                  placeholder="Computer Science"
                  value={branch}
                  onChange={(event) => setBranch(event.target.value)}
                />
              </Field>
            )}
            <Field
              label="Programme"
              hint="Helps GradTools show you VTU notices meant for your programme."
            >
              <Select
                value={programme === '' ? NOT_SET : programme}
                onValueChange={(value) => setProgramme(value === NOT_SET ? '' : value)}
                options={[
                  { value: NOT_SET, label: 'Not set' },
                  ...PROGRAMMES.map((value) => ({ value, label: value })),
                ]}
              />
            </Field>
            <Field label="Current semester">
              <Select
                value={semester === '' ? NOT_SET : semester}
                onValueChange={(value) => setSemester(value === NOT_SET ? '' : value)}
                options={[{ value: NOT_SET, label: 'Not set' }, ...SEMESTER_OPTIONS]}
              />
            </Field>
            <Field
              label="Scheme"
              hint={
                schemes.state.status === 'error'
                  ? 'Schemes could not be loaded from the server.'
                  : 'Only verified schemes are offered.'
              }
            >
              <Select
                value={vtu2022RuleSet.schemeId}
                onValueChange={() => undefined}
                disabled={schemes.state.status !== 'ready' || schemes.state.data.length <= 1}
                options={
                  schemes.state.status === 'ready' && schemes.state.data.length > 0
                    ? schemes.state.data.map((item) => ({
                        value: item.id,
                        label: `${item.name} (${item.regulationCode})`,
                      }))
                    : [{ value: vtu2022RuleSet.schemeId, label: 'VTU 2022 (22OB)' }]
                }
              />
            </Field>
          </div>
          <div className="mt-6 flex justify-end gap-2">
            <Button variant="ghost" icon={<RotateCcw />} onClick={reset} disabled={!dirty}>
              Reset
            </Button>
            <Button type="submit" variant="primary">
              Save profile
            </Button>
          </div>
        </form>
      </FormCard>
      <SubjectsPanel semester={semester === '' ? null : Number(semester)} />
      <MyRecordsPanel />
    </div>
  );
}

function IdentityForm({
  profile,
  save,
}: {
  readonly profile: StudentProfile | null;
  readonly save: SaveProfile;
}) {
  const [displayName, setDisplayName] = useState(profile?.displayName ?? '');
  const [usn, setUsn] = useState(profile?.usn ?? '');
  const commit = (): void => {
    void save(
      withChanges(profile, {
        displayName: blankToNull(displayName),
        usn: usn.trim() === '' ? null : usn.trim().toUpperCase(),
      }),
    ).then(() => toast('Saved on this device.', { tone: 'success' }));
  };
  return (
    <FormCard
      title="You"
      note={
        <>
          <p>
            Everything here is optional and stored only in this browser. GradTools never needs any
            of it to calculate anything.
          </p>
          <p>
            Your name is used only to greet you. The USN only labels a result you export — leaving
            it blank costs nothing.
          </p>
        </>
      }
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          commit();
        }}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name" hint="Only used to greet you.">
            <Input
              autoComplete="name"
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
            />
          </Field>
          <Field label="USN" optional hint="Only used to label a result you export.">
            <Input
              className="font-mono"
              placeholder="1XX22CS001"
              value={usn}
              onChange={(event) => setUsn(event.target.value)}
            />
          </Field>
        </div>
        <div className="mt-6 flex justify-end">
          <Button type="submit" variant="primary">
            Save
          </Button>
        </div>
      </form>
    </FormCard>
  );
}

function DataNotes() {
  return (
    <div className="flex flex-col gap-4">
      <FormCard title="Where your data lives">
        <div className="space-y-3 text-[13px] leading-relaxed text-ink-2">
          <p>
            Everything you enter (profile, attendance, results and timetable) is stored in this
            browser. If you sign in on the Account page, a copy is kept in your account so another
            device can restore it.
          </p>
          <p>Clearing your browser data removes the local copy.</p>
          <p className="text-ink-3">
            GradTools does not collect your date of birth, phone number, or any login details for a
            university system, and never asks for a university password.
          </p>
        </div>
        <Button asChild className="mt-4">
          <Link to="/account">Sync, export and deletion</Link>
        </Button>
      </FormCard>
      <FormCard title="What is supported">
        <div className="space-y-3 text-[13px] leading-relaxed text-ink-2">
          <p>
            This experimental version supports the{' '}
            <strong className="font-semibold text-ink">VTU 2022 scheme (22OB)</strong> for
            B.E./B.Tech at non-autonomous affiliated colleges.
          </p>
          <p className="text-ink-3">
            Autonomous colleges set their own internal rules, so these figures may not apply there.
            Other schemes are not supported yet.
          </p>
        </div>
      </FormCard>
    </div>
  );
}

/* --------------------------------------------------- Reference subjects */

function SubjectsPanel({ semester }: { readonly semester: number | null }) {
  const subjects = useSubjects('vtu-2022', 'cse', semester === null ? undefined : semester);
  return (
    <Card className="overflow-hidden">
      <div className="px-6 pt-6">
        <SectionTitle>Subjects in the reference data</SectionTitle>
      </div>
      {subjects.state.status === 'loading' ? (
        <div role="status" className="space-y-2 px-6 pb-6">
          <span className="sr-only">Loading subjects…</span>
          <Skeleton className="h-8" />
          <Skeleton className="h-8" />
        </div>
      ) : subjects.state.status === 'error' ? (
        <ErrorState
          className="m-6 mt-0"
          title="Subjects are unavailable"
          message={`${subjects.state.message} Your own data is stored on this device and is unaffected.`}
          onRetry={subjects.retry}
        />
      ) : subjects.state.data.length === 0 ? (
        <div className="space-y-1 px-6 pb-6 text-[13px] text-ink-2">
          <p>
            No verified subjects for{' '}
            {semester === null ? 'this selection' : `semester ${String(semester)}`} yet.
          </p>
          <p className="text-ink-3">
            GradTools only publishes subject data it has verified against a VTU source document;
            unverified semesters are absent rather than guessed.
          </p>
        </div>
      ) : (
        <>
          <div className="border-t border-line">
            <Table>
              <TableCaption>Verified subjects from the GradTools reference data</TableCaption>
              <TableHeader>
                <tr>
                  <TableHead>Code</TableHead>
                  <TableHead>Title</TableHead>
                  <TableHead className="text-right">Credits</TableHead>
                </tr>
              </TableHeader>
              <TableBody>
                {subjects.state.data.map((subject) => (
                  <TableRow key={subject.id}>
                    <TableCell className="font-mono text-[12px]">{subject.code}</TableCell>
                    <TableCell className="text-ink-2">{subject.title}</TableCell>
                    <TableCell className={numeric}>{subject.credits ?? '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <p className="flex flex-wrap items-center gap-2 border-t border-line px-6 py-3 text-[12px] text-ink-3">
            {formatCount(subjects.state.data.length, 'verified subject')} ·
            <a
              href={subjects.state.data[0]?.provenance.sourceUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="inline-flex items-center gap-1 font-medium text-accent-ink underline-offset-4 hover:underline"
            >
              View the source document <ExternalLink className="size-3" aria-hidden="true" />
            </a>
          </p>
        </>
      )}
    </Card>
  );
}

/* --------------------------------------------- What you added yourself */

type Scope = 'all' | 'results' | 'timetable';
type Pending =
  | { kind: 'subject'; resultId: string; subjectId: string; name: string; semester: number }
  | { kind: 'slot'; id: string; name: string; when: string };

function MyRecordsPanel() {
  const results = useResults();
  const timetable = useTimetable();
  const [scope, setScope] = useState<Scope>('all');
  const [pending, setPending] = useState<Pending | null>(null);

  const rows = results.items.flatMap((result) =>
    result.subjects
      .filter((subject) => subject.provenance === 'manual')
      .map((subject) => ({ result, subject })),
  );
  const activities = timetable.items.filter((slot) => slot.subjectCode === null);
  const total = rows.length + activities.length;

  const updateResult = (
    resultId: string,
    change: (subjects: (typeof rows)[number]['subject'][]) => (typeof rows)[number]['subject'][],
  ): void => {
    const result = results.items.find((entry) => entry.id === resultId);
    if (result === undefined) return;
    void results.save({ ...result, subjects: change([...result.subjects]), updatedAt: nowIso() });
  };

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 px-6 pt-6">
        <SectionTitle className="mb-0">What you added yourself</SectionTitle>
        {total > 0 && (
          <Segmented<Scope>
            size="sm"
            label="Show"
            value={scope}
            onChange={setScope}
            options={[
              { value: 'all', label: `All · ${String(total)}` },
              { value: 'results', label: `Results · ${String(rows.length)}` },
              { value: 'timetable', label: `Timetable · ${String(activities.length)}` },
            ]}
          />
        )}
      </div>
      {results.loading || timetable.loading ? (
        <div className="p-6">
          <Skeleton className="h-16" />
        </div>
      ) : total === 0 ? (
        <EmptyState
          compact
          icon={<FileText />}
          title="Nothing added by hand yet"
          description="Subjects you type into a result, and hours your timetable schedules without a course code, appear here so you can find them again."
        />
      ) : (
        <div className="mt-4 border-t border-line">
          <Table>
            <TableCaption>Records you entered yourself</TableCaption>
            <TableHeader>
              <tr>
                <TableHead>Record</TableHead>
                <TableHead>Where</TableHead>
                <TableHead>How it is recorded</TableHead>
                <TableHead>
                  <span className="sr-only">Actions</span>
                </TableHead>
              </tr>
            </TableHeader>
            <TableBody>
              {scope !== 'timetable' &&
                rows.map(({ result, subject }) => (
                  <TableRow key={subject.id}>
                    <TableCell>
                      {subject.subjectTitle}
                      {subject.subjectCode !== null && (
                        <span className="ml-1 font-mono text-[12px] text-ink-3">
                          {subject.subjectCode}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-ink-2">
                      Result · semester {result.semester}
                    </TableCell>
                    <TableCell>
                      <Badge>
                        {subject.catalogueCode === null
                          ? 'Entered by you'
                          : `Entered by you · linked to ${subject.catalogueCode}`}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-1">
                        <Button asChild size="sm" variant="ghost">
                          <Link to={`/results/${String(result.semester)}`}>Open</Link>
                        </Button>
                        {subject.catalogueCode !== null && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() =>
                              updateResult(result.id, (subjects) =>
                                subjects.map((entry) =>
                                  entry.id === subject.id
                                    ? { ...entry, catalogueCode: null }
                                    : entry,
                                ),
                              )
                            }
                          >
                            Unlink
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-danger hover:text-danger"
                          onClick={() =>
                            setPending({
                              kind: 'subject',
                              resultId: result.id,
                              subjectId: subject.id,
                              name: subject.subjectTitle,
                              semester: result.semester,
                            })
                          }
                        >
                          Delete
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              {scope !== 'results' &&
                activities.map((slot) => (
                  <TableRow key={slot.id}>
                    <TableCell>{slot.activity ?? 'Unnamed'}</TableCell>
                    <TableCell className="text-ink-2">
                      Timetable · {slot.day} {slot.startTime}
                    </TableCell>
                    <TableCell>
                      <Badge>No course code</Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-1">
                        <Button asChild size="sm" variant="ghost">
                          <Link to="/timetable">Open</Link>
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-danger hover:text-danger"
                          onClick={() =>
                            setPending({
                              kind: 'slot',
                              id: slot.id,
                              name: slot.activity ?? 'This hour',
                              when: `${slot.day} at ${slot.startTime}`,
                            })
                          }
                        >
                          Delete
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
            </TableBody>
          </Table>
        </div>
      )}
      <ConfirmDialog
        open={pending !== null}
        onOpenChange={(open) => !open && setPending(null)}
        destructive
        title={pending?.kind === 'slot' ? 'Delete this activity?' : 'Delete this subject?'}
        description={
          pending === null
            ? ''
            : pending.kind === 'subject'
              ? `${pending.name} leaves your semester ${String(pending.semester)} result. The rest of the result stays as it is.`
              : `${pending.name} leaves your timetable (${pending.when}).`
        }
        confirmLabel="Delete"
        onConfirm={() => {
          if (pending?.kind === 'subject') {
            updateResult(pending.resultId, (subjects) =>
              subjects.filter((entry) => entry.id !== pending.subjectId),
            );
          } else if (pending?.kind === 'slot') {
            void timetable.remove(pending.id);
          }
          setPending(null);
        }}
      />
    </Card>
  );
}
