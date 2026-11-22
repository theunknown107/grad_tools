/**
 * Where Google sign-in in the Android app lands, in the system browser.
 *
 * Clerk's server refuses the app's `gradtools://` link as an OAuth return
 * address, so the browser tab comes here first, an ordinary https page, and
 * this page hands the student back to the app. The app finishes the sign-in
 * itself; nothing on this page reads or carries a session.
 */

import { useEffect } from 'react';
import { GradToolsLogo } from '../../brand/GradToolsLogo.js';
import { Button } from '../../components/ui/button.js';
import { Card } from '../../components/ui/card.js';
import { NATIVE_AUTH_CALLBACK } from '../../repositories/cloud/clerk.js';

export function NativeReturnPage() {
  useEffect(() => {
    /* Opens the app at once; the button covers a browser that wants a tap. */
    window.location.href = NATIVE_AUTH_CALLBACK;
  }, []);

  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-4 py-4">
      <Card className="p-6 sm:p-8">
        <GradToolsLogo size={40} />
        <h1 className="mt-5 font-display text-[26px] leading-tight font-semibold">
          Back to the app
        </h1>
        <p className="mt-1.5 text-sm text-ink-2">
          Google sign-in is done here. GradTools finishes signing you in once you are back.
        </p>
        <Button asChild variant="primary" className="mt-6 w-full">
          <a href={NATIVE_AUTH_CALLBACK}>Return to GradTools</a>
        </Button>
      </Card>
    </div>
  );
}
