import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Segmented } from '../src/components/ui/segmented.js';

afterEach(cleanup);

const OPTIONS = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
] as const;

describe('Segmented', () => {
  it('is a labelled radio group whose options take itemClassName', () => {
    const onChange = vi.fn();
    render(
      <Segmented
        label="Appearance"
        value="light"
        onChange={onChange}
        options={OPTIONS}
        itemClassName="min-h-11 rounded-full"
      />,
    );
    const group = screen.getByRole('radiogroup', { name: 'Appearance' });
    const radios = within(group).getAllByRole('radio');
    expect(radios).toHaveLength(2);
    for (const radio of radios) {
      /* The option's own size class gives way to the larger target. */
      expect(radio.className).toContain('min-h-11');
      expect(radio.className).not.toContain('min-h-8');
      expect(radio.className).toContain('rounded-full');
    }
    expect(within(group).getByRole('radio', { name: 'Light' }).getAttribute('aria-checked')).toBe(
      'true',
    );
    fireEvent.click(within(group).getByRole('radio', { name: 'Dark' }));
    expect(onChange).toHaveBeenCalledWith('dark');
  });
});
