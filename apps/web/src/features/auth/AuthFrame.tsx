/**
 * The card Sign in and Create account share: GradTools' name, a switch between
 * the two, the heading, then the form. Google first, email second, the Terms
 * line last.
 */

import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { GradToolsLogo } from '../../brand/GradToolsLogo.js';
import { Button } from '../../components/ui/button.js';
import { Card } from '../../components/ui/card.js';
import { cn } from '../../lib/cn.js';

type Tab = 'sign-in' | 'sign-up';
const TABS: readonly { readonly key: Tab; readonly to: string; readonly label: string }[] = [
  { key: 'sign-in', to: '/sign-in', label: 'Sign in' },
  { key: 'sign-up', to: '/sign-up', label: 'Create account' },
];

export function AuthFrame({
  title,
  lead,
  tab,
  children,
}: {
  readonly title: string;
  readonly lead: string;
  /** Omit to hide the switch (a build without accounts). */
  readonly tab?: Tab;
  readonly children: ReactNode;
}) {
  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-4 py-4">
      <Card className="p-6 sm:p-8">
        <div className="flex items-center gap-2.5">
          <GradToolsLogo size={32} />
          <span className="font-display text-[15px] font-semibold tracking-[-0.01em]">
            GradTools
          </span>
        </div>
        {tab !== undefined && (
          <nav
            aria-label="Account"
            className="gt-inset mt-6 grid grid-cols-2 gap-1 rounded-xl border border-line p-1"
          >
            {TABS.map((item) => (
              <Link
                key={item.key}
                to={item.to}
                aria-current={item.key === tab ? 'page' : undefined}
                className={cn(
                  'flex min-h-9 items-center justify-center rounded-lg text-[13px] font-medium transition-[color,background,box-shadow] duration-150',
                  item.key === tab
                    ? 'bg-[var(--glass-control-hover)] text-ink shadow-e1'
                    : 'text-ink-2 hover:text-ink',
                )}
              >
                {item.label}
              </Link>
            ))}
          </nav>
        )}
        <h1 className="mt-6 font-display text-[24px] leading-tight font-semibold tracking-[-0.02em]">
          {title}
        </h1>
        <p className="mt-1.5 text-sm text-ink-2">{lead}</p>
        <div className="mt-6">{children}</div>
      </Card>
      <p className="px-2 text-center text-[12px] text-ink-3">
        By continuing you agree to the{' '}
        <Link to="/terms" className="font-medium text-ink-2 underline-offset-4 hover:underline">
          GradTools Terms
        </Link>
        .
      </p>
    </div>
  );
}

/** The provider button, with Google's own mark (Iconify `logos:google-icon`). */
export function GoogleButton({
  children,
  busy,
  onClick,
}: {
  readonly children: ReactNode;
  readonly busy: boolean;
  readonly onClick: () => void;
}) {
  return (
    <Button
      size="lg"
      className="w-full"
      loading={busy}
      onClick={onClick}
      icon={
        <svg viewBox="0 0 256 262" aria-hidden="true" className="size-[18px]">
          <path
            fill="#4285f4"
            d="M255.878 133.451c0-10.734-.871-18.567-2.756-26.69H130.55v48.448h71.947c-1.45 12.04-9.283 30.172-26.69 42.356l-.244 1.622l38.755 30.023l2.685.268c24.659-22.774 38.875-56.282 38.875-96.027"
          />
          <path
            fill="#34a853"
            d="M130.55 261.1c35.248 0 64.839-11.605 86.453-31.622l-41.196-31.913c-11.024 7.688-25.82 13.055-45.257 13.055c-34.523 0-63.824-22.773-74.269-54.25l-1.531.13l-40.298 31.187l-.527 1.465C35.393 231.798 79.49 261.1 130.55 261.1"
          />
          <path
            fill="#fbbc05"
            d="M56.281 156.37c-2.756-8.123-4.351-16.827-4.351-25.82c0-8.994 1.595-17.697 4.206-25.82l-.073-1.73L15.26 71.312l-1.335.635C5.077 89.644 0 109.517 0 130.55s5.077 40.905 13.925 58.602z"
          />
          <path
            fill="#eb4335"
            d="M130.55 50.479c24.514 0 41.05 10.589 50.479 19.438l36.844-35.974C195.245 12.91 165.798 0 130.55 0C79.49 0 35.393 29.301 13.925 71.947l42.211 32.783c10.59-31.477 39.891-54.251 74.414-54.251"
          />
        </svg>
      }
    >
      {children}
    </Button>
  );
}

/** Between the provider button and the email form. */
export function EmailDivider() {
  return (
    <div className="my-5 flex items-center gap-3 text-[12px] text-ink-3" aria-hidden="true">
      <span className="h-px flex-1 bg-line" /> or with email{' '}
      <span className="h-px flex-1 bg-line" />
    </div>
  );
}

/** Shown on the app while Google runs in the browser tab. */
export function BrowserWaitNote() {
  return (
    <p role="status" className="mt-3 text-[12px] text-ink-2">
      Continue with Google in the browser. If the browser stays open afterwards, close it: GradTools
      finishes signing you in when you are back.
    </p>
  );
}
