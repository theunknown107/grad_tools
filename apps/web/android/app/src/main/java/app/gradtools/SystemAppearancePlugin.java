package app.gradtools;

import android.content.res.Configuration;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Tells the web app whether Android is in dark mode, now and whenever it
 * changes while the app runs.
 *
 * The WebView's `prefers-color-scheme` cannot be trusted for this: on the
 * Pixel 10a / Android 17 emulator it reported light with the system in dark
 * mode, live and after a cold start (device test 2026-11-05, defect 4). The
 * activity's own configuration is the authority, so the web layer asks here
 * and listens for "change" (lib/system-appearance.ts). The manifest keeps
 * `uiMode` in configChanges, so a theme switch arrives as a configuration
 * change instead of recreating the activity and reloading the page.
 */
@CapacitorPlugin(name = "SystemAppearance")
public class SystemAppearancePlugin extends Plugin {

    private Boolean lastDark = null;

    private boolean isDark(Configuration configuration) {
        return (configuration.uiMode & Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES;
    }

    @PluginMethod
    public void get(PluginCall call) {
        JSObject result = new JSObject();
        result.put("dark", isDark(getContext().getResources().getConfiguration()));
        call.resolve(result);
    }

    @Override
    protected void handleOnConfigurationChanged(Configuration newConfig) {
        super.handleOnConfigurationChanged(newConfig);
        boolean dark = isDark(newConfig);
        if (lastDark != null && lastDark == dark) return;
        lastDark = dark;
        JSObject data = new JSObject();
        data.put("dark", dark);
        notifyListeners("change", data);
    }
}
