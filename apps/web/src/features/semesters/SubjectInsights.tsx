/**
 * Subject performance, and the strong/weak rule.
 *
 * Authority: docs/18 §18.9 · M6 §8, §9
 *
 * NO AI, AND NOTHING QUALITATIVE. Every classification shown here is a rule
 * printed on the same screen, so a student can apply it by hand and disagree
 * with it. Nothing explains WHY a subject went badly — GradTools does not know.
 */

import type { StrengthAnalysis, SubjectPerformance } from '../../domain/academics.js';
import {
  EmptyState,
  Panel,
  StatusPill,
  numericClass,
  tableClass,
  TableScroll,
} from '../../components/ui/index.js';
import styles from './semesters.module.css';

/**
 * A direction, in words as well as an arrow.
 *
 * Never colour or a glyph alone: an arrow is meaningless to a screen reader and
 * to anyone who cannot tell red from green (docs/27).
 */
const TREND_LABEL: Record<SubjectPerformance['trend'], { text: string; symbol: string }> = {
  improved: { text: 'Improved', symbol: '↑' },
  declined: { text: 'Declined', symbol: '↓' },
  unchanged: { text: 'Unchanged', symbol: '→' },
  // A subject sat once has no direction, and saying "unchanged" would dress a
  // single point up as a flat line (M6 §8).
  single_attempt: { text: 'Taken once', symbol: '·' },
};

export function SubjectInsights({
  performances,
  strengths,
  loading,
}: {
  readonly performances: readonly SubjectPerformance[];
  readonly strengths: StrengthAnalysis;
  readonly loading: boolean;
}) {
  const standingOf = (code: string) =>
    strengths.subjects.find((entry) => entry.performance.subjectCode === code)?.standing;

  return (
    <Panel title="Subjects">
      {/*
        THE RULE IS PRINTED, NOT HIDDEN (M6 §9). A classification a student
        cannot check is a classification they have to take on trust.
      */}
      {strengths.available ? (
        <p className={styles.note}>
          Strong and weak are measured against your own average of{' '}
          <strong>{strengths.meanGradePoint?.toFixed(2)}</strong> grade points: a subject a full
          grade point above it is strong, a full grade point below is weak. Nothing is compared to
          other students.
        </p>
      ) : (
        <p className={styles.note}>{strengths.reason}</p>
      )}

      {performances.length === 0 ? (
        loading ? null : (
          <EmptyState>
            No graded subjects yet. Add a semester result and your subjects appear here.
          </EmptyState>
        )
      ) : (
        <TableScroll>
          <table className={tableClass}>
            <caption className={styles.caption}>
              Every subject you have a grade for, most recent first.
            </caption>
            <thead>
              <tr>
                <th scope="col">Subject</th>
                <th scope="col">Semester</th>
                <th scope="col">Grade</th>
                <th scope="col">Points</th>
                <th scope="col">Trend</th>
                <th scope="col">Standing</th>
              </tr>
            </thead>
            <tbody>
              {performances.map((performance) => {
                const standing = standingOf(performance.subjectCode);
                const trend = TREND_LABEL[performance.trend];
                return (
                  <tr key={performance.subjectCode}>
                    {/* Student-entered text, rendered as text. */}
                    <th scope="row">{performance.subjectCode}</th>
                    <td className={numericClass}>{performance.semester}</td>
                    <td>{performance.gradeLetter}</td>
                    <td className={numericClass}>{performance.gradePoint ?? '—'}</td>
                    <td>
                      <span aria-hidden="true">{trend.symbol} </span>
                      {trend.text}
                      {performance.attempts.length > 1 && (
                        <span className={styles.attempts}>
                          {' '}
                          ({performance.attempts.length} attempts)
                        </span>
                      )}
                    </td>
                    <td>
                      {standing === undefined ? (
                        '—'
                      ) : standing === 'strong' ? (
                        <StatusPill tone="success">Strong</StatusPill>
                      ) : standing === 'weak' ? (
                        <StatusPill tone="warning">Weak</StatusPill>
                      ) : (
                        <StatusPill tone="neutral">Typical</StatusPill>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </TableScroll>
      )}
    </Panel>
  );
}
