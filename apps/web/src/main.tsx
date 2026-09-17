import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App.js';
import { AuthProvider } from './features/auth/AuthContext.js';
import { ThemeProvider } from './hooks/useTheme.js';
import { mirrorAriaHiddenAsInert } from './lib/inert-hidden.js';
import './styles/index.css';

const container = document.getElementById('root');
if (!container) throw new Error('Root element #root is missing from index.html');

mirrorAriaHiddenAsInert();

createRoot(container).render(
  <StrictMode>
    <ThemeProvider>
      <BrowserRouter>
        {/* AuthProvider supplies the repository bundle: which account is signed in decides which storage scope the app reads. */}
        <AuthProvider>
          <App />
        </AuthProvider>
      </BrowserRouter>
    </ThemeProvider>
  </StrictMode>,
);
