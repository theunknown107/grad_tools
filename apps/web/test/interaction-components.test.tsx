/**
 * The M9.6B interaction components, driven the way a person drives them.
 *
 * Authority: docs/22 §22.31 (M9.6B) · docs/27
 *
 * Every assertion here is about BEHAVIOUR or ACCESSIBLE STATE — what a keyboard
 * does, what a screen reader would be told, what survives Escape. None of it
 * asserts a class name, because a component can carry every class and still be
 * unusable without a mouse.
 */

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { Select } from '../src/components/ui/Select.js';
import { DropdownMenu } from '../src/components/ui/DropdownMenu.js';
import { IslandTabs } from '../src/components/ui/IslandTabs.js';
import { UploadModal } from '../src/components/ui/UploadModal.js';
import { EmptyState } from '../src/components/ui/index.js';

afterEach(cleanup);

/* -------------------------------------------------------------------------- */
/* Select                                                                      */
/* -------------------------------------------------------------------------- */

const SEMESTERS = [
  { value: '1', label: 'Semester 1' },
  { value: '2', label: 'Semester 2' },
  { value: '3', label: 'Semester 3', disabled: true },
  { value: '4', label: 'Semester 4' },
];

function SelectHarness({ initial = '2' }: { initial?: string }) {
  const [value, setValue] = useState(initial);
  return <Select label="Semester" value={value} options={SEMESTERS} onChange={setValue} />;
}

describe('Select', () => {
  it('exposes itself as a combobox that owns a listbox', async () => {
    const user = userEvent.setup();
    render(<SelectHarness />);

    const trigger = screen.getByRole('combobox', { name: /semester/i });
    expect(trigger.getAttribute('aria-expanded')).toBe('false');

    await user.click(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('listbox')).toBeTruthy();
  });

  it('opens on the CURRENT value rather than the top of the list', async () => {
    const user = userEvent.setup();
    render(<SelectHarness initial="4" />);

    await user.click(screen.getByRole('combobox'));
    // Semester 4 is selected, so it must be the active option — opening on
    // "Semester 1" would make the person re-find their place every time.
    const options = screen.getAllByRole('option');
    expect(options[3]?.getAttribute('data-active')).toBe('true');
  });

  it('is fully operable from the keyboard', async () => {
    const user = userEvent.setup();
    render(<SelectHarness initial="1" />);

    const trigger = screen.getByRole('combobox');
    trigger.focus();
    await user.keyboard('{ArrowDown}');
    await waitFor(() => expect(trigger.getAttribute('aria-expanded')).toBe('true'));

    await user.keyboard('{ArrowDown}{Enter}');
    await waitFor(() => expect(trigger.textContent).toContain('Semester 2'));
  });

  it('skips a disabled option instead of parking on it', async () => {
    const user = userEvent.setup();
    render(<SelectHarness initial="2" />);

    const trigger = screen.getByRole('combobox');
    trigger.focus();
    await user.keyboard('{ArrowDown}');
    // From Semester 2, one step down must land on 4 — 3 is disabled.
    await user.keyboard('{ArrowDown}{Enter}');
    await waitFor(() => expect(trigger.textContent).toContain('Semester 4'));
  });

  it('closes on Escape without changing the value', async () => {
    const user = userEvent.setup();
    render(<SelectHarness initial="1" />);

    const trigger = screen.getByRole('combobox');
    await user.click(trigger);
    await user.keyboard('{ArrowDown}');
    await user.keyboard('{Escape}');

    await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
    expect(trigger.textContent).toContain('Semester 1');
    expect(document.activeElement).toBe(trigger);
  });
});

/* -------------------------------------------------------------------------- */
/* DropdownMenu                                                                */
/* -------------------------------------------------------------------------- */

describe('DropdownMenu', () => {
  it('runs the chosen item and returns focus to its trigger', async () => {
    const user = userEvent.setup();
    const edit = vi.fn();
    render(
      <DropdownMenu
        label="Actions for BXXX401"
        items={[
          { label: 'Edit', onSelect: edit },
          { label: 'Delete', onSelect: vi.fn(), tone: 'danger' },
        ]}
      />,
    );

    const trigger = screen.getByRole('button', { name: 'Actions for BXXX401' });
    await user.click(trigger);
    await user.click(screen.getByRole('menuitem', { name: 'Edit' }));

    expect(edit).toHaveBeenCalledOnce();
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    expect(document.activeElement).toBe(trigger);
  });

  it('opens and activates from the keyboard alone', async () => {
    const user = userEvent.setup();
    const remove = vi.fn();
    render(
      <DropdownMenu
        label="Actions"
        items={[
          { label: 'Edit', onSelect: vi.fn() },
          { label: 'Delete', onSelect: remove, tone: 'danger' },
        ]}
      />,
    );

    screen.getByRole('button', { name: 'Actions' }).focus();
    await user.keyboard('{ArrowDown}');
    await waitFor(() => expect(screen.getByRole('menu')).toBeTruthy());
    await user.keyboard('{ArrowDown}{Enter}');

    expect(remove).toHaveBeenCalledOnce();
  });

  it('never activates a disabled item', async () => {
    const user = userEvent.setup();
    const blocked = vi.fn();
    render(
      <DropdownMenu
        label="Actions"
        items={[
          { label: 'Edit', onSelect: blocked, disabled: true },
          { label: 'Delete', onSelect: vi.fn(), tone: 'danger' },
        ]}
      />,
    );

    screen.getByRole('button', { name: 'Actions' }).focus();
    await user.keyboard('{ArrowDown}');
    // The first step must skip the disabled Edit and land on Delete.
    await user.keyboard('{Enter}');
    expect(blocked).not.toHaveBeenCalled();
  });
});

/* -------------------------------------------------------------------------- */
/* IslandTabs                                                                  */
/* -------------------------------------------------------------------------- */

function TabsHarness() {
  const [value, setValue] = useState('overview');
  return (
    <IslandTabs
      label="Results view"
      value={value}
      onChange={setValue}
      tabs={[
        { id: 'overview', label: 'Overview' },
        { id: 'subjects', label: 'Subjects', count: 9 },
        { id: 'attempts', label: 'Attempts' },
      ]}
    />
  );
}

describe('IslandTabs', () => {
  it('follows the WAI-ARIA tabs pattern', async () => {
    render(<TabsHarness />);
    const list = screen.getByRole('tablist', { name: 'Results view' });
    const tabs = within(list).getAllByRole('tab');

    expect(tabs[0]?.getAttribute('aria-selected')).toBe('true');
    // Only the selected tab is tabbable; the rest are reached with arrows.
    expect(tabs[0]?.getAttribute('tabindex')).toBe('0');
    expect(tabs[1]?.getAttribute('tabindex')).toBe('-1');
  });

  it('moves selection with the arrow keys and wraps', async () => {
    const user = userEvent.setup();
    render(<TabsHarness />);
    const tabs = screen.getAllByRole('tab');

    tabs[0]?.focus();
    await user.keyboard('{ArrowRight}');
    await waitFor(() => expect(tabs[1]?.getAttribute('aria-selected')).toBe('true'));

    await user.keyboard('{ArrowLeft}{ArrowLeft}');
    // Wrapped backwards past the first tab to the last.
    await waitFor(() => expect(tabs[2]?.getAttribute('aria-selected')).toBe('true'));
  });
});

/* -------------------------------------------------------------------------- */
/* UploadModal                                                                 */
/* -------------------------------------------------------------------------- */

const pdf = (name: string, size: number): File => {
  const file = new File(['x'], name, { type: 'application/pdf' });
  Object.defineProperty(file, 'size', { value: size });
  return file;
};

function uploadProps(onSelect: (file: File) => void) {
  return {
    open: true,
    onClose: vi.fn(),
    onSelect,
    title: 'Add a question paper',
    description: 'Select a PDF to add to the library.',
    accept: ['application/pdf'],
    maxBytes: 1024 * 1024,
  };
}

describe('UploadModal', () => {
  it('is a labelled modal dialog', () => {
    render(<UploadModal {...uploadProps(vi.fn())} />);
    const dialog = screen.getByRole('dialog', { name: 'Add a question paper' });
    expect(dialog.getAttribute('aria-modal')).toBe('true');
  });

  it('accepts a permitted file and hands it to the caller', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<UploadModal {...uploadProps(onSelect)} />);

    const input = document.querySelector('input[type="file"]');
    await user.upload(input as HTMLInputElement, pdf('paper.pdf', 2048));

    await waitFor(() => expect(screen.getByText('paper.pdf')).toBeTruthy());
    await user.click(screen.getByRole('button', { name: 'Use this file' }));
    expect(onSelect).toHaveBeenCalledOnce();
  });

  it('REJECTS a file past the size limit and says so out loud', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<UploadModal {...uploadProps(onSelect)} />);

    const input = document.querySelector('input[type="file"]');
    await user.upload(input as HTMLInputElement, pdf('huge.pdf', 5 * 1024 * 1024));

    // role="alert", so the rejection reaches a screen reader rather than only
    // turning the border red.
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/limit is 1\.0 MB/);
    expect(screen.getByRole('button', { name: 'Use this file' }).hasAttribute('disabled')).toBe(
      true,
    );
  });

  it('rejects a disallowed type even though the picker filtered for it', async () => {
    render(<UploadModal {...uploadProps(vi.fn())} />);

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    /*
     * fireEvent, not userEvent.upload: userEvent HONOURS the `accept`
     * attribute and silently drops a non-matching file, which is exactly the
     * filter this test needs to bypass. Drag-and-drop and renamed files bypass
     * it in the real world too, which is why the component re-checks the File.
     */
    const file = new File(['x'], 'notes.txt', { type: 'text/plain' });
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    fireEvent.change(input);

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/text\/plain/);
  });

  it('renders nothing at all when closed', () => {
    render(<UploadModal {...uploadProps(vi.fn())} open={false} />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* EmptyState                                                                  */
/* -------------------------------------------------------------------------- */

describe('EmptyState', () => {
  it('keeps its icon cluster out of the accessibility tree', () => {
    const { container } = render(
      <EmptyState title="No papers yet" icons={['papers', 'search', 'empty']}>
        Nothing has been added to the library.
      </EmptyState>,
    );

    expect(screen.getByText('No papers yet')).toBeTruthy();
    // Decoration must not be announced; the sentence carries the meaning.
    const cluster = container.querySelector('[aria-hidden="true"]');
    expect(cluster).toBeTruthy();
    expect(container.querySelectorAll('svg[aria-hidden="true"]').length).toBeGreaterThan(0);
  });

  it('still renders without a cluster, for a plain absence', () => {
    render(<EmptyState>No results yet.</EmptyState>);
    expect(screen.getByText('No results yet.')).toBeTruthy();
  });
});
