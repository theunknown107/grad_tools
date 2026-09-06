/**
 * Toasts — a short confirmation that something happened.
 *
 * Authority: Phase 7B §2, §12 · docs/27 §27.9
 * Provenance: behaviourally faithful shadcn/Radix implementation adapted to the
 * GradTools styling architecture. The behaviour is `@radix-ui/react-toast`.
 *
 * shadcn's CURRENT registry ships Sonner rather than Radix Toast, and that is a
 * deliberate departure here. Sonner's appearance is not separable from it — it
 * injects its own stylesheet and owns its own DOM — so adopting it would put a
 * second visual system into the product, which Phase 7B §14 forbids. Radix
 * Toast is the same primitive shadcn shipped before Sonner, it is still
 * published, and its whole surface is `className`, which is what makes a
 * GradTools-styled toast possible at all.
 *
 * ---------------------------------------------------------------------------
 * WHAT A TOAST MAY AND MAY NOT CARRY
 * ---------------------------------------------------------------------------
 *
 * A toast disappears. So it may only ever CONFIRM something the person just
 * did — "Semester 3 saved", "Marked as attended" — and it may carry an undo for
 * that same action, because undo is only useful while the action is fresh.
 *
 * It may never carry:
 *
 *   - a value the student needs (it will be gone before they can copy it),
 *   - an error that requires a decision (that is an Alert, which stays),
 *   - anything that is the only record of what happened.
 *
 * ---------------------------------------------------------------------------
 * THE LIVE REGION EXISTS BEFORE THE MESSAGE DOES
 * ---------------------------------------------------------------------------
 *
 * `Toast.Viewport` is mounted by the provider on first render, empty. That is
 * not incidental: a live region inserted into the DOM at the same moment as its
 * content is not announced by most screen readers — the region has to be there,
 * and empty, for the insertion to count as a change. This is the single most
 * common way a toast implementation ends up silent for exactly the people who
 * most need it.
 *
 * Radix also gives the viewport an F8 hotkey, so a keyboard user can reach a
 * toast's action without hunting for it before it times out, and it pauses the
 * timer while a toast is hovered or focused.
 */

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import * as ToastPrimitive from '@radix-ui/react-toast';
import { Icon } from '../icons.js';
import styles from './Toast.module.css';

export interface ToastOptions {
  readonly title: string;
  readonly description?: string | undefined;
  readonly tone?: 'default' | 'success' | 'danger';
  /** One action, and it is nearly always Undo. */
  readonly action?: { readonly label: string; readonly onAction: () => void } | undefined;
}

interface LiveToast extends ToastOptions {
  readonly id: number;
}

const ToastContext = createContext<((options: ToastOptions) => void) | null>(null);

/**
 * Announces things. Mounted once, in the shell.
 *
 * Errors rather than no-oping when used outside the provider: a `toast()` that
 * silently does nothing is indistinguishable from one that worked, and the
 * whole point of the component is to tell somebody something happened.
 */
export function useToast(): (options: ToastOptions) => void {
  const push = useContext(ToastContext);
  if (push === null) {
    throw new Error('useToast must be used inside <ToastProvider>');
  }
  return push;
}

export function ToastProvider({ children }: { readonly children: ReactNode }): ReactNode {
  const [toasts, setToasts] = useState<readonly LiveToast[]>([]);

  const push = useCallback((options: ToastOptions) => {
    /*
     * `Date.now()` would collide for two toasts pushed in the same
     * millisecond — two attendance marks from one tap-and-undo — and React
     * would then reuse one component for both, leaving the second one's timer
     * attached to the first one's text.
     */
    setToasts((current) => [
      ...current,
      { ...options, id: (current[current.length - 1]?.id ?? 0) + 1 },
    ]);
  }, []);

  const value = useMemo(() => push, [push]);

  return (
    <ToastContext.Provider value={value}>
      <ToastPrimitive.Provider swipeDirection="right" duration={5000}>
        {children}

        {toasts.map((toast) => (
          <ToastPrimitive.Root
            key={toast.id}
            className={styles.toast}
            data-tone={toast.tone ?? 'default'}
            onOpenChange={(open) => {
              /* Radix owns the timer and the swipe; this only drops the record
                 once the exit animation has finished. */
              if (!open) setToasts((current) => current.filter((entry) => entry.id !== toast.id));
            }}
          >
            <div className={styles.body}>
              <ToastPrimitive.Title className={styles.title}>{toast.title}</ToastPrimitive.Title>
              {toast.description !== undefined && (
                <ToastPrimitive.Description className={styles.description}>
                  {toast.description}
                </ToastPrimitive.Description>
              )}
            </div>

            {toast.action !== undefined && (
              <ToastPrimitive.Action
                className={styles.action}
                /*
                 * `altText` is what a screen reader is told INSTEAD of the
                 * button, for users who cannot reach a toast before it leaves.
                 * Radix requires it, and it should describe the alternative
                 * route — not repeat the button's own label.
                 */
                altText={`${toast.action.label} — also available from the list`}
                onClick={toast.action.onAction}
              >
                {toast.action.label}
              </ToastPrimitive.Action>
            )}

            <ToastPrimitive.Close className={styles.close} aria-label="Dismiss">
              <Icon name="close" size="small" />
            </ToastPrimitive.Close>
          </ToastPrimitive.Root>
        ))}

        <ToastPrimitive.Viewport className={styles.viewport} />
      </ToastPrimitive.Provider>
    </ToastContext.Provider>
  );
}
