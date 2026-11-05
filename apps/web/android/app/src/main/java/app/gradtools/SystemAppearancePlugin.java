package app.gradtools;

import android.content.Context;
import android.content.SharedPreferences;
import android.content.res.Configuration;
import android.graphics.Color;
import android.webkit.WebView;
import androidx.webkit.ScriptHandler;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.Collections;
import org.json.JSONObject;

/**
 * Android's appearance, and the student's theme choice, for the web app.
 *
 * Three jobs (device tests 2026-11-05):
 *
 *  1. SYSTEM DARK. The WebView's `prefers-color-scheme` reported light with the
 *     system in dark mode, so the activity's own configuration is the
 *     authority: `get()` and the "change" event (a theme switch arrives as a
 *     configuration change — `uiMode` is in the manifest's configChanges).
 *
 *  2. FIRST FRAME. Before the page's first script runs, a document-start
 *     script sets `window.__GT_NATIVE__ = { systemDark, theme }`, so
 *     index.html's pre-paint script resolves System — and reads the saved
 *     theme — with no light frame first. The WebView's own background is set to
 *     the resolved canvas colour too, so nothing white shows before the page
 *     paints. Re-registered whenever either value changes, so a reload sees
 *     the current answer.
 *
 *  3. PERSISTENCE. The WebView writes localStorage to disk lazily: a theme
 *     chosen and then force-stopped within about a second came back old.
 *     `saveTheme` writes the same JSON to SharedPreferences with commit() —
 *     synchronously — and that copy is what the app starts from. Calls arrive
 *     in order over the bridge, so the last choice wins.
 */
@CapacitorPlugin(name = "SystemAppearance")
public class SystemAppearancePlugin extends Plugin {

    private static final String PREFS = "gradtools";
    private static final String THEME_KEY = "theme";
    /* Canvas colours from styles/index.css (light :root, dark .dark). */
    private static final int LIGHT_CANVAS = Color.parseColor("#f4f2ee");
    private static final int DARK_CANVAS = Color.parseColor("#070708");

    private Boolean lastDark = null;
    private ScriptHandler startScript = null;

    @Override
    public void load() {
        lastDark = isDark(getContext().getResources().getConfiguration());
        publishStartState();
    }

    private boolean isDark(Configuration configuration) {
        return (configuration.uiMode & Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES;
    }

    private SharedPreferences prefs() {
        return getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    private String savedTheme() {
        return prefs().getString(THEME_KEY, null);
    }

    /** Light or dark, as the app will resolve it: an explicit choice wins, else the system. */
    private boolean resolvesDark(String theme, boolean systemDark) {
        if (theme == null) return false; // the app's default is Light
        try {
            String appearance = new JSONObject(theme).optString("appearance", "light");
            if (appearance.equals("dark")) return true;
            if (appearance.equals("system")) return systemDark;
            return false;
        } catch (Exception e) {
            return false;
        }
    }

    /**
     * (Re)publish the first-frame state: the document-start script and the
     * WebView background. UI thread only — load() and configuration changes
     * already run there; saveTheme posts to it.
     */
    private void publishStartState() {
        WebView webView = getBridge().getWebView();
        if (webView == null) return;
        boolean systemDark = lastDark != null && lastDark;
        String theme = savedTheme();
        int canvas = resolvesDark(theme, systemDark) ? DARK_CANVAS : LIGHT_CANVAS;
        webView.setBackgroundColor(canvas);
        /* The window behind the WebView too: between the system splash and the
           page's first paint it showed the DayNight window colour, so an
           explicit Light on a dark phone flashed dark for a frame. */
        if (getActivity() != null) getActivity().getWindow().getDecorView().setBackgroundColor(canvas);

        if (!WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) return;
        if (startScript != null) {
            startScript.remove();
            startScript = null;
        }
        String script =
            "window.__GT_NATIVE__=Object.freeze({systemDark:" +
            systemDark +
            ",theme:" +
            (theme == null ? "null" : JSONObject.quote(theme)) +
            "});";
        startScript = WebViewCompat.addDocumentStartJavaScript(webView, script, Collections.singleton("https://localhost"));
    }

    @PluginMethod
    public void get(PluginCall call) {
        JSObject result = new JSObject();
        result.put("dark", isDark(getContext().getResources().getConfiguration()));
        call.resolve(result);
    }

    /** Saves the theme JSON synchronously. The value is the same object the web app keeps. */
    @PluginMethod
    public void saveTheme(PluginCall call) {
        String value = call.getString("value");
        if (value == null || value.length() > 2048) {
            call.reject("A theme value is required");
            return;
        }
        // Synchronous, on this (plugin) thread: on disk before the call returns.
        boolean written = prefs().edit().putString(THEME_KEY, value).commit();
        // WebView calls must run on the UI thread; plugin methods do not.
        getBridge().executeOnMainThread(this::publishStartState);
        if (written) call.resolve();
        else call.reject("Could not save the theme");
    }

    @Override
    protected void handleOnConfigurationChanged(Configuration newConfig) {
        super.handleOnConfigurationChanged(newConfig);
        boolean dark = isDark(newConfig);
        if (lastDark != null && lastDark == dark) return;
        lastDark = dark;
        publishStartState();
        JSObject data = new JSObject();
        data.put("dark", dark);
        notifyListeners("change", data);
    }
}
