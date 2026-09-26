/**
 * First-run setup — guided, and skippable at every step (UF-01, DEC-001,
 * DEC-002).
 *
 *   1. Your name         optional
 *   2. Confirm           an explicit Confirm sets `identityConfirmedAt`;
 *                        skipping sets nothing
 *   3. Academic identity USN, college, scheme, branch, years, entry route
 *
 * LOCAL-FIRST: finishing writes the profile on this device through the same
 * repository the profile page uses. Nothing here touches the network beyond
 * the public reference lists (DEC-015, UF-02). Nothing is required, and a
 * setup skipped end to end writes nothing at all. NO DATE OF BIRTH (DEC-008).
 */

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../../components/ui/button.js';
import { Card } from '../../components/ui/card.js';
import { Field, Input } from '../../components/ui/field.js';
import { PageHeader } from '../../components/ui/page.js';
import { PageSkeleton } from '../../components/ui/skeleton.js';
import type { StudentProfile } from '../../domain/types.js';
import { useProfile } from '../../hooks/useCollection.js';
import { nowIso } from '../../lib/id.js';
import { withChanges } from '../profile/ProfilePage.js';
import {
  BranchField,
  CollegeField,
  SchemeField,
  YearFields,
  useAcademicYears,
} from './AcademicFields.js';

const STEPS = ['Your name', 'Confirm', 'Academic details'] as const;

export function SetupPage() {
  const { profile, loading, save } = useProfile();
  if (loading) return <PageSkeleton label="Loading" />;
  return <Setup profile={profile ?? null} save={save} />;
}

function Setup({
  profile,
  save,
}: {
  readonly profile: StudentProfile | null;
  readonly save: (profile: StudentProfile) => Promise<void>;
}) {
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [name, setName] = useState(profile?.displayName ?? '');
  const [confirmedAt, setConfirmedAt] = useState<string | null>(
    profile?.identityConfirmedAt ?? null,
  );
  const [usn, setUsn] = useState(profile?.usn ?? '');
  const [college, setCollege] = useState(profile?.collegeName ?? '');
  const [branch, setBranch] = useState(profile?.branch ?? '');
  const years = useAcademicYears(profile);

  const trimmed = name.trim();

  /** Writes what was stated; a setup that stated nothing writes nothing. */
  const finish = async (withAcademic: boolean): Promise<void> => {
    const patch: Partial<StudentProfile> = {
      displayName: trimmed === '' ? null : trimmed,
      identityConfirmedAt: confirmedAt,
      ...(withAcademic
        ? {
            usn: usn.trim() === '' ? null : usn.trim().toUpperCase(),
            collegeName: college.trim() === '' ? null : college.trim(),
            branch: branch.trim() === '' ? null : branch.trim(),
            ...years.values(),
          }
        : {}),
    };
    const stated = Object.values(patch).some((value) => value !== null && value !== undefined);
    if (profile !== null || stated) await save(withChanges(profile, patch));
    void navigate('/');
  };

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-6">
      <PageHeader
        eyebrow={`Step ${String(step + 1)} of ${String(STEPS.length)}`}
        title={STEPS[step] ?? ''}
      />
      <p className="text-[13px] text-ink-2">
        Everything here is optional. It is saved on this device, and to your account if you sync.
        Skip anything you like.
      </p>

      {step === 0 && (
        <Card className="flex flex-col gap-4 p-6">
          <Field label="Your name" optional hint="Only used to greet you.">
            <Input
              autoComplete="name"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                /* A confirmation is of a name; a different name is unconfirmed. */
                setConfirmedAt(null);
              }}
            />
          </Field>
          <div className="flex justify-end gap-2">
            <Button
              variant="ghost"
              onClick={() => {
                setName(profile?.displayName ?? '');
                setStep(2);
              }}
            >
              Skip
            </Button>
            <Button variant="primary" disabled={trimmed === ''} onClick={() => setStep(1)}>
              Next
            </Button>
          </div>
        </Card>
      )}

      {step === 1 && (
        <Card className="flex flex-col gap-4 p-6">
          <p className="text-[13px] text-ink-2">This is how GradTools will show your name:</p>
          <p className="text-[20px] font-semibold">{trimmed}</p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setStep(0)}>
              Change it
            </Button>
            <Button variant="ghost" onClick={() => setStep(2)}>
              Skip
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                setConfirmedAt(nowIso());
                setStep(2);
              }}
            >
              Confirm
            </Button>
          </div>
        </Card>
      )}

      {step === 2 && (
        <Card className="p-6">
          <form
            className="flex flex-col gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              if (years.error === null) void finish(true);
            }}
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="USN" optional hint="Usually 10 characters, like 1XX22CS001.">
                <Input
                  className="font-mono"
                  placeholder="1XX22CS001"
                  value={usn}
                  onChange={(event) => setUsn(event.target.value)}
                />
              </Field>
              <CollegeField value={college} onChange={setCollege} />
              <SchemeField />
              <BranchField value={branch} onChange={setBranch} />
              <YearFields years={years} />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => void finish(false)}>
                Skip
              </Button>
              <Button type="submit" variant="primary" disabled={years.error !== null}>
                Save
              </Button>
            </div>
          </form>
        </Card>
      )}
    </div>
  );
}
