/**
 * The VTU panel, with an auth state and nothing else around it.
 *
 * Authority: Phase 7B.3.1 §118
 *
 * The panel is rendered on its own rather than through `NotificationsPage`,
 * because that page needs the repository, profile and reference providers and
 * none of them has anything to do with what is being asserted here.
 */

import { FromVtu } from '../../src/features/announcements/NotificationsPage.js';
import { AuthContextValueProvider } from './auth-harness.js';

export function FromVtuPanelForTest({ signedIn }: { readonly signedIn: boolean }) {
  return (
    <AuthContextValueProvider signedIn={signedIn}>
      <FromVtu />
    </AuthContextValueProvider>
  );
}
