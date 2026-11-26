/**
 * AUTH DIAGNOSTIC — DIAGNOSTIC BUILDS ONLY.
 *
 * Reachable at `/diagnostics` only when a build sets `VITE_DIAGNOSTICS=1`
 * (App.tsx registers the route behind that flag; normal builds tree-shake this
 * file out entirely). It exists to tell apart the suspected causes of a sign-in
 * or session-restoration failure WITHOUT touching the auth lifecycle: it only
 * reads already-provided state (`useAuth`, `window.Clerk`) and runs read-only
 * GET probes the student triggers by hand.
 *
 * It never renders a secret key, a full publishable key, a token, a cookie or a
 * header, never writes a token to storage, and never triggers a write or a sync.
 */

import { useCallback, useEffect, useState } from 'react';
import { STUDENT_ROUTES } from '@gradtools/shared-types';
import { Card, CardHeader } from '../../components/ui/card.js';
import { Badge, type Tone } from '../../components/ui/badge.js';
import { Button } from '../../components/ui/button.js';
import { Callout } from '../../components/ui/feedback.js';
import { deliberateSignOutAt, signOutPending, useAuth } from '../auth/AuthContext.js';
import { clerkPublishableKey } from '../../repositories/cloud/clerk.js';
import { apiBaseUrl, apiConfigured } from '../../repositories/reference.js';
import { authorizedFetch } from '../../lib/api.js';
import {
  analyzeApiUrl,
  classifyPublishableKey,
  PROBE_LABEL,
  PROBE_TIMEOUT_MS,
  restoreVerdict,
  runProbe,
  type ProbeResult,
} from './diagnostics.js';

/** Only a status string + time — never a token or identity. */
const SNAPSHOT_KEY = 'gradtools:v1:diag-session';

interface Snapshot {
  readonly status: string;
  readonly at: string;
}

function readSnapshot(): Snapshot | null {
  try {
    const raw = localStorage.getItem(SNAPSHOT_KEY);
    return raw === null ? null : (JSON.parse(raw) as Snapshot);
  } catch {
    return null;
  }
}

function writeSnapshot(status: string): void {
  try {
    localStorage.setItem(SNAPSHOT_KEY, JSON.stringify({ status, at: new Date().toISOString() }));
  } catch {
    /* Private mode / storage blocked: the before/after row just stays empty. */
  }
}

function Field({
  label,
  value,
  tone,
}: {
  readonly label: string;
  readonly value: string;
  readonly tone?: Tone;
}) {
  return (
    <div className="flex items-center justify-between gap-3 border-t border-line px-1 py-2 first:border-t-0">
      <span className="text-[13px] text-ink-2">{label}</span>
      {tone === undefined ? (
        <span className="font-mono text-[12px] text-ink">{value}</span>
      ) : (
        <Badge tone={tone} className="max-w-[65%] text-right break-all whitespace-normal">
          {value}
        </Badge>
      )}
    </div>
  );
}

const AUTH_TONE: Record<string, Tone> = {
  signed_in: 'success',
  signed_out: 'neutral',
  restoring: 'info',
  expired: 'warning',
};

export function DiagnosticsPage() {
  const { state, adapter } = useAuth();

  // --- Configuration (read once; these are build-time constants) ----------
  const key = classifyPublishableKey(clerkPublishableKey());
  const origin = window.location.origin;
  const api = analyzeApiUrl({
    effective: apiBaseUrl(),
    configuredRaw: import.meta.env.VITE_API_URL as string | undefined,
    origin,
  });
  const native =
    (
      window as { Capacitor?: { isNativePlatform?: () => boolean } }
    ).Capacitor?.isNativePlatform?.() === true;
  const clerk = (window as { Clerk?: { loaded?: boolean } }).Clerk;
  const providerConfigured = adapter !== null;

  // --- Session restoration: what we saw before this load vs. now ----------
  const [previous] = useState<Snapshot | null>(() => readSnapshot());
  useEffect(() => {
    // Record the settled state so the next load/restart has something to compare.
    if (state.status !== 'restoring') writeSnapshot(state.status);
  }, [state.status]);

  const verdict = restoreVerdict({
    previous: previous?.status ?? null,
    current: state.status,
    signedOutAt: deliberateSignOutAt(),
    signOutPending: signOutPending(),
  });

  // --- Read-only probes (hand-triggered) ----------------------------------
  const [conn, setConn] = useState<ProbeResult | null>(null);
  const [authed, setAuthed] = useState<ProbeResult | null>(null);
  const [busy, setBusy] = useState(false);

  const meUrl = `${apiBaseUrl()}${STUDENT_ROUTES.me}`;

  const probeConnectivity = useCallback(async () => {
    if (!apiConfigured()) return setConn({ kind: 'unconfigured' });
    setBusy(true);
    // Unauthenticated GET to a real route: a readable 401 proves the server is reachable.
    setConn(
      await runProbe(
        () =>
          fetch(meUrl, {
            headers: { Accept: 'application/json' },
            signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
          }),
        meUrl,
      ),
    );
    setBusy(false);
  }, [meUrl]);

  const probeAuthenticated = useCallback(async () => {
    if (!apiConfigured()) return setAuthed({ kind: 'unconfigured' });
    setBusy(true);
    // authorizedFetch resolves null when there is no session (no token to send).
    setAuthed(
      await runProbe(
        () =>
          authorizedFetch(adapter, STUDENT_ROUTES.me, {
            signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
          }),
        meUrl,
      ),
    );
    setBusy(false);
  }, [adapter, meUrl]);

  const keyTone: Tone = !key.present ? 'danger' : key.validFormat ? 'success' : 'warning';
  const apiTone: Tone =
    api.localhostFallback && native
      ? 'danger'
      : api.https || api.sameOrigin
        ? 'success'
        : 'warning';

  return (
    <div className="mx-auto w-full max-w-xl space-y-4 py-6">
      <Callout tone="warning" title="Auth diagnostic — diagnostic build only">
        This screen reads configuration and runs read-only checks. It changes nothing about how you
        sign in. It is excluded from normal release builds.
      </Callout>

      <Card>
        <CardHeader title="Clerk configuration" />
        <div className="px-4 pb-3">
          <Field
            label="Publishable key present"
            value={key.present ? 'yes' : 'no'}
            tone={key.present ? 'success' : 'danger'}
          />
          <Field
            label="Key format valid"
            value={key.present ? (key.validFormat ? 'valid' : 'invalid') : 'n/a'}
            tone={keyTone}
          />
          <Field
            label="Key category"
            value={key.category}
            tone={key.category === 'live' ? 'info' : key.category === 'test' ? 'accent' : 'neutral'}
          />
          <Field label="Key (masked)" value={key.masked} />
          <Field
            label="Provider configured"
            value={providerConfigured ? 'yes' : 'no (local-only)'}
            tone={providerConfigured ? 'success' : 'warning'}
          />
          <Field
            label="clerk-js mounted"
            value={clerk === undefined ? 'no' : 'yes'}
            tone={clerk === undefined ? 'warning' : 'success'}
          />
          <Field
            label="clerk-js loaded"
            value={clerk?.loaded === true ? 'yes' : clerk === undefined ? 'n/a' : 'loading'}
            tone={clerk?.loaded === true ? 'success' : 'warning'}
          />
        </div>
      </Card>

      <Card>
        <CardHeader title="API & origin" />
        <div className="px-4 pb-3">
          <Field label="App origin" value={origin} />
          <Field label="Native (Capacitor)" value={native ? 'yes' : 'no'} />
          <Field label="Effective API URL" value={api.effective} tone={apiTone} />
          <Field
            label="VITE_API_URL set"
            value={api.configured ? 'yes' : 'no'}
            tone={api.configured ? 'success' : native ? 'danger' : 'neutral'}
          />
          <Field
            label="HTTPS"
            value={api.https ? 'yes' : 'no'}
            tone={api.https ? 'success' : 'warning'}
          />
          <Field
            label="localhost fallback active"
            value={api.localhostFallback ? 'yes' : 'no'}
            tone={
              api.localhostFallback && native
                ? 'danger'
                : api.localhostFallback
                  ? 'warning'
                  : 'success'
            }
          />
        </div>
        {api.localhostFallback && native && (
          <div className="px-4 pb-3">
            <Callout tone="warning" title="Unreachable API on device">
              This build has no <code>VITE_API_URL</code>, so it targets{' '}
              <code>http://localhost:3001</code> — on a phone that is the phone itself. Set a
              reachable HTTPS API URL at build time.
            </Callout>
          </div>
        )}
      </Card>

      <Card>
        <CardHeader title="Authentication state" />
        <div className="px-4 pb-3">
          <Field
            label="Current state"
            value={state.status}
            tone={AUTH_TONE[state.status] ?? 'neutral'}
          />
          <Field
            label="Before this load"
            value={previous === null ? '— (first run)' : `${previous.status} @ ${previous.at}`}
          />
          <Field label="Restored across reload" value={verdict.value} tone={verdict.tone} />
        </div>
        <div className="flex flex-wrap gap-2 px-4 pb-4">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              writeSnapshot(state.status);
              window.location.reload();
            }}
          >
            Persist &amp; reload (test restore)
          </Button>
        </div>
      </Card>

      <Card>
        <CardHeader title="API probes (read-only)" />
        <div className="px-4 pb-3">
          <Field
            label="Connectivity (no auth)"
            value={conn === null ? 'not run' : PROBE_LABEL[conn.kind]}
            tone={
              conn === null
                ? 'neutral'
                : conn.kind === 'ok' || conn.kind === 'unauthorized' || conn.kind === 'forbidden'
                  ? 'success'
                  : conn.kind === 'cors'
                    ? 'warning'
                    : 'danger'
            }
          />
          <Field
            label="Authenticated GET /me"
            value={authed === null ? 'not run' : PROBE_LABEL[authed.kind]}
            tone={
              authed === null
                ? 'neutral'
                : authed.kind === 'ok'
                  ? 'success'
                  : authed.kind === 'unauthorized' ||
                      authed.kind === 'forbidden' ||
                      authed.kind === 'cors'
                    ? 'warning'
                    : authed.kind === 'no-token'
                      ? 'neutral'
                      : 'danger'
            }
          />
          {(conn?.kind === 'cors' || authed?.kind === 'cors') && (
            <Callout
              tone="warning"
              title="The API answered, but refused this origin"
              className="mt-3"
            >
              The server is reachable, yet its CORS allowlist does not include <code>{origin}</code>
              , so the app cannot read any reply — including the sign-in check. The fix is on the
              server (its allowed web origins), not in the app.
            </Callout>
          )}
          {(conn?.kind === 'network' || authed?.kind === 'network') && (
            <Callout tone="warning" title="The browser could not read a reply" className="mt-3">
              A browser cannot tell a network or TLS failure from a CORS refusal. If the API answers
              from another device, check that its allowed web origins include <code>{origin}</code>.
            </Callout>
          )}
        </div>
        <div className="flex flex-wrap gap-2 px-4 pb-4">
          <Button
            variant="secondary"
            size="sm"
            disabled={busy}
            onClick={() => void probeConnectivity()}
          >
            Probe connectivity
          </Button>
          <Button
            variant="secondary"
            size="sm"
            disabled={busy}
            onClick={() => void probeAuthenticated()}
          >
            Probe authenticated /me
          </Button>
        </div>
      </Card>
    </div>
  );
}
