import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import ConfirmDialog from './ConfirmDialog';

/**
 * TASK-006 Phase 4: `ConfirmDialog` is the hand-rolled `role="alertdialog"`
 * replacement for native `window.confirm` (a UAT PASS-blocker). Asserts the
 * accessible roles/relationships, focus moves in on open and restores to the
 * trigger on close, ESC + outside-click close, the in-flight lock, and the
 * Cancel/Delete callbacks.
 */

afterEach(() => {
  vi.clearAllMocks();
});

/** A trigger + dialog harness so we can assert focus restoration to the trigger. */
function Harness({
  pending = false,
  onConfirm = vi.fn(),
  onCancel,
}: {
  pending?: boolean;
  onConfirm?: () => void;
  onCancel?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const cancel = () => {
    setOpen(false);
    onCancel?.();
  };
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open
      </button>
      {open && (
        <ConfirmDialog
          title="Delete this rule?"
          description="This can’t be undone."
          pending={pending}
          onConfirm={onConfirm}
          onCancel={cancel}
        />
      )}
    </>
  );
}

describe('ConfirmDialog', () => {
  it('renders as an accessibly-named alertdialog, labelled and described', async () => {
    render(
      <ConfirmDialog
        title="Delete this rule?"
        description="This can’t be undone."
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    const dialog = screen.getByRole('alertdialog');
    expect(dialog).toHaveAccessibleName('Delete this rule?');
    expect(dialog).toHaveAccessibleDescription('This can’t be undone.');
  });

  it('moves focus into the dialog on open and restores it to the trigger on close', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    const trigger = screen.getByRole('button', { name: 'Open' });
    await user.click(trigger);

    const dialog = screen.getByRole('alertdialog');
    expect(dialog).toContainElement(document.activeElement as HTMLElement);

    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('closes on Escape', async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    render(<Harness onCancel={onCancel} />);

    await user.click(screen.getByRole('button', { name: 'Open' }));
    await user.keyboard('{Escape}');

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('closes on an outside (overlay) click', async () => {
    const onCancel = vi.fn();
    render(
      <ConfirmDialog
        title="Delete this rule?"
        description="This can’t be undone."
        onConfirm={vi.fn()}
        onCancel={onCancel}
      />,
    );

    // The overlay is the alertdialog's parent; a mousedown on it (not the dialog) closes.
    const overlay = screen.getByRole('alertdialog').parentElement as HTMLElement;
    await userEvent.pointer({ target: overlay, keys: '[MouseLeft]' });

    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('is locked while pending: ESC and the buttons do nothing', async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    const onConfirm = vi.fn();
    render(
      <ConfirmDialog
        title="Delete this rule?"
        description="This can’t be undone."
        pending
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );

    await user.keyboard('{Escape}');
    expect(onCancel).not.toHaveBeenCalled();

    // Both buttons are disabled while the request is in flight.
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    expect(screen.getByRole('button', { name: /deleting/i })).toBeDisabled();
  });

  it('invokes onConfirm when Delete is activated', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(
      <ConfirmDialog
        title="Delete this rule?"
        description="This can’t be undone."
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Delete' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});
