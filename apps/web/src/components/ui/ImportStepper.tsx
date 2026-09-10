/**
 * Where a document has got to, as the approved design draws it.
 *
 * Authority: Figma Make `pages/AddDocument.tsx` → Stepper
 *
 * ---------------------------------------------------------------------------
 * IT REPORTS THE PIPELINE; IT DOES NOT DRIVE IT
 * ---------------------------------------------------------------------------
 *
 * Every step here corresponds to a state the real importer already passes
 * through — a file being read, a picture being recognised, rows waiting to be
 * confirmed, a write completing. Nothing was invented to fill the row, and no
 * step can be reached except by the pipeline actually reaching it.
 *
 * That matters because a stepper is a promise: it tells a student how much is
 * left. One with a stage the code never enters, or one that skips ahead of the
 * work, is worse than no stepper at all.
 */

import { Icon } from '../icons.js';
import styles from './ImportStepper.module.css';

export const IMPORT_STEPS = ['Select', 'Validate', 'Parse', 'Review', 'Confirm'] as const;
export type ImportStep = (typeof IMPORT_STEPS)[number];

export function ImportStepper({ at }: { readonly at: ImportStep }) {
  const current = IMPORT_STEPS.indexOf(at);
  return (
    /*
     * FOCUSABLE, because it SCROLLS. Below about 430px the five steps do not
     * fit and the row scrolls sideways; a scrollable region that cannot be
     * focused is one a keyboard user can never reach the end of. axe caught
     * this at 390px, and `tabIndex` plus the label it already had is the
     * whole fix.
     */
    <ol className={styles.steps} aria-label="Import progress" tabIndex={0}>
      {IMPORT_STEPS.map((step, index) => {
        const done = index < current;
        const active = index === current;
        return (
          <li key={step} className={styles.item}>
            <span
              className={styles.step}
              data-state={done ? 'done' : active ? 'active' : 'todo'}
              /*
               * The step a student is ON is announced; the others are read as
               * ordinary list items. `aria-current="step"` is the one thing a
               * screen reader needs from this that the text does not already
               * say.
               */
              aria-current={active ? 'step' : undefined}
            >
              <span className={styles.marker} aria-hidden="true">
                {done ? <Icon name="check" size="micro" /> : index + 1}
              </span>
              {step}
            </span>
            {index < IMPORT_STEPS.length - 1 && (
              <span className={styles.link} data-done={done} aria-hidden="true" />
            )}
          </li>
        );
      })}
    </ol>
  );
}
