/**
 * The app-wide error boundary (OBSERVABILITY-AND-SUPPORT-V1 §16).
 *
 * Catches a render crash and shows a calm screen with two actions — try again,
 * and report the problem — instead of a white page or a stack trace. It does
 * NOT auto-submit anything: reporting is a deliberate click, which is also why
 * it cannot start a report→fail→report loop. The report link carries only the
 * category and a safe `stage`; the error's message and stack never leave the
 * device.
 */

import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  readonly children: ReactNode;
}
interface State {
  readonly crashed: boolean;
}

export class ErrorBoundary extends Component<Props, State> {
  override state: State = { crashed: false };

  static getDerivedStateFromError(): State {
    return { crashed: true };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // Kept on the device only: the name helps the student's own retry decision;
    // the message and stack are never sent anywhere.
    // eslint-disable-next-line no-console
    console.error('GradTools render error', error.name, info.componentStack);
  }

  override render(): ReactNode {
    if (!this.state.crashed) return this.props.children;
    return (
      <div className="mx-auto flex min-h-[60dvh] max-w-md flex-col items-center justify-center gap-4 px-4 text-center">
        <h1 className="font-display text-[22px] font-semibold">Something went wrong.</h1>
        <p className="text-[14px] text-ink-2">
          This screen ran into a problem. Your data on this device is safe and unchanged.
        </p>
        <div className="flex flex-wrap justify-center gap-2">
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="rounded-lg bg-accent px-4 py-2 text-[14px] font-medium text-on-accent"
          >
            Try again
          </button>
          <a
            href="/account?section=support"
            className="rounded-lg border border-line px-4 py-2 text-[14px] font-medium text-ink hover:bg-sunken"
          >
            Report a problem
          </a>
        </div>
      </div>
    );
  }
}
