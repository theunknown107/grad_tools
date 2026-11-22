/** Themes and appearance, as a section of its own (moved out of Account). */
import { PageHeader } from '../../components/ui/page.js';
import { AppearanceSettings } from './AppearanceSettings.js';

export function AppearancePage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Settings"
        title="Appearance"
        description="Theme, accent, surfaces and motion. Changes apply at once and stay on this device."
      />
      <AppearanceSettings />
    </div>
  );
}
