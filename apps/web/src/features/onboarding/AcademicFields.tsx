/**
 * The academic-identity controls, shared by first-run setup and the profile.
 *
 * Every value here is what the student states. Nothing is inferred from
 * anything else: the entry route is a plain fact (OQ-055), and the passout
 * year offered from the admission year is a visible, editable suggestion —
 * whatever is in the box when they save is what is stored. NO DATE OF BIRTH
 * (DEC-008).
 */

import { vtu2022RuleSet } from '@gradtools/academic-rules';
import { RotateCcw } from 'lucide-react';
import { useState } from 'react';
import { Button } from '../../components/ui/button.js';
import { Field, Input, Select } from '../../components/ui/field.js';
import { Segmented } from '../../components/ui/segmented.js';
import type { StudentProfile } from '../../domain/types.js';
import { useBranches, useColleges, useSchemes } from '../../hooks/useReference.js';

const NOT_SET = '__not_set__';
const OTHER = '__other__';

export type EntryRoute = 'puc' | 'diploma';

/** Years the student may state. The same window as profileInputSchema. */
export const YEAR_MIN = 2000;
export const YEAR_MAX = 2100;

/** `''` is "not said"; anything else must be a whole year in the window. */
export function parseYear(text: string): number | null | 'invalid' {
  const trimmed = text.trim();
  if (trimmed === '') return null;
  const year = Number(trimmed);
  return Number.isInteger(year) && year >= YEAR_MIN && year <= YEAR_MAX ? year : 'invalid';
}

/**
 * The usual passout year for a route — OFFERED, never stored on its own.
 * PUC students usually take four years, Diploma entrants three; a student
 * whose path differs simply types theirs.
 */
export function suggestedPassout(
  admission: number | null,
  route: EntryRoute | null,
): number | null {
  if (admission === null || route === null) return null;
  return admission + (route === 'puc' ? 4 : 3);
}

const asText = (year: number | null | undefined): string =>
  year === null || year === undefined ? '' : String(year);

/** Draft state for admission year, passout year and entry route. */
export function useAcademicYears(profile: StudentProfile | null) {
  const [admission, setAdmissionText] = useState(asText(profile?.admissionYear));
  const [passout, setPassoutText] = useState(asText(profile?.expectedPassoutYear));
  const [route, setRouteValue] = useState<EntryRoute | null>(profile?.entryRoute ?? null);
  /* Once the student types a passout year, no suggestion replaces it. */
  const [touched, setTouched] = useState(passout !== '');

  const suggest = (nextAdmission: string, nextRoute: EntryRoute | null): void => {
    if (touched) return;
    const year = parseYear(nextAdmission);
    setPassoutText(asText(suggestedPassout(typeof year === 'number' ? year : null, nextRoute)));
  };

  const admissionYear = parseYear(admission);
  const passoutYear = parseYear(passout);
  const error =
    admissionYear === 'invalid' || passoutYear === 'invalid'
      ? `Enter a year between ${String(YEAR_MIN)} and ${String(YEAR_MAX)}.`
      : admissionYear !== null && passoutYear !== null && passoutYear < admissionYear
        ? 'The passout year cannot be before the admission year.'
        : null;

  return {
    admission,
    passout,
    route,
    error,
    /** Shown beside the passout box while it still holds the suggestion. */
    suggested: !touched && passout !== '',
    setAdmission(text: string) {
      setAdmissionText(text);
      suggest(text, route);
    },
    setPassout(text: string) {
      setTouched(true);
      setPassoutText(text);
    },
    setRoute(next: EntryRoute | null) {
      setRouteValue(next);
      suggest(admission, next);
    },
    reset() {
      setAdmissionText(asText(profile?.admissionYear));
      setPassoutText(asText(profile?.expectedPassoutYear));
      setRouteValue(profile?.entryRoute ?? null);
      setTouched(asText(profile?.expectedPassoutYear) !== '');
    },
    /** The values to store. Only valid when `error` is null. */
    values(): Pick<StudentProfile, 'admissionYear' | 'expectedPassoutYear' | 'entryRoute'> {
      return {
        admissionYear: typeof admissionYear === 'number' ? admissionYear : null,
        expectedPassoutYear: typeof passoutYear === 'number' ? passoutYear : null,
        entryRoute: route,
      };
    },
    dirty:
      admission !== asText(profile?.admissionYear) ||
      passout !== asText(profile?.expectedPassoutYear) ||
      route !== (profile?.entryRoute ?? null),
  };
}

export type AcademicYears = ReturnType<typeof useAcademicYears>;

/** Admission year, expected passout year and entry route. */
export function YearFields({ years }: { readonly years: AcademicYears }) {
  return (
    <>
      <Field label="Admission year" optional>
        <Input
          inputMode="numeric"
          placeholder="2022"
          value={years.admission}
          onChange={(event) => years.setAdmission(event.target.value)}
        />
      </Field>
      <Field
        label="Expected passout year"
        optional
        error={years.error}
        hint={
          years.suggested
            ? 'Suggested from your admission year and entry route. Change it if yours differs.'
            : undefined
        }
      >
        <Input
          inputMode="numeric"
          placeholder="2026"
          value={years.passout}
          onChange={(event) => years.setPassout(event.target.value)}
        />
      </Field>
      <div className="flex min-w-0 flex-col gap-1.5 sm:col-span-2">
        <span className="text-[13px] font-medium">
          Entry route <span className="ml-1 font-normal text-ink-3">(optional)</span>
        </span>
        <Segmented<'none' | EntryRoute>
          label="Entry route"
          value={years.route ?? 'none'}
          onChange={(value) => years.setRoute(value === 'none' ? null : value)}
          options={[
            { value: 'none', label: 'Not said' },
            { value: 'puc', label: 'PUC' },
            { value: 'diploma', label: 'Diploma' },
          ]}
        />
      </div>
    </>
  );
}

/** College: the official affiliated list, or "Other" typed by hand. */
export function CollegeField({
  value,
  onChange,
}: {
  readonly value: string;
  readonly onChange: (value: string) => void;
}) {
  const colleges = useColleges();
  const [choseOther, setOther] = useState(false);
  /* A stored name that is not on the list is one the student typed. */
  const other = choseOther || (value !== '' && !colleges.items.some((c) => c.name === value));

  if (colleges.loading || colleges.error !== null || colleges.items.length === 0) {
    return (
      <Field
        label="College"
        optional
        hint={
          colleges.loading
            ? 'Loading colleges…'
            : 'The college list is unavailable; type yours instead.'
        }
      >
        <Input value={value} onChange={(event) => onChange(event.target.value)} />
      </Field>
    );
  }

  /* Review state travels in words, not colour: the hint and a "verified" suffix. */
  const chosen = other ? undefined : colleges.items.find((c) => c.name === value);
  const hint =
    chosen?.reviewed === true
      ? "Verified by GradTools against VTU's affiliated-institute list."
      : chosen !== undefined || colleges.items.some((c) => !c.reviewed)
        ? "Transcribed from VTU's affiliated-institute list; not yet checked by GradTools."
        : 'From the list of VTU-affiliated colleges.';

  return (
    <>
      <Field label="College" optional hint={hint}>
        <Select
          value={other ? OTHER : value === '' ? NOT_SET : value}
          onValueChange={(next) => {
            setOther(next === OTHER);
            if (next !== OTHER) onChange(next === NOT_SET ? '' : next);
          }}
          options={[
            { value: NOT_SET, label: 'Not set' },
            ...colleges.items.map((college) => ({
              value: college.name,
              label: college.reviewed ? `${college.name} (verified)` : college.name,
            })),
            { value: OTHER, label: 'Other (type it)' },
          ]}
        />
      </Field>
      {other && (
        <Field label="Your college">
          <Input value={value} onChange={(event) => onChange(event.target.value)} />
        </Field>
      )}
    </>
  );
}

/** Branch: the reference list, with a typed fallback when it is unreachable. */
export function BranchField({
  value,
  onChange,
}: {
  readonly value: string;
  readonly onChange: (value: string) => void;
}) {
  const branches = useBranches();
  if (branches.state.status === 'loading') {
    return (
      <Field label="Branch" hint="Loading branches…">
        <Input disabled value={value} />
      </Field>
    );
  }
  if (branches.state.status === 'ready' && branches.state.data.length > 0) {
    const data = branches.state.data;
    return (
      <Field label="Branch" hint="From the GradTools reference data.">
        <Select
          value={value === '' ? NOT_SET : value}
          onValueChange={(next) => onChange(next === NOT_SET ? '' : next)}
          options={[
            { value: NOT_SET, label: 'Not set' },
            ...data.map((item) => ({ value: item.name, label: item.name })),
            ...(value !== '' && !data.some((item) => item.name === value)
              ? [{ value, label: value }]
              : []),
          ]}
        />
      </Field>
    );
  }
  /*
   * THE FALLBACK IS A FALLBACK, AND SAYS WHICH ONE IT IS. The retry sits beside
   * the field rather than in its hint, which is the input's description.
   */
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <Field
        label="Branch"
        hint={
          branches.state.status === 'error'
            ? 'Branches could not be loaded; type yours instead.'
            : 'No branches available from the server; type yours instead.'
        }
      >
        <Input
          placeholder="Computer Science"
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
      </Field>
      <div>
        <Button size="sm" variant="ghost" icon={<RotateCcw />} onClick={branches.retry}>
          Look for branches again
        </Button>
      </div>
    </div>
  );
}

/** Scheme: only verified schemes are offered; today that is one. */
export function SchemeField() {
  const schemes = useSchemes();
  return (
    <Field
      label="Scheme"
      hint={
        schemes.state.status === 'error'
          ? 'Schemes could not be loaded from the server.'
          : 'Only verified schemes are offered.'
      }
    >
      <Select
        value={vtu2022RuleSet.schemeId}
        onValueChange={() => undefined}
        disabled={schemes.state.status !== 'ready' || schemes.state.data.length <= 1}
        options={
          schemes.state.status === 'ready' && schemes.state.data.length > 0
            ? schemes.state.data.map((item) => ({
                value: item.id,
                label: `${item.name} (${item.regulationCode})`,
              }))
            : [{ value: vtu2022RuleSet.schemeId, label: 'VTU 2022 (22OB)' }]
        }
      />
    </Field>
  );
}
