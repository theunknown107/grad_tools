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

import { Link, useNavigate } from 'react-router-dom';
import { PageHeader } from '../../components/AppShell.js';
import { Icon } from '../../components/icons.js';
import { MetaPill } from '../../components/ui/tone.js';
import { DocumentImportPanel } from './DocumentImportPanel.js';
import styles from './import.module.css';

export function ImportPage() {
  const navigate = useNavigate();

  return (
    <>
      <PageHeader
        eyebrow="Import"
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
        {/*
          DONE GOES SOMEWHERE. On Results the panel sits inside a page, so
          closing it reveals what is behind; here the panel IS the page, and
          `onDone` was `() => undefined` — a button a student could press
          forever with nothing happening. A browser sweep flagged it as a dead
          control, and it was one.

          It goes to Results, which is where whatever they just imported now
          lives, and which is where the success alert already offers to take
          them.
        */}
        <DocumentImportPanel
          onDone={() => {
            navigate('/results');
          }}
        />

        {/*
          THE TRUST LINE, at the FOOT.
          
          It used to open the panel, above the drop surface. The approved design
          puts it last, and that is the better place for it: a reassurance read
          before anything has happened is read as boilerplate and skipped —
          including by the person who needed it. Here it answers the question a
          student actually has once they are holding a file.
        */}
        <ul className={styles.trust}>
          <li>
            <Icon name="lock" size="micro" />
            Your file is read on this device.
          </li>
          <li>
            <Icon name="shield" size="micro" />
            Only the information you confirm is saved.
          </li>
          <li>Supported: PDF, PNG, JPG &middot; up to 20&nbsp;MB</li>
        </ul>

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
