/**
 * Where a student hands GradTools the documents they already have.
 *
 * Authority: docs/08 §8.23 · M10A.9 §6, §7, §11, §15
 *
 * ---------------------------------------------------------------------------
 * AUTOMATIC INGESTION IS THE PRIMARY WORKFLOW
 * ---------------------------------------------------------------------------
 *
 * The importer existed before this page did, but only inside Results — so a
 * student with a semester calendar or a class timetable had no reason to go
 * looking for it, and no way to guess that Results was where it lived.
 *
 * This is the destination the product points at instead. The panel is the same
 * one Results renders; what this adds is somewhere to send people.
 *
 * Manual entry is not removed and is not hidden. It is offered here as the
 * thing to do when a document cannot be read (§15) — second, because typing a
 * semester by hand is the fallback, not the product.
 */

import { Link } from 'react-router-dom';
import { PageHeader } from '../../components/AppShell.js';
import { MetaPill } from '../../components/ui/tone.js';
import { DocumentImportPanel } from './DocumentImportPanel.js';
import styles from './import.module.css';

export function ImportPage() {
  return (
    <>
      <PageHeader
        title="Add academic document"
        subtitle="Drop a result card, an academic calendar or a class timetable. GradTools works out which is which."
        /*
         * The three documents this page accepts, stated as facts before the
         * file picker rather than as a sentence inside it. A student who
         * arrives holding a timetable can see it is welcome without reading.
         */
        pills={
          <>
            <MetaPill>Result card</MetaPill>
            <MetaPill>Academic calendar</MetaPill>
            <MetaPill>Class timetable</MetaPill>
          </>
        }
      />

      <div className={styles.stack}>
        {/*
          The panel carries the privacy statement already. Repeating it here
          would be the same sentence twice on one screen, which reads as
          boilerplate and gets skipped — including by the person who needed it.
        */}
        <DocumentImportPanel onDone={() => undefined} />

        {/*
          THE FALLBACK, AND VISIBLY SECOND. A document that cannot be read must
          never leave a student stuck, but typing a semester by hand is what you
          do when the import fails — not the way in (§15).
        */}
        <p className={styles.fallback}>
          Can&apos;t import a document? <Link to="/results">Enter a result by hand</Link>, or{' '}
          <Link to="/timetable">add your classes manually</Link>.
        </p>
      </div>
    </>
  );
}
