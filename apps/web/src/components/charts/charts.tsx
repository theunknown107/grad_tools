/**
 * Charts — the design's recharts compositions.
 *
 * Every series is a token (`--accent`, the `--chart-*` ramp), so Mono draws in
 * grayscale and a colour accent draws in one hue. Each chart carries a
 * visually-hidden table of the same figures: a picture of a trend is not the
 * trend for someone who cannot see it.
 *
 * The figures are the rules engine's (`AcademicStatistics.trend`,
 * `.grades`). Nothing is computed here.
 */

import type { ReactNode } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { GradeDistribution, TrendPoint } from '../../domain/statistics.js';
import { cn } from '../../lib/cn.js';

const axisTick = { fill: 'var(--text-muted)', fontSize: 12 } as const;

interface TipEntry {
  readonly dataKey?: string | number;
  readonly name?: string | number;
  readonly value?: number | string | null;
  readonly color?: string;
  readonly stroke?: string;
}

export function ChartTip({
  active,
  payload,
  label,
  suffix = '',
  names = {},
}: {
  readonly active?: boolean;
  readonly payload?: readonly TipEntry[];
  readonly label?: string | number;
  readonly suffix?: string;
  readonly names?: Readonly<Record<string, string>>;
}) {
  if (active !== true || payload === undefined || payload.length === 0) return null;
  const shown = payload.filter((entry) => entry.value !== null && entry.value !== undefined);
  if (shown.length === 0) return null;
  return (
    <div className="rounded-lg border border-line bg-raised px-3 py-2 shadow-e2">
      <div className="mb-1 font-mono text-[11px] text-ink-3">{label}</div>
      {shown.map((entry) => {
        const key = String(entry.dataKey ?? entry.name ?? '');
        return (
          <div key={key} className="flex items-center gap-2 text-[12px]">
            <span
              className="size-2 rounded-full"
              style={{ background: entry.color ?? entry.stroke }}
            />
            <span className="text-ink-2">{names[key] ?? key}</span>
            <span className="tnum ml-auto pl-3 font-semibold text-ink">
              {entry.value}
              {suffix}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/** A visually-hidden table that states what the chart draws. */
function ChartTable({
  caption,
  head,
  rows,
}: {
  readonly caption: string;
  readonly head: readonly string[];
  readonly rows: readonly (readonly ReactNode[])[];
}) {
  // `sr-only` on the wrapper: a table ignores the 1px width and would widen the page.
  return (
    <div className="sr-only">
      <table>
        <caption>{caption}</caption>
        <thead>
          <tr>
            {head.map((cell) => (
              <th key={cell} scope="col">
                {cell}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index}>
              {row.map((cell, cellIndex) => (
                <td key={cellIndex}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function domainFor(values: readonly number[]): [number, number] {
  if (values.length === 0) return [0, 10];
  const low = Math.max(0, Math.floor(Math.min(...values) - 0.5));
  const high = Math.min(10, Math.ceil(Math.max(...values) + 0.5));
  return low === high ? [Math.max(0, low - 1), Math.min(10, high + 1)] : [low, high];
}

/* ---------------------------------------------------------- SGPA / CGPA */

export function SgpaTrendChart({
  points,
  variant = 'area',
  height = 224,
  className,
}: {
  readonly points: readonly TrendPoint[];
  readonly variant?: 'area' | 'line';
  readonly height?: number;
  readonly className?: string;
}) {
  const lastWithData = points.reduce(
    (last, point, index) => (point.sgpa !== null || point.cgpaSoFar !== null ? index : last),
    -1,
  );
  const data = points.slice(0, lastWithData + 1).map((point) => ({
    sem: `S${String(point.semester)}`,
    sgpa: point.sgpa,
    cgpaSoFar: point.cgpaSoFar,
  }));
  const values = points.flatMap((point) =>
    [point.sgpa, point.cgpaSoFar].filter((value): value is number => value !== null),
  );
  const domain = domainFor(values);
  const names = { sgpa: 'SGPA', cgpaSoFar: 'CGPA' };
  const margin = { top: 8, right: 8, left: -18, bottom: 0 };
  const common = (
    <>
      <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
      <XAxis dataKey="sem" tick={axisTick} axisLine={false} tickLine={false} />
      <YAxis
        domain={domain}
        tick={axisTick}
        axisLine={false}
        tickLine={false}
        allowDecimals={false}
      />
      <Tooltip content={<ChartTip names={names} />} cursor={{ stroke: 'var(--border-strong)' }} />
    </>
  );
  return (
    <figure className={cn('relative m-0', className)}>
      <div aria-hidden="true" style={{ height }}>
        <ResponsiveContainer width="100%" height={height}>
          {variant === 'area' ? (
            <AreaChart data={data} margin={margin} accessibilityLayer={false}>
              <defs>
                <linearGradient id="gt-sgpa-fill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.28} />
                  <stop offset="100%" stopColor="var(--accent)" stopOpacity={0} />
                </linearGradient>
              </defs>
              {common}
              <Area
                type="monotone"
                dataKey="sgpa"
                stroke="var(--accent)"
                strokeWidth={2.5}
                fill="url(#gt-sgpa-fill)"
                dot={{ r: 3, fill: 'var(--accent)' }}
                activeDot={{ r: 5 }}
                connectNulls={false}
                isAnimationActive
              />
              <Area
                type="monotone"
                dataKey="cgpaSoFar"
                stroke="var(--chart-3)"
                strokeWidth={1.5}
                strokeDasharray="4 4"
                fill="none"
                dot={false}
                connectNulls={false}
              />
            </AreaChart>
          ) : (
            <LineChart data={data} margin={margin} accessibilityLayer={false}>
              {common}
              <Line
                type="monotone"
                dataKey="sgpa"
                stroke="var(--accent)"
                strokeWidth={2.5}
                dot={{ r: 3 }}
                connectNulls={false}
              />
              <Line
                type="monotone"
                dataKey="cgpaSoFar"
                stroke="var(--chart-3)"
                strokeWidth={2}
                strokeDasharray="4 4"
                dot={{ r: 3 }}
                connectNulls={false}
              />
            </LineChart>
          )}
        </ResponsiveContainer>
      </div>
      <figcaption className="mt-2 flex flex-wrap items-center gap-4 text-[12px] text-ink-2">
        <span className="flex items-center gap-1.5">
          <span aria-hidden="true" className="size-2 rounded-full bg-accent" />
          SGPA per semester
        </span>
        <span className="flex items-center gap-1.5">
          <span aria-hidden="true" className="h-0.5 w-3.5 rounded-full bg-chart-3" />
          CGPA so far
        </span>
      </figcaption>
      <ChartTable
        caption="SGPA and cumulative CGPA by semester"
        head={['Semester', 'SGPA', 'CGPA so far']}
        rows={points.map((point) => [
          `Semester ${String(point.semester)}`,
          point.sgpa === null ? 'Not graded' : point.sgpa.toFixed(2),
          point.cgpaSoFar === null ? 'Not available' : point.cgpaSoFar.toFixed(2),
        ])}
      />
    </figure>
  );
}

/* ------------------------------------------------------ Grade distribution */

export function GradeDistributionChart({
  grades,
  height = 224,
}: {
  readonly grades: GradeDistribution;
  readonly height?: number;
}) {
  const rows = [
    ...grades.bands.map((band) => ({ grade: band.letter, count: band.count, meaning: '' })),
    ...grades.specials
      .filter((special) => special.count > 0)
      .map((special) => ({
        grade: special.letter,
        count: special.count,
        meaning: special.meaning,
      })),
    ...(grades.unresolved > 0
      ? [{ grade: '?', count: grades.unresolved, meaning: 'No grade this build can resolve yet' }]
      : []),
  ];
  return (
    <figure className="relative m-0">
      <div aria-hidden="true" style={{ height }}>
        <ResponsiveContainer width="100%" height={height}>
          <BarChart
            data={rows}
            margin={{ top: 8, right: 8, left: -22, bottom: 0 }}
            accessibilityLayer={false}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
            <XAxis dataKey="grade" tick={axisTick} axisLine={false} tickLine={false} interval={0} />
            <YAxis tick={axisTick} axisLine={false} tickLine={false} allowDecimals={false} />
            <Tooltip
              content={<ChartTip suffix=" courses" names={{ count: 'Courses' }} />}
              cursor={{ fill: 'var(--sunken)' }}
            />
            <Bar dataKey="count" radius={[6, 6, 0, 0]} maxBarSize={40}>
              {rows.map((row, index) => (
                <Cell
                  key={row.grade}
                  fill={
                    row.grade === '?'
                      ? 'var(--border-strong)'
                      : `var(--chart-${String(Math.min(index + 1, 5))})`
                  }
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <ChartTable
        caption={`Grades across ${String(grades.total)} courses`}
        head={['Grade', 'Courses']}
        rows={rows.map((row) => [
          row.meaning === '' ? row.grade : `${row.grade} (${row.meaning})`,
          row.count,
        ])}
      />
    </figure>
  );
}
