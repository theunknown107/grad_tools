/**
 * Profile — the design's profile page: hero, identity and academic snapshot,
 * with Edit profile for the personal details. Academic configuration,
 * Appearance and data live in Account → Settings, as the design has them; the
 * academic panels are exported from here for that page.
 *
 * Every field is optional and stored only on this device. Nothing here is
 * needed to calculate anything.
 */

import { vtu2022RuleSet } from '@gradtools/academic-rules';
import {
  Building2,
  CalendarDays,
  ExternalLink,
  FileText,
  GraduationCap,
  Hash,
  Pencil,
  RotateCcw,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { Link, Navigate, useSearchParams } from 'react-router-dom';
import { Badge } from '../../components/ui/badge.js';
import { Button } from '../../components/ui/button.js';
import { Card } from '../../components/ui/card.js';
import {
  ConfirmDialog,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
} from '../../components/ui/dialog.js';
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
import { identityOf } from '../../domain/auth.js';
import { asStudentProfileId } from '../../domain/identity.js';
import { hasNoBacklogs } from '../../domain/statistics.js';
import type { StudentProfile } from '../../domain/types.js';
import { useAcademicState } from '../../hooks/useAcademicState.js';
import { useProfile, useResults, useTimetable } from '../../hooks/useCollection.js';
import { useBranches, useSchemes, useSubjects } from '../../hooks/useReference.js';
import { cn } from '../../lib/cn.js';
import { branchCode, formatCount, formatGpa, metricDisplay } from '../../lib/format.js';
import { newId, nowIso } from '../../lib/id.js';
import { isStorageAvailable } from '../../repositories/local/store.js';
import { useAuth } from '../auth/AuthContext.js';
import { SEMESTER_OPTIONS } from '../import/CalendarReview.js';

const PROGRAMMES = ['B.E.', 'B.Tech.', 'B.Arch.', 'M.Tech.', 'M.Arch.', 'MBA', 'MCA'] as const;
const NOT_SET = '__not_set__';

/** Sections that used to live here and are now in Account → Settings. */
const MOVED: Readonly<Record<string, string>> = {
  appearance: 'appearance',
  academic: 'academic',
  data: 'data',
};

export function ProfilePage() {
  const { profile, loading, save } = useProfile();
  const [params, setParams] = useSearchParams();
  const [storageOk, setStorageOk] = useState(true);
  const requested = params.get('section');
  const editing = requested === 'identity';
  const setEditing = (open: boolean): void =>
    setParams(open ? { section: 'identity' } : {}, { replace: true });

  useEffect(() => {
    void isStorageAvailable().then(setStorageOk);
  }, []);

  const moved = requested === null ? undefined : MOVED[requested];
  if (moved !== undefined) return <Navigate to={`/account?section=${moved}`} replace />;
  if (loading) return <PageSkeleton label="Loading your profile" />;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Account"
        title="Profile"
        actions={
          <Button icon={<Pencil />} onClick={() => setEditing(true)}>
            Edit profile
          </Button>
        }
      />

      {!storageOk && (
        <Callout tone="warning">
          Your browser is blocking storage, so nothing will be saved between visits. The calculators
          still work.
        </Callout>
      )}

      <Overview profile={profile ?? null} onEdit={() => setEditing(true)} />

      <Dialog open={editing} onOpenChange={setEditing}>
        <DialogContent
          title="Edit profile"
          description="Optional, and stored only on this device. Every field can be left blank."
        >
          <IdentityForm profile={profile ?? null} save={save} onDone={() => setEditing(false)} />
        </DialogContent>
      </Dialog>
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
  const { state: auth } = useAuth();
  /* The verified address from the session — never the stored profile. */
  const accountEmail = identityOf(auth)?.email ?? null;
  const name = profile?.displayName ?? null;
  const usn = profile?.usn ?? null;
  const provisional = statistics.cgpaBasis.pending.length > 0;
  /*
   * The backlog COUNT is the one the student records, as on the dashboard and
   * the degree page's backlog list. "No backlogs" is claimed only when neither
   * that nor the results show one.
   */
  const backlogs = statistics.backlogs.value;
  const clear = hasNoBacklogs(statistics);
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
      <Card aria-label="Who you are">
        <div className="p-6">
          <div className="flex items-center gap-4">
            <Avatar initials={initialsOf(name ?? usn)} size={56} />
            <div className="min-w-0">
              <h2
                className={cn(
                  'truncate text-[20px] leading-tight font-semibold',
                  name === null && 'text-ink-3',
                )}
              >
                {name ?? 'Name not set'}
              </h2>
              <div className="font-mono text-[12px] text-ink-3">{usn ?? 'No USN recorded'}</div>
              {/*
               * THE ACCOUNT'S ADDRESS, AND ONLY WHEN THERE IS AN ACCOUNT.
               *
               * It is shown verbatim and never taken apart: the local part of
               * an address is not a person's name, and a product that renders
               * "a.student" as who you are has invented it. The display name
               * above stays whatever the student typed, or "Name not set".
               */}
              {accountEmail !== null && (
                <div className="mt-0.5 truncate text-[12px] text-ink-3">
                  <span className="sr-only">Signed in as </span>
                  {accountEmail}
                </div>
              )}
            </div>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            {profile?.branch !== null && profile?.branch !== undefined && profile.branch !== '' && (
              <Badge tone="accent">
                <abbr title={profile.branch} className="no-underline">
                  {branchCode(profile.branch)}
                </abbr>
              </Badge>
            )}
            {profile?.currentSemester !== null && profile?.currentSemester !== undefined && (
              <Badge>Semester {profile.currentSemester}</Badge>
            )}
            {profile?.schemeId === 'vtu-2022' && <Badge>2022 scheme</Badge>}
            {clear ? (
              <Badge tone="success">No backlogs</Badge>
            ) : backlogs !== null && backlogs > 0 ? (
              <Badge tone="warning">{formatCount(backlogs, 'backlog')}</Badge>
            ) : (statistics.backlogsFromResults.value ?? 0) > 0 ? (
              <Badge tone="warning">
                {formatCount(statistics.backlogsFromResults.value ?? 0, 'backlog')} in your results
              </Badge>
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
              value={`${String(statistics.semestersGraded.value ?? 0)}/${String(statistics.views.length)}`}
              valueClassName="text-2xl"
            />
            <MiniStat
              label="Backlogs"
              value={metricDisplay(statistics.backlogs).value}
              valueClassName={cn(
                'text-2xl',
                clear && 'text-success',
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
              /*
               * THE FALLBACK IS A FALLBACK, AND SAYS WHICH ONE IT IS.
               *
               * The list above is the normal case. Typing a branch by hand is
               * what is left when the reference data could not be reached —
               * and an unreachable server is a thing to retry, not a thing to
               * work around silently, which is what this looked like.
               *
               * The retry sits BESIDE the field rather than inside its hint:
               * the hint is the input's `aria-describedby` target, and a
               * control buried in a description is read as part of it.
               */
              <div className="flex min-w-0 flex-col gap-1.5">
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
                <div>
                  <Button size="sm" variant="ghost" icon={<RotateCcw />} onClick={branches.retry}>
                    Look for branches again
                  </Button>
                </div>
              </div>
            )}
            <Field
              label="Programme"
              hint={
                /*
                 * The programme only matches notices (OQ-055). Every academic
                 * figure follows the one supported rule set, so a student who
                 * picks another programme is told so here, in SupportNote's words.
                 */
                programme === '' || programme === 'B.E.' || programme === 'B.Tech.'
                  ? 'Helps GradTools show you VTU notices meant for your programme.'
                  : 'Helps GradTools show you VTU notices meant for your programme. Academic figures follow the VTU 2022 scheme (22OB) for B.E./B.Tech only.'
              }
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
  onDone,
}: {
  readonly profile: StudentProfile | null;
  readonly save: SaveProfile;
  readonly onDone: () => void;
}) {
  const [displayName, setDisplayName] = useState(profile?.displayName ?? '');
  const [usn, setUsn] = useState(profile?.usn ?? '');
  const commit = (): void => {
    void save(
      withChanges(profile, {
        displayName: blankToNull(displayName),
        usn: usn.trim() === '' ? null : usn.trim().toUpperCase(),
      }),
    ).then(() => {
      toast('Saved on this device.', { tone: 'success' });
      onDone();
    });
  };
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        commit();
      }}
    >
      <DialogBody className="grid gap-4 sm:grid-cols-2">
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
        <p className="text-[12px] text-ink-3 sm:col-span-2">
          College, branch, programme and semester are set in{' '}
          <Link
            to="/account?section=academic"
            className="font-medium text-accent-ink underline-offset-4 hover:underline"
          >
            Settings → Academic
          </Link>
          .
        </p>
      </DialogBody>
      <DialogFooter>
        <Button variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" variant="primary">
          Save
        </Button>
      </DialogFooter>
    </form>
  );
}

/** What this version supports — shown in Settings → About. */
export function SupportNote() {
  return (
    <Card className="p-6">
      <SectionTitle>What is supported</SectionTitle>
      <div className="space-y-3 text-[13px] leading-relaxed text-ink-2">
        <p>
          This experimental version supports the{' '}
          <strong className="font-semibold text-ink">VTU 2022 scheme (22OB)</strong> for B.E./B.Tech
          at non-autonomous affiliated colleges.
        </p>
        <p className="text-ink-3">
          Autonomous colleges set their own internal rules, so these figures may not apply there.
          Other schemes are not supported yet.
        </p>
      </div>
    </Card>
  );
}

/** Settings → Academic: the configuration, the reference subjects, and hand-entered records. */
export function AcademicSettings() {
  const { profile, loading, save } = useProfile();
  if (loading) return <PageSkeleton label="Loading your academic details" />;
  return <AcademicForm profile={profile ?? null} save={save} />;
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
