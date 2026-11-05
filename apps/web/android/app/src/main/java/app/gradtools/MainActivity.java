package app.gradtools;

import android.os.Build;
import android.os.Bundle;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(SystemAppearancePlugin.class);
        super.onCreate(savedInstanceState);

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
    }
}
