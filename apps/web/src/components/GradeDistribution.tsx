/**
 * How many courses took each grade.
 *
 * Authority: docs/05 §5.12
 *
 * SHARED, because two screens ask the same question. It began on the SGPA &
 * CGPA page; the dashboard's own composition wants it beside the trend, and a
 * second copy of a chart is how two answers to one question start.
 */

import type { GradeDistribution } from '../domain/statistics.js';
import styles from './GradeDistribution.module.css';

export function GradeDistributionRows({ grades }: { readonly grades: GradeDistribution }) {
  const rows = [
    ...grades.bands.map((band) => ({
      key: band.letter,
      label: band.letter,
      short: band.letter,
      count: band.count,
      title: undefined as string | undefined,
    })),
    ...grades.specials
      .filter((special) => special.count > 0)
      .map((special) => ({
        key: special.letter,
        label: special.letter,
        short: special.letter,
        count: special.count,
        title: special.meaning,
      })),
    ...(grades.unresolved > 0
      ? [
          {
            key: 'unresolved',
            label: 'Unresolved',
            /* The one label that will not fit beneath a column. The full word
               is in the bar's accessible name and in its tooltip. */
            short: '?',
            count: grades.unresolved,
            /*
              NEVER FOLDED INTO A LETTER (7). Counting these as F would invent
              failures and counting them as P would invent passes; leaving them
              out would make the rows not add up to the courses on screen.
            */
            title: 'These courses have no grade this build can resolve yet.' as string | undefined,
          },
        ]
      : []),
  ];

  const peak = Math.max(1, ...rows.map((row) => row.count));

  /*
   * COLUMNS, as the design draws them.
   *
   * This was a list of horizontal bars. The design's distribution is a column
   * chart — grade along the bottom, count up the side — and the difference is
   * not cosmetic: read as columns, the shape of a student's record is a
   * silhouette they can compare at a glance to the one beside it, which is the
   * whole reason the chart sits next to the trend.
   *
   * No charting library: eleven columns and a dashed ground do not need one,
   * and the accent-derived ramp has to stay in CSS to keep Mono grey.
   */
  return (
    <ol className={styles.gradeColumns}>
      {rows.map((row, index) => (
        /*
          THE CHART FAMILY, not one flat colour. Every bar was `--accent`, so
          the distribution read as one block; the approved design walks a
          single-hue luminance ramp across the series. Because the ramp is
          derived from the accent, Mono resolves it to grayscale and no theme
          can produce a rainbow.
        */
        <li
          className={styles.gradeColumn}
          key={row.key}
          data-zero={row.count === 0}
          data-series={Math.min(index + 1, 5)}
        >
          <span className={styles.gradeCount}>{row.count}</span>
          <span
            className={styles.gradeTrack}
            role="img"
            aria-label={`${row.label}: ${String(row.count)} of ${String(grades.total)} courses`}
          >
            <span
              className={styles.gradeFill}
              style={{ blockSize: `${String((row.count / peak) * 100)}%` }}
            />
          </span>
          {/*
            The axis label. `title` carries the meaning of a special code and
            the reason a course is unresolved, because neither fits under a
            40px column.
          */}
          <span className={styles.gradeLetter} title={row.title}>
            {row.short}
          </span>
        </li>
      ))}
    </ol>
  );
}
