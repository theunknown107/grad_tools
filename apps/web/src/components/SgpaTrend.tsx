/**
 * SGPA across the eight semesters of the degree.
 *
 * Authority: docs/05 §5.25 (M9.6B §13) · docs/18 · docs/37 (never invent)
 *
 * ---------------------------------------------------------------------------
 * NO CHARTING LIBRARY, AND THE REASON IS NOT BUNDLE SIZE ALONE
 * ---------------------------------------------------------------------------
 *
 * Recharts is ~90KB gzipped and d3-scale alone is more code than this file. But
 * the deciding reason is that every general-purpose chart library wants a dense
 * series and treats a gap as a rendering problem to be smoothed over. This
 * chart's most important property is the OPPOSITE: a semester with no result
 * must show as absent, and the line must BREAK across it.
 *
 * Connecting semester 3 to semester 6 with a straight segment would draw two
 * SGPAs the student never earned. That is the exact failure docs/37 forbids, and
 * it is the default behaviour of most libraries' `connectNulls`.
 *
 * So: 60 lines of SVG, one polyline per unbroken run, gaps left as gaps.
 *
 * ---------------------------------------------------------------------------
 * THE Y AXIS STARTS AT 4, NOT 0
 * ---------------------------------------------------------------------------
 *
 * 4.0 is the lowest passing grade point under 22OB 6.1 — below it a course is
 * failed, so an SGPA under 4 is not a value on this scale. Starting the axis at
 * 0 would compress every real reading into the top 60% of the box and make a
 * genuine drop invisible. The floor is labelled so the truncation is stated
 * rather than hidden, which is the honest way to truncate an axis.
 */

import { useId, type ReactNode } from 'react';
import styles from './SgpaTrend.module.css';

export interface SemesterPoint {
  readonly semester: number;
  /** Null when the semester has no computable SGPA — never a zero. */
  readonly sgpa: number | null;
  readonly state: 'graded' | 'in_progress' | 'planned';
}

const MIN = 4;
const MAX = 10;
const TOTAL_SEMESTERS = 8;

/* A viewBox in abstract units; CSS sizes the element. */
const W = 320;
const H = 132;
const PAD_X = 16;
const PAD_Y = 12;

function x(semester: number): number {
  return PAD_X + ((semester - 1) / (TOTAL_SEMESTERS - 1)) * (W - PAD_X * 2);
}

function y(sgpa: number): number {
  const clamped = Math.min(MAX, Math.max(MIN, sgpa));
  return H - PAD_Y - ((clamped - MIN) / (MAX - MIN)) * (H - PAD_Y * 2);
}

/**
 * Splits the series into unbroken runs.
 *
 * Each run becomes its own polyline, which is what makes a gap a gap. A single
 * polyline over the whole series would join across missing semesters.
 */
function runs(points: readonly SemesterPoint[]): readonly (readonly SemesterPoint[])[] {
  const output: SemesterPoint[][] = [];
  let current: SemesterPoint[] = [];
  for (const point of points) {
    if (point.sgpa === null) {
      if (current.length > 0) output.push(current);
      current = [];
    } else {
      current.push(point);
    }
  }
  if (current.length > 0) output.push(current);
  return output;
}

export function SgpaTrend({ points }: { readonly points: readonly SemesterPoint[] }): ReactNode {
  const gradientId = useId();
  const graded = points.filter((point) => point.sgpa !== null);
  const segments = runs(points);

  if (graded.length === 0) {
    return (
      <p className={styles.none}>
        No SGPA yet. Add a semester&rsquo;s results and the trend appears here.
      </p>
    );
  }

  /*
   * The accessible representation is a TABLE, not a description of the shape.
   * "Trending upward" is an interpretation; the figures are the fact, and a
   * screen-reader user is owed the same numbers a sighted one can read off.
   */
  return (
    <figure className={styles.figure}>
      <svg
        viewBox={`0 0 ${String(W)} ${String(H)}`}
        className={styles.svg}
        role="img"
        aria-label={`SGPA by semester. ${graded
          .map((point) => `Semester ${String(point.semester)}: ${(point.sgpa ?? 0).toFixed(2)}`)
          .join('. ')}`}
        preserveAspectRatio="none"
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.28" />
            <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* Gridlines at each whole grade point. */}
        {[4, 6, 8, 10].map((value) => (
          <line
            key={value}
            x1={PAD_X}
            x2={W - PAD_X}
            y1={y(value)}
            y2={y(value)}
            className={styles.grid}
          />
        ))}

        {segments.map((segment) => {
          const line = segment.map(
            (point) => `${String(x(point.semester))},${String(y(point.sgpa ?? 0))}`,
          );
          // A single graded semester has no line to draw, only a dot.
          if (segment.length < 2) return null;
          const first = segment[0] as SemesterPoint;
          const last = segment[segment.length - 1] as SemesterPoint;
          return (
            <g key={`run-${String(first.semester)}`}>
              <polygon
                className={styles.area}
                fill={`url(#${gradientId})`}
                points={`${String(x(first.semester))},${String(H - PAD_Y)} ${line.join(' ')} ${String(x(last.semester))},${String(H - PAD_Y)}`}
              />
              <polyline className={styles.line} points={line.join(' ')} />
            </g>
          );
        })}

        {graded.map((point) => (
          <circle
            key={point.semester}
            cx={x(point.semester)}
            cy={y(point.sgpa ?? 0)}
            r="3.5"
            className={styles.dot}
            data-state={point.state}
          />
        ))}
      </svg>

      {/* The x axis is the eight semesters themselves, always all eight, so an
          absent semester is visible as an absence rather than missing entirely. */}
      <ol className={styles.axis}>
        {Array.from({ length: TOTAL_SEMESTERS }, (_, index) => {
          const semester = index + 1;
          const point = points.find((candidate) => candidate.semester === semester);
          return (
            <li
              key={semester}
              className={styles.axisItem}
              data-has-value={point?.sgpa !== null && point?.sgpa !== undefined}
            >
              {semester}
            </li>
          );
        })}
      </ol>

      <figcaption className={styles.caption}>
        Scale starts at 4.0, the lowest passing grade point (22OB 6.1). Semesters without a
        computable SGPA are left blank rather than joined.
      </figcaption>
    </figure>
  );
}
