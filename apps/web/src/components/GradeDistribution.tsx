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
      count: band.count,
      title: undefined as string | undefined,
    })),
    ...grades.specials
      .filter((special) => special.count > 0)
      .map((special) => ({
        key: special.letter,
        label: special.letter,
        count: special.count,
        title: special.meaning,
      })),
    ...(grades.unresolved > 0
      ? [
          {
            key: 'unresolved',
            label: 'Unresolved',
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

  return (
    <ul className={styles.gradeRows}>
      {rows.map((row, index) => (
        /*
          THE CHART FAMILY, not one flat colour. Every bar was `--accent`, so
          the distribution read as one block; the approved design walks a
          single-hue luminance ramp across the series. Because the ramp is
          derived from the accent, Mono resolves it to grayscale and no theme
          can produce a rainbow.
        */
        <li
          className={styles.gradeRow}
          key={row.key}
          data-zero={row.count === 0}
          data-series={Math.min(index + 1, 5)}
        >
          <span className={styles.gradeLetter} title={row.title}>
            {row.label}
          </span>
          <span
            className={styles.gradeTrack}
            role="img"
            aria-label={`${row.label}: ${String(row.count)} of ${String(grades.total)} courses`}
          >
            <span
              className={styles.gradeFill}
              style={{ inlineSize: `${String((row.count / peak) * 100)}%` }}
            />
          </span>
          <span className={styles.gradeCount}>{row.count}</span>
        </li>
      ))}
    </ul>
  );
}
