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
import { PageHeader } from '../../components/AppShell.js';
import { Button, Notice, Panel, SelectField, TextField } from '../../components/ui/index.js';
import { newId, nowIso } from '../../lib/id.js';
import { useProfile } from '../../hooks/useCollection.js';
import { isStorageAvailable } from '../../repositories/local/store.js';
import styles from './profile.module.css';

export function ProfilePage() {
  const { profile, loading, save } = useProfile();

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
      />

      <div className={styles.stack}>
        {!storageOk && (
          <Notice tone="warning">
            Your browser is blocking storage, so nothing will be saved between visits. The
            calculators still work.
          </Notice>
        )}

        <Panel title="Academic profile">
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
            <TextField
              label="USN"
              hint="Used to label your saved results. An academic identifier, not a login."
              mono
              placeholder="1XX22CS001"
              value={usn}
              onChange={(event) => {
                setUsn(event.target.value);
                setSaved(false);
              }}
            />
            <TextField
              label="College"
              value={collegeName}
              onChange={(event) => {
                setCollegeName(event.target.value);
                setSaved(false);
              }}
            />
            <TextField
              label="Branch"
              placeholder="Computer Science"
              value={branch}
              onChange={(event) => {
                setBranch(event.target.value);
                setSaved(false);
              }}
            />
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
            <SelectField label="Scheme" value={vtu2022RuleSet.schemeId} disabled>
              <option value={vtu2022RuleSet.schemeId}>VTU 2022 (22OB)</option>
            </SelectField>
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
        </Panel>

        <Panel title="Where your data lives">
          <div className={styles.prose}>
            <p>
              Everything you enter (profile, attendance, results and timetable) is stored in this
              browser. GradTools has no account system yet and sends none of it to a server.
            </p>
            <p>
              Clearing your browser data removes it. There is no sync between devices at this stage.
            </p>
            <p className={styles.muted}>
              GradTools does not collect your date of birth, phone number, or any login details for
              a university system, and never asks for a university password.
            </p>
          </div>
        </Panel>

        <Panel title="Supported scope">
          <div className={styles.prose}>
            <p>
              This experimental version supports the <strong>VTU 2022 scheme (22OB)</strong> for
              B.E./B.Tech at non-autonomous affiliated colleges.
            </p>
            <p className={styles.muted}>
              Autonomous colleges set their own internal rules, so these figures may not apply
              there. Other schemes are not supported yet.
            </p>
          </div>
        </Panel>
      </div>
    </>
  );
}
