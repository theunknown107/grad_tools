/**
 * Account → Settings — the design's settings page: Appearance, Academic,
 * Data & privacy, Notifications and About, in the design's order.
 *
 * Data & privacy carries what an account does: sign-in, sync and its
 * conflicts, export and deletion. Everything else is local to this device.
 */

import {
  Bell,
  CloudUpload,
  Database,
  Download,
  GraduationCap,
  Info,
  LogOut,
  Palette,
  RefreshCw,
  ShieldCheck,
  Trash2,
  type LucideIcon,
} from 'lucide-react';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { GradToolsLogo } from '../../brand/GradToolsLogo.js';
import { Badge } from '../../components/ui/badge.js';
import { Button } from '../../components/ui/button.js';
import { Card } from '../../components/ui/card.js';
import { ConfirmDialog } from '../../components/ui/dialog.js';
import { Callout, toast } from '../../components/ui/feedback.js';
import { IconTile, PageHeader, SectionTitle } from '../../components/ui/page.js';
import { PageSkeleton } from '../../components/ui/skeleton.js';
import { SYNC_LABEL } from '../../domain/auth.js';
import type { ConflictResolution } from '../../domain/sync.js';
import { cn } from '../../lib/cn.js';
import { NotificationSettings } from '../announcements/NotificationsPage.js';
import { AppearanceSettings } from '../profile/AppearanceSettings.js';
import { AcademicSettings, SupportNote } from '../profile/ProfilePage.js';
import { useAuth } from './AuthContext.js';
import { DivergenceCard } from './DivergenceCard.js';
import { useSync } from './useSync.js';

const PROVIDER_LABEL: Record<string, string> = {
  google: 'Google',
  apple: 'Apple',
  email: 'Email and password',
};

function summarise(data: Record<string, unknown> | null): string {
  if (data === null) return 'deleted';
  const parts = Object.entries(data)
    .filter(([key]) => key !== 'profileId' && key !== 'updatedAt')
    .slice(0, 4)
    .map(([key, value]) => `${key} ${String(value)}`);
  return parts.length === 0 ? 'no details' : parts.join(', ');
}

const PROFILE_FIELD_LABEL: Record<string, string> = {
  displayName: 'Name',
  usn: 'USN',
  collegeName: 'College',
  schemeId: 'Scheme',
  programme: 'Programme',
  branch: 'Branch',
  currentSemester: 'Current semester',
  admissionYear: 'Admission year',
  expectedPassoutYear: 'Expected passout year',
  entryRoute: 'Entry route',
  identityConfirmedAt: 'Identity confirmed',
};

function profileValue(key: string, value: unknown): string {
  if (value === null || value === undefined) return 'Not set';
  if (key === 'entryRoute') return value === 'puc' ? 'PUC' : value === 'diploma' ? 'Diploma' : '—';
  return String(value);
}

/** The profile fields the two copies disagree on, both sides shown. */
function ProfileConflictDiff({
  local,
  server,
}: {
  readonly local: Record<string, unknown> | null;
  readonly server: Record<string, unknown> | null;
}) {
  const keys = Object.keys(PROFILE_FIELD_LABEL).filter((key) => local?.[key] !== server?.[key]);
  return (
    <table className="mt-3 w-full text-left text-[12px] [overflow-wrap:anywhere]">
      <thead className="text-ink-3">
        <tr>
          <th scope="col" className="py-1 font-medium">
            Field
          </th>
          <th scope="col" className="py-1 font-medium">
            This device
          </th>
          <th scope="col" className="py-1 font-medium">
            Your account
          </th>
        </tr>
      </thead>
      <tbody>
        {keys.map((key) => (
          <tr key={key} className="border-t">
            <th scope="row" className="py-1 pr-2 font-medium">
              {PROFILE_FIELD_LABEL[key]}
            </th>
            <td className="py-1 pr-2">{profileValue(key, local?.[key])}</td>
            <td className="py-1">{profileValue(key, server?.[key])}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const SECTIONS = [
  { key: 'appearance', label: 'Appearance', icon: Palette },
  { key: 'academic', label: 'Academic', icon: GraduationCap },
  { key: 'data', label: 'Data & privacy', icon: Database },
  { key: 'notifications', label: 'Notifications', icon: Bell },
  { key: 'about', label: 'About', icon: Info },
] as const satisfies readonly { key: string; label: string; icon: LucideIcon }[];
type SectionKey = (typeof SECTIONS)[number]['key'];

export function AccountPage() {
  const { state, signOut } = useAuth();
  const sync = useSync();
  const [params, setParams] = useSearchParams();
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [profileChoice, setProfileChoice] = useState<ConflictResolution | null>(null);
  const [resolving, setResolving] = useState(false);

  if (state.status === 'restoring') return <PageSkeleton label="Checking your session" />;

  const signedIn = state.status === 'signed_in';
  const identity = signedIn ? state.identity : null;
  const requested = params.get('section');
  const section: SectionKey =
    SECTIONS.find((entry) => entry.key === requested)?.key ?? 'appearance';
  const conflicts = signedIn ? sync.state.conflicts.length : 0;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Account"
        title="Settings"
        description="Manage appearance, academic configuration and your data."
        actions={
          signedIn ? (
            <Badge
              tone={
                sync.state.status === 'failed' || sync.state.status === 'conflicts'
                  ? 'warning'
                  : 'neutral'
              }
            >
              {SYNC_LABEL[sync.state.status]}
            </Badge>
          ) : undefined
        }
      />

      {state.status === 'expired' && (
        <Callout tone="warning">Your session has expired. Sign in again to resume syncing.</Callout>
      )}

      <div className="grid gap-6 lg:grid-cols-[220px_1fr]">
        <nav aria-label="Settings sections" className="h-fit min-w-0 lg:sticky lg:top-6">
          <ul className="relative -mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1 scroll-quiet lg:flex-col">
            {SECTIONS.map((item) => {
              const active = section === item.key;
              return (
                <li key={item.key} className="shrink-0">
                  <button
                    type="button"
                    aria-current={active ? 'page' : undefined}
                    onClick={() =>
                      setParams(item.key === 'appearance' ? {} : { section: item.key }, {
                        replace: true,
                      })
                    }
                    className={cn(
                      'flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] font-medium whitespace-nowrap transition-colors',
                      active
                        ? 'bg-accent-weak text-accent-ink'
                        : 'text-ink-2 hover:bg-sunken hover:text-ink',
                    )}
                  >
                    <item.icon className="size-4" aria-hidden="true" /> {item.label}
                    {item.key === 'data' && conflicts > 0 && (
                      <Badge tone="warning" className="ml-auto">
                        {conflicts}
                        <span className="sr-only"> records need attention</span>
                      </Badge>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>

        <div key={section} className="flex min-w-0 animate-rise flex-col gap-4">
          {section === 'appearance' && <AppearanceSettings />}
          {section === 'academic' && <AcademicSettings />}
          {section === 'notifications' && <NotificationSettings />}
          {section === 'data' &&
            (identity === null ? (
              <Card className="p-6">
                <div className="flex items-start gap-3">
                  <IconTile tone="accent" size="lg">
                    <CloudUpload />
                  </IconTile>
                  <div>
                    <h2 className="text-[15px] font-semibold">Sign in</h2>
                    <p className="mt-1 max-w-xl text-[13px] text-ink-2">
                      An account syncs your records between devices. Without one, GradTools works
                      exactly the same on this device.
                    </p>
                    <Button asChild variant="primary" className="mt-4">
                      <Link to="/sign-in">Sign in or create an account</Link>
                    </Button>
                  </div>
                </div>
              </Card>
            ) : (
              <>
                <Card className="p-6">
                  <SectionTitle>Signed in</SectionTitle>
                  <dl className="grid gap-4 sm:grid-cols-3">
                    <div>
                      <dt className="text-[11px] tracking-wide text-ink-3 uppercase">
                        Signed in with
                      </dt>
                      <dd className="mt-0.5 text-[13px] font-medium">
                        {identity.provider === null
                          ? 'An email address'
                          : (PROVIDER_LABEL[identity.provider] ?? identity.provider)}
                      </dd>
                    </div>
                    {identity.email !== null && (
                      <div className="min-w-0">
                        <dt className="text-[11px] tracking-wide text-ink-3 uppercase">Email</dt>
                        <dd className="mt-0.5 truncate text-[13px] font-medium">
                          {identity.email}
                        </dd>
                      </div>
                    )}
                    <div>
                      <dt className="text-[11px] tracking-wide text-ink-3 uppercase">Sync</dt>
                      <dd className="mt-1">
                        <Badge
                          tone={
                            sync.state.status === 'failed'
                              ? 'warning'
                              : sync.state.status === 'synced'
                                ? 'success'
                                : 'neutral'
                          }
                        >
                          {SYNC_LABEL[sync.state.status]}
                        </Badge>
                      </dd>
                    </div>
                  </dl>
                  {identity.email !== null && identity.provider === 'apple' && (
                    <p className="mt-4 text-[12px] text-ink-3">
                      Apple may give apps a private relay address rather than your real one.
                      GradTools only uses it to show you which account this is.
                    </p>
                  )}
                  <div className="mt-5 flex flex-wrap gap-2">
                    <Button
                      icon={<RefreshCw />}
                      loading={sync.state.status === 'syncing'}
                      disabled={deleting}
                      onClick={() => void sync.syncNow()}
                    >
                      Sync now
                    </Button>
                  </div>
                </Card>
                <Card className="p-6">
                  <SectionTitle>Sign out</SectionTitle>
                  <p className="text-[13px] text-ink-2">
                    Signing out stops syncing. The records saved on this device stay here, and are
                    yours again when you sign back in.
                  </p>
                  <Button className="mt-4" icon={<LogOut />} onClick={() => void signOut()}>
                    Sign out
                  </Button>
                </Card>
              </>
            ))}

          {section === 'data' && (
            <>
              {conflicts > 0 && (
                <Card className="p-6">
                  <SectionTitle>Needs your attention</SectionTitle>
                  <p className="text-[13px] text-ink-2">
                    These records changed in two places. Nothing has been overwritten, and both
                    versions are still here.
                  </p>
                  <ul className="mt-4 flex flex-col gap-2">
                    {sync.state.conflicts.map((conflict) => (
                      <li
                        key={`${conflict.collection}:${conflict.id}`}
                        className="rounded-xl border bg-warning-weak/30 p-4 text-[13px]"
                      >
                        <div className="font-semibold capitalize">{conflict.collection}</div>
                        <div className="mt-0.5 text-ink-2">{conflict.reason}</div>
                        {conflict.collection === 'profile' ? (
                          <>
                            <ProfileConflictDiff local={conflict.local} server={conflict.server} />
                            <div className="mt-3 flex flex-wrap gap-2">
                              <Button size="sm" onClick={() => setProfileChoice('keep_mine')}>
                                Keep this device&rsquo;s
                              </Button>
                              <Button size="sm" onClick={() => setProfileChoice('take_theirs')}>
                                Use account version
                              </Button>
                            </div>
                          </>
                        ) : (
                          <div className="mt-2 grid gap-1 font-mono text-[11px] text-ink-3">
                            <span>On this device: {summarise(conflict.local)}</span>
                            <span>In your account: {summarise(conflict.server)}</span>
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                  {sync.state.error !== null && (
                    <Callout tone="warning" role="alert" className="mt-4">
                      {sync.state.error}
                    </Callout>
                  )}
                  <p className="mt-4 text-[12px] text-ink-3">
                    For other records, edit the one on the device you want to keep, then sync again.
                  </p>
                </Card>
              )}

              <DivergenceCard />

              <Card className="p-6">
                <div className="flex items-start gap-3">
                  <IconTile tone="success" size="lg">
                    <ShieldCheck />
                  </IconTile>
                  <div>
                    <h2 className="text-[15px] font-semibold">Local-first by design</h2>
                    <p className="mt-1 max-w-xl text-[13px] text-ink-2">
                      Your academic records, marks cards and timetable are stored in this browser.
                      Documents are read locally, and nothing is uploaded unless you sign in and
                      choose to sync. Clearing your browser data removes the local copy, and
                      GradTools never asks for a university password.
                    </p>
                    {/*
                      SAID PLAINLY, BECAUSE IT IS NOT OBVIOUS.
                      The weekly timetable syncs; per-class attendance and
                      date-specific changes do not, in this version. A student
                      who marks a class on their phone and then opens their
                      laptop should not have to discover that for themselves.
                    */}
                    <p className="mt-3 max-w-xl text-[13px] text-ink-2">
                      Per-class attendance history and date-specific timetable changes —
                      cancellations, replacements and one-off classes — stay on this device. Your
                      weekly timetable and your attendance totals sync as they always have. Syncing
                      the per-class record is a later piece of work.
                    </p>
                  </div>
                </div>
              </Card>
              {identity !== null ? (
                <>
                  <Card className="p-6">
                    <SectionTitle>Your data</SectionTitle>
                    <p className="text-[13px] text-ink-2">
                      Everything GradTools holds for you, as a JSON file. It contains your records
                      and nobody else&rsquo;s.
                    </p>
                    <div className="mt-4 flex flex-wrap gap-2">
                      <Button
                        icon={<Download />}
                        loading={busy}
                        onClick={() => {
                          setBusy(true);
                          void sync
                            .exportData()
                            .then((ok) => {
                              setMessage(ok ? null : 'Could not build your export. Try again.');
                              if (ok) toast('Export downloaded', { tone: 'success' });
                            })
                            .finally(() => setBusy(false));
                        }}
                      >
                        Download my data
                      </Button>
                    </div>
                    {message !== null && (
                      <Callout tone="warning" role="alert" className="mt-4">
                        {message}
                      </Callout>
                    )}
                  </Card>
                  <Card className="relative overflow-hidden p-6">
                    {/*
                      The danger edge is a FILLED span, as AnnouncementCard's "For you"
                      edge: a `border-danger/*` colour renders as the neutral hairline
                      (index.css neutralises coloured borders by design). Decorative;
                      the title and the button say it in words.
                    */}
                    <span
                      aria-hidden="true"
                      className="absolute inset-y-0 left-0 w-0.5 bg-danger"
                    />
                    <SectionTitle>Delete account</SectionTitle>
                    <p className="text-[13px] text-ink-2">
                      Deleting your account removes your profile, semesters, subjects, results,
                      attendance, timetable and backlogs from GradTools&rsquo; servers. This cannot
                      be undone.
                    </p>
                    <p className="mt-2 text-[12px] text-ink-3">
                      The copy on this device is not deleted by this. Clear it separately if you
                      want it gone.
                    </p>
                    <Button
                      variant="destructive"
                      className="mt-4"
                      icon={<Trash2 />}
                      onClick={() => {
                        setDeleteError(null);
                        setConfirmingDelete(true);
                      }}
                    >
                      Delete my account
                    </Button>
                  </Card>
                </>
              ) : (
                <Card className="p-6">
                  <SectionTitle>Your data</SectionTitle>
                  <p className="text-[13px] text-ink-2">
                    Without an account, nothing leaves this device. Clearing your browser&rsquo;s
                    site data removes it. Sign in to export your records or keep a synced copy.
                  </p>
                </Card>
              )}
            </>
          )}

          {section === 'about' && (
            <Card className="p-6">
              <div className="flex items-center gap-3">
                <GradToolsLogo size={40} />
                <div>
                  <h2 className="text-[16px] font-semibold">GradTools</h2>
                  <div className="font-mono text-[11px] text-ink-3">
                    Academic OS · VTU 2022 scheme catalogue
                  </div>
                </div>
              </div>
              <p className="mt-4 max-w-xl text-[13px] leading-relaxed text-ink-2">
                A personal academic workspace: results, SGPA and CGPA, attendance, the timetable and
                the documents they come from, in one calm, local-first place. An independent student
                project, not affiliated with VTU.
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <Badge>Catalogue: 2022 scheme</Badge>
                <Badge>Local-first</Badge>
                <Badge>No account required</Badge>
              </div>
            </Card>
          )}
          {section === 'about' && <SupportNote />}
        </div>
      </div>

      <ConfirmDialog
        open={profileChoice !== null}
        onOpenChange={(open) => {
          if (!open) setProfileChoice(null);
        }}
        busy={resolving}
        pendingStatus="Saving your choice…"
        title={
          profileChoice === 'keep_mine'
            ? "Keep this device's profile?"
            : 'Use the profile from your account?'
        }
        description={
          profileChoice === 'keep_mine'
            ? 'Your account gets the profile on this device. The other version is replaced.'
            : "This device takes your account's profile. This device's version is replaced."
        }
        confirmLabel={profileChoice === 'keep_mine' ? 'Keep this device’s' : 'Use account version'}
        onConfirm={() => {
          if (profileChoice === null) return;
          setResolving(true);
          void sync.resolveProfileConflict(profileChoice).finally(() => {
            setResolving(false);
            setProfileChoice(null);
          });
        }}
      />

      <ConfirmDialog
        open={confirmingDelete}
        onOpenChange={(open) => {
          if (!open) setDeleteError(null);
          setConfirmingDelete(open);
        }}
        destructive
        busy={deleting}
        error={deleteError}
        pendingStatus="Deleting account…"
        title="Delete your account permanently?"
        description="Your synced records are removed from GradTools' servers. The copy on this device stays. This cannot be undone."
        confirmLabel="Delete my account permanently"
        onConfirm={() => {
          setDeleting(true);
          setDeleteError(null);
          void sync
            .deleteAccount()
            // A thrown request (offline) must not leave the dialog stuck busy.
            .catch(() => ({
              error: 'Could not reach GradTools to delete your account. Try again.',
            }))
            .then(async (result) => {
              // A failure stays in the dialog, open, so the person can retry or cancel.
              if (result.error !== null) {
                setDeleting(false);
                setDeleteError(result.error);
                return;
              }
              toast('Account deleted', { tone: 'neutral' });
              /*
               * Sign out BEFORE closing. Signing out removes the card that opened
               * this dialog; closing first returned focus to its button, which
               * then vanished and left focus on <body>. Closed after, the dialog
               * finds its trigger gone and focus falls back to <main>.
               */
              try {
                await signOut();
              } finally {
                setDeleting(false);
                setConfirmingDelete(false);
              }
            });
        }}
      />
    </div>
  );
}
