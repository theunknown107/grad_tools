/**
 * The charts, loaded on first use. Recharts is the largest dependency in the
 * app and only draws once two semesters are graded, so it stays out of the
 * first download; a skeleton of the same height holds the space meanwhile.
 */

import { lazy, Suspense, type ComponentProps } from 'react';
import { Skeleton } from '../ui/skeleton.js';

const charts = () => import('./charts.js');
const SgpaTrend = lazy(() => charts().then((module) => ({ default: module.SgpaTrendChart })));
const GradeDistribution = lazy(() =>
  charts().then((module) => ({ default: module.GradeDistributionChart })),
);

export function SgpaTrendChart(props: ComponentProps<typeof SgpaTrend>) {
  return (
    <Suspense fallback={<Skeleton className="h-[240px] w-full" />}>
      <SgpaTrend {...props} />
    </Suspense>
  );
}

export function GradeDistributionChart(props: ComponentProps<typeof GradeDistribution>) {
  return (
    <Suspense fallback={<Skeleton className="h-[240px] w-full" />}>
      <GradeDistribution {...props} />
    </Suspense>
  );
}
