/**
 * SGPA and CGPA calculators.
 *
 * Authority: docs/03 UF-04/UF-05, docs/16 §16.8, M3 continuation §15-§16.
 *
 * ---------------------------------------------------------------------------
 * NO ACADEMIC ARITHMETIC EXISTS IN THIS FILE.
 * ---------------------------------------------------------------------------
 * Every displayed number comes from @gradtools/academic-rules, resolved
 * against an explicit RuleSet. In particular the percentage conversion is NOT
 * implemented here: `calculatePercentage` applies the rule set's
 * `cgpa_x_10` formula (22OB 6.7). React never multiplies a CGPA by anything.
 */

import { useMemo, useState } from 'react';
import {
  calculateCGPA,
  calculateClass,
  calculatePercentage,
  calculateSGPA,
  vtu2022RuleSet,
  type CourseGrade,
  type SemesterSummary,
} from '@gradtools/academic-rules';
import { PageHeader } from '../../components/AppShell.js';
import { Icon } from '../../components/icons.js';
import {
  Button,
  ExplanationDisclosure,
  Notice,
  Panel,
  SelectField,
  StatusPill,
  TextField,
} from '../../components/ui/index.js';
import { formatGpa, formatPercent } from '../../lib/format.js';
import { newId } from '../../lib/id.js';
import { useResults } from '../../hooks/useCollection.js';
import styles from './academics.module.css';

const ruleSet = vtu2022RuleSet;

/** Credit values a VTU course can carry. A select, not free text. */
const CREDIT_OPTIONS = [0.5, 1, 1.5, 2, 3, 4, 5] as const;

interface CourseRow {
  readonly id: string;
  readonly subjectCode: string;
  readonly credits: string;
  readonly gradeLetter: string;
}

function blankRow(): CourseRow {
  return { id: newId(), subjectCode: '', credits: '4', gradeLetter: 'A' };
}

export function AcademicsPage() {
  return (
    <>
      <PageHeader
        title="SGPA & CGPA"
        subtitle="Every figure is computed by the shared rules engine against the VTU 2022 regulation, and every one can show its working."
      />
      <div className={styles.stack}>
        <SgpaCalculator />
        <CgpaCalculator />
      </div>
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* SGPA                                                                       */
/* -------------------------------------------------------------------------- */

function SgpaCalculator() {
  const [rows, setRows] = useState<CourseRow[]>(() => [
    blankRow(),
    blankRow(),
    blankRow(),
    blankRow(),
    blankRow(),
  ]);

  const courses: CourseGrade[] = useMemo(
    () =>
      rows
        .filter((row) => row.gradeLetter !== '')
        .map((row) => ({
          credits: Number(row.credits),
          gradeLetter: row.gradeLetter,
          ...(row.subjectCode.trim() === '' ? {} : { subjectCode: row.subjectCode.trim() }),
        })),
    [rows],
  );

  const result = useMemo(() => calculateSGPA(courses, ruleSet), [courses]);

  const update = (id: string, patch: Partial<CourseRow>) => {
    setRows((current) => current.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  };

  const gradeOptions = [...ruleSet.gradeBands, ...ruleSet.specialGrades];

  return (
    <Panel
      title="SGPA for one semester"
      action={
        <Button small onClick={() => setRows((current) => [...current, blankRow()])}>
          <Icon name="plus" size="nav" />
          Add course
        </Button>
      }
      flush
    >
      <div className={styles.rowsHeader} aria-hidden="true">
        <span>Subject code</span>
        <span>Credits</span>
        <span>Grade</span>
        <span />
      </div>

      <ul className={styles.rows}>
        {rows.map((row, index) => (
          <li className={styles.row} key={row.id}>
            <TextField
              label={`Subject code, course ${String(index + 1)}`}
              placeholder="BCS301"
              value={row.subjectCode}
              mono
              onChange={(event) => {
                update(row.id, { subjectCode: event.target.value });
              }}
            />
            <SelectField
              label={`Credits, course ${String(index + 1)}`}
              value={row.credits}
              onChange={(event) => {
                update(row.id, { credits: event.target.value });
              }}
            >
              {CREDIT_OPTIONS.map((credit) => (
                <option key={credit} value={credit}>
                  {credit}
                </option>
              ))}
            </SelectField>
            <SelectField
              label={`Grade, course ${String(index + 1)}`}
              value={row.gradeLetter}
              onChange={(event) => {
                update(row.id, { gradeLetter: event.target.value });
              }}
            >
              {gradeOptions.map((grade) => (
                <option key={grade.letter} value={grade.letter}>
                  {'points' in grade && grade.points !== null
                    ? `${grade.letter} (${String(grade.points)} points)`
                    : grade.letter}
                </option>
              ))}
            </SelectField>
            <Button
              variant="danger"
              iconOnly
              aria-label={`Remove course ${String(index + 1)}`}
              disabled={rows.length === 1}
              onClick={() => {
                setRows((current) => current.filter((candidate) => candidate.id !== row.id));
              }}
            >
              <Icon name="trash" size="nav" />
            </Button>
          </li>
        ))}
      </ul>

      <div className={styles.answer}>
        {result.ok ? (
          <>
            <p className={styles.answerValue}>{formatGpa(result.value)}</p>
            <p className={styles.answerCaption}>
              SGPA · {String(courses.length)} courses ·{' '}
              {String(result.explanation.inputs.totalCredits ?? 0)} credits
            </p>
          </>
        ) : (
          <>
            <p className={styles.answerPlaceholder}>—</p>
            <p className={styles.answerCaption}>{result.detail}</p>
          </>
        )}
      </div>

      <ExplanationDisclosure explanation={result.explanation} />
    </Panel>
  );
}

/* -------------------------------------------------------------------------- */
/* CGPA                                                                       */
/* -------------------------------------------------------------------------- */

interface SemesterRow {
  readonly id: string;
  readonly semester: string;
  readonly credits: string;
  readonly sgpa: string;
}

function blankSemester(index: number): SemesterRow {
  return { id: newId(), semester: String(index + 1), credits: '', sgpa: '' };
}

function CgpaCalculator() {
  const { items: savedResults } = useResults();

  const [rows, setRows] = useState<SemesterRow[]>(() => [blankSemester(0), blankSemester(1)]);

  const semesters: SemesterSummary[] = useMemo(
    () =>
      rows
        .filter((row) => row.credits.trim() !== '' && row.sgpa.trim() !== '')
        .map((row) => ({
          credits: Number(row.credits),
          sgpa: Number(row.sgpa),
          semester: Number(row.semester),
        })),
    [rows],
  );

  const cgpa = useMemo(() => calculateCGPA(semesters, ruleSet), [semesters]);
  const percentage = useMemo(
    () => (cgpa.ok ? calculatePercentage(cgpa.value, ruleSet) : null),
    [cgpa],
  );
  const classBand = useMemo(
    () => (percentage?.ok === true ? calculateClass(percentage.value, ruleSet) : null),
    [percentage],
  );

  const update = (id: string, patch: Partial<SemesterRow>) => {
    setRows((current) => current.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  };

  return (
    <Panel
      title="CGPA across semesters"
      action={
        <Button
          small
          onClick={() => {
            setRows((current) => [...current, blankSemester(current.length)]);
          }}
        >
          <Icon name="plus" size="nav" />
          Add semester
        </Button>
      }
      flush
    >
      {savedResults.length > 0 && (
        <div className={styles.panelNotice}>
          <Notice>
            You have {String(savedResults.length)} saved semester result
            {savedResults.length === 1 ? '' : 's'}. Use <strong>Fill from saved results</strong> to
            load them.
            <div className={styles.noticeAction}>
              <Button
                small
                onClick={() => {
                  setRows(
                    savedResults.map((saved) => {
                      const computed = calculateSGPA(
                        saved.subjects.map((subject) => ({
                          credits: subject.credits,
                          gradeLetter: subject.gradeLetter,
                          subjectCode: subject.subjectCode,
                        })),
                        ruleSet,
                      );
                      const credits = saved.subjects.reduce(
                        (total, subject) => total + subject.credits,
                        0,
                      );
                      return {
                        id: saved.id,
                        semester: String(saved.semester),
                        credits: String(credits),
                        sgpa: computed.ok ? computed.value.toFixed(2) : '',
                      };
                    }),
                  );
                }}
              >
                Fill from saved results
              </Button>
            </div>
          </Notice>
        </div>
      )}

      <div className={styles.semesterHeader} aria-hidden="true">
        <span>Semester</span>
        <span>Total credits</span>
        <span>SGPA</span>
        <span />
      </div>

      <ul className={styles.rows}>
        {rows.map((row, index) => (
          <li className={styles.semesterRow} key={row.id}>
            <SelectField
              label={`Semester number, row ${String(index + 1)}`}
              value={row.semester}
              onChange={(event) => {
                update(row.id, { semester: event.target.value });
              }}
            >
              {[1, 2, 3, 4, 5, 6, 7, 8].map((semester) => (
                <option key={semester} value={semester}>
                  Semester {semester}
                </option>
              ))}
            </SelectField>
            <TextField
              label={`Total credits, row ${String(index + 1)}`}
              inputMode="numeric"
              placeholder="22"
              value={row.credits}
              onChange={(event) => {
                update(row.id, { credits: event.target.value });
              }}
            />
            <TextField
              label={`SGPA, row ${String(index + 1)}`}
              inputMode="decimal"
              placeholder="8.43"
              value={row.sgpa}
              onChange={(event) => {
                update(row.id, { sgpa: event.target.value });
              }}
            />
            <Button
              variant="danger"
              iconOnly
              aria-label={`Remove semester row ${String(index + 1)}`}
              disabled={rows.length === 1}
              onClick={() => {
                setRows((current) => current.filter((candidate) => candidate.id !== row.id));
              }}
            >
              <Icon name="trash" size="nav" />
            </Button>
          </li>
        ))}
      </ul>

      <div className={styles.answer}>
        {cgpa.ok ? (
          <>
            <p className={styles.answerValue}>{formatGpa(cgpa.value)}</p>
            <p className={styles.answerCaption}>CGPA · {String(semesters.length)} semesters</p>
            <div className={styles.derived}>
              {percentage?.ok === true && (
                <span className={styles.derivedItem}>
                  <span className={styles.derivedLabel}>Percentage</span>
                  <span className="tabular">{formatPercent(percentage.value)}</span>
                </span>
              )}
              {classBand?.ok === true && (
                <span className={styles.derivedItem}>
                  <span className={styles.derivedLabel}>Class</span>
                  <StatusPill tone="accent">{classBand.value.label}</StatusPill>
                </span>
              )}
            </div>
          </>
        ) : (
          <>
            <p className={styles.answerPlaceholder}>—</p>
            <p className={styles.answerCaption}>{cgpa.detail}</p>
          </>
        )}
      </div>

      <ExplanationDisclosure explanation={cgpa.explanation} />

      {percentage?.ok === true && (
        <div className={styles.percentageNote}>
          <Notice>
            <strong>Percentage = CGPA × 10</strong>, per clause 22OB 6.7 of the VTU 2022 regulation,
            which gives this worked example: CGPA 8.20 → 82.0%.
            <br />
            Many other calculators subtract 0.75 before multiplying, which returns a figure exactly
            7.5 percentage points lower. That formula does not appear in the 2022 regulation.
            GradTools follows the regulation.
          </Notice>
        </div>
      )}
    </Panel>
  );
}
