package app.gradtools;

import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.view.Display;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.WebView;
import androidx.core.view.WindowCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(SystemAppearancePlugin.class);
        super.onCreate(savedInstanceState);

        /*
         * Edge to edge, like any current app: the page draws under both system
         * bars, which are fully transparent. Android otherwise adds a contrast
         * scrim behind them — the dark band under the status bar and behind the
         * navigation buttons. The page keeps itself readable instead: it pads
         * by the safe-area insets and frosts the status-bar strip only once
         * content scrolls under it (styles/index.css "Status bar").
         */
        Window window = getWindow();
        WindowCompat.setDecorFitsSystemWindows(window, false);
        window.setStatusBarColor(Color.TRANSPARENT);
        window.setNavigationBarColor(Color.TRANSPARENT);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            window.setStatusBarContrastEnforced(false);
            window.setNavigationBarContrastEnforced(false);
        }

        /*
         * GradTools draws its own light and dark themes (Settings → Appearance).
         * Android must not recolour the page on top of that: with the system in
         * dark mode it force-darkened the light theme, leaving light controls on
         * a darkened canvas and dark text on dark (device test 2026-11-05).
         * Turn off both darkening paths — the framework's force dark on the view
         * and WebView's algorithmic darkening of the page.
         */
        WebView webView = getBridge().getWebView();
        if (webView != null) {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) webView.setForceDarkAllowed(false);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                webView.getSettings().setAlgorithmicDarkeningAllowed(false);
            }
        }

        preferSixtyHertz();
    }

    /**
     * Asks for the display's 60 Hz mode for this window only, so every frame the
     * app draws (fluid background, scrolling, transitions) has one steady 16.67 ms
     * budget on 90/120 Hz panels. A preference, not a system setting: Android
     * may still override it, and other apps are unaffected.
     */
    private void preferSixtyHertz() {
        Display display = Build.VERSION.SDK_INT >= Build.VERSION_CODES.R
            ? getDisplay()
            : getWindowManager().getDefaultDisplay();
        if (display == null) return;
        Display.Mode current = display.getMode();
        for (Display.Mode mode : display.getSupportedModes()) {
            if (
                mode.getPhysicalWidth() == current.getPhysicalWidth() &&
                mode.getPhysicalHeight() == current.getPhysicalHeight() &&
                Math.abs(mode.getRefreshRate() - 60f) < 1f
            ) {
                WindowManager.LayoutParams params = getWindow().getAttributes();
                params.preferredDisplayModeId = mode.getModeId();
                getWindow().setAttributes(params);
                return;
            }
        }
    }
}
