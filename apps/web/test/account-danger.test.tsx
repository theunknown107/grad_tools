/**
 * The "Delete account" card must look dangerous in a way that actually renders.
 *
 * index.css carries a deliberate unlayered `border-color: var(--border)` rule
 * that beats every Tailwind border-colour utility, so `border-danger/*` renders
 * as the neutral hairline. The danger state is carried by a filled edge span.
 *
 * jsdom has no cascade, so these are class/structure assertions: they pin the
 * pattern that survives the global rule (a filled `bg-danger` span) and forbid
 * the one that does not (a border-colour class).
 */
import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { screen } from '@testing-library/dom';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AuthProvider } from '../src/features/auth/AuthContext.js';
import { ThemeProvider } from '../src/hooks/useTheme.js';
import { TooltipProvider } from '../src/components/ui/tooltip.js';
import { AccountPage } from '../src/features/auth/AccountPage.js';
import type { AuthAdapter } from '../src/repositories/cloud/supabase.js';
import type { Identity } from '../src/domain/auth.js';

const identity: Identity = { userId: 'user-a', email: 'a@example.test', provider: 'google' };

/** A signed-in stand-in provider; nothing here is exercised beyond rendering. */
const adapter: AuthAdapter = {
  current: async () => identity,
  accessToken: async () => 'synthetic-token',
  signInWithPassword: async () => ({ error: null }),
  signUpWithPassword: async () => ({ error: null, needsConfirmation: true }),
  signInWithProvider: async () => ({ error: null }),
  sendRecovery: async () => ({ error: null }),
  signOut: async () => {},
  onChange: () => () => {},
};

afterEach(cleanup);

async function dangerCard() {
  render(
    <MemoryRouter initialEntries={['/account?section=data']}>
      <ThemeProvider>
        <TooltipProvider>
          <AuthProvider adapter={adapter}>
            <Routes>
              <Route path="*" element={<AccountPage />} />
            </Routes>
          </AuthProvider>
        </TooltipProvider>
      </ThemeProvider>
    </MemoryRouter>,
  );
  const button = await screen.findByRole('button', { name: 'Delete my account' });
  const card = button.parentElement;
  if (card === null) throw new Error('the delete button has no card');
  return { button, card };
}

describe('the Delete account card', () => {
  it('draws its danger state with a filled edge, not a border colour', async () => {
    const { card } = await dangerCard();

    const edge = card.querySelector(':scope > span.bg-danger');
    expect(edge).not.toBeNull();
    expect(edge?.className).toMatch(/\babsolute\b/);
    expect(card.className).toMatch(/\brelative\b/);
    expect(card.className).toMatch(/\boverflow-hidden\b/);
    // A border colour is inert under the global rule; it must not be the signal.
    expect(card.className).not.toMatch(/\bborder-danger/);
  });

  it('keeps the edge out of the accessibility tree', async () => {
    const { card } = await dangerCard();
    const edge = card.querySelector(':scope > span.bg-danger');
    expect(edge?.getAttribute('aria-hidden')).toBe('true');
    expect(edge?.textContent).toBe('');
  });

  it('keeps the destructive button and its name', async () => {
    const { button } = await dangerCard();
    expect(button.textContent).toBe('Delete my account');
    expect(button.className).toMatch(/\bbg-danger\b/);
  });
});
