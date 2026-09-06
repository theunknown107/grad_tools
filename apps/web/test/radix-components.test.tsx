/**
 * The Phase 7B components, driven the way a person drives them.
 *
 * Authority: Phase 7B §13 · docs/22 · docs/27
 *
 * Every assertion here is about BEHAVIOUR or ACCESSIBLE STATE — what the
 * keyboard does, what a screen reader would be told, what survives Escape,
 * what a disabled control refuses. None of it asserts a class name: a component
 * can carry every class in the stylesheet and still be unusable without a
 * mouse, and that is the failure these are here to catch.
 *
 * What is NOT tested here, and why: painted appearance, animation timing and
 * responsive layout. jsdom has no layout engine and no CSS cascade, so an
 * assertion about any of the three would be asserting the mock. Those are
 * verified in the browser harness instead.
 */

import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogTrigger,
  AlertDialog,
  AlertDialogContent,
} from '../src/components/ui/Dialog.js';
import {
  ButtonGroup,
  Checkbox,
  RadioGroup,
  Slider,
  Switch,
  Toggle,
  ToggleGroup,
} from '../src/components/ui/Controls.js';
import { Field, InputGroup } from '../src/components/ui/Field.js';
import { Alert, ScrollArea, Spinner } from '../src/components/ui/Feedback.js';
import { Attachment, Item } from '../src/components/ui/Item.js';
import { Collapsible } from '../src/components/ui/Collapsible.js';
import { Combobox, CommandPalette } from '../src/components/ui/Command.js';
import { DatePicker } from '../src/components/ui/Calendar.js';
import { DataTable, type ColumnDef } from '../src/components/ui/DataTable.js';
import { ToastProvider, useToast } from '../src/components/ui/Toast.js';
import { Sheet } from '../src/components/ui/Sheet.js';

afterEach(cleanup);

/* -------------------------------------------------------------------------- */
/* Dialog                                                                     */
/* -------------------------------------------------------------------------- */

describe('Dialog', () => {
  it('opens, names itself, and returns focus to its trigger on Escape', async () => {
    const user = userEvent.setup();
    render(
      <Dialog>
        <DialogTrigger>Edit semester</DialogTrigger>
        <DialogContent title="Edit semester 3" description="Marks you confirm are saved.">
          <input aria-label="Internal marks" />
        </DialogContent>
      </Dialog>,
    );

    const trigger = screen.getByRole('button', { name: 'Edit semester' });
    await user.click(trigger);

    const dialog = await screen.findByRole('dialog', { name: 'Edit semester 3' });
    // The description is wired, not merely rendered — an unreferenced sentence
    // is decoration.
    const describedBy = dialog.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy as string)?.textContent).toBe(
      'Marks you confirm are saved.',
    );

    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.activeElement).toBe(trigger);
  });

  it('traps Tab inside itself', async () => {
    const user = userEvent.setup();
    render(
      <>
        <button type="button">Outside</button>
        <Dialog defaultOpen>
          <DialogContent title="Edit" footer={<button type="button">Save</button>}>
            <input aria-label="First" />
          </DialogContent>
        </Dialog>
      </>,
    );

    /*
     * The page behind is `aria-hidden` while the dialog is open, so the outside
     * button is no longer in the accessibility tree at all — `hidden: true` is
     * needed just to find it. That is itself half the guarantee.
     */
    const outside = screen.getByRole('button', { name: 'Outside', hidden: true });

    // Six tabs is more than the dialog holds, so an untrapped focus would have
    // escaped to the page behind by now.
    for (let step = 0; step < 6; step += 1) await user.tab();
    expect(document.activeElement).not.toBe(outside);
    expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true);
  });
});

describe('AlertDialog', () => {
  it('is an alertdialog, cannot be dismissed by Escape into a destructive action, and focuses Cancel', async () => {
    const user = userEvent.setup();
    const confirm = vi.fn();
    render(
      <AlertDialog defaultOpen>
        <AlertDialogContent
          title="Delete semester 3?"
          description="Semester 3 and its 8 subjects will be removed from this device."
          confirmLabel="Delete"
          onConfirm={confirm}
        />
      </AlertDialog>,
    );

    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).toBeTruthy();

    // Cancel takes initial focus, so Enter on a dialog nobody read is safe.
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancel' })),
    );
    await user.keyboard('{Enter}');
    expect(confirm).not.toHaveBeenCalled();
  });

  it('runs the destructive action only when it is chosen', async () => {
    const user = userEvent.setup();
    const confirm = vi.fn();
    render(
      <AlertDialog defaultOpen>
        <AlertDialogContent
          title="Delete semester 3?"
          description="This cannot be undone."
          confirmLabel="Delete"
          onConfirm={confirm}
        />
      </AlertDialog>,
    );

    await user.click(await screen.findByRole('button', { name: 'Delete' }));
    expect(confirm).toHaveBeenCalledOnce();
  });
});

/* -------------------------------------------------------------------------- */
/* Sheet                                                                      */
/* -------------------------------------------------------------------------- */

describe('Sheet', () => {
  it('closes from its own control and reports it to the caller', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <Sheet open onClose={onClose} title="Data Structures" description="Semester 3">
        <p>Internal 42</p>
      </Sheet>,
    );

    expect(await screen.findByRole('dialog', { name: 'Data Structures' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledOnce();
  });
});

/* -------------------------------------------------------------------------- */
/* Controls                                                                   */
/* -------------------------------------------------------------------------- */

describe('Checkbox', () => {
  it('is labelled, toggles from the keyboard, and reports a partial state as mixed', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { rerender } = render(
      <Checkbox checked={false} onCheckedChange={onChange} label="Unread only" />,
    );

    const box = screen.getByRole('checkbox', { name: 'Unread only' });
    box.focus();
    await user.keyboard(' ');
    expect(onChange).toHaveBeenCalledWith(true);

    rerender(<Checkbox checked="indeterminate" onCheckedChange={onChange} label="Unread only" />);
    // "mixed" is what a screen reader must hear for a partly-selected
    // select-all; "false" would be a lie about the rows underneath.
    expect(screen.getByRole('checkbox', { name: 'Unread only' }).getAttribute('aria-checked')).toBe(
      'mixed',
    );
  });

  it('refuses input when disabled', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Checkbox checked={false} onCheckedChange={onChange} label="Locked" disabled />);

    await user.click(screen.getByRole('checkbox', { name: 'Locked' }));
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('RadioGroup', () => {
  it('names the set with its legend and moves selection with the arrow keys', async () => {
    const user = userEvent.setup();

    function Harness() {
      const [value, setValue] = useState('light');
      return (
        <RadioGroup
          legend="Appearance"
          value={value}
          onValueChange={setValue}
          options={[
            { value: 'light', label: 'Light' },
            { value: 'dark', label: 'Dark' },
            { value: 'system', label: 'System' },
          ]}
        />
      );
    }
    render(<Harness />);

    const group = screen.getByRole('radiogroup');
    expect(within(group).getAllByRole('radio')).toHaveLength(3);
    expect(screen.getByRole('radio', { name: 'Light' }).getAttribute('aria-checked')).toBe('true');

    /*
     * Tab INTO the group rather than calling .focus(): the roving-focus group
     * registers its current stop on the focus event, and a direct .focus()
     * skips the handler that tells it where the arrows should start from.
     */
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('radio', { name: 'Light' }));

    // One tab stop for the whole set; the arrows move within it.
    await user.keyboard('{ArrowDown}');
    expect(document.activeElement).toBe(screen.getByRole('radio', { name: 'Dark' }));
    await user.keyboard('{ArrowDown}');
    expect(document.activeElement).toBe(screen.getByRole('radio', { name: 'System' }));
    // Wraps.
    await user.keyboard('{ArrowDown}');
    expect(document.activeElement).toBe(screen.getByRole('radio', { name: 'Light' }));

    await user.keyboard('{ArrowUp}{ }');
    await waitFor(() =>
      expect(screen.getByRole('radio', { name: 'System' }).getAttribute('aria-checked')).toBe(
        'true',
      ),
    );
  });

  /*
   * SELECTION-FOLLOWS-FOCUS IS NOT ASSERTED HERE, DELIBERATELY.
   *
   * Radix implements it with a `keydown` listener on `document` that sets a
   * ref which the item's `onFocus` then reads. React delegates its own handlers
   * to the root container, which is INSIDE document, so React's roving-focus
   * handler moves focus — and the focus handler runs — before the document
   * listener has set the ref. Under jsdom the selection therefore does not
   * follow the arrow keys.
   *
   * Whether that is a jsdom event-ordering artifact or the real behaviour is a
   * question about a browser, and it is answered in the browser harness rather
   * than guessed at here. What is asserted above is what a keyboard user needs
   * either way: one tab stop, arrows that move and wrap, and Space that selects.
   */
});

describe('Switch', () => {
  it('is a switch rather than a checkbox, and is labelled', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Switch checked={false} onCheckedChange={onChange} label="Browser notifications" />);

    // role="switch" is announced "on/off"; a checkbox would be announced
    // "checked", which is wrong for a setting that takes effect immediately.
    const control = screen.getByRole('switch', { name: 'Browser notifications' });
    await user.click(control);
    expect(onChange).toHaveBeenCalledWith(true);
  });
});

describe('Slider', () => {
  it('carries its value in the accessibility tree and moves with the keyboard', async () => {
    const user = userEvent.setup();

    function Harness() {
      const [value, setValue] = useState(3);
      return (
        <Slider
          label="Classes to miss"
          value={value}
          onValueChange={setValue}
          min={0}
          max={10}
          format={(next) => `${String(next)} classes`}
        />
      );
    }
    render(<Harness />);

    const slider = screen.getByRole('slider', { name: 'Classes to miss' });
    expect(slider.getAttribute('aria-valuenow')).toBe('3');
    // The readable form, not the raw number — "3" alone does not say of what.
    expect(slider.getAttribute('aria-valuetext')).toBe('3 classes');

    slider.focus();
    await user.keyboard('{ArrowRight}');
    await waitFor(() => expect(slider.getAttribute('aria-valuenow')).toBe('4'));

    await user.keyboard('{Home}');
    await waitFor(() => expect(slider.getAttribute('aria-valuenow')).toBe('0'));
  });
});

describe('Toggle and ToggleGroup', () => {
  it('reports pressed state', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Toggle pressed={false} onPressedChange={onChange} label="Unread only" />);

    const toggle = screen.getByRole('button', { name: 'Unread only' });
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    await user.click(toggle);
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('never leaves the group with nothing selected', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <ToggleGroup
        label="Timetable view"
        value="today"
        onValueChange={onChange}
        options={[
          { value: 'today', label: 'Today' },
          { value: 'week', label: 'Week' },
        ]}
      />,
    );

    /*
     * A single-select toggle group is a RADIOGROUP in Radix, not a row of
     * pressed buttons — which is correct: exactly one of the set is chosen, and
     * that is what a radio group means. The visual is a segmented control
     * either way.
     */
    expect(screen.getByRole('radiogroup', { name: 'Timetable view' })).toBeTruthy();

    // Pressing the already-pressed item is a deselect in Radix; a segmented
    // control has no unselected state, so it must be dropped.
    await user.click(screen.getByRole('radio', { name: 'Today' }));
    expect(onChange).not.toHaveBeenCalled();

    await user.click(screen.getByRole('radio', { name: 'Week' }));
    expect(onChange).toHaveBeenCalledWith('week');
  });
});

describe('ButtonGroup', () => {
  it('groups its buttons without taking away their tab stops', async () => {
    const user = userEvent.setup();
    render(
      <ButtonGroup label="Record this class">
        <button type="button">Attended</button>
        <button type="button">Missed</button>
      </ButtonGroup>,
    );

    expect(screen.getByRole('group', { name: 'Record this class' })).toBeTruthy();
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Attended' }));
    await user.tab();
    // Both remain reachable: a roving tabindex here would REMOVE a stop the
    // keyboard user currently has.
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Missed' }));
  });
});

/* -------------------------------------------------------------------------- */
/* Field                                                                      */
/* -------------------------------------------------------------------------- */

describe('Field', () => {
  it('describes the control with the hint AND the error, in that order', () => {
    render(
      <Field label="Internal marks" hint="Out of 50." error="Must be 50 or less.">
        {(control) => <input {...control} />}
      </Field>,
    );

    const input = screen.getByLabelText('Internal marks');
    expect(input.getAttribute('aria-invalid')).toBe('true');

    const ids = (input.getAttribute('aria-describedby') ?? '').split(' ');
    expect(ids).toHaveLength(2);
    // The error must not REPLACE the instruction that would have prevented it.
    expect(document.getElementById(ids[0] as string)?.textContent).toBe('Out of 50.');
    expect(document.getElementById(ids[1] as string)?.textContent).toBe('Must be 50 or less.');
  });

  it('leaves a valid field unmarked rather than marking it valid', () => {
    render(<Field label="Room">{(control) => <input {...control} />}</Field>);
    const input = screen.getByLabelText('Room');
    expect(input.getAttribute('aria-invalid')).toBeNull();
    expect(input.getAttribute('aria-describedby')).toBeNull();
  });

  it('names a group where the control is not a labelable element', () => {
    render(
      <Field label="Appearance" as="group">
        {() => <button type="button">Light</button>}
      </Field>,
    );
    expect(screen.getByRole('group', { name: 'Appearance' })).toBeTruthy();
  });
});

describe('InputGroup', () => {
  it('hides a unit from the accessibility tree but keeps an action in it', () => {
    render(
      <InputGroup suffix="/ 50" action={<button type="button">Clear</button>}>
        <input aria-label="Internal marks" />
      </InputGroup>,
    );

    // The label already says the scale; announcing "slash fifty" after every
    // keystroke is noise.
    expect(screen.queryByText('/ 50')?.getAttribute('aria-hidden')).toBe('true');
    expect(screen.getByRole('button', { name: 'Clear' })).toBeTruthy();
  });
});

/* -------------------------------------------------------------------------- */
/* Feedback                                                                   */
/* -------------------------------------------------------------------------- */

describe('Alert', () => {
  it('is silent unless it is live, and polite unless it is urgent', () => {
    const { rerender } = render(<Alert title="Saved">Semester 3 saved.</Alert>);
    // A message that was on the page at load must not talk over the page.
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();

    rerender(
      <Alert title="Saved" live>
        Semester 3 saved.
      </Alert>,
    );
    expect(screen.getByRole('status')).toBeTruthy();

    rerender(
      <Alert title="Failed" tone="danger" live="assertive">
        The file could not be read.
      </Alert>,
    );
    expect(screen.getByRole('alert')).toBeTruthy();
  });
});

describe('Spinner', () => {
  it('says what is being waited for', () => {
    render(<Spinner label="Reading the result card" />);
    // A spinner with no accessible name announces nothing, which is the same
    // as showing nothing.
    expect(screen.getByRole('status', { name: 'Reading the result card' })).toBeTruthy();
  });
});

describe('ScrollArea', () => {
  it('is reachable by keyboard, because it scrolls', async () => {
    const user = userEvent.setup();
    render(
      <ScrollArea label="Subjects" maxHeight="80px">
        <p>Data Structures</p>
      </ScrollArea>,
    );

    await user.tab();
    // Everything past the fold is unreachable without this.
    expect(document.activeElement).toBe(screen.getByRole('group', { name: 'Subjects' }));
  });
});

/* -------------------------------------------------------------------------- */
/* Item and Attachment                                                        */
/* -------------------------------------------------------------------------- */

describe('Item', () => {
  it('renders its title, description and actions', () => {
    render(
      <Item
        title="Data Structures"
        description="BCS304"
        actions={<button type="button">Open</button>}
      />,
    );
    expect(screen.getByText('Data Structures')).toBeTruthy();
    expect(screen.getByText('BCS304')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Open' })).toBeTruthy();
  });
});

describe('Attachment', () => {
  it('states its status in words, not only in colour', () => {
    render(<Attachment fileName="sem3.pdf" bytes={2048} status="failed" error="No text layer." />);

    expect(screen.getByText('Could not be read')).toBeTruthy();
    expect(screen.getByText('No text layer.')).toBeTruthy();
  });

  it('names its remove button with the file it removes', async () => {
    const user = userEvent.setup();
    const remove = vi.fn();
    render(<Attachment fileName="sem3.pdf" status="read" onRemove={remove} />);

    // Five identical "Remove" buttons would be unusable with a screen reader.
    await user.click(screen.getByRole('button', { name: 'Remove sem3.pdf' }));
    expect(remove).toHaveBeenCalledOnce();
  });
});

/* -------------------------------------------------------------------------- */
/* Collapsible                                                                */
/* -------------------------------------------------------------------------- */

describe('Collapsible', () => {
  it('reports and toggles its own expanded state', async () => {
    const user = userEvent.setup();
    render(
      <Collapsible summary="Add a class">
        <input aria-label="Subject code" />
      </Collapsible>,
    );

    const trigger = screen.getByRole('button', { name: /add a class/i });
    expect(trigger.getAttribute('aria-expanded')).toBe('false');

    await user.click(trigger);
    await waitFor(() => expect(trigger.getAttribute('aria-expanded')).toBe('true'));
    expect(screen.getByLabelText('Subject code')).toBeTruthy();
  });
});

/* -------------------------------------------------------------------------- */
/* Command and Combobox                                                       */
/* -------------------------------------------------------------------------- */

const SUBJECTS = [
  { value: 'BCS301', label: 'Mathematics for Computer Science', keywords: ['BCS301'] },
  { value: 'BCS304', label: 'Data Structures and Applications', keywords: ['BCS304', 'dsa'] },
  { value: 'BCS306A', label: 'Object Oriented Programming', keywords: ['BCS306A'] },
];

describe('CommandPalette', () => {
  it('filters by keyword as well as by label, and runs the chosen item', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(
      <CommandPalette
        open
        onOpenChange={vi.fn()}
        label="Search GradTools"
        items={SUBJECTS}
        onSelect={onSelect}
      />,
    );

    /*
     * "dsa" appears nowhere in the visible label; the keyword is what finds it.
     *
     * RANKING, not filtering, is the assertion. cmdk scores fuzzily, so "dsa"
     * also scrapes a match out of "Object Oriente(d) Programming" + BC(S)306(A)
     * — that is what a fuzzy matcher is FOR, and demanding exactly one result
     * would be asserting that it is not fuzzy. What matters is that the subject
     * a person meant is the one at the top.
     */
    await user.type(screen.getByRole('combobox'), 'dsa');
    await waitFor(() => {
      expect(screen.getAllByRole('option')[0]?.textContent).toContain(
        'Data Structures and Applications',
      );
    });

    await user.click(screen.getByRole('option', { name: /data structures/i }));
    expect(onSelect).toHaveBeenCalledWith('BCS304');
  });

  it('says so when nothing matches, rather than showing an empty list', async () => {
    const user = userEvent.setup();
    render(
      <CommandPalette
        open
        onOpenChange={vi.fn()}
        label="Search"
        items={SUBJECTS}
        onSelect={vi.fn()}
        empty="Nothing matches that."
      />,
    );

    await user.type(screen.getByRole('combobox'), 'zzzz');
    expect(await screen.findByText('Nothing matches that.')).toBeTruthy();
  });
});

describe('Combobox', () => {
  it('shows the chosen value on its trigger rather than the placeholder', async () => {
    const user = userEvent.setup();

    function Harness() {
      const [value, setValue] = useState<string | null>(null);
      return (
        <Combobox
          label="Subject"
          items={SUBJECTS}
          value={value}
          onValueChange={setValue}
          placeholder="Select a subject"
        />
      );
    }
    render(<Harness />);

    const trigger = screen.getByRole('button', { name: 'Subject' });
    expect(trigger.textContent).toContain('Select a subject');

    await user.click(trigger);
    await user.click(await screen.findByRole('option', { name: /object oriented/i }));

    // A combobox still saying "Select a subject" after a selection is a control
    // whose state cannot be read.
    await waitFor(() => expect(trigger.textContent).toContain('Object Oriented Programming'));
  });
});

/* -------------------------------------------------------------------------- */
/* Date picker                                                                */
/* -------------------------------------------------------------------------- */

describe('DatePicker', () => {
  it('round-trips a local date without slipping a day across the timezone', async () => {
    const user = userEvent.setup();

    function Harness() {
      const [value, setValue] = useState<string | null>('2026-09-06');
      return <DatePicker label="Effective from" value={value} onChange={setValue} />;
    }
    render(<Harness />);

    const trigger = screen.getByRole('button', { name: 'Effective from' });
    expect(trigger.textContent).toContain('2026-09-06');

    await user.click(trigger);
    // The 6th must be the selected day — `new Date('2026-09-06')` parses as UTC
    // midnight and renders as the 5th anywhere west of Greenwich, which is the
    // bug this asserts against.
    const selected = await screen.findByRole('gridcell', { selected: true });
    expect(selected.textContent).toBe('6');
  });
});

/* -------------------------------------------------------------------------- */
/* Data table                                                                 */
/* -------------------------------------------------------------------------- */

interface Mark {
  readonly code: string;
  readonly total: number;
}

const MARK_COLUMNS: ColumnDef<Mark, never>[] = [
  { accessorKey: 'code', header: 'Code' },
  { accessorKey: 'total', header: 'Total' },
];

const MARKS: readonly Mark[] = [
  { code: 'BCS301', total: 71 },
  { code: 'BCS304', total: 88 },
  { code: 'BCS306A', total: 64 },
];

describe('DataTable', () => {
  it('is a real table with a caption and column headers', () => {
    render(<DataTable data={MARKS} columns={MARK_COLUMNS} caption="Semester 3 marks" />);

    // The caption is the table's accessible name; "table with 3 rows" alone
    // tells a screen-reader user nothing about which table they are in.
    const table = screen.getByRole('table', { name: 'Semester 3 marks' });
    expect(within(table).getAllByRole('columnheader')).toHaveLength(2);
    expect(within(table).getAllByRole('row')).toHaveLength(4);
  });

  it('sorts from the keyboard and reports the sort on the header cell', async () => {
    const user = userEvent.setup();
    render(<DataTable data={MARKS} columns={MARK_COLUMNS} caption="Semester 3 marks" />);

    const header = screen.getByRole('columnheader', { name: /total/i });
    expect(header.getAttribute('aria-sort')).toBeNull();

    // The control is a BUTTON inside the th: a th with a click handler is not
    // focusable and is not announced as actionable.
    await user.click(within(header).getByRole('button'));
    await waitFor(() => expect(header.getAttribute('aria-sort')).toBe('ascending'));

    const firstCell = within(screen.getAllByRole('row')[1] as HTMLElement).getAllByRole('cell')[0];
    expect(firstCell?.textContent).toBe('BCS306A');
  });

  it('filters across columns and says when nothing is left', async () => {
    const { rerender } = render(
      <DataTable data={MARKS} columns={MARK_COLUMNS} caption="Marks" filter="306" />,
    );
    expect(screen.getAllByRole('row')).toHaveLength(2);

    rerender(
      <DataTable
        data={MARKS}
        columns={MARK_COLUMNS}
        caption="Marks"
        filter="zzz"
        empty="No subject matches."
      />,
    );
    expect(screen.getByText('No subject matches.')).toBeTruthy();
  });
});

/* -------------------------------------------------------------------------- */
/* Toast                                                                      */
/* -------------------------------------------------------------------------- */

describe('Toast', () => {
  it('announces a confirmation and runs its action', async () => {
    const user = userEvent.setup();
    const undo = vi.fn();

    function Harness() {
      const toast = useToast();
      return (
        <button
          type="button"
          onClick={() => {
            toast({ title: 'Marked as attended', action: { label: 'Undo', onAction: undo } });
          }}
        >
          Attended
        </button>
      );
    }

    render(
      <ToastProvider>
        <Harness />
      </ToastProvider>,
    );

    await user.click(screen.getByRole('button', { name: 'Attended' }));
    expect(await screen.findByText('Marked as attended')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Undo' }));
    expect(undo).toHaveBeenCalledOnce();
  });

  it('refuses to be used without its provider rather than failing silently', () => {
    function Orphan() {
      useToast();
      return null;
    }
    // A toast() that quietly does nothing is indistinguishable from one that
    // worked, which is the worst possible failure for this component.
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() => render(<Orphan />)).toThrow(/ToastProvider/);
    quiet.mockRestore();
  });
});
