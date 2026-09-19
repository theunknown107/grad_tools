/**
 * Entering (or correcting) a semester result by hand, exactly as the card
 * prints it. Where the reference catalogue knows the scheme's subjects, a
 * subject can be picked from it and its credits and SEE come with it.
 *
 * Nothing is corrected for the student: a row that does not validate is shown
 * with its reason and the save is refused until it does.
 */

import { vtu2022RuleSet } from '@gradtools/academic-rules';
import type { Subject } from '@gradtools/shared-types';
import { Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Button, IconButton } from '../../components/ui/button.js';
import { Card, CardHeader } from '../../components/ui/card.js';
import { Callout } from '../../components/ui/feedback.js';
import { Field, Input, Select } from '../../components/ui/field.js';
import type { asStudentProfileId } from '../../domain/identity.js';
import {
  normalizeResultSubject,
  validateResultSubject,
  type ResultSubjectField,
} from '../../domain/results.js';
import {
  RESULT_STATUSES,
  type ResultSubject,
  type SemesterResult,
  type SubjectProvenance,
} from '../../domain/types.js';
import { useSubjects } from '../../hooks/useReference.js';
import { newId, nowIso } from '../../lib/id.js';
import { SEMESTER_OPTIONS } from '../import/CalendarReview.js';

const ruleSet = vtu2022RuleSet;
const NONE = '__none__';
const MANUAL = '__manual__';

interface DraftSubject {
  readonly id: string;
  readonly subjectCode: string;
  readonly subjectTitle: string;
  readonly internal: string;
  readonly external: string;
  readonly total: string;
  readonly resultStatus: string;
  readonly gradeLetter: string;
  readonly credits: string;
  readonly hasSee: 'yes' | 'no' | 'unknown';
  readonly catalogueCode: string | null;
  readonly provenance: SubjectProvenance;
  readonly gradePoint: number | null;
}

function blankSubject(): DraftSubject {
  return {
    id: newId(),
    subjectCode: '',
    subjectTitle: '',
    internal: '',
    external: '',
    total: '',
    resultStatus: '',
    gradeLetter: '',
    credits: '',
    hasSee: 'unknown',
    catalogueCode: null,
    provenance: 'manual',
    gradePoint: null,
  };
}

function toDraft(subject: ResultSubject): DraftSubject {
  return {
    id: subject.id,
    subjectCode: subject.subjectCode ?? '',
    subjectTitle: subject.subjectTitle,
    internal: subject.internal === null ? '' : String(subject.internal),
    external: subject.external === null ? '' : String(subject.external),
    total: subject.total === null ? '' : String(subject.total),
    resultStatus: subject.resultStatus ?? '',
    gradeLetter: subject.gradeLetter ?? '',
    credits: subject.credits === null ? '' : String(subject.credits),
    hasSee: subject.hasSee === null ? 'unknown' : subject.hasSee ? 'yes' : 'no',
    catalogueCode: subject.catalogueCode,
    provenance: subject.provenance,
    gradePoint: subject.gradePoint,
  };
}

function toSubject(draft: DraftSubject, announcedOn: string): ResultSubject {
  const code = draft.subjectCode.trim().toUpperCase();
  return normalizeResultSubject({
    id: draft.id,
    subjectCode: code === '' ? null : code,
    subjectTitle: draft.subjectTitle.trim() === '' ? code : draft.subjectTitle.trim(),
    internal: draft.internal,
    external: draft.external,
    total: draft.total,
    resultStatus: draft.resultStatus,
    announcedOn,
    gradeLetter: draft.gradeLetter,
    gradePoint: draft.gradePoint,
    credits: draft.credits,
    hasSee: draft.hasSee === 'unknown' ? null : draft.hasSee === 'yes',
    provenance: draft.provenance,
    catalogueCode: draft.catalogueCode,
  });
}

export function ResultEditor({
  existing,
  taken,
  profileId,
  schemeId,
  branch,
  initialSemester,
  onSave,
  onCancel,
}: {
  readonly existing: SemesterResult | null;
  readonly taken: readonly number[];
  readonly profileId: ReturnType<typeof asStudentProfileId>;
  readonly schemeId: string;
  readonly branch: string | null;
  readonly initialSemester?: number;
  readonly onSave: (result: SemesterResult) => void;
  readonly onCancel: () => void;
}) {
  const [semester, setSemester] = useState(String(existing?.semester ?? initialSemester ?? 3));
  const [sgpaAsserted, setSgpaAsserted] = useState(
    existing === null || existing.sgpaAsserted === null ? '' : String(existing.sgpaAsserted),
  );
  const [announcedOn, setAnnouncedOn] = useState(
    existing?.subjects.find((subject) => subject.announcedOn !== null)?.announcedOn ?? '',
  );
  const [subjects, setSubjects] = useState<DraftSubject[]>(() =>
    existing === null ? [blankSubject()] : existing.subjects.map(toDraft),
  );
  const [showErrors, setShowErrors] = useState(false);

  const catalogue = useSubjects(schemeId, branch ?? undefined, Number(semester));
  const options: readonly Subject[] =
    catalogue.state.status === 'ready' ? catalogue.state.data : [];

  const update = (id: string, patch: Partial<DraftSubject>): void => {
    setSubjects((current) =>
      current.map((subject) => (subject.id === id ? { ...subject, ...patch } : subject)),
    );
  };
  const pick = (draft: DraftSubject, subject: Subject | null): void => {
    update(
      draft.id,
      subject === null
        ? { catalogueCode: null }
        : {
            subjectCode: subject.code,
            subjectTitle: subject.title,
            credits: subject.credits === null ? '' : String(subject.credits),
            hasSee: subject.hasSee === null ? 'unknown' : subject.hasSee ? 'yes' : 'no',
            catalogueCode: subject.code,
          },
    );
  };

  const duplicate = taken.includes(Number(semester));
  const rows = subjects.map((draft) => ({ draft, subject: toSubject(draft, announcedOn) }));
  const issues = new Map(
    rows.map(({ draft, subject }) => [draft.id, validateResultSubject(subject, ruleSet)]),
  );
  const invalid = [...issues.values()].some((list) => list.length > 0);
  const errorFor = (id: string, field: ResultSubjectField): string | undefined =>
    showErrors ? issues.get(id)?.find((issue) => issue.field === field)?.message : undefined;

  const commit = (): void => {
    if (invalid || duplicate) {
      setShowErrors(true);
      return;
    }
    onSave({
      id: existing?.id ?? newId(),
      profileId,
      semester: Number(semester),
      schemeId: existing?.schemeId ?? ruleSet.schemeId,
      ruleSetId: existing?.ruleSetId ?? ruleSet.id,
      sgpaAsserted: sgpaAsserted.trim() === '' ? null : Number(sgpaAsserted),
      subjects: rows.map((row) => row.subject),
      createdAt: existing?.createdAt ?? nowIso(),
      updatedAt: nowIso(),
    });
  };

  const gradeOptions = [
    { value: NONE, label: '—' },
    ...[...ruleSet.gradeBands, ...ruleSet.specialGrades].map((grade) => ({
      value: grade.letter,
      label: grade.letter,
    })),
  ];
  const statusOptions = [
    { value: NONE, label: '—' },
    ...RESULT_STATUSES.map((status) => ({ value: status, label: status })),
  ];

  return (
    <Card className="overflow-hidden" aria-labelledby="result-editor-title">
      <CardHeader
        titleId="result-editor-title"
        title={
          existing === null
            ? 'New semester result'
            : `Editing semester ${String(existing.semester)}`
        }
      />
      <div className="grid gap-4 border-b border-line p-5 sm:grid-cols-3">
        <Field label="Semester">
          <Select value={semester} onValueChange={setSemester} options={SEMESTER_OPTIONS} />
        </Field>
        <Field label="Announced on" hint="The date printed on the card." optional>
          <Input
            type="date"
            value={announcedOn}
            onChange={(event) => setAnnouncedOn(event.target.value)}
          />
        </Field>
        <Field
          label="SGPA printed on your grade card"
          hint="A provisional result does not print one."
          optional
        >
          <Input
            inputMode="decimal"
            placeholder="8.43"
            value={sgpaAsserted}
            onChange={(event) => setSgpaAsserted(event.target.value)}
          />
        </Field>
      </div>

      <ol className="divide-y divide-line">
        {rows.map(({ draft }, index) => {
          const position = String(index + 1);
          const fromCatalogue = draft.catalogueCode !== null;
          return (
            <li key={draft.id} className="p-5">
              <div className="mb-3 flex items-center justify-between gap-2">
                <span className="font-mono text-[11px] tracking-[0.14em] text-ink-3 uppercase">
                  Subject {position}
                </span>
                <IconButton
                  size="sm"
                  label={`Remove subject ${position}`}
                  disabled={subjects.length === 1}
                  className="hover:text-danger"
                  onClick={() =>
                    setSubjects((current) =>
                      current.filter((candidate) => candidate.id !== draft.id),
                    )
                  }
                >
                  <Trash2 />
                </IconButton>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[1.4fr_1fr_1.6fr]">
                {options.length > 0 && (
                  <Field label={`Subject ${position}`} className="sm:col-span-2 lg:col-span-1">
                    <Select
                      value={draft.catalogueCode ?? MANUAL}
                      onValueChange={(value) =>
                        pick(draft, options.find((subject) => subject.code === value) ?? null)
                      }
                      options={[
                        { value: MANUAL, label: 'Enter manually' },
                        ...options.map((subject) => ({
                          value: subject.code,
                          label: `${subject.code} — ${subject.title}`,
                        })),
                      ]}
                    />
                  </Field>
                )}
                <Field
                  label={options.length > 0 ? `Code ${position}` : `Subject code ${position}`}
                  error={errorFor(draft.id, 'subjectCode')}
                >
                  <Input
                    className="font-mono"
                    placeholder="BCS301"
                    readOnly={fromCatalogue}
                    value={draft.subjectCode}
                    onChange={(event) => update(draft.id, { subjectCode: event.target.value })}
                  />
                </Field>
                <Field
                  label={`Subject name ${position}`}
                  {...(fromCatalogue ? {} : { optional: true })}
                >
                  <Input
                    readOnly={fromCatalogue}
                    value={draft.subjectTitle}
                    onChange={(event) => update(draft.id, { subjectTitle: event.target.value })}
                  />
                </Field>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
                <Field label={`Internal ${position}`} error={errorFor(draft.id, 'internal')}>
                  <Input
                    inputMode="numeric"
                    value={draft.internal}
                    onChange={(event) => update(draft.id, { internal: event.target.value })}
                  />
                </Field>
                <Field
                  label={`External ${position}`}
                  error={errorFor(draft.id, 'external')}
                  {...(draft.hasSee === 'no' ? { hint: 'No SEE' } : {})}
                >
                  <Input
                    inputMode="numeric"
                    value={draft.external}
                    onChange={(event) => update(draft.id, { external: event.target.value })}
                  />
                </Field>
                <Field label={`Total ${position}`} error={errorFor(draft.id, 'total')}>
                  <Input
                    inputMode="numeric"
                    value={draft.total}
                    onChange={(event) => update(draft.id, { total: event.target.value })}
                  />
                </Field>
                <Field label={`Result ${position}`}>
                  <Select
                    value={draft.resultStatus === '' ? NONE : draft.resultStatus}
                    onValueChange={(value) =>
                      update(draft.id, { resultStatus: value === NONE ? '' : value })
                    }
                    options={statusOptions}
                  />
                </Field>
                <Field label={`Semester-end exam ${position}`}>
                  <Select
                    value={draft.hasSee}
                    onValueChange={(value) =>
                      update(draft.id, { hasSee: value as DraftSubject['hasSee'] })
                    }
                    options={[
                      { value: 'unknown', label: 'Not sure' },
                      { value: 'yes', label: 'Yes' },
                      { value: 'no', label: 'No — internal only' },
                    ]}
                  />
                </Field>
                <Field
                  label={`Credits ${position}`}
                  error={errorFor(draft.id, 'credits')}
                  {...(fromCatalogue ? { hint: 'From the catalogue' } : {})}
                >
                  <Input
                    inputMode="decimal"
                    value={draft.credits}
                    onChange={(event) => update(draft.id, { credits: event.target.value })}
                  />
                </Field>
                <Field label={`Grade ${position}`} hint="Only if printed.">
                  <Select
                    value={draft.gradeLetter === '' ? NONE : draft.gradeLetter}
                    onValueChange={(value) =>
                      update(draft.id, { gradeLetter: value === NONE ? '' : value })
                    }
                    options={gradeOptions}
                  />
                </Field>
              </div>
            </li>
          );
        })}
      </ol>

      <div className="flex flex-col gap-3 border-t border-line p-5">
        {duplicate && (
          <Callout tone="warning">
            Semester {semester} already has a result saved. Choose another semester, or close this
            and use <strong>Edit semester</strong> on the one you already have — a second record for
            the same semester would not be counted.
          </Callout>
        )}
        {showErrors && invalid && (
          <Callout tone="warning" role="alert">
            Some rows do not match the card. Nothing is corrected for you — check the marks against
            what is printed.
          </Callout>
        )}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Button
            icon={<Plus />}
            onClick={() => setSubjects((current) => [...current, blankSubject()])}
          >
            Add subject
          </Button>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onCancel}>
              Cancel
            </Button>
            <Button variant="primary" onClick={commit}>
              {existing === null ? 'Save semester' : 'Save changes'}
            </Button>
          </div>
        </div>
      </div>
    </Card>
  );
}
