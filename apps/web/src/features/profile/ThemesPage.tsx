/** Themes — light or dark, the palette and the glass. Its own page under More. */

import { PageHeader } from '../../components/ui/page.js';
import { AppearanceSettings } from './AppearanceSettings.js';

export function ThemesPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Themes" />
      <AppearanceSettings />
    </div>
  );
}
