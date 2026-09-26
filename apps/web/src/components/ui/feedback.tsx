/**
 * Feedback — empty states, callouts, error panels, "Unavailable" values and
 * toasts, each in the design's form.
 */

import { AlertTriangle, CircleCheck, Info, OctagonAlert, RotateCcw, X } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { cn } from '../../lib/cn.js';
import { Button } from './button.js';
import { Tooltip } from './tooltip.js';

/* ------------------------------------------------------------ Empty state */

export function EmptyState({
  icon,
  title,
  description,
  actions,
  className,
  compact = false,
}: {
  readonly icon: ReactNode;
  readonly title: string;
  readonly description?: ReactNode;
  readonly actions?: ReactNode;
  readonly className?: string;
  /** Inside a card: no dashed frame, less padding. */
  readonly compact?: boolean;
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center text-center',
        compact
          ? 'px-5 py-8'
          : 'rounded-xl border border-dashed border-line-strong bg-panel px-6 py-14',
        className,
      )}
    >
      <div
        className={cn(
          'mb-4 grid place-items-center rounded-2xl bg-sunken text-ink-2',
          compact ? 'size-11 [&_svg]:size-5' : 'size-14 [&_svg]:size-6',
        )}
        aria-hidden="true"
      >
        {icon}
      </div>
      <h3 className="text-[15px] font-semibold text-ink">{title}</h3>
      {description !== undefined && (
        <p className="mt-1 max-w-sm text-[13px] text-ink-2">{description}</p>
      )}
      {actions !== undefined && (
        <div className="mt-5 flex flex-wrap items-center justify-center gap-2">{actions}</div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- Callout */

const calloutTone = {
  warning: {
    box: 'bg-warning-weak/40',
    icon: 'text-warning',
    Icon: AlertTriangle,
  },
  danger: { box: 'bg-danger-weak/40', icon: 'text-danger', Icon: OctagonAlert },
  success: { box: 'bg-success-weak/40', icon: 'text-success', Icon: CircleCheck },
  info: { box: 'border-line bg-panel', icon: 'text-ink-2', Icon: Info },
} as const;

/** The design's tinted inline notice ("Partial result. …"). */
export function Callout({
  tone = 'info',
  title,
  children,
  action,
  className,
  role,
}: {
  readonly tone?: keyof typeof calloutTone;
  readonly title?: ReactNode;
  readonly children?: ReactNode;
  readonly action?: ReactNode;
  readonly className?: string;
  readonly role?: 'status' | 'alert';
}) {
  const style = calloutTone[tone];
  const Icon = style.Icon;
  return (
    <div
      {...(role === undefined ? {} : { role })}
      className={cn('flex items-start gap-3 rounded-xl border p-4', style.box, className)}
    >
      <Icon aria-hidden="true" className={cn('mt-0.5 size-4.5 shrink-0', style.icon)} />
      <div className="min-w-0 flex-1 text-[13px] leading-relaxed text-ink-2">
        {title !== undefined && <span className="font-medium text-ink">{title} </span>}
        {children}
      </div>
      {action !== undefined && <div className="shrink-0">{action}</div>}
    </div>
  );
}

/** A failed load, with a way to try again. */
export function ErrorState({
  title = 'Something went wrong',
  message,
  onRetry,
  className,
}: {
  readonly title?: string;
  readonly message: ReactNode;
  readonly onRetry?: () => void;
  readonly className?: string;
}) {
  return (
    <div
      role="alert"
      className={cn(
        'flex flex-col items-center rounded-xl border border-line bg-raised px-6 py-12 text-center',
        className,
      )}
    >
      <span className="mb-4 grid size-14 place-items-center rounded-full bg-danger-weak text-danger">
        <AlertTriangle className="size-6" aria-hidden="true" />
      </span>
      <h3 className="text-[15px] font-semibold text-ink">{title}</h3>
      <p className="mt-1 max-w-md text-[13px] text-ink-2">{message}</p>
      {onRetry !== undefined && (
        <Button className="mt-5" icon={<RotateCcw />} onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}

/* ------------------------------------------------------------ Unavailable */

/**
 * The design's "Unavailable" value with a dashed underline and its reason in a
 * tooltip. Focusable, so the reason reaches a keyboard user too.
 */
export function Unavailable({
  reason,
  label = 'Unavailable',
  className,
}: {
  readonly reason?: string | null | undefined;
  readonly label?: string;
  readonly className?: string;
}) {
  if (reason === undefined || reason === null || reason === '') {
    return <span className={cn('text-[13px] text-ink-3', className)}>{label}</span>;
  }
  return (
    <Tooltip content={reason}>
      <span
        tabIndex={0}
        aria-label={`${label}: ${reason}`}
        className={cn(
          // A text-decoration, not a border: the global border-color rule would
          // paint a `border-ink-3` underline as the faint hairline.
          'cursor-help text-[13px] text-ink-3 underline decoration-ink-3 decoration-dashed underline-offset-4',
          className,
        )}
      >
        {label}
      </span>
    </Tooltip>
  );
}

/* ------------------------------------------------------------------ Toast */

export type ToastTone = 'neutral' | 'success' | 'warning' | 'danger' | 'accent';

export interface ToastAction {
  readonly label: string;
  readonly onClick: () => void;
}

interface ToastPayload {
  readonly id: number;
  readonly message: string;
  readonly description?: string | undefined;
  readonly tone: ToastTone;
  readonly action?: ToastAction | undefined;
}

const TOAST_EVENT = 'gt-toast';
let nextToastId = 1;

/**
 * Shows a transient confirmation. Decoupled from React context so any module
 * can call it; the one `<Toaster />` in the shell renders the stack.
 */
export function toast(
  message: string,
  options?: {
    readonly description?: string;
    readonly tone?: ToastTone;
    readonly action?: ToastAction;
  },
): void {
  window.dispatchEvent(
    new CustomEvent<ToastPayload>(TOAST_EVENT, {
      detail: {
        id: nextToastId++,
        message,
        description: options?.description,
        tone: options?.tone ?? 'neutral',
        action: options?.action,
      },
    }),
  );
}

const toastDot: Record<ToastTone, string> = {
  neutral: 'bg-ink-3',
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-danger',
  accent: 'bg-accent',
};

export function Toaster() {
  const [items, setItems] = useState<readonly ToastPayload[]>([]);
  useEffect(() => {
    const timers = new Set<ReturnType<typeof setTimeout>>();
    const onToast = (event: Event): void => {
      const item = (event as CustomEvent<ToastPayload>).detail;
      setItems((previous) => [...previous, item].slice(-4));
      const timer = setTimeout(
        () => {
          timers.delete(timer);
          setItems((previous) => previous.filter((entry) => entry.id !== item.id));
        },
        item.action === undefined ? 3600 : 6000,
      );
      timers.add(timer);
    };
    window.addEventListener(TOAST_EVENT, onToast);
    return () => {
      window.removeEventListener(TOAST_EVENT, onToast);
      timers.forEach(clearTimeout);
    };
  }, []);

  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed right-4 bottom-20 z-[90] flex flex-col items-end gap-2 max-sm:inset-x-4 max-sm:items-stretch lg:bottom-4"
    >
      {items.map((item) => (
        <div
          key={item.id}
          role="status"
          className="pointer-events-auto flex max-w-sm animate-toast-in items-start gap-2.5 rounded-xl border border-line bg-raised px-3.5 py-3 shadow-e3"
        >
          <span
            aria-hidden="true"
            className={cn('mt-1.5 size-2 shrink-0 rounded-full', toastDot[item.tone])}
          />
          <div className="min-w-0">
            <div className="text-[13px] font-medium text-ink">{item.message}</div>
            {item.description !== undefined && (
              <div className="mt-0.5 text-[12px] text-ink-2">{item.description}</div>
            )}
          </div>
          {item.action !== undefined && (
            <button
              type="button"
              onClick={() => {
                item.action?.onClick();
                setItems((previous) => previous.filter((entry) => entry.id !== item.id));
              }}
              className="ml-1 shrink-0 rounded-md px-2 py-1 text-[12px] font-semibold text-accent-ink transition-colors hover:bg-sunken"
            >
              {item.action.label}
            </button>
          )}
          <button
            type="button"
            aria-label="Dismiss"
            onClick={() => setItems((previous) => previous.filter((entry) => entry.id !== item.id))}
            className="-mt-0.5 -mr-1 ml-1 grid size-6 place-items-center rounded-md text-ink-3 transition-colors hover:bg-sunken hover:text-ink"
          >
            <X className="size-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
}
