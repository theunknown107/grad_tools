import { ArrowDown, ArrowRight, ArrowUp, BookOpen, Dot } from 'lucide-react';
import { Badge } from '../../components/ui/badge.js';
import { Card } from '../../components/ui/card.js';
import { EmptyState } from '../../components/ui/feedback.js';
import { SectionTitle } from '../../components/ui/page.js';
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableRowHead,
  numeric,
} from '../../components/ui/table.js';
import type { StrengthAnalysis, SubjectPerformance } from '../../domain/academics.js';
import { gradeTone } from '../../components/academic/grade-tone.js';

const TREND = {
  improved: { text: 'Improved', Icon: ArrowUp, tone: 'text-success' },
  declined: { text: 'Declined', Icon: ArrowDown, tone: 'text-warning' },
  unchanged: { text: 'Unchanged', Icon: ArrowRight, tone: 'text-ink-3' },
  single_attempt: { text: 'Taken once', Icon: Dot, tone: 'text-ink-3' },
} as const;

/** Every graded subject, measured only against the student's own average. */
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
    <Card className="p-5" aria-labelledby="subjects-title">
      <SectionTitle id="subjects-title">Subjects</SectionTitle>
      <p className="mb-4 text-[13px] text-ink-2">
        {strengths.available ? (
          <>
            Strong and weak are measured against your own average of{' '}
            <strong className="tnum font-semibold text-ink">
              {strengths.meanGradePoint?.toFixed(2)}
            </strong>{' '}
            grade points: a subject a full grade point above it is strong, a full grade point below
            is weak. Nothing is compared to other students.
          </>
        ) : (
          strengths.reason
        )}
      </p>
      {performances.length === 0 ? (
        loading ? null : (
          <EmptyState
            compact
            icon={<BookOpen />}
            title="No graded subjects yet"
            description="Add a semester result and your subjects appear here."
          />
        )
      ) : (
        <div className="overflow-hidden rounded-xl border border-line">
          <Table>
            <TableCaption>Every subject you have a grade for, most recent first.</TableCaption>
            <TableHeader>
              <tr>
                <TableHead>Subject</TableHead>
                <TableHead className="text-right">Semester</TableHead>
                <TableHead className="text-center">Grade</TableHead>
                <TableHead className="text-right">Points</TableHead>
                <TableHead>Trend</TableHead>
                <TableHead>Standing</TableHead>
              </tr>
            </TableHeader>
            <TableBody>
              {performances.map((performance) => {
                const standing = standingOf(performance.subjectCode);
                const trend = TREND[performance.trend];
                return (
                  <TableRow key={performance.subjectCode}>
                    <TableRowHead className="font-mono text-[12px]">
                      {performance.subjectCode}
                    </TableRowHead>
                    <TableCell className={numeric}>S{performance.semester}</TableCell>
                    <TableCell className="text-center">
                      <Badge tone={gradeTone(performance.gradeLetter)}>
                        {performance.gradeLetter}
                      </Badge>
                    </TableCell>
                    <TableCell className={numeric}>{performance.gradePoint ?? '—'}</TableCell>
                    <TableCell className="whitespace-nowrap">
                      <span className={`inline-flex items-center gap-1 ${trend.tone}`}>
                        <trend.Icon className="size-3.5" aria-hidden="true" />
                        {trend.text}
                      </span>
                      {performance.attempts.length > 1 && (
                        <span className="text-ink-3">
                          {' '}
                          ({performance.attempts.length} attempts)
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      {standing === undefined ? (
                        <span className="text-ink-3">—</span>
                      ) : standing === 'strong' ? (
                        <Badge tone="success">Strong</Badge>
                      ) : standing === 'weak' ? (
                        <Badge tone="warning">Weak</Badge>
                      ) : (
                        <Badge>Typical</Badge>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </Card>
  );
}
