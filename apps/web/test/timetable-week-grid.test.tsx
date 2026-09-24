/**
 * The week reads as a timetable, not as six stacks of cards.
 *
 * ---------------------------------------------------------------------------
 * WHAT WAS WRONG, AND WHY IT WAS NOT A STYLING PROBLEM
 * ---------------------------------------------------------------------------
 *
 * The week used to be six independent columns of equal-height chips. A
 * fifty-minute lecture and a three-hour lab were the same size; nine o'clock
 * on Monday sat level with two o'clock on Tuesday because both happened to be
 * first in their list; a free morning was invisible because nothing occupied
 * the space it should have left. No amount of restyling a stack of cards fixes
 * any of that — a column of cards cannot express duration or alignment at all.
 *
 * So the assertions below are about GEOMETRY, which is the thing that was
 * missing: row spans proportional to duration, and one shared scale so the
 * same clock time is the same height on every day.
 *
 * The grid is the wide layout. Below `lg` the week stays a list of days, which
 * is asserted here too, because six proportional day columns at phone width is
 * a horizontal scroll and the product does not have one.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, screen } from '@testing-library/react';
import { TimetablePage } from '../src/features/timetable/TimetablePage.js';
import { asStudentProfileId } from '../src/domain/identity.js';
import type { TimetableSlot } from '../src/domain/types.js';
import { createMemoryRepositories, renderWith } from './helpers.js';

const profileId = asStudentProfileId('p1');

function slot(
  id: string,
  day: TimetableSlot['day'],
  startTime: string,
  endTime: string,
  subjectCode: string | null,
): TimetableSlot {
  return {
    id,
    classId: id,
    profileId,
    day,
    startTime,
    endTime,
    subjectCode,
    room: null,
    faculty: null,
    activity: null,
  };
}

/**
 * Mon 09:00 lecture (50 min), Mon 14:00 lab (3 h), Tue 09:00 lecture (50 min).
 *
 * The pair at 09:00 on different days is what proves the scale is shared; the
 * lab against the lecture is what proves height means duration.
 */
const WEEK: TimetableSlot[] = [
  slot('a', 'Mon', '09:00', '09:50', 'BCS401'),
  slot('b', 'Mon', '14:00', '17:00', 'BCS402'),
  slot('c', 'Tue', '09:00', '09:50', 'BCS403'),
];

/** The grid row span an element was placed at, as `[start, end]`. */
function rowsOf(element: HTMLElement): readonly [number, number] {
  const placed = element.style.gridRow;
  const [start, end] = placed.split('/').map((part) => Number(part.trim()));
  return [start ?? Number.NaN, end ?? Number.NaN];
}

/** The wide time grid, which is the layout these assertions are about. */
function timeGrid(): HTMLElement {
  /* Identified by the axis it renders, not by a utility class others share. */
  const grid = [...document.querySelectorAll('[class~="lg:block"]')].find((el) =>
    el.querySelector('[style*="grid-template-columns"]'),
  );
  expect(grid).not.toBeUndefined();
  return grid as HTMLElement;
}

/** The placed wrapper a session's chip sits in, found by its course code. */
function placementFor(code: string): HTMLElement {
  const article = timeGrid().querySelector(`[title="${code}"]`);
  expect(article).not.toBeNull();
  const wrapper = (article as HTMLElement).closest('[style*="grid-row"]');
  expect(wrapper).not.toBeNull();
  return wrapper as HTMLElement;
}

function render() {
  return renderWith(<TimetablePage />, {
    repositories: createMemoryRepositories({ timetable: WEEK }).bundle,
  });
}

/* `globals: false`, so testing-library's auto-cleanup is not installed. */
afterEach(cleanup);

describe('the week as a time axis', () => {
  it('gives a class as much height as it has duration', async () => {
    render();
    await screen.findAllByText(/BCS401/);

    const [lectureStart, lectureEnd] = rowsOf(placementFor('BCS401'));
    const [labStart, labEnd] = rowsOf(placementFor('BCS402'));

    /*
     * 50 minutes against 3 hours. The lab is not merely taller — it is taller
     * in proportion, which a stack of equal cards could never be.
     */
    expect(labEnd - labStart).toBe((lectureEnd - lectureStart) * 3.6);
  });

  it('puts the same clock time at the same height on every day', async () => {
    render();
    await screen.findAllByText(/BCS401/);

    /* Monday 09:00 and Tuesday 09:00, on one scale. */
    expect(rowsOf(placementFor('BCS401'))).toEqual(rowsOf(placementFor('BCS403')));
  });

  it('leaves the empty hours empty instead of closing the gap', async () => {
    render();
    await screen.findAllByText(/BCS401/);

    const [, morningEnd] = rowsOf(placementFor('BCS401'));
    const [afternoonStart] = rowsOf(placementFor('BCS402'));

    /* 09:50 to 14:00 is four hours and ten minutes of nothing, and it shows. */
    expect(afternoonStart - morningEnd).toBe(250 / 5);
  });

  it('labels the axis, so a height can be read as a time', async () => {
    render();
    await screen.findAllByText(/BCS401/);

    const labels = [...timeGrid().querySelectorAll('span')].map((one) => one.textContent);
    expect(labels).toContain('9:00 am');
    /* The axis runs to the end of the last class, not to an assumed day end. */
    expect(labels).toContain('4:00 pm');
    expect(labels).not.toContain('5:00 pm');
  });

  it('does not draw two back-to-back short classes on top of each other', async () => {
    /*
     * A minimum height would have to come from somewhere: inflating the end
     * used for overlap splits these into two lanes for a collision they do not
     * have, and inflating the drawn height alone stacks them. Neither happens
     * — the pair is one lane wide and the rows meet without overlapping.
     */
    renderWith(<TimetablePage />, {
      repositories: createMemoryRepositories({
        timetable: [
          slot('s1', 'Mon', '09:00', '09:20', 'BSH001'),
          slot('s2', 'Mon', '09:20', '09:40', 'BSH002'),
        ],
      }).bundle,
    });
    await screen.findAllByText(/BSH001/);

    const [, firstEnd] = rowsOf(placementFor('BSH001'));
    const [secondStart] = rowsOf(placementFor('BSH002'));
    expect(firstEnd).toBe(secondStart);

    /* One lane: neither is squeezed to half width for a clash it does not have. */
    expect(placementFor('BSH001').style.width).toBe('100%');
    expect(placementFor('BSH002').style.width).toBe('100%');
  });

  it('splits genuinely overlapping classes into lanes instead of hiding one', async () => {
    renderWith(<TimetablePage />, {
      repositories: createMemoryRepositories({
        timetable: [
          slot('o1', 'Mon', '09:00', '10:00', 'BEL001'),
          slot('o2', 'Mon', '09:30', '10:30', 'BEL002'),
        ],
      }).bundle,
    });
    await screen.findAllByText(/BEL001/);

    expect(placementFor('BEL001').style.width).toBe('50%');
    expect(placementFor('BEL002').style.width).toBe('50%');
    expect(placementFor('BEL002').style.marginLeft).toBe('50%');
  });

  it('keeps a day-by-day list for narrow screens', async () => {
    const { container } = render();
    await screen.findAllByText(/BCS401/);

    /*
     * Both layouts are in the DOM and CSS picks one. `display: none` takes the
     * hidden one out of the accessibility tree as well, so a screen reader
     * hears the week once rather than twice.
     */
    expect(container.querySelector('ol.lg\\:hidden')).not.toBeNull();
    expect(container.querySelector('.hidden.lg\\:block')).not.toBeNull();
  });
});
