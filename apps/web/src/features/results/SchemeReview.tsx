/**
 * A Scheme of Teaching that was read, shown before it is kept.
 *
 * Authority: Phase 7C §6, §10, §13, §14, §33 · docs/08 §8.21
 *
 * ---------------------------------------------------------------------------
 * WHAT THE STUDENT IS ACTUALLY CONFIRMING
 * ---------------------------------------------------------------------------
 *
 * That these credits are the university's. Everything downstream depends on
 * that being true: a credit saved here is labelled "VTU catalogue" wherever it
 * appears, is trusted as the answer for its code on every screen, and enters a
 * credit-weighted SGPA. So the review shows the figure and the course it
 * belongs to, and nothing is editable — a scheme row a student could alter
 * would be a student figure wearing the catalogue's label, which is the exact
 * confusion §14 exists to prevent. A credit they want to state themselves is
 * stated on the result row, where it is labelled as theirs.
 *
 * The rows the reader REFUSED are shown too, with their reasons. An elective
 * option carries no credits of its own in this document; saying so is the
 * difference between "the scheme does not state this" and "GradTools missed
 * it", and only one of those is worth the student's attention.
 */

import { useState } from 'react';
import type { ParsedScheme } from '@gradtools/vtu-catalogue';
import type { SchemeCourse } from '../../domain/types.js';
import type { StudentProfileId } from '../../domain/identity.js';
import { Button, Notice } from '../../components/ui/index.js';
import { Alert } from '../../components/ui/Feedback.js';
import { useToast } from '../../components/ui/Toast.js';
import { newId, nowIso } from '../../lib/id.js';
import styles from './results.module.css';

export function SchemeReview({
  fileName,
  parsed,
  profileId,
  saved,
  onSave,
}: {
  readonly fileName: string;
  readonly parsed: ParsedScheme;
  readonly profileId: StudentProfileId;
  /** What is already stored, so a re-import replaces rather than duplicates. */
  readonly saved: readonly SchemeCourse[];
  readonly onSave: (courses: readonly SchemeCourse[]) => void | Promise<void>;
}) {
  const toast = useToast();
  /*
   * Four states rather than a boolean, for the reason the other review screens
   * carry one: a synchronous `done` announces a success the write has not had
   * a chance to fail at yet.
   */
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'failed'>('idle');
  const [saveError, setSaveError] = useState<string | null>(null);

  const savedCodes = new Set(saved.map((course) => course.code));
  const replacing = parsed.courses.filter((course) => savedCodes.has(course.code)).length;

  const confirm = async () => {
    /* Idempotent against a second press: the disable lands a render too late. */
    if (saveState === 'saving' || saveState === 'saved') return;
    setSaveState('saving');
    setSaveError(null);
    try {
      await onSave(
        parsed.courses.map((course) => ({
          id: newId(),
          profileId,
          schemeYear: parsed.schemeYear,
          programme: parsed.programme,
          semester: course.semester,
          code: course.code,
          title: course.title,
          credits: course.credits,
          sourcePage: course.page,
          updatedAt: nowIso(),
        })),
      );
      setSaveState('saved');
      toast({
        title: 'Data confirmed and recorded.',
        description: `${String(parsed.courses.length)} courses and their credits are saved on this device.`,
        tone: 'success',
      });
    } catch (cause) {
      setSaveState('failed');
      setSaveError(
        cause instanceof Error && cause.message !== ''
          ? `Your scheme could not be recorded: ${cause.message}`
          : 'Your scheme could not be recorded. Please try again.',
      );
    }
  };

  if (saveState === 'saved') {
    return (
      <section className={styles.importGroup} aria-label="Scheme recorded">
        <Alert tone="success" live title="Data confirmed and recorded.">
          {parsed.courses.length} courses and their credits are saved on this device. Result cards
          you import now resolve their credits from this scheme, so your SGPA and CGPA can be
          calculated.
        </Alert>
      </section>
    );
  }

  return (
    <section className={styles.importGroup}>
      <div className={styles.semesterHead}>
        <div className={styles.semesterIdentity}>
          <h3 className={styles.semesterTitle}>
            {parsed.programme === null
              ? 'Scheme of teaching'
              : `Scheme of teaching — ${parsed.programme}`}
          </h3>
          <span className={styles.semesterMeta}>
            {parsed.courses.length} courses
            {parsed.schemeYear === null ? '' : ` · ${parsed.schemeYear} scheme`}
            {parsed.semesters.length === 0
              ? ''
              : ` · semesters ${parsed.semesters.map((n) => String(n)).join(', ')}`}{' '}
            · from {fileName}
          </span>
        </div>
      </div>

      {parsed.courses.length === 0 && (
        <div className={styles.editorNotice}>
          <Notice tone="warning">
            No course table could be read from this document. A scheme states each semester as its
            own heading and prints the credits in the last column; if this file is a syllabus for
            one course rather than the scheme for a programme, it does not carry that table.
          </Notice>
        </div>
      )}

      {replacing > 0 && (
        <div className={styles.editorNotice}>
          {/*
            A re-imported scheme REPLACES what it covers. Keeping both would
            leave two credit figures for one code with nothing to choose
            between them, and a corrected scheme is the usual reason to import
            one twice.
          */}
          <Notice>
            {replacing} of these courses are already recorded from a scheme. Saving replaces those
            entries with the ones read here.
          </Notice>
        </div>
      )}

      {saveError !== null && (
        <div className={styles.editorNotice}>
          <Alert tone="danger" live title="Not recorded">
            {saveError}
          </Alert>
        </div>
      )}

      {parsed.courses.length > 0 && (
        <ul className={styles.schemeList}>
          {parsed.courses.map((course) => (
            <li className={styles.schemeRow} key={`${String(course.page)}-${course.code}`}>
              <span className={styles.schemeSemester}>S{course.semester}</span>
              <span className={styles.schemeCode}>{course.code}</span>
              <span className={styles.schemeTitle}>{course.title}</span>
              {/*
                Zero is printed as zero. A non-credit mandatory course really
                carries none, and rendering that as a blank would make it
                indistinguishable from a figure nobody has (§33).
              */}
              <span className={styles.schemeCredits}>
                {course.credits} {course.credits === 1 ? 'credit' : 'credits'}
              </span>
            </li>
          ))}
        </ul>
      )}

      {parsed.rejected.length > 0 && (
        <details className={styles.schemeRejected}>
          <summary>{parsed.rejected.length} rows the scheme states no credits for</summary>
          {/*
            NOT AN ERROR LIST. These are courses the document mentions without
            giving them a credit column — the elective options, whose credits
            belong to the slot they are chosen for. Saying so is what stops it
            reading as something GradTools failed at.
          */}
          <ul>
            {parsed.rejected.map((rejection) => (
              <li key={`${String(rejection.page)}-${rejection.code}`}>
                <strong>{rejection.code}</strong> — {rejection.reason}
              </li>
            ))}
          </ul>
        </details>
      )}

      <div className={styles.editorActions}>
        <Button
          variant="primary"
          onClick={() => void confirm()}
          disabled={parsed.courses.length === 0 || saveState === 'saving'}
        >
          {saveState === 'saving'
            ? 'Recording…'
            : saveState === 'failed'
              ? 'Try saving again'
              : 'Confirm and save these credits'}
        </Button>
      </div>
    </section>
  );
}
