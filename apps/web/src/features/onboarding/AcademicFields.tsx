/**
 * The academic-identity controls, shared by first-run setup and the profile.
 *
 * Every value here is what the student states. Nothing is inferred from
 * anything else: the entry route is a plain fact (OQ-055), and the passout
 * year offered from the admission year is a visible, editable suggestion —
 * whatever is in the box when they save is what is stored. NO DATE OF BIRTH
 * (DEC-008).
 */

import { VTU_SCHEMES, schemeSupport } from '@gradtools/academic-rules';
import { VTU_BRANCHES_2022 } from '@gradtools/vtu-catalogue/data';
import { DEFAULT_SCHEME_ID } from '../../hooks/useSchemeRules.js';
import { useState } from 'react';
import { Combobox } from '../../components/ui/combobox.js';
import { Field, Input, Select } from '../../components/ui/field.js';
import { Segmented } from '../../components/ui/segmented.js';
import { searchColleges } from '../../domain/college-search.js';
import type { StudentProfile } from '../../domain/types.js';
import { useBranches, useColleges } from '../../hooks/useReference.js';

const NOT_SET = '__not_set__';

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

  const collegeOptions = [
    { value: NOT_SET, label: 'Not set', name: '', code: null },
    ...colleges.items.map((college) => ({
      value: college.name,
      label: college.reviewed ? `${college.name} (verified)` : college.name,
      detail: [college.code, college.region]
        .filter((part) => part !== null && part !== '')
        .join(' · '),
      name: college.name,
      code: college.code,
    })),
  ];

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
      {/*
        SEARCHED, NOT SCROLLED. 185 colleges in one dropdown was a list a
        student had to scroll to find their own. Picking one stores the
        catalogue's own name, so the value stays canonical; typing a name that
        is not listed is a separate, explicit choice.
      */}
      <Field label="College" optional hint={hint}>
        <Combobox
          value={other ? '' : value === '' ? NOT_SET : value}
          onValueChange={(next) => {
            setOther(false);
            onChange(next === NOT_SET ? '' : next);
          }}
          options={collegeOptions}
          search={(_, query) =>
            query.trim() === '' ? collegeOptions : searchColleges(collegeOptions.slice(1), query)
          }
          placeholder={other ? 'Not listed (typed below)' : 'Not set'}
          searchPlaceholder="Search colleges — name, initials or code"
          noun="colleges"
          footer={{ label: 'My college isn’t listed — type it', onSelect: () => setOther(true) }}
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
  schemeId = DEFAULT_SCHEME_ID,
}: {
  readonly value: string;
  readonly onChange: (value: string) => void;
  /** The scheme being recorded: the bundled branch list is the 2022 scheme's. */
  readonly schemeId?: string;
}) {
  const branches = useBranches();
  const [typing, setTyping] = useState(false);
  /*
   * PUBLISHED ROWS FIRST, THE BUNDLED LIST OTHERWISE. VTU's 2022 branch list is
   * transcribed into the app, so no request is needed to offer it; the server
   * only improves on it. It is the 2022 scheme's list, so another scheme is not
   * shown it as though it applied.
   */
  const fromServer = branches.state.status === 'ready' && branches.state.data.length > 0;
  const listed = fromServer
    ? branches.state.data.map((item) => item.name)
    : schemeId === DEFAULT_SCHEME_ID
      ? VTU_BRANCHES_2022.entries.map((entry) => entry.labelAsPrinted)
      : [];

  if (listed.length === 0) {
    return (
      <Field
        label="Branch"
        hint="GradTools has no branch list for this scheme yet. Type yours as your college prints it."
      >
        <Input
          placeholder="Computer Science"
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
      </Field>
    );
  }

  const other = typing || (value !== '' && !listed.includes(value));
  const options = [
    { value: NOT_SET, label: 'Not set', name: '', code: null },
    ...listed.map((name) => ({ value: name, label: name, name, code: null })),
  ];
  return (
    <>
      <Field
        label="Branch"
        hint={
          fromServer
            ? 'From the GradTools reference data.'
            : "VTU's 2022-scheme branch list, as transcribed by GradTools."
        }
      >
        <Combobox
          value={other ? '' : value === '' ? NOT_SET : value}
          onValueChange={(next) => {
            setTyping(false);
            onChange(next === NOT_SET ? '' : next);
          }}
          options={options}
          search={(_, query) =>
            query.trim() === '' ? options : searchColleges(options.slice(1), query)
          }
          placeholder={other ? 'Not listed (typed below)' : 'Not set'}
          searchPlaceholder="Search branches"
          noun="branches"
          footer={{ label: 'My branch isn’t listed — type it', onSelect: () => setTyping(true) }}
        />
      </Field>
      {other && (
        <Field label="Your branch">
          <Input value={value} onChange={(event) => onChange(event.target.value)} />
        </Field>
      )}
    </>
  );
}

/**
 * Scheme: every VTU B.E./B.Tech scheme can be RECORDED; only one with verified
 * rules is calculated for. The list is the versioned registry in
 * @gradtools/academic-rules — static, so no request is made to fill it — and a
 * scheme without rules says so in the option itself, not after the fact.
 */
export function SchemeField({
  value,
  onChange,
}: {
  readonly value: string;
  readonly onChange: (value: string) => void;
}) {
  const support = schemeSupport(value);
  return (
    <Field
      label="Scheme"
      hint={
        support === 'supported'
          ? 'GradTools calculates figures for this scheme.'
          : support === 'recognised'
            ? 'Recorded on your profile. GradTools has no verified rules for this scheme yet, so it will not calculate SGPA, CGPA or attendance for it.'
            : 'Not a scheme GradTools knows. Choose yours from the list.'
      }
    >
      <Select
        value={value}
        onValueChange={onChange}
        options={VTU_SCHEMES.map((scheme) => ({
          value: scheme.id,
          label: `${scheme.label}${scheme.regulationCode === null ? '' : ` (${scheme.regulationCode})`}${
            schemeSupport(scheme.id) === 'supported' ? '' : ' — recorded only'
          }`,
        }))}
      />
    </Field>
  );
}
