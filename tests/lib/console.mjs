/**
 * Telling a broken product apart from an absent API.
 *
 * Authority: docs/22 §22.68
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS SHARED RATHER THAN REPEATED
 * ---------------------------------------------------------------------------
 *
 * Every browser harness serves the built bundle and nothing else. The app asks
 * `localhost:3001` for reference data and announcements, no API is listening,
 * and the browser logs a refused connection. That is a fact about the harness,
 * not a defect in the product.
 *
 * Worse, it is a RACE: whether the refusal lands before the harness reads the
 * console decides whether the run passes. Three harnesses failed this way with
 * no code change between a green run and a red one, and two others had already
 * grown their own copy of the same regex — which is how the copies drift and
 * one of them quietly stops matching.
 *
 * So it lives here once. Anything this does NOT match still fails the run: the
 * point is to classify a known environmental message, never to swallow console
 * output in general.
 */

const API_DOWN = /Failed to fetch|ERR_CONNECTION|ERR_NETWORK_CHANGED|CORS/;

/** Whether a console line is the API being absent rather than the app failing. */
export function isApiDown(line) {
  return API_DOWN.test(String(line));
}

/**
 * Split captured console lines into real problems and counted noise.
 *
 * Returns `{ real, apiDown }` so a harness can fail on the first and report
 * the second, rather than choosing between a flake and a blind spot.
 */
export function splitConsole(lines) {
  const real = [];
  let apiDown = 0;
  for (const line of lines) {
    if (isApiDown(line)) apiDown += 1;
    else real.push(line);
  }
  return { real, apiDown };
}
