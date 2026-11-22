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
