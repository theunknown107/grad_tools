/**
 * Terms & Conditions acceptance (TERMS-AND-ONBOARDING, Slice 2).
 *
 * Renders `CURRENT_TERMS` and gates continuation behind an explicit,
 * initially-unchecked consent box. On accept it POSTs the exact version it
 * displayed, then RE-READS `/me` to confirm the server recorded it, and only
 * then moves on. If the POST or the verification fails, it says so and stays
 * put — it never claims an acceptance it could not confirm.
 */

import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { CURRENT_TERMS, TERMS_ROUTES } from '@gradtools/shared-types';
import { GradToolsLogo } from '../../brand/GradToolsLogo.js';
import { Button } from '../../components/ui/button.js';
import { Card } from '../../components/ui/card.js';
import { Callout } from '../../components/ui/feedback.js';
import { Checkbox } from '../../components/ui/field.js';
import { PageSkeleton } from '../../components/ui/skeleton.js';
import { authorizedFetch } from '../../lib/api.js';
import { useAuth } from '../auth/AuthContext.js';

export function TermsPage() {
  const { adapter, state, signOut } = useAuth();
  const navigate = useNavigate();
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Acceptance requires a session. Without a provider there is nothing to
  // record against; while the session is still restoring we wait rather than
  // bounce; without a signed-in user, sign in first.
  if (adapter === null) return <Navigate to="/" replace />;
  if (state.status === 'restoring') return <PageSkeleton label="Loading" />;
  if (state.status !== 'signed_in') return <Navigate to="/sign-in" replace />;

  const accept = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const res = await authorizedFetch(adapter, TERMS_ROUTES.acceptance, {
        method: 'POST',
        body: JSON.stringify({ version: CURRENT_TERMS.version }),
      });
      if (res === null) {
        setError('Your session has ended. Please sign in again.');
        return;
      }
      if (!res.ok) {
        setError('We couldn’t record your acceptance. Please try again.');
        return;
      }
      // Verify the SERVER state rather than trusting the POST alone.
      const me = await authorizedFetch(adapter, '/api/v1/me');
      if (me === null || !me.ok) {
        setError('We couldn’t confirm your acceptance. Please try again.');
        return;
      }
      const body = (await me.json()) as { terms: { version: string } | null };
      if (body.terms === null || body.terms.version !== CURRENT_TERMS.version) {
        setError('We couldn’t confirm your acceptance. Please try again.');
        return;
      }
      navigate('/onboarding', { replace: true });
    } catch {
      setError('We couldn’t reach the server. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 py-4">
      <Card className="p-6 sm:p-8">
        <GradToolsLogo size={40} />
        <h1 className="mt-5 font-display text-[26px] leading-tight font-semibold tracking-[-0.02em]">
          {CURRENT_TERMS.title}
        </h1>
        <p className="mt-1.5 text-[12px] text-ink-3">
          Version {CURRENT_TERMS.version} · Effective {CURRENT_TERMS.effectiveDate}
        </p>
        <p className="mt-4 text-sm text-ink-2">{CURRENT_TERMS.intro}</p>

        <div
          tabIndex={0}
          aria-label="Terms and Conditions"
          className="scroll-quiet mt-6 max-h-[48vh] overflow-y-auto rounded-xl border border-line bg-raised p-5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
        >
          {CURRENT_TERMS.sections.map((section) => (
            <section key={section.n} className="mb-5 last:mb-0">
              <h2 className="text-[14px] font-semibold text-ink">
                {section.n}. {section.heading}
              </h2>
              {section.body.map((paragraph, i) => (
                <p key={i} className="mt-1.5 text-[13px] leading-relaxed text-ink-2">
                  {paragraph}
                </p>
              ))}
            </section>
          ))}
        </div>

        {error !== null && (
          <Callout tone="warning" role="alert" className="mt-5">
            {error}
          </Callout>
        )}

        <div className="mt-5 flex items-start gap-3">
          <Checkbox
            id="accept-terms"
            checked={agreed}
            onCheckedChange={setAgreed}
            label="I have read and agree to the Terms & Conditions"
            disabled={busy}
          />
          <label htmlFor="accept-terms" className="text-[13px] leading-relaxed text-ink-2">
            I have read and agree to the Terms &amp; Conditions.
          </label>
        </div>

        <div className="mt-6 flex flex-col gap-3 sm:flex-row-reverse">
          <Button
            variant="primary"
            className="w-full sm:w-auto"
            disabled={!agreed}
            loading={busy}
            onClick={() => void accept()}
          >
            {busy ? 'Recording…' : 'Accept & Continue'}
          </Button>
          <Button
            variant="ghost"
            className="w-full sm:w-auto"
            disabled={busy}
            onClick={() => void signOut()}
          >
            Sign out
          </Button>
        </div>
      </Card>
    </div>
  );
}
