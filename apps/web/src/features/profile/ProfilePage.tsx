/**
 * Academic profile.
 *
 * Authority: docs/03 UF-02, docs/11, docs/12, M3 continuation §8-§9.
 *
 * ---------------------------------------------------------------------------
 * WHAT IS AND IS NOT COLLECTED
 * ---------------------------------------------------------------------------
 * Everything here is OPTIONAL and stored on this device only. No network call
 * is made when saving a profile — a fact worth stating in the UI, because the
 * student has no way to verify it otherwise.
 *
 * There is NO date-of-birth field, and none may be added: DOB has no approved
 * product requirement (docs/32 DEC-008). Reintroducing it requires a new,
 * explicit product decision.
 *
 * USN is an academic identifier, not an identity key (domain/identity.ts).
 *
 * ---------------------------------------------------------------------------
 * FUTURE ONBOARDING ORDER
 * ---------------------------------------------------------------------------
 * When authentication arrives the order becomes:
 *     Welcome -> sign in -> identity established -> academic profile -> dashboard
 * NOT profile-then-auth. Collecting academic metadata before an identity
 * exists creates duplicate profiles and complicates recovery. Stage 1 sits at
 * the "try it without an account" branch of that flow, which is why the
 * profile is local and skippable.
 */

import { useEffect, useState } from 'react';
import { vtu2022RuleSet } from '@gradtools/academic-rules';
import { asStudentProfileId } from '../../domain/identity.js';
import type { StudentProfile } from '../../domain/types.js';
import { AsyncSection } from '../../components/AsyncSection.js';
import { PageHeader } from '../../components/AppShell.js';
import { MetaPill } from '../../components/ui/tone.js';
import { SectionedForm } from '../../components/ui/SectionedForm.js';
import { ThemeControl } from '../../components/ThemeControl.js';
import {
  Button,
  Notice,
  Panel,
  SelectField,
  TextField,
  monoClass,
  numericClass,
  TableScroll,
  tableClass,
} from '../../components/ui/index.js';
import { newId, nowIso } from '../../lib/id.js';
import { useProfile } from '../../hooks/useCollection.js';
import { useBranches, useSchemes, useSubjects } from '../../hooks/useReference.js';
import { isStorageAvailable } from '../../repositories/local/store.js';
import styles from './profile.module.css';

export function ProfilePage() {
  const { profile, loading, save } = useProfile();

  /*
   * Reference data comes from the server; the student's SELECTION stays local.
   * That split is the whole point of this milestone: the list of schemes is
   * public academic fact, the choice of one is personal data (M5a §20).
   */
  const schemes = useSchemes();
  const branches = useBranches();

  const [displayName, setDisplayName] = useState('');
  const [usn, setUsn] = useState('');
  const [collegeName, setCollegeName] = useState('');
  const [branch, setBranch] = useState('');
  const [semester, setSemester] = useState('3');
  const [saved, setSaved] = useState(false);
  const [storageOk, setStorageOk] = useState(true);

  useEffect(() => {
    void isStorageAvailable().then(setStorageOk);
  }, []);

  useEffect(() => {
    if (!profile) return;
    setDisplayName(profile.displayName ?? '');
    setUsn(profile.usn ?? '');
    setCollegeName(profile.collegeName ?? '');
    setBranch(profile.branch ?? '');
    setSemester(profile.currentSemester === null ? '' : String(profile.currentSemester));
  }, [profile]);

  const commit = () => {
    const next: StudentProfile = {
      id: profile?.id ?? asStudentProfileId(newId()),
      // Always null in Stage 1: no authentication is implemented.
      authUserId: null,
      displayName: displayName.trim() === '' ? null : displayName.trim(),
      usn: usn.trim() === '' ? null : usn.trim().toUpperCase(),
      collegeName: collegeName.trim() === '' ? null : collegeName.trim(),
      schemeId: vtu2022RuleSet.schemeId,
      branch: branch.trim() === '' ? null : branch.trim(),
      currentSemester: semester === '' ? null : Number(semester),
      createdAt: profile?.createdAt ?? nowIso(),
      updatedAt: nowIso(),
    };
    void save(next);
    setSaved(true);
  };

  if (loading) return <p>Loading…</p>;

  return (
    <>
      <PageHeader
        title="Profile"
        subtitle="Optional, and stored only in this browser. Every field can be left blank."
        /* Only what the student actually filled in. A blank profile shows no
           pills rather than a row of placeholders. */
        pills={
          <>
            {profile?.usn !== undefined && profile.usn !== null && profile.usn !== '' && (
              <MetaPill>{profile.usn}</MetaPill>
            )}
            {profile?.branch !== undefined && profile.branch !== null && profile.branch !== '' && (
              <MetaPill>{profile.branch}</MetaPill>
            )}
            {profile?.currentSemester !== undefined && profile.currentSemester !== null && (
              <MetaPill>Semester {String(profile.currentSemester)}</MetaPill>
            )}
          </>
        }
      />

      <div className={styles.stack}>
        {!storageOk && (
          <Notice tone="warning">
            Your browser is blocking storage, so nothing will be saved between visits. The
            calculators still work.
          </Notice>
        )}

        {/*
        -------------------------------------------------------------------
        M9.6G: PROFILE IS FOUR CONCERNS, NOT ONE LONG FORM
        -------------------------------------------------------------------

        M9.6F only de-emphasised the USN, which was a field change and not a
        composition. The page was still one "Academic profile" panel holding
        name, USN, college, branch, semester and scheme in a single grid, with
        two explanatory panels stacked under it.

        Split along the lines a person actually thinks in — who I am, what I am
        studying, how it looks, where it lives — using the same SectionedForm
        the Account page uses, so the two settings surfaces are one pattern
        rather than two.

        Appearance is a real section here for the same reason it is on Account:
        the theme control existed only in a header popover, which is right for
        a quick switch and wrong as the only home for a preference.
      */}
        <SectionedForm
          label="Profile settings"
          sections={[
            /*
             * Academic leads, and that is a product decision rather than an
             * ordering accident: branch, scheme and semester drive every figure
             * GradTools computes, while name and USN are decorative and
             * optional. The first section should be the one that matters.
             */
            {
              id: 'academic',
              label: 'Academic',
              icon: 'degree',
              children: (
                <>
                  <div className={styles.grid}>
                    <TextField
                      label="College"
                      value={collegeName}
                      onChange={(event) => {
                        setCollegeName(event.target.value);
                        setSaved(false);
                      }}
                    />
                    <div className={styles.referenceField}>
                      <AsyncSection
                        state={branches.state}
                        retry={branches.retry}
                        label="branches"
                        isEmpty={(list) => list.length === 0}
                        empty={
                          <TextField
                            label="Branch"
                            hint="No branches available from the server; type yours instead."
                            placeholder="Computer Science"
                            value={branch}
                            onChange={(event) => {
                              setBranch(event.target.value);
                              setSaved(false);
                            }}
                          />
                        }
                      >
                        {(list) => (
                          <SelectField
                            label="Branch"
                            hint="From the GradTools reference data."
                            value={branch}
                            onChange={(event) => {
                              setBranch(event.target.value);
                              setSaved(false);
                            }}
                          >
                            <option value="">Not set</option>
                            {list.map((item) => (
                              <option key={item.id} value={item.name}>
                                {item.name}
                              </option>
                            ))}
                          </SelectField>
                        )}
                      </AsyncSection>
                    </div>
                    <SelectField
                      label="Current semester"
                      value={semester}
                      onChange={(event) => {
                        setSemester(event.target.value);
                        setSaved(false);
                      }}
                    >
                      <option value="">Not set</option>
                      {[1, 2, 3, 4, 5, 6, 7, 8].map((value) => (
                        <option key={value} value={value}>
                          Semester {value}
                        </option>
                      ))}
                    </SelectField>
                    <div className={styles.referenceField}>
                      <AsyncSection
                        state={schemes.state}
                        retry={schemes.retry}
                        label="schemes"
                        isEmpty={(list) => list.length === 0}
                      >
                        {(list) => (
                          <SelectField
                            label="Scheme"
                            hint="Only verified schemes are offered."
                            value={vtu2022RuleSet.schemeId}
                            disabled={list.length <= 1}
                          >
                            {list.map((item) => (
                              <option key={item.id} value={item.id}>
                                {item.name} ({item.regulationCode})
                              </option>
                            ))}
                          </SelectField>
                        )}
                      </AsyncSection>
                    </div>
                  </div>

                  <div className={styles.actions}>
                    <Button variant="primary" onClick={commit}>
                      Save profile
                    </Button>
                    {saved && (
                      <span className={styles.savedNote} role="status">
                        Saved on this device.
                      </span>
                    )}
                  </div>
                  <SubjectsPanel semester={semester === '' ? null : Number(semester)} />
                </>
              ),
            },
            {
              id: 'identity',
              label: 'You',
              icon: 'profile',
              children: (
                <>
                  <p className={styles.note}>
                    Everything on this page is optional and stored only in this browser. GradTools
                    never needs any of it to calculate anything.
                  </p>
                  <p className={styles.note}>
                    Your name is used only to greet you on the dashboard. The USN is only used to
                    label a result you export &mdash; leaving it blank costs nothing.
                  </p>

                  {/*
                    Name and USN live HERE, not under Academic. The rail said
                    "You" while the name field sat in the academic section,
                    which is the kind of incoherence a split like this exists
                    to remove rather than introduce.
                  */}
                  <div className={styles.grid}>
                    <TextField
                      label="Name"
                      hint="Only used to greet you."
                      value={displayName}
                      onChange={(event) => {
                        setDisplayName(event.target.value);
                        setSaved(false);
                      }}
                    />
                    {/*
                  -----------------------------------------------------------------
                  M9.6F: THE USN IS OPTIONAL AND SAYS SO ON ITS FACE
                  -----------------------------------------------------------------

                  It sat second in the form, styled identically to Name and College,
                  with a hint explaining what it is NOT. Presented that way it reads
                  as required — and a seat number is the single most identifying
                  thing a student could type into this app (docs/12 §12.16). §16 of
                  this milestone rules out requiring one.

                  So it moves below the fields that are actually used, is labelled
                  optional in its own label rather than in a hint, and the hint now
                  leads with the fact that leaving it blank costs nothing.
                */}
                    <TextField
                      label="USN (optional)"
                      hint="GradTools never needs it. Leave it blank and everything works the same; it is only used to label a result you export."
                      mono
                      placeholder="1XX22CS001"
                      value={usn}
                      onChange={(event) => {
                        setUsn(event.target.value);
                        setSaved(false);
                      }}
                    />
                  </div>
                </>
              ),
            },
            {
              id: 'appearance',
              label: 'Appearance',
              icon: 'sun',
              children: (
                <>
                  <p className={styles.note}>
                    Light, dark or whatever this device is set to, and the accent used for selected
                    items and highlights. Saved on this device only &mdash; never synced, and it can
                    never affect an academic figure.
                  </p>
                  <div className={styles.themeRow}>
                    <ThemeControl />
                  </div>
                </>
              ),
            },
            {
              id: 'data',
              label: 'Your data',
              icon: 'shield',
              children: (
                <>
                  <div className={styles.prose}>
                    <p>
                      Everything you enter (profile, attendance, results and timetable) is stored in
                      this browser. GradTools has no account system yet and sends none of it to a
                      server.
                    </p>
                    <p>
                      Clearing your browser data removes it. There is no sync between devices at
                      this stage.
                    </p>
                    <p className={styles.muted}>
                      GradTools does not collect your date of birth, phone number, or any login
                      details for a university system, and never asks for a university password.
                    </p>
                  </div>
                  <div className={styles.prose}>
                    <p>
                      This experimental version supports the <strong>VTU 2022 scheme (22OB)</strong>{' '}
                      for B.E./B.Tech at non-autonomous affiliated colleges.
                    </p>
                    <p className={styles.muted}>
                      Autonomous colleges set their own internal rules, so these figures may not
                      apply there. Other schemes are not supported yet.
                    </p>
                  </div>
                </>
              ),
            },
          ]}
        />
      </div>
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Subjects for the selected semester                                         */
/* -------------------------------------------------------------------------- */

/**
 * The first screen to read real reference data over HTTP.
 *
 * It is deliberately honest about incompleteness: GradTools has verified
 * semester-1 CSE subjects and nothing beyond that, so a student on semester 3
 * is told the data is missing rather than shown an empty table that looks like
 * a bug (M5a §16, §21).
 */
function SubjectsPanel({ semester }: { semester: number | null }) {
  const subjects = useSubjects('vtu-2022', 'cse', semester === null ? undefined : semester);

  return (
    <Panel title="Subjects in the reference data">
      <AsyncSection
        state={subjects.state}
        retry={subjects.retry}
        label="subjects"
        isEmpty={(list) => list.length === 0}
        empty={
          <div className={styles.prose}>
            <p>
              No verified subjects for
              {semester === null ? ' this selection' : ` semester ${String(semester)}`} yet.
            </p>
            <p className={styles.muted}>
              GradTools only publishes subject data it has verified against a VTU source document.
              Semester 1 for Computer Science is verified; the remaining semesters are not yet, so
              they are absent rather than guessed.
            </p>
          </div>
        }
      >
        {(list) => (
          <>
            <TableScroll>
              <table className={tableClass}>
                <caption className="visually-hidden">
                  Verified subjects from the GradTools reference data
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Code</th>
                    <th scope="col">Title</th>
                    <th scope="col" className={numericClass}>
                      Credits
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {list.map((subject) => (
                    <tr key={subject.id}>
                      <td className={monoClass}>{subject.code}</td>
                      <td>{subject.title}</td>
                      <td className={numericClass}>{subject.credits}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableScroll>
            <p className={styles.provenance}>
              {list.length} verified {list.length === 1 ? 'subject' : 'subjects'} ·{' '}
              <a href={list[0]?.provenance.sourceUrl} target="_blank" rel="noreferrer noopener">
                View the source document
              </a>
            </p>
          </>
        )}
      </AsyncSection>
    </Panel>
  );
}
