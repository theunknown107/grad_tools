/**
 * The design system's own guarantees.
 *
 * The pages' tests prove the product through these components; this file pins
 * what every page relies on without re-proving it: that the one theme control
 * in the top bar only flips light and dark, that accent lives in Appearance and
 * nowhere near an academic figure, and that each primitive keeps the keyboard
 * and screen-reader behaviour the Radix pattern underneath it promises.
 *
 * jsdom has no layout, so nothing here asserts appearance.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { screen, waitFor, within } from '@testing-library/dom';
import { cleanup, render } from '@testing-library/react';
import { useState } from 'react';
import { Route, Routes, useLocation } from 'react-router-dom';
import { ThemeToggle } from '../src/components/navigation/ThemeToggle.js';
import { CommandMenuProvider } from '../src/components/navigation/CommandMenu.js';
import { AppShell } from '../src/components/layout/AppShell.js';
import { gradeTone } from '../src/components/academic/grade-tone.js';
import { Button } from '../src/components/ui/button.js';
import {
  ConfirmDialog,
  Dialog,
  DialogBody,
  DialogContent,
  DialogTrigger,
} from '../src/components/ui/dialog.js';
import { EmptyState, Unavailable, toast } from '../src/components/ui/feedback.js';
import { Field, Input, Select } from '../src/components/ui/field.js';
import { MiniStat } from '../src/components/ui/metric.js';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../src/components/ui/menu.js';
import { Segmented } from '../src/components/ui/segmented.js';
import { PageSkeleton } from '../src/components/ui/skeleton.js';
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../src/components/ui/table.js';
import { Tooltip } from '../src/components/ui/tooltip.js';
import { AppearanceSettings } from '../src/features/profile/AppearanceSettings.js';
import { ACCENTS, THEME_STORAGE_KEY } from '../src/lib/theme.js';
import { renderWith } from './helpers.js';

const root = document.documentElement;

beforeEach(() => {
  localStorage.clear();
  root.className = '';
  for (const name of ['data-theme', 'data-accent', 'data-motion', 'data-density'])
    root.removeAttribute(name);
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.reject(new TypeError('offline'))),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function stored(): Record<string, unknown> {
  return JSON.parse(localStorage.getItem(THEME_STORAGE_KEY) ?? '{}') as Record<string, unknown>;
}

/* ---------------------------------------------------------------- Theme */

describe('the top-bar theme control', () => {
  it('starts light and monochrome', () => {
    renderWith(<ThemeToggle />);
    expect(root.classList.contains('dark')).toBe(false);
    expect(root.getAttribute('data-accent')).toBe('mono');
    const toggle = screen.getByRole('button', { name: 'Switch to dark theme' });
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
  });

  it('flips light and dark, and remembers the choice on this device', async () => {
    const user = userEvent.setup();
    renderWith(<ThemeToggle />);

    await user.click(screen.getByRole('button', { name: 'Switch to dark theme' }));
    expect(root.classList.contains('dark')).toBe(true);
    expect(stored()['appearance']).toBe('dark');

    const back = screen.getByRole('button', { name: 'Switch to light theme' });
    expect(back.getAttribute('aria-pressed')).toBe('true');
    await user.click(back);
    expect(root.classList.contains('dark')).toBe(false);
    expect(stored()['appearance']).toBe('light');
  });

  it('never touches the accent', async () => {
    localStorage.setItem(
      THEME_STORAGE_KEY,
      JSON.stringify({ appearance: 'light', accent: 'crimson' }),
    );
    const user = userEvent.setup();
    renderWith(<ThemeToggle />);
    await user.click(screen.getByRole('button', { name: 'Switch to dark theme' }));
    expect(root.getAttribute('data-accent')).toBe('crimson');
    expect(stored()['accent']).toBe('crimson');
  });

  it('is the only appearance control in the shell, and offers no accent', () => {
    renderWith(
      <AppShell>
        <p>Page</p>
      </AppShell>,
    );
    const banner = screen.getByRole('banner');
    expect(
      within(banner).getAllByRole('button', { name: /switch to (dark|light) theme/i }),
    ).toHaveLength(1);
    expect(within(banner).queryByText(/accent/i)).toBeNull();
    expect(within(banner).queryByRole('radiogroup')).toBeNull();
  });
});

describe('Profile → Appearance', () => {
  it('offers Light, Dark and System as one radio group, with Light chosen', () => {
    renderWith(<AppearanceSettings />);
    const group = screen.getByRole('radiogroup', { name: 'Theme' });
    const options = within(group).getAllByRole('radio');
    expect(options.map((option) => option.textContent)).toEqual(['Light', 'Dark', 'System']);
    expect(within(group).getByRole('radio', { name: 'Light' }).getAttribute('aria-checked')).toBe(
      'true',
    );
  });

  it('follows the device under System and drops the explicit attribute', async () => {
    const user = userEvent.setup();
    renderWith(<AppearanceSettings />);
    const group = screen.getByRole('radiogroup', { name: 'Theme' });
    await user.click(within(group).getByRole('radio', { name: 'Dark' }));
    expect(root.getAttribute('data-theme')).toBe('dark');
    await user.click(within(group).getByRole('radio', { name: 'System' }));
    expect(root.hasAttribute('data-theme')).toBe(false);
    expect(stored()['appearance']).toBe('system');
  });

  it('lists every accent, Mono first and chosen by default', () => {
    renderWith(<AppearanceSettings />);
    const group = screen.getByRole('radiogroup', { name: 'Accent' });
    const options = within(group).getAllByRole('radio');
    expect(options).toHaveLength(ACCENTS.length);
    expect(options[0]?.getAttribute('aria-checked')).toBe('true');
    expect(options[0]?.textContent).toMatch(/mono/i);
  });

  it('moves and selects with the arrow keys, from a single tab stop', async () => {
    const user = userEvent.setup();
    renderWith(<AppearanceSettings />);
    const group = screen.getByRole('radiogroup', { name: 'Accent' });
    const [first, second] = within(group).getAllByRole('radio') as [HTMLElement, HTMLElement];
    first.focus();
    // Held, as a finger holds it: Radix selects on the focus an arrow key moves.
    await user.keyboard('{ArrowRight>}');
    await waitFor(() => {
      expect(document.activeElement).toBe(second);
      expect(second.getAttribute('aria-checked')).toBe('true');
    });
    await user.keyboard('{/ArrowRight}');
    expect(root.getAttribute('data-accent')).toBe(ACCENTS[1]);
    expect(first.tabIndex).toBe(-1);
  });

  it('changes the accent without touching the appearance', async () => {
    const user = userEvent.setup();
    renderWith(<AppearanceSettings />);
    await user.click(
      within(screen.getByRole('radiogroup', { name: 'Accent' })).getByRole('radio', {
        name: /ocean/i,
      }),
    );
    expect(root.getAttribute('data-accent')).toBe('ocean');
    expect(stored()['appearance']).toBe('light');
    expect(root.classList.contains('dark')).toBe(false);
  });

  it('carries a renamed accent across rather than resetting it', () => {
    localStorage.setItem(
      THEME_STORAGE_KEY,
      JSON.stringify({ appearance: 'light', accent: 'cyan' }),
    );
    renderWith(<AppearanceSettings />);
    expect(root.getAttribute('data-accent')).toBe('turquoise');
  });

  it('turns reduced motion on as a labelled switch', async () => {
    const user = userEvent.setup();
    renderWith(<AppearanceSettings />);
    const toggle = screen.getByRole('switch', { name: 'Reduced motion' });
    await user.click(toggle);
    expect(root.getAttribute('data-motion')).toBe('reduced');
  });

  it('keeps its live preview out of the tab order and the accessibility tree', () => {
    renderWith(<AppearanceSettings />);
    const preview = screen.getByText('Sample figure').closest('[inert]');
    expect(preview?.getAttribute('aria-hidden')).toBe('true');
  });
});

describe('grades and the accent', () => {
  it('colours a grade by what it means, never by the accent', () => {
    for (const letter of ['O', 'A+', 'A', 'B+', 'B', 'C', 'P', 'F', 'Ab', 'X']) {
      expect(gradeTone(letter)).not.toBe('accent');
    }
    expect(gradeTone('O')).toBe('success');
    expect(gradeTone('F')).toBe('danger');
  });
});

/* ------------------------------------------------------------ Overlays */

function DialogHarness() {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button>Open form</Button>
      </DialogTrigger>
      <DialogContent title="Add a thing" description="A short description.">
        <DialogBody>
          <Field label="Name">
            <Input />
          </Field>
          <Button>Save</Button>
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}

describe('Dialog', () => {
  it('names itself, and returns focus to its trigger on Escape', async () => {
    const user = userEvent.setup();
    render(<DialogHarness />);
    const trigger = screen.getByRole('button', { name: 'Open form' });
    await user.click(trigger);

    const dialog = await screen.findByRole('dialog', { name: 'Add a thing' });
    expect(dialog.getAttribute('aria-describedby')).toBeTruthy();
    await user.keyboard('{Escape}');
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(document.activeElement).toBe(trigger);
  });

  it('keeps Tab inside itself', async () => {
    const user = userEvent.setup();
    render(<DialogHarness />);
    await user.click(screen.getByRole('button', { name: 'Open form' }));
    const dialog = await screen.findByRole('dialog');
    for (let step = 0; step < 6; step += 1) {
      await user.tab();
      expect(dialog.contains(document.activeElement)).toBe(true);
    }
  });
});

describe('a dialog opened from state, with no trigger', () => {
  function Controlled() {
    const [open, setOpen] = useState(false);
    return (
      <>
        <Button onClick={() => setOpen(true)}>Add a course</Button>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent title="Add a course">
            <DialogBody>
              <Button>Save</Button>
            </DialogBody>
          </DialogContent>
        </Dialog>
      </>
    );
  }

  it('still returns focus to the control that opened it', async () => {
    const user = userEvent.setup();
    render(<Controlled />);
    const opener = screen.getByRole('button', { name: 'Add a course' });
    await user.click(opener);
    await screen.findByRole('dialog');
    await user.keyboard('{Escape}');
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    await waitFor(() => {
      expect(document.activeElement).toBe(opener);
    });
  });
});

describe('a confirmation opened from a menu item', () => {
  function FromMenu() {
    const [open, setOpen] = useState(false);
    return (
      <>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button>More actions</Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem onSelect={() => setOpen(true)}>Delete</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <ConfirmDialog
          open={open}
          onOpenChange={setOpen}
          title="Delete it?"
          description="This cannot be undone."
          confirmLabel="Delete"
          onConfirm={() => setOpen(false)}
        />
      </>
    );
  }

  it('returns focus to the menu trigger, since the item is gone', async () => {
    const user = userEvent.setup();
    render(<FromMenu />);
    const trigger = screen.getByRole('button', { name: 'More actions' });
    await user.click(trigger);
    await user.click(await screen.findByRole('menuitem', { name: 'Delete' }));
    await screen.findByRole('alertdialog');
    await user.keyboard('{Escape}');
    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).toBeNull();
      expect(document.activeElement).toBe(trigger);
    });
  });
});

describe('ConfirmDialog', () => {
  function Harness({ onConfirm }: { readonly onConfirm: () => void }) {
    const [open, setOpen] = useState(true);
    return (
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        destructive
        title="Delete semester 3?"
        description="This cannot be undone."
        confirmLabel="Delete semester"
        onConfirm={onConfirm}
      />
    );
  }

  it('is an alertdialog that starts on Cancel, so Enter erases nothing', async () => {
    const onConfirm = vi.fn();
    const user = userEvent.setup();
    render(<Harness onConfirm={onConfirm} />);
    const dialog = await screen.findByRole('alertdialog', { name: 'Delete semester 3?' });
    expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: 'Cancel' }));
    await user.keyboard('{Enter}');
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('runs the destructive action only when it is chosen', async () => {
    const onConfirm = vi.fn();
    const user = userEvent.setup();
    render(<Harness onConfirm={onConfirm} />);
    await user.click(await screen.findByRole('button', { name: 'Delete semester' }));
    expect(onConfirm).toHaveBeenCalledOnce();
  });
});

describe('DropdownMenu', () => {
  it('opens from the keyboard, runs the item, and returns focus to its trigger', async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button>More</Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem onSelect={onSelect}>Edit</DropdownMenuItem>
          <DropdownMenuItem onSelect={vi.fn()} disabled>
            Archive
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>,
    );
    const trigger = screen.getByRole('button', { name: 'More' });
    trigger.focus();
    await user.keyboard('{Enter}');
    const menu = await screen.findByRole('menu');
    expect(
      within(menu).getByRole('menuitem', { name: 'Archive' }).getAttribute('aria-disabled'),
    ).toBe('true');
    await user.keyboard('{Enter}');
    expect(onSelect).toHaveBeenCalledOnce();
    await waitFor(() => {
      expect(document.activeElement).toBe(trigger);
    });
  });
});

describe('Tooltip and Unavailable', () => {
  it('opens on keyboard focus and closes on Escape', async () => {
    const user = userEvent.setup();
    renderWith(
      <Tooltip content="Why this is empty">
        <button type="button">Info</button>
      </Tooltip>,
    );
    await user.tab();
    expect((await screen.findByRole('tooltip')).textContent).toContain('Why this is empty');
    await user.keyboard('{Escape}');
    await waitFor(() => {
      expect(screen.queryByRole('tooltip')).toBeNull();
    });
  });

  it('says why a value is unavailable to a screen reader, not only on hover', () => {
    renderWith(<Unavailable reason="Credits unknown" />);
    const value = screen.getByLabelText('Unavailable: Credits unknown');
    expect(value.tabIndex).toBe(0);
  });
});

/* -------------------------------------------------------------- Inputs */

describe('Select', () => {
  function Harness() {
    const [value, setValue] = useState('b');
    return (
      <Field label="Grade">
        <Select
          value={value}
          onValueChange={setValue}
          options={[
            { value: 'a', label: 'Alpha' },
            { value: 'b', label: 'Beta' },
            { value: 'c', label: 'Gamma', disabled: true },
          ]}
        />
      </Field>
    );
  }

  it('is a labelled combobox that opens on its current value', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const trigger = screen.getByRole('combobox', { name: 'Grade' });
    expect(trigger.textContent).toContain('Beta');
    await user.click(trigger);
    const listbox = await screen.findByRole('listbox');
    expect(
      within(listbox).getByRole('option', { name: 'Beta' }).getAttribute('aria-selected'),
    ).toBe('true');
    expect(
      within(listbox).getByRole('option', { name: 'Gamma' }).getAttribute('aria-disabled'),
    ).toBe('true');
  });

  it('closes on Escape without changing the value', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const trigger = screen.getByRole('combobox', { name: 'Grade' });
    await user.click(trigger);
    await screen.findByRole('listbox');
    await user.keyboard('{ArrowUp}{Escape}');
    await waitFor(() => {
      expect(screen.queryByRole('listbox')).toBeNull();
    });
    expect(trigger.textContent).toContain('Beta');
  });
});

describe('Field', () => {
  it('describes the control with its error and marks it invalid', () => {
    render(
      <Field label="Total" hint="Out of 100" error="Does not match the columns.">
        <Input />
      </Field>,
    );
    const input = screen.getByLabelText('Total');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    const note = document.getElementById(input.getAttribute('aria-describedby') ?? '');
    expect(note?.textContent).toBe('Does not match the columns.');
    expect(note?.getAttribute('role')).toBe('alert');
  });

  it('marks an invalid control with a ring, which renders, not a border colour', () => {
    /*
     * index.css neutralises every coloured border utility on purpose, so a
     * `border-danger` invalid state painted as the plain hairline. A ring is
     * a box-shadow, which the rule does not touch.
     */
    render(
      <Field label="Total" error="Does not match the columns.">
        <Input />
      </Field>,
    );
    const input = screen.getByLabelText('Total');
    expect(input.className).toContain('aria-[invalid=true]:ring-danger');
    expect(input.className).not.toContain('aria-[invalid=true]:border-danger');
  });

  it('leaves a valid field unmarked and described by its hint', () => {
    render(
      <Field label="Total" hint="Out of 100">
        <Input />
      </Field>,
    );
    const input = screen.getByLabelText('Total');
    expect(input.hasAttribute('aria-invalid')).toBe(false);
    expect(document.getElementById(input.getAttribute('aria-describedby') ?? '')?.textContent).toBe(
      'Out of 100',
    );
  });
});

describe('Segmented', () => {
  it('is a named radio group that never ends with nothing selected', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(
      <Segmented
        label="View"
        value="week"
        onChange={onChange}
        options={[
          { value: 'week', label: 'Week' },
          { value: 'day', label: 'Day' },
        ]}
      />,
    );
    const group = screen.getByRole('radiogroup', { name: 'View' });
    await user.click(within(group).getByRole('radio', { name: 'Week' }));
    expect(onChange).not.toHaveBeenCalled();
    await user.click(within(group).getByRole('radio', { name: 'Day' }));
    expect(onChange).toHaveBeenCalledWith('day');
  });
});

/* ------------------------------------------------------------ Feedback */

describe('states', () => {
  it('keeps an empty state icon out of the accessibility tree', () => {
    render(<EmptyState icon={<svg data-testid="icon" />} title="No results yet" />);
    expect(screen.getByTestId('icon').closest('[aria-hidden="true"]')).not.toBeNull();
    expect(screen.getByRole('heading', { name: 'No results yet' })).toBeTruthy();
  });

  it('announces loading rather than showing blank space', () => {
    render(<PageSkeleton label="Loading your results" />);
    expect(screen.getByRole('status').textContent).toContain('Loading your results');
  });

  it('announces a toast and runs its action', async () => {
    const onUndo = vi.fn();
    const user = userEvent.setup();
    renderWith(<p>Page</p>);
    toast('Class marked', { action: { label: 'Undo', onClick: onUndo } });
    const status = await screen.findByRole('status');
    expect(status.textContent).toContain('Class marked');
    await user.click(within(status).getByRole('button', { name: 'Undo' }));
    expect(onUndo).toHaveBeenCalledOnce();
  });

  it('makes a wide table a focusable, named scroll region with a caption', () => {
    render(
      <Table>
        <TableCaption>Every subject</TableCaption>
        <TableHeader>
          <tr>
            <TableHead>Code</TableHead>
          </tr>
        </TableHeader>
        <TableBody>
          <TableRow>
            <TableCell>BCS301</TableCell>
          </TableRow>
        </TableBody>
      </Table>,
    );
    const table = screen.getByRole('table', { name: 'Every subject' });
    const region = table.closest('[tabindex="0"]');
    expect(region).not.toBeNull();
    expect(screen.getByRole('columnheader', { name: 'Code' })).toBeTruthy();
  });
});

/* -------------------------------------------------------------- Search */

function Where() {
  const location = useLocation();
  return <output data-testid="where">{location.pathname + location.search}</output>;
}

describe('the command menu', () => {
  function renderMenu() {
    return renderWith(
      <CommandMenuProvider>
        <Routes>
          <Route path="*" element={<Where />} />
        </Routes>
      </CommandMenuProvider>,
    );
  }

  it('opens with Ctrl+K, finds a page by keyword, and goes there', async () => {
    const user = userEvent.setup();
    renderMenu();
    await user.keyboard('{Control>}k{/Control}');
    const dialog = await screen.findByRole('dialog');
    // "bunk" is a keyword of Attendance, not part of its label.
    await user.type(within(dialog).getByRole('combobox'), 'bunk');
    await user.click(await within(dialog).findByRole('option', { name: /attendance/i }));
    expect(screen.getByTestId('where').textContent).toBe('/attendance');
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
  });

  it('says so when nothing matches', async () => {
    const user = userEvent.setup();
    renderMenu();
    await user.keyboard('{Control>}k{/Control}');
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByRole('combobox'), 'zzqqxx');
    expect(await within(dialog).findByText(/no (matches|results)/i)).toBeTruthy();
  });

  it('opens the calculator tab directly', async () => {
    const user = userEvent.setup();
    renderMenu();
    await user.keyboard('{Control>}k{/Control}');
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByRole('combobox'), 'sgpa calculator');
    await user.click(await within(dialog).findByRole('option', { name: /open sgpa calculator/i }));
    expect(screen.getByTestId('where').textContent).toBe('/academics?tab=calculator');
  });
});

describe('the shell', () => {
  it('skips to the main content and names both navigations', () => {
    renderWith(
      <AppShell>
        <p>Page</p>
      </AppShell>,
    );
    const skip = screen.getByRole('link', { name: /skip to content/i });
    expect(skip.getAttribute('href')).toBe('#gt-main');
    expect(document.getElementById('gt-main')?.tagName).toBe('MAIN');
    expect(screen.getAllByRole('navigation').every((nav) => nav.hasAttribute('aria-label'))).toBe(
      true,
    );
  });
});

describe('MiniStat', () => {
  it('is a labelled figure with no box of its own', () => {
    /* It sits inside a card or dialog; a bordered tile there is a card in a card. */
    render(<MiniStat label="Credits" value="72" />);
    const stat = screen.getByRole('group', { name: 'Credits' });
    expect(stat.textContent).toContain('72');
    expect(stat.className).not.toMatch(/\bborder\b|\brounded-|\bbg-/);
  });
});
