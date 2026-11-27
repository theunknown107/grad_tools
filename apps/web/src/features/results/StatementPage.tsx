/**
 * Academic summary, for printing or saving as PDF from the browser.
 *
 * Authority: docs/53 · domain/statement.ts
 *
 * The browser's own print dialog is the PDF writer: no library, nothing
 * uploaded. The page stands outside the app shell (no sidebar or bars to hide)
 * but inside the onboarding gate, so it is shown to exactly the people the app
 * would be shown to. The toolbar is screen-only; the document is what prints.
 */

import { ArrowLeft, Printer } from 'lucide-react';
import { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Button } from '../../components/ui/button.js';
import { Callout } from '../../components/ui/feedback.js';
import { Select } from '../../components/ui/field.js';
import { PageSkeleton } from '../../components/ui/skeleton.js';
import {
  buildStatement,
  STATEMENT_DISCLAIMER,
  type StatementMark,
  type StatementSemester,
} from '../../domain/statement.js';
import type { Metric } from '../../domain/statistics.js';
import { resolveSubject } from '../../domain/subjects.js';
import { useAcademicState } from '../../hooks/useAcademicState.js';
import { useBacklogs, useProfile } from '../../hooks/useCollection.js';
import { useSubjectIndex } from '../../hooks/useSubjectIndex.js';
import { formatGpa, formatPercent } from '../../lib/format.js';

const STUDENT_LABEL = {
  name: 'Name',
  usn: 'USN',
  college: 'College',
  programme: 'Programme',
  branch: 'Branch',
  scheme: 'Scheme',
} as const;

function markText(mark: StatementMark | null): string {
  if (mark === null) return '—';
  return mark.outOf === null ? String(mark.value) : `${String(mark.value)} / ${String(mark.outOf)}`;
}

/** A figure, or the reason there is none. Never a zero standing in for "unknown". */
function MetricText({
  metric,
  format,
}: {
  readonly metric: Metric<number>;
  readonly format: (value: number) => string;
}) {
  return metric.value !== null ? (
    <strong>{format(metric.value)}</strong>
  ) : (
    <span className="text-ink-3">Not available — {metric.reason ?? 'not enough information.'}</span>
  );
}

function SemesterSection({ semester }: { readonly semester: StatementSemester }) {
  return (
    <section className="statement-semester mt-6" aria-labelledby={`sem-${String(semester.number)}`}>
      <h2 id={`sem-${String(semester.number)}`} className="text-[15px] font-semibold">
        Semester {semester.number}
      </h2>
      <table className="statement-table mt-2 w-full border-collapse text-[12px]">
        <thead>
          <tr>
            <th scope="col">Code</th>
            <th scope="col" className="w-[34%]">
              Course
            </th>
            <th scope="col">CIE</th>
            <th scope="col">SEE</th>
            <th scope="col">Total</th>
            <th scope="col">Credits</th>
            <th scope="col">Grade</th>
            <th scope="col">Result</th>
          </tr>
        </thead>
        <tbody>
          {semester.rows.map((row, index) => (
            <tr key={`${row.code ?? 'row'}-${String(index)}`}>
              <td className="font-mono">{row.code ?? '—'}</td>
              <td>
                {row.title}
                {row.note !== null && <div className="text-[12px] text-ink-3">{row.note}</div>}
              </td>
              <td className="tabular-nums">{markText(row.internal)}</td>
              <td className="tabular-nums">{markText(row.external)}</td>
              <td className="tabular-nums">{markText(row.total)}</td>
              <td className="tabular-nums">
                {row.credits === null ? 'Not recorded' : row.credits}
              </td>
              <td>
                {row.grade === null
                  ? '—'
                  : `${row.grade.letter}${row.grade.points === null ? '' : ` (${String(row.grade.points)})`}`}
                {row.gradeFrom === 'rules' && (
                  <div className="text-[12px] text-ink-3">from the marks</div>
                )}
              </td>
              <td>
                {row.passed === null ? 'Not determined' : row.passed ? 'Passed' : 'Not passed'}
                {row.printedStatus !== null && (
                  <div className="text-[12px] text-ink-3">card: {row.printedStatus}</div>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <dl className="statement-figures mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-0.5 text-[12px]">
        <dt>SGPA</dt>
        <dd>
          <MetricText metric={semester.sgpa} format={formatGpa} />
        </dd>
        {semester.sgpaPrinted !== null && (
          <>
            <dt>SGPA on the grade card</dt>
            <dd>{formatGpa(semester.sgpaPrinted)} (as you entered it)</dd>
          </>
        )}
        <dt>Credits registered</dt>
        <dd>
          <MetricText metric={semester.creditsAttempted} format={String} />
        </dd>
        <dt>Credits earned</dt>
        <dd>
          <MetricText metric={semester.creditsEarned} format={String} />
        </dd>
      </dl>
    </section>
  );
}

export function StatementPage() {
  const [params, setParams] = useSearchParams();
  const { statistics, loading } = useAcademicState();
  const { profile } = useProfile();
  const { items: backlogs } = useBacklogs();
  const { index } = useSubjectIndex();

  const requested = Number(params.get('semester'));
  const semester =
    Number.isInteger(requested) && requested >= 1 && requested <= 8 ? requested : null;

  const statement = useMemo(
    () =>
      buildStatement({
        profile,
        statistics,
        backlogs,
        identify: (code) => (code === null ? null : resolveSubject(index, code)),
        semester,
      }),
    [profile, statistics, backlogs, index, semester],
  );

  if (loading) return <PageSkeleton label="Preparing your academic summary" />;

  const withResults = statistics.semesters.filter((entry) => entry.view.result !== null);
  const studentRows = Object.entries(statement.student) as [keyof typeof STUDENT_LABEL, string][];
  const generated = new Date(statement.generatedAt).toLocaleString('en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });

  return (
    <div className="statement-page mx-auto w-full max-w-4xl px-4 py-6">
      <div className="mb-4 flex flex-wrap items-center gap-2 print:hidden">
        <Button asChild variant="ghost" icon={<ArrowLeft />}>
          <Link to="/results">Back to results</Link>
        </Button>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Select
            aria-label="What to include"
            value={semester === null ? 'all' : String(semester)}
            onValueChange={(value) => setParams(value === 'all' ? {} : { semester: value })}
            options={[
              { value: 'all', label: 'All semesters' },
              ...withResults.map((entry) => ({
                value: String(entry.number),
                label: `Semester ${String(entry.number)}`,
              })),
            ]}
          />
          <Button
            variant="primary"
            icon={<Printer />}
            disabled={statement.semesters.length === 0}
            onClick={() => window.print()}
          >
            Print or save as PDF
          </Button>
        </div>
      </div>
      <p className="mb-4 text-[12px] text-ink-3 print:hidden">
        Choose “Save as PDF” as the printer to keep a copy. Nothing leaves this device.
      </p>

      <article className="statement-doc rounded-xl border border-line bg-panel p-6 print:p-0">
        <header>
          <p className="statement-disclaimer rounded-md border border-line px-3 py-2 text-[12px] font-semibold">
            {STATEMENT_DISCLAIMER}
          </p>
          <h1 className="mt-4 text-[20px] font-semibold">
            Academic summary{semester === null ? '' : ` — Semester ${String(semester)}`}
          </h1>
          <p className="text-[12px] text-ink-3">Generated by GradTools on {generated}</p>
          {studentRows.length > 0 && (
            <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-0.5 text-[13px]">
              {studentRows.map(([key, value]) => (
                <div key={key} className="contents">
                  <dt className="text-ink-3">{STUDENT_LABEL[key]}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
          )}
        </header>

        {statement.semesters.length === 0 ? (
          <Callout className="mt-6">
            No results are saved{semester === null ? '' : ` for semester ${String(semester)}`} yet,
            so there is nothing to put on a summary.
          </Callout>
        ) : (
          statement.semesters.map((entry) => (
            <SemesterSection key={entry.number} semester={entry} />
          ))
        )}

        {statement.cumulative !== null && statement.semesters.length > 0 && (
          <section className="statement-cumulative mt-6" aria-labelledby="cumulative">
            <h2 id="cumulative" className="text-[15px] font-semibold">
              Across semesters
            </h2>
            <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-0.5 text-[13px]">
              <dt>CGPA</dt>
              <dd>
                <MetricText metric={statement.cumulative.cgpa} format={formatGpa} />
              </dd>
              {statement.cumulative.cgpa.value === null &&
                statement.cumulative.provisionalCgpa.value !== null && (
                  <>
                    <dt>Provisional CGPA</dt>
                    <dd>
                      {formatGpa(statement.cumulative.provisionalCgpa.value)} over{' '}
                      {statement.cumulative.basis.counted} semester
                      {statement.cumulative.basis.counted === 1 ? '' : 's'} only — not the CGPA
                    </dd>
                  </>
                )}
              <dt>Percentage</dt>
              <dd>
                <MetricText metric={statement.cumulative.percentage} format={formatPercent} />
              </dd>
              <dt>Class</dt>
              <dd>
                {statement.cumulative.classAwarded ?? (
                  <span className="text-ink-3">{statement.cumulative.classNote}</span>
                )}
              </dd>
            </dl>
          </section>
        )}

        {statement.recordedBacklogs.length > 0 && (
          <section className="statement-backlogs mt-6" aria-labelledby="backlogs">
            <h2 id="backlogs" className="text-[15px] font-semibold">
              Backlogs you recorded
            </h2>
            <table className="statement-table mt-2 w-full border-collapse text-[12px]">
              <thead>
                <tr>
                  <th scope="col">Code</th>
                  <th scope="col">Course</th>
                  <th scope="col">Semester taken</th>
                  <th scope="col">Status</th>
                  <th scope="col">Attempts</th>
                </tr>
              </thead>
              <tbody>
                {statement.recordedBacklogs.map((record) => (
                  <tr key={record.id}>
                    <td className="font-mono">{record.subjectCode}</td>
                    <td>{record.subjectTitle}</td>
                    <td>{record.originSemester}</td>
                    <td>
                      {record.status === 'cleared'
                        ? `Cleared${record.clearedInSemester === null ? '' : ` (semester ${String(record.clearedInSemester)})`}`
                        : record.status === 'attempted'
                          ? 'Attempted, result awaited'
                          : 'Active'}
                    </td>
                    <td>{record.attempts}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}

        <footer className="mt-8 border-t border-line pt-3 text-[12px] text-ink-3">
          <p>
            Figures follow the VTU 2022 regulations (22OB): SGPA and CGPA 6.6, percentage = CGPA ×
            10 (6.7), class 6.8
            {statement.ruleSets.length > 0 &&
              ` — rule set ${statement.ruleSets.map((ruleSet) => ruleSet.id).join(', ')}`}
            . A grade marked “from the marks” was worked out by GradTools from the marks you saved;
            others are as printed on your card. Values GradTools does not have are left out, never
            shown as zero.
          </p>
          <p className="mt-1">{STATEMENT_DISCLAIMER}</p>
        </footer>
      </article>
    </div>
  );
}
