/**
 * Finding a college by typing, not scrolling.
 *
 * VTU prints names the way a register does ("S G BALEKUNDRI INST. OF TECH"),
 * so the search has to meet students where they type: initials, a word, a
 * code. Deterministic ranking; never fuzzy.
 */

import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { useState } from 'react';
import { VTU_COLLEGES } from '@gradtools/vtu-catalogue/data';
import { normalizeName, searchColleges } from '../src/domain/college-search.js';
import { CollegeField } from '../src/features/onboarding/AcademicFields.js';
import { renderWith } from './helpers.js';

afterEach(cleanup);

const COLLEGES = VTU_COLLEGES.entries;
const names = (query: string): string[] => searchColleges(COLLEGES, query).map((c) => c.name);

describe('searchColleges', () => {
  it('finds S G Balekundri by its initials, by a word, and by its code', () => {
    expect(names('SG')[0]).toBe('S G BALEKUNDRI INST. OF TECH');
    expect(names('balekundri')).toEqual(['S G BALEKUNDRI INST. OF TECH']);
    expect(names('bu')).toContain('S G BALEKUNDRI INST. OF TECH'); // its VTU code, exactly
    // "SG" is also Sapthagiri's code: found, but after the name the student meant.
    expect(names('SG').indexOf('SAPTHAGIRI COLLEGE OF ENGINEERING')).toBeGreaterThan(0);
  });

  it('ignores case, punctuation and extra spaces', () => {
    expect(names('  s.g.   BALEKUNDRI ')).toEqual(['S G BALEKUNDRI INST. OF TECH']);
    expect(names('cmr')[0]).toBe('C.M.R INSTITUTE OF TECHNOLOGY');
    expect(normalizeName('A.P.S College of Engineering.')).toBe('a p s college of engineering');
  });

  it('matches every word by its start, in any order', () => {
    expect(names('inst bal')).toEqual(['S G BALEKUNDRI INST. OF TECH']);
  });

  it('ranks a name that starts with the query above one that merely contains it', () => {
    const found = names('atria');
    expect(found[0]).toBe('ATRIA INSTITUTE OF TECHNOLOGY');
  });

  it('returns the whole list for an empty query and nothing for a stranger', () => {
    expect(searchColleges(COLLEGES, '   ')).toHaveLength(COLLEGES.length);
    expect(names('zzzqqq')).toEqual([]);
  });

  it('stays fast on a list many times the real one', () => {
    const many = Array.from({ length: 50 }, () => COLLEGES).flat();
    const started = performance.now();
    for (const query of ['s', 'sg', 'inst', 'tech of', 'balekundri']) searchColleges(many, query);
    // A guard against pathological slowness, not a benchmark: suites run in parallel.
    expect(performance.now() - started).toBeLessThan(1000);
  });
});

function Harness() {
  const [value, setValue] = useState('');
  return (
    <>
      <CollegeField value={value} onChange={setValue} />
      <output aria-label="stored">{value}</output>
    </>
  );
}

describe('the college field', () => {
  it('is a searchable combobox, not a 185-row dropdown', async () => {
    renderWith(<Harness />);
    const trigger = await screen.findByRole('combobox', { name: /college/i });
    fireEvent.click(trigger);
    const search = screen.getByPlaceholderText(/search colleges/i);
    expect(screen.getAllByRole('option').length).toBeLessThanOrEqual(52);

    fireEvent.change(search, { target: { value: 'SG' } });
    const options = screen.getAllByRole('option');
    expect(options[0]?.textContent).toContain('S G BALEKUNDRI INST. OF TECH');
    fireEvent.click(options[0] as HTMLElement);

    // The catalogue's own name is what is stored.
    expect(screen.getByLabelText('stored').textContent).toBe('S G BALEKUNDRI INST. OF TECH');
    expect(trigger.textContent).toContain('S G BALEKUNDRI');
  });

  it('says so when nothing matches, and offers typing the name as a separate choice', async () => {
    renderWith(<Harness />);
    fireEvent.click(await screen.findByRole('combobox', { name: /college/i }));
    fireEvent.change(screen.getByPlaceholderText(/search colleges/i), {
      target: { value: 'zzzqqq' },
    });
    expect(screen.getByText(/no colleges match/i)).toBeTruthy();
    const listbox = screen.getByRole('listbox');
    fireEvent.click(within(listbox).getByRole('option', { name: /isn’t listed — type it/i }));
    expect(screen.getByRole('textbox', { name: /your college/i })).toBeTruthy();
  });
});
