/**
 * Reviewing a result card before it is saved — the design's review table.
 *
 * Each row shows what was read and what is resolved about it (credits, grade,
 * grade point, assessment), each with its source or its reason for being
 * unavailable. A row that needs an answer only the student has (did this
 * course have a final exam?) opens itself. Nothing is corrected silently and
 * nothing is saved until the student confirms.
 */

import { useSchemeRules } from '../../hooks/useSchemeRules.js';
import type { RuleSet } from '@gradtools/academic-rules';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  FileCheck2,
  Trash2,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Badge } from '../../components/ui/badge.js';
import { Button } from '../../components/ui/button.js';
import { Card } from '../../components/ui/card.js';
import { Callout, Unavailable, toast } from '../../components/ui/feedback.js';
import { Field, Input, Select } from '../../components/ui/field.js';
import type { asStudentProfileId } from '../../domain/identity.js';
import { COURSE_KIND_LABEL, enrichRow, type RowEnrichment } from '../../domain/enrichment.js';
import { resolveCourseKind } from '../../domain/exams.js';
import { rowToSubject, type ParsedRow } from '../../domain/result-import.js';
import {
  blockingReason,
  isReadyToImport,
  withChosenSemester,
  type SemesterGroup,
} from '../../domain/result-reconcile.js';
import { useProfile, useResults } from '../../hooks/useCollection.js';
import {
  creditsFor,
  resolveSubject,
  subjectKey,
  type CatalogueSubject,
  type SubjectIdentity,
} from '../../domain/subjects.js';
import { RESULT_STATUSES, type ResultSubject, type SemesterResult } from '../../domain/types.js';
import { gradeTone } from '../../components/academic/grade-tone.js';
import { cn } from '../../lib/cn.js';
import { formatCount } from '../../lib/format.js';
import { newId, nowIso } from '../../lib/id.js';
import { SEMESTER_OPTIONS } from './CalendarReview.js';
import { Recorded, ReviewCard, SaveFooter, saveFailure, type SaveState } from './ReviewCard.js';

/** Recorded on each imported result, so a later parser fix can tell which readings predate it. */
const PARSER_VERSION = 'vtu-result-card/1';

const sameUsn = (a: string, b: string): boolean =>
  a.trim().toUpperCase() === b.trim().toUpperCase();

function gradeOptionsFor(rules: RuleSet) {
  return [
    { value: '', label: 'Not printed' },
    ...[...rules.gradeBands, ...rules.specialGrades].map((grade) => ({
      value: grade.letter,
      label: grade.letter,
    })),
  ];
}
/* P and F say what they mean; the other statuses stay as printed (their
   meaning is scheme-specific and is not guessed here). */
const STATUS_MEANING: Readonly<Record<string, string>> = { P: 'P — Pass', F: 'F — Fail' };
const STATUS_OPTIONS = [
  { value: '', label: 'Not printed' },
  ...RESULT_STATUSES.map((status) => ({ value: status, label: STATUS_MEANING[status] ?? status })),
];
// Radix Select cannot hold '' as an item value; these map it to a sentinel.
const NONE = '__none__';
const withNone = (options: readonly { value: string; label: string }[]) =>
  options.map((option) => (option.value === '' ? { ...option, value: NONE } : option));
const fromNone = (value: string): string => (value === NONE ? '' : value);
const toNone = (value: string): string => (value === '' ? NONE : value);

interface DraftRow {
  readonly id: string;
  readonly subjectCode: string;
  readonly subjectTitle: string;
  readonly internal: string;
  readonly external: string;
  readonly total: string;
  readonly resultStatus: string;
  readonly gradeLetter: string;
  readonly credits: string;
  readonly hasSee: string;
  readonly announcedOn: string;
  readonly sourceLine: string;
  readonly warnings: ParsedRow['warnings'];
}

function toDraft(row: ParsedRow): DraftRow {
  return {
    id: newId(),
    subjectCode: row.subjectCode,
    subjectTitle: row.subjectTitle,
    internal: row.internal === null ? '' : String(row.internal),
    external: row.external === null ? '' : String(row.external),
    total: row.total === null ? '' : String(row.total),
    resultStatus: row.resultStatus ?? '',
    gradeLetter: '',
    credits: '',
    hasSee: '',
    announcedOn: row.announcedOn ?? '',
    sourceLine: row.sourceLine,
    warnings: row.warnings,
  };
}

function needsSeeAnswer(row: DraftRow, referenceHasSee: boolean | null): boolean {
  if (row.hasSee !== '') return true;
  const external = row.external === '' ? null : Number(row.external);
  return (
    resolveCourseKind({
      subjectCode: row.subjectCode,
      subjectTitle: row.subjectTitle,
      internal: null,
      external: Number.isFinite(external) ? external : null,
      total: null,
      resultStatus: null,
      announcedOn: null,
      gradeLetter: row.gradeLetter === '' ? null : row.gradeLetter,
      gradePoint: null,
      credits: null,
      hasSee: referenceHasSee,
      provenance: 'manual',
      catalogueCode: null,
      id: row.id,
    }).kind === null
  );
}

function parsedFrom(row: DraftRow) {
  return {
    subjectCode: row.subjectCode,
    subjectTitle: row.subjectTitle,
    internal: row.internal === '' ? null : Number(row.internal),
    external: row.external === '' ? null : Number(row.external),
    total: row.total === '' ? null : Number(row.total),
    resultStatus: row.resultStatus === '' ? null : row.resultStatus,
    announcedOn: row.announcedOn === '' ? null : row.announcedOn,
    page: 1,
    sourceLine: row.sourceLine,
    warnings: [],
  };
}

const COLUMNS =
  'md:grid md:grid-cols-[minmax(0,1.6fr)_repeat(6,minmax(0,0.6fr))] md:items-center md:gap-2';

export function ResultReview({
  group,
  recognised,
  catalogue,
  subjectIndex,
  profileId,
  expectedSemester = null,
  session = null,
  onSave,
  onDiscard,
}: {
  readonly group: SemesterGroup;
  readonly recognised: boolean;
  readonly catalogue: readonly CatalogueSubject[];
  readonly subjectIndex: Map<string, SubjectIdentity>;
  readonly profileId: ReturnType<typeof asStudentProfileId>;
  /** The semester the "Get VTU Result" link was opened for, validated 1–8. */
  readonly expectedSemester?: number | null;
  /** The result session the student said this page is from, validated. */
  readonly session?: { readonly id: string; readonly label: string } | null;
  readonly onSave: (result: SemesterResult) => void | Promise<void>;
  readonly onDiscard: () => void;
}) {
  const schemeRules = useSchemeRules();
  const activeRules = schemeRules.ruleSet;
  const first = group.files[0];
  const { items: savedResults } = useResults();
  const { profile } = useProfile();
  /*
   * The deep link's semester PRE-FILLS the choice only where the card printed
   * none. It is still a choice run through `withChosenSemester` below, so a
   * semester that already has a saved result is refused exactly as if picked.
   * A printed semester always wins; a different expected one is only a warning.
   */
  const [semester, setSemester] = useState(
    String(
      group.semester ??
        (group.files.some((file) => file.card.unsupportedSemester !== null)
          ? ''
          : (expectedSemester ?? '')),
    ),
  );
  const [rows, setRows] = useState<readonly DraftRow[]>(() =>
    (first?.card.rows ?? []).map(toDraft),
  );
  const [state, setState] = useState<SaveState>('idle');
  const [error, setError] = useState<string | null>(null);
  const [openRows, setOpenRows] = useState<ReadonlySet<string>>(() => new Set<string>());

  const update = (id: string, patch: Partial<DraftRow>): void => {
    setRows((current) => current.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  };
  const catalogueFor = (code: string) => {
    const match = catalogue.find((subject) => subjectKey(subject.code) === subjectKey(code));
    return match === undefined ? null : { credits: match.credits, hasSee: match.hasSee };
  };
  const rememberedCredits = (code: string) =>
    creditsFor(resolveSubject(subjectIndex, code)).credits;

  const subjectFrom = (row: DraftRow): ResultSubject => {
    const base = rowToSubject(parsedFrom(row), row.id, catalogueFor(row.subjectCode));
    const typed = row.credits !== '';
    return {
      ...base,
      gradeLetter: row.gradeLetter === '' ? base.gradeLetter : row.gradeLetter,
      credits: typed ? Number(row.credits) : (base.credits ?? rememberedCredits(row.subjectCode)),
      hasSee: row.hasSee === '' ? base.hasSee : row.hasSee === 'yes',
      /*
       * A credit the student TYPED is theirs, even on a row the catalogue
       * matched. Left as `catalogue`, it was shown as "catalogue" and promoted
       * into reference credits on other screens (§14).
       */
      ...(typed ? { provenance: 'manual' as const } : {}),
    };
  };
  const enrichmentFor = (row: DraftRow): RowEnrichment =>
    enrichRow(subjectFrom(row), resolveSubject(subjectIndex, row.subjectCode), activeRules);

  /*
   * A page that printed a semester outside 1–8 is refused, not re-filed: picking
   * 1–8 for a semester-9 card would be silently wrong data (OQ-057).
   */
  const unsupported = group.files.some((file) => file.card.unsupportedSemester !== null);
  /* A chosen semester is checked exactly like a printed one. */
  const effective =
    group.semester === null && !unsupported && semester !== ''
      ? withChosenSemester(
          group,
          Number(semester),
          savedResults.map((result) => result.semester),
        )
      : group;
  const blocked = blockingReason(effective);
  const ready = isReadyToImport(effective);

  const enriched = rows.map((row) => {
    const enrichment = enrichmentFor(row);
    const needsAnswer = needsSeeAnswer(row, catalogueFor(row.subjectCode)?.hasSee ?? null);
    return {
      row,
      enrichment,
      needsAnswer,
      /*
       * TWO DIFFERENT THINGS, NEVER MERGED. "Needs review" is a contradiction
       * or a question only the student can answer. A value nobody knows yet —
       * credits, a letter the card does not print — is merely incomplete: it
       * keeps the row out of SGPA and is said plainly, not as a warning.
       */
      unresolved: enrichment.conflict !== null || needsAnswer,
      incomplete: enrichment.credits.value === null || enrichment.grade.value === null,
    };
  });
  /*
   * A row with a conflict OPENS ITSELF, once, and then stays open until the
   * student closes it. Tying `open` to the conflict directly closed the row the
   * moment an edit cleared it — unmounting the field being typed into.
   */
  const conflicted = enriched
    .filter((entry) => entry.enrichment.conflict !== null)
    .map((entry) => entry.row.id)
    .join('|');
  useEffect(() => {
    if (conflicted === '') return;
    setOpenRows((current) => {
      const next = new Set(current);
      for (const id of conflicted.split('|')) next.add(id);
      return next.size === current.size ? current : next;
    });
  }, [conflicted]);
  const unresolvedCount = enriched.filter((entry) => entry.unresolved).length;
  const incompleteCount = enriched.filter((entry) => !entry.unresolved && entry.incomplete).length;
  const resolvedCount = enriched.length - unresolvedCount - incompleteCount;
  const unreadable = group.files.flatMap((file) => file.card.unreadableRows);
  const seat = first?.card.seatNumber ?? null;
  const usn = profile?.usn ?? null;
  const otherStudent = seat !== null && usn !== null && usn.trim() !== '' && !sameUsn(seat, usn);
  const otherSemester =
    group.semester !== null && expectedSemester !== null && group.semester !== expectedSemester;

  const confirm = async (): Promise<void> => {
    if (state === 'saving' || state === 'saved' || !ready) return;
    const subjects = rows.map(subjectFrom);
    setState('saving');
    setError(null);
    try {
      await onSave({
        id: newId(),
        profileId,
        semester: Number(semester),
        // Filed under the student's scheme; pinned only to rules that exist.
        schemeId: schemeRules.schemeId,
        ruleSetId: activeRules?.id ?? null,
        sgpaAsserted: null,
        subjects,
        /*
         * LOCAL-ONLY provenance: not a synced column, so it never reaches the
         * cloud and never enters the sync fingerprint. Only a VTU result card
         * can get here — `ready` requires `looksLikeResultCard`.
         */
        source: {
          kind: 'vtu-result-page',
          sessionId: session?.id ?? null,
          importedAt: nowIso(),
          parserVersion: PARSER_VERSION,
        },
        createdAt: nowIso(),
        updatedAt: nowIso(),
      });
      setState('saved');
      toast('Data confirmed and recorded.', {
        description: `Semester ${semester} and its ${String(subjects.length)} subjects are saved on this device.`,
        tone: 'success',
      });
    } catch (cause) {
      setState('failed');
      setError(saveFailure(cause, 'Data'));
    }
  };

  if (first === undefined) return null;

  if (state === 'saved') {
    const perRow = rows.map((row) => enrichmentFor(row).credits.value);
    const creditsKnown = perRow.every((value) => value !== null);
    const credits = perRow.reduce((total: number, value) => total + (value ?? 0), 0);
    return (
      <Recorded
        label={`Semester ${semester} recorded`}
        figures={[
          { label: rows.length === 1 ? 'subject' : 'subjects', value: rows.length },
          ...(creditsKnown ? [{ label: 'credits', value: credits }] : []),
          { label: 'semester', value: semester },
        ]}
        actions={
          <>
            <Button asChild variant="primary" icon={<ArrowRight />}>
              <Link to={`/results/${semester}`}>View results</Link>
            </Button>
            <Button asChild>
              <Link to="/">Go to dashboard</Link>
            </Button>
          </>
        }
      >
        Semester {semester} and its {formatCount(rows.length, 'subject')} are saved on this device.
        Your dashboard, results and degree progress are already up to date.
      </Recorded>
    );
  }

  const toggle = (id: string): void =>
    setOpenRows((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <ReviewCard
      label={
        group.semester === null ? 'Result review' : `Semester ${String(group.semester)} review`
      }
      title={group.files.map((file) => file.fileName).join(', ')}
      meta={
        <>
          Parsed as a semester result ·{' '}
          {first.card.unsupportedSemester !== null
            ? `semester ${String(first.card.unsupportedSemester)} (not supported)`
            : group.semester === null
              ? 'semester not detected'
              : `semester ${String(group.semester)}`}{' '}
          · {formatCount(rows.length, 'course')} detected
          {seat !== null && <span className="block">Seat number: {seat}</span>}
          {session !== null && <span className="block">From: {session.label}</span>}
        </>
      }
      badges={
        <>
          <Badge tone="success" icon={<CheckCircle2 />}>
            {resolvedCount} resolved
          </Badge>
          {incompleteCount > 0 && <Badge tone="neutral">{incompleteCount} incomplete</Badge>}
          {unresolvedCount > 0 && (
            <Badge tone="warning" icon={<AlertTriangle />}>
              {unresolvedCount} needs review
            </Badge>
          )}
        </>
      }
    >
      {unresolvedCount > 0 && (
        <Callout tone="warning" title="Check these against the card.">
          {formatCount(unresolvedCount, 'course')} {unresolvedCount === 1 ? 'has' : 'have'} marks
          that disagree — with each other or with the printed result — or a question only you can
          answer. Nothing is worked out from them until they agree.
        </Callout>
      )}
      {incompleteCount > 0 && (
        <Callout tone="info" title="Partial result.">
          {formatCount(incompleteCount, 'course')} {incompleteCount === 1 ? 'has' : 'have'} no known
          credits or grade, so {incompleteCount === 1 ? 'it carries' : 'they carry'} no grade point.
          Everything is saved as read either way.
        </Callout>
      )}
      {blocked !== null && <Callout tone="warning">{blocked}</Callout>}
      {otherStudent && (
        <Callout tone="warning" title="Check whose card this is.">
          This card is for {seat}, your profile says {usn}. You can still save it — make sure it is
          your own result.
        </Callout>
      )}
      {otherSemester && (
        <Callout tone="warning" title="A different semester.">
          This card prints semester {String(group.semester)}, but you opened it for semester{' '}
          {String(expectedSemester)}. It will be saved as semester {String(group.semester)}, as
          printed.
        </Callout>
      )}
      {recognised && (
        <Callout tone="warning" title="Read from a picture.">
          These figures were read from an image, not from a PDF&apos;s own text. Check every mark
          against the card before saving — a misread digit becomes an SGPA you cannot explain.
        </Callout>
      )}
      {group.semester === null && !unsupported && first.card.looksLikeResultCard && (
        <Card className="p-5">
          <Field
            label="Semester"
            hint="This document did not print one, so it cannot be guessed."
            className="max-w-xs"
          >
            <Select
              value={semester}
              onValueChange={setSemester}
              placeholder="Choose…"
              options={SEMESTER_OPTIONS}
            />
          </Field>
        </Card>
      )}
      {unreadable.length > 0 && (
        <Callout tone="warning">
          {unreadable.length === 1
            ? 'One line looks like a subject row but could not be read. Check it against your card and add it by hand if the subject is missing below.'
            : `${String(unreadable.length)} lines look like subject rows but could not be read. Check them against your card and add any missing subjects by hand.`}
          <ul className="mt-1 list-disc pl-5 font-mono text-[11px]">
            {unreadable.map((line) => (
              <li key={`${String(line.page)}-${line.text}`}>{line.text}</li>
            ))}
          </ul>
        </Callout>
      )}
      {group.differences.length > 0 && (
        <Callout tone="warning" title="These files describe the same semester differently:">
          <ul className="mt-1 list-disc pl-5">
            {group.differences.map((difference) => (
              <li key={`${difference.subjectCode}-${difference.field}`}>
                {difference.subjectCode} · {difference.field}: {difference.a} → {difference.b}
              </li>
            ))}
          </ul>
        </Callout>
      )}

      <Card className="overflow-hidden">
        <div
          aria-hidden="true"
          className={cn(
            'hidden border-b border-line bg-panel px-5 py-3 text-[11px] font-semibold tracking-wide text-ink-3 uppercase',
            COLUMNS,
          )}
        >
          <span>Course</span>
          <span className="text-right">Int</span>
          <span className="text-right">Ext</span>
          <span className="text-right">Total</span>
          <span className="text-right">Credits</span>
          <span className="text-center">Grade</span>
          <span className="text-right">Result</span>
        </div>
        <ul className="divide-y divide-line">
          {enriched.map(({ row, enrichment, needsAnswer, unresolved }, index) => {
            const position = String(index + 1);
            const open = needsAnswer || openRows.has(row.id);
            const name = row.subjectTitle === '' ? row.subjectCode : row.subjectTitle;
            return (
              <li key={row.id} className={cn(unresolved && 'bg-warning-weak/25')}>
                <div className={cn('px-5 py-3', COLUMNS)}>
                  <div className="min-w-0">
                    <button
                      type="button"
                      aria-expanded={open}
                      disabled={needsAnswer}
                      onClick={() => toggle(row.id)}
                      className="group flex w-full min-w-0 items-center gap-2 rounded-md text-left disabled:cursor-default"
                    >
                      <span className="min-w-0">
                        <span className="flex items-center gap-2">
                          <span className="truncate text-[13px] font-medium text-ink">{name}</span>
                          {unresolved && <Badge tone="warning">Check</Badge>}
                        </span>
                        <span className="block font-mono text-[11px] text-ink-3">
                          {row.subjectCode}
                        </span>
                      </span>
                      {!needsAnswer && (
                        <ChevronDown
                          aria-hidden="true"
                          className={cn(
                            'ml-auto size-4 shrink-0 text-ink-3 transition-transform md:hidden',
                            open && 'rotate-180',
                          )}
                        />
                      )}
                    </button>
                  </div>
                  <div className="mt-2 grid grid-cols-4 gap-2 text-[12px] md:contents md:text-[13px]">
                    <Cell label="Int" value={row.internal} />
                    <Cell label="Ext" value={row.external} />
                    <Cell label="Total" value={row.total} />
                    <Cell
                      label="Credits"
                      value={
                        enrichment.credits.value === null ? '' : String(enrichment.credits.value)
                      }
                      reason={enrichment.credits.reason}
                    />
                    <span className="hidden justify-center md:flex">
                      {enrichment.grade.value === null ? (
                        <Unavailable reason={enrichment.grade.reason} />
                      ) : (
                        <Badge tone={gradeTone(enrichment.grade.value)}>
                          {enrichment.grade.value}
                        </Badge>
                      )}
                    </span>
                    <span className="hidden text-right md:block">
                      {row.resultStatus === '' ? (
                        <Unavailable />
                      ) : (
                        <Badge
                          tone={
                            row.resultStatus === 'P'
                              ? 'success'
                              : row.resultStatus === 'F'
                                ? 'danger'
                                : 'neutral'
                          }
                        >
                          {row.resultStatus}
                        </Badge>
                      )}
                    </span>
                  </div>
                </div>

                {open && (
                  <div className="animate-fade border-t border-line bg-panel px-5 py-4">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <Field label={`Subject code ${position}`}>
                        <Input
                          className="font-mono"
                          value={row.subjectCode}
                          onChange={(event) => update(row.id, { subjectCode: event.target.value })}
                        />
                      </Field>
                      <Field label={`Subject name ${position}`}>
                        <Input
                          value={row.subjectTitle}
                          onChange={(event) => update(row.id, { subjectTitle: event.target.value })}
                        />
                      </Field>
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                      <Field label={`Internal ${position}`}>
                        <Input
                          inputMode="numeric"
                          value={row.internal}
                          onChange={(event) => update(row.id, { internal: event.target.value })}
                        />
                      </Field>
                      <Field label={`External ${position}`}>
                        <Input
                          inputMode="numeric"
                          value={row.external}
                          onChange={(event) => update(row.id, { external: event.target.value })}
                        />
                      </Field>
                      <Field label={`Total ${position}`}>
                        <Input
                          inputMode="numeric"
                          value={row.total}
                          onChange={(event) => update(row.id, { total: event.target.value })}
                        />
                      </Field>
                      <Field label={`Result ${position}`}>
                        <Select
                          value={toNone(row.resultStatus)}
                          onValueChange={(value) =>
                            update(row.id, { resultStatus: fromNone(value) })
                          }
                          options={withNone(STATUS_OPTIONS)}
                        />
                      </Field>
                      {/*
                        CREDITS ONCE. The value GradTools knows sits in the
                        field as its placeholder, with who vouches for it; a
                        typed figure replaces it and becomes the student's own.
                      */}
                      <Field
                        label={`Credits ${position}`}
                        hint={
                          row.credits !== ''
                            ? 'Your own record.'
                            : enrichment.credits.value !== null
                              ? `${String(enrichment.credits.value)} — ${enrichment.credits.source ?? ''}. The card does not print credits.`
                              : 'Not provided by the document. Type it if you know it.'
                        }
                      >
                        <Input
                          inputMode="decimal"
                          value={row.credits}
                          placeholder={
                            enrichment.credits.value === null
                              ? undefined
                              : String(enrichment.credits.value)
                          }
                          onChange={(event) => update(row.id, { credits: event.target.value })}
                        />
                      </Field>
                      <Field label={`Grade ${position}`} hint="Only if the card prints one.">
                        {activeRules === undefined ? (
                          /* No verified letters for this scheme: the printed one, as printed. */
                          <Input
                            value={row.gradeLetter}
                            onChange={(event) =>
                              update(row.id, {
                                gradeLetter: event.target.value.trim().toUpperCase(),
                              })
                            }
                          />
                        ) : (
                          <Select
                            value={toNone(row.gradeLetter)}
                            onValueChange={(value) =>
                              update(row.id, { gradeLetter: fromNone(value) })
                            }
                            options={withNone(gradeOptionsFor(activeRules))}
                          />
                        )}
                      </Field>
                      {needsAnswer && (
                        <Field
                          label={`Final exam ${position}`}
                          hint="This card does not say, and it changes the result."
                          className="col-span-2"
                        >
                          <Select
                            value={toNone(row.hasSee)}
                            onValueChange={(value) => update(row.id, { hasSee: fromNone(value) })}
                            options={[
                              { value: NONE, label: 'Not sure' },
                              { value: 'yes', label: 'Had a final exam' },
                              { value: 'no', label: 'No final exam' },
                            ]}
                          />
                        </Field>
                      )}
                    </div>
                    {enrichment.conflict !== null && (
                      <p role="status" className="mt-3 text-[13px] font-medium text-warning">
                        {enrichment.conflict}
                      </p>
                    )}
                    <Resolved row={row} enrichment={enrichment} />
                    <p className="mt-3 truncate font-mono text-[11px] text-ink-3">
                      <span className="font-sans font-medium text-ink-2">Read from</span>{' '}
                      {row.sourceLine}
                    </p>
                    {/* A total mismatch is worked out live, above, from what is in the fields now. */}
                    {row.warnings
                      .filter((warning) => warning.kind !== 'total_mismatch')
                      .map((warning) => (
                        <p key={warning.kind} className="mt-1 text-[12px] text-warning">
                          {warning.message}
                        </p>
                      ))}
                    <div className="mt-3 flex justify-end">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-danger hover:text-danger"
                        icon={<Trash2 />}
                        aria-label={`Remove row ${position}`}
                        onClick={() =>
                          setRows((current) =>
                            current.filter((candidate) => candidate.id !== row.id),
                          )
                        }
                      >
                        Remove this course
                      </Button>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </Card>

      <SaveFooter
        error={error}
        saving={state === 'saving'}
        disabled={!ready || rows.length === 0}
        onConfirm={() => void confirm()}
        icon={<FileCheck2 />}
        confirmLabel={`Confirm and save ${formatCount(rows.length, 'course')}`}
        secondary={
          <Button variant="ghost" onClick={onDiscard}>
            Discard this document
          </Button>
        }
      />
    </ReviewCard>
  );
}

function Cell({
  label,
  value,
  reason,
}: {
  readonly label: string;
  readonly value: string;
  readonly reason?: string | null | undefined;
}) {
  const missing = value.trim() === '';
  return (
    <span className="md:text-right">
      <span className="block text-[10px] text-ink-3 uppercase md:hidden">{label}</span>
      {missing ? (
        <Unavailable reason={reason} />
      ) : (
        <span className="tnum font-medium text-ink md:font-normal">{value}</span>
      )}
    </span>
  );
}

function Resolved({
  row,
  enrichment,
}: {
  readonly row: DraftRow;
  readonly enrichment: RowEnrichment;
}) {
  const { grade, gradePoint, courseKind } = enrichment;
  const items = [
    {
      term: 'Assessment',
      missing: courseKind.kind === null,
      value: courseKind.kind === null ? 'Not known' : COURSE_KIND_LABEL[courseKind.kind],
      why:
        courseKind.kind === null
          ? 'Answer the final-exam question above to settle it.'
          : courseKind.from === 'catalogue'
            ? 'GradTools catalogue'
            : courseKind.from === 'grade'
              ? 'From the printed grade'
              : 'From the marks',
    },
    {
      term: 'Grade',
      missing: grade.value === null,
      value: grade.value ?? 'Not known',
      why: grade.value === null ? grade.reason : grade.source,
    },
    {
      term: 'Grade point',
      missing: gradePoint.value === null,
      value: gradePoint.value === null ? 'Not known' : String(gradePoint.value),
      why: gradePoint.value === null ? gradePoint.reason : null,
    },
  ];
  return (
    <dl
      aria-label={`What is known about ${row.subjectCode}`}
      className="mt-4 grid grid-cols-2 gap-x-8 gap-y-3 text-[12px] sm:grid-cols-4"
    >
      {items.map((item) => (
        <div key={item.term}>
          <dt className="text-ink-3">{item.term}</dt>
          <dd className={cn('mt-0.5 font-medium', item.missing ? 'text-warning' : 'tnum text-ink')}>
            {item.value}
          </dd>
          {item.why !== null && item.why !== undefined && item.why !== '' && (
            <dd className="text-[11px] text-ink-3">{item.why}</dd>
          )}
        </div>
      ))}
    </dl>
  );
}
