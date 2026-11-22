package app.gradtools;

import android.os.Build;
import android.os.Bundle;
import android.view.Display;
import android.view.WindowManager;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
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
