import { App as NativeApp } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App.js';
import { ErrorBoundary } from './components/ErrorBoundary.js';
import { LaunchSplash } from './components/layout/LaunchSplash.js';
import { AuthProvider } from './features/auth/AuthContext.js';
import { ClerkAuth } from './features/auth/ClerkAuth.js';
import { clerkPublishableKey } from './repositories/cloud/clerk.js';
import { ThemeProvider } from './hooks/useTheme.js';
import { mirrorAriaHiddenAsInert } from './lib/inert-hidden.js';
import './styles/index.css';

const container = document.getElementById('root');
if (!container) throw new Error('Root element #root is missing from index.html');

mirrorAriaHiddenAsInert();

/*
 * The fluid background comes back where it left off, not jumped ahead by the
 * time spent away. Leaving records where each fluid layer is; on the first
 * frame back each is re-anchored to that point. Measured on the Android WebView: a CSS play-state change or a
 * pause()/play() both still jumped, because a backgrounded WebView draws no
 * frame for them to apply on. The Android WebView never fires
 * `visibilitychange` when the app leaves the screen, so there the app
 * lifecycle says it instead.
 */
let heldFlow: Map<Animation, number> | null = null;
const fluidLayers = (): Animation[] =>
  typeof document.getAnimations !== 'function'
    ? []
    : document
        .getAnimations()
        .filter(
          (animation) =>
            'animationName' in animation && String(animation.animationName).startsWith('gt-flow'),
        );
const holdStill = (hidden: boolean): void => {
  if (hidden) {
    heldFlow = new Map(fluidLayers().map((layer) => [layer, Number(layer.currentTime)]));
    return;
  }
  const held = heldFlow;
  heldFlow = null;
  if (held === null) return;
  requestAnimationFrame(() => {
    /* The real clock: the document timeline can still read stale on this frame. */
    const now = performance.now();
    const live = fluidLayers();
    for (const [layer, time] of held)
      if (live.includes(layer) && layer.playState === 'running') layer.startTime = now - time;
  });
};
document.addEventListener('visibilitychange', () => holdStill(document.hidden));
if (Capacitor.isNativePlatform()) {
  void NativeApp.addListener('appStateChange', ({ isActive }) => holdStill(!isActive));
}

/* Set: Clerk is the identity provider. Unset: the legacy Supabase adapter, or local-only. */
const clerkKey = clerkPublishableKey();

createRoot(container).render(
  <StrictMode>
    <ThemeProvider>
      <BrowserRouter>
        {/* A render crash shows a calm screen with a "Report a problem" link, not a white page. */}
        <ErrorBoundary>
          {/* AuthProvider supplies the repository bundle: which account is signed in decides which storage scope the app reads. */}
          {clerkKey === null ? (
            <AuthProvider>
              <App />
            </AuthProvider>
          ) : (
            <ClerkAuth publishableKey={clerkKey}>
              <App />
            </ClerkAuth>
          )}
          {/* Android only; removes itself after ~800ms (LaunchSplash). */}
          <LaunchSplash />
        </ErrorBoundary>
      </BrowserRouter>
    </ThemeProvider>
  </StrictMode>,
);
