/**
 * A tap you can feel — the light, confirming buzz social apps give a selection
 * or a successful action.
 *
 * Native `navigator.vibrate`, not a dependency: it is the one piece of the
 * platform that reaches the phone's vibrator, works inside the Android WebView
 * the app ships as, and is a no-op in a browser that has no motor. Every call
 * is guarded — the API is absent on desktop and throws under some privacy
 * settings.
 *
 * Haptics are deliberately NOT tied to the reduced-motion preference: a buzz is
 * touch feedback, not on-screen motion, and the two are separate accessibility
 * concerns. A student who stills the animations has not asked the phone to stop
 * confirming their taps. (The OS-level "vibration off" setting already silences
 * `navigator.vibrate` at the platform, which is the right place for it.)
 */
function buzz(pattern: number | readonly number[]): void {
  if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return;
  try {
    navigator.vibrate(pattern as number | number[]);
  } catch {
    /* A vibrator that refuses is not an error worth surfacing. */
  }
}

/** A single light tick — a selection, a toggle, a row chosen. */
export function tapHaptic(): void {
  buzz(10);
}

/** A two-beat confirm — something was saved or completed. */
export function successHaptic(): void {
  buzz([14, 40, 24]);
}
