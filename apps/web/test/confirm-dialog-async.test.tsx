/**
 * ConfirmDialog around an async action: while the action runs the dialog
 * cannot be dismissed, progress is announced once, focus stays inside, and a
 * failure is shown in place with focus on a usable control.
 */

import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConfirmDialog } from '../src/components/ui/dialog.js';

afterEach(() => {
  cleanup();
});

const TITLE = 'Delete your account?';
const DESCRIPTION = 'Everything on this device is erased.';

function renderDialog(props: { busy?: boolean; error?: string } = {}) {
  const onOpenChange = vi.fn();
  const onConfirm = vi.fn();
  const view = (next: { busy?: boolean; error?: string }) => (
    <ConfirmDialog
      open
      onOpenChange={onOpenChange}
      destructive
      title={TITLE}
      description={DESCRIPTION}
      confirmLabel="Delete account"
      onConfirm={onConfirm}
      pendingStatus="Deleting your account…"
      {...next}
    />
  );
  const result = render(view(props));
  return {
    onOpenChange,
    onConfirm,
    rerender: (next: { busy?: boolean; error?: string }) => result.rerender(view(next)),
  };
}

function expectFocusUsableInside(dialog: HTMLElement) {
  const active = document.activeElement as HTMLElement;
  expect(dialog.contains(active)).toBe(true);
  expect(active.hasAttribute('disabled')).toBe(false);
}

describe('ConfirmDialog while busy', () => {
  it('keeps the title as its name and the description as its description', async () => {
    renderDialog({ error: 'Could not reach the server.' });
    expect(
      await screen.findByRole('alertdialog', { name: TITLE, description: DESCRIPTION }),
    ).toBeTruthy();
  });

  it('cannot be closed by Cancel or Escape while busy', async () => {
    const user = userEvent.setup();
    const { onOpenChange } = renderDialog({ busy: true });
    const dialog = await screen.findByRole('alertdialog');
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await user.keyboard('{Escape}');
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it('closes by Cancel and Escape when idle', async () => {
    const user = userEvent.setup();
    const { onOpenChange } = renderDialog();
    const dialog = await screen.findByRole('alertdialog');
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    onOpenChange.mockClear();
    await user.keyboard('{Escape}');
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('announces the pending status exactly once while busy, and not when idle', async () => {
    const { rerender } = renderDialog();
    await screen.findByRole('alertdialog');
    expect(screen.queryByText('Deleting your account…')).toBeNull();
    rerender({ busy: true });
    const statuses = screen.getAllByRole('status');
    expect(statuses.filter((s) => s.textContent === 'Deleting your account…')).toHaveLength(1);
    expect(screen.getAllByText('Deleting your account…')).toHaveLength(1);
  });

  it('keeps focus inside the dialog on an enabled control while busy, and ignores repeat confirms', async () => {
    const user = userEvent.setup();
    const { onConfirm, rerender } = renderDialog();
    const dialog = await screen.findByRole('alertdialog');
    await user.click(within(dialog).getByRole('button', { name: 'Delete account' }));
    expect(onConfirm).toHaveBeenCalledOnce();
    rerender({ busy: true });
    const confirm = within(dialog).getByRole('button', { name: 'Delete account' });
    expect(confirm.getAttribute('aria-disabled')).toBe('true');
    expect(confirm.getAttribute('aria-busy')).toBe('true');
    expectFocusUsableInside(dialog);
    confirm.click();
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it('after a failure shows the error as an alert inside and focuses a usable control', async () => {
    const { rerender } = renderDialog({ busy: true });
    const dialog = await screen.findByRole('alertdialog');
    act(() => {
      (document.activeElement as HTMLElement | null)?.blur();
    });
    rerender({ busy: false, error: 'Could not reach the server.' });
    const alert = within(dialog).getByRole('alert');
    expect(alert.textContent).toContain('Could not reach the server.');
    const confirm = within(dialog).getByRole('button', { name: 'Delete account' });
    await waitFor(() => expect(document.activeElement).toBe(confirm));
    expect(confirm.hasAttribute('aria-disabled')).toBe(false);
    expectFocusUsableInside(dialog);
  });
});

describe('return focus when a confirmation closes', () => {
  function Page({ removeTrigger }: { readonly removeTrigger: boolean }) {
    const [open, setOpen] = useState(false);
    const [gone, setGone] = useState(false);
    return (
      <main id="gt-main" tabIndex={-1}>
        {!gone && (
          <button type="button" onClick={() => setOpen(true)}>
            Open
          </button>
        )}
        <ConfirmDialog
          open={open}
          onOpenChange={setOpen}
          title="Sure?"
          description="Really."
          confirmLabel="Yes"
          onConfirm={() => {
            if (removeTrigger) setGone(true);
            setOpen(false);
          }}
        />
      </main>
    );
  }

  it('falls back to the main landmark when the trigger was removed', async () => {
    const user = userEvent.setup();
    render(<Page removeTrigger />);
    await user.click(screen.getByRole('button', { name: 'Open' }));
    await user.click(await screen.findByRole('button', { name: 'Yes' }));
    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).toBeNull();
      expect(document.activeElement).toBe(document.getElementById('gt-main'));
    });
  });

  it('returns to the trigger when it is still there', async () => {
    const user = userEvent.setup();
    render(<Page removeTrigger={false} />);
    const trigger = screen.getByRole('button', { name: 'Open' });
    await user.click(trigger);
    await user.click(await screen.findByRole('button', { name: 'Yes' }));
    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).toBeNull();
      expect(document.activeElement).toBe(trigger);
    });
  });
});
