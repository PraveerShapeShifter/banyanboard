import { useEffect, useId, useRef } from 'react';

interface ConfirmDialogProps {
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Copy for the confirm button while the action is in flight. */
  pendingLabel?: string;
  /** While true the dialog is locked open: ESC/outside-click/buttons disabled. */
  pending?: boolean;
  /** An in-dialog error (the action failed); the dialog stays open. */
  error?: string | null;
  onConfirm(): void;
  onCancel(): void;
}

/**
 * Hand-rolled confirmation dialog for destructive actions (TASK-006 Phase 4),
 * replacing native `window.confirm` (a UAT PASS-blocker). `role="alertdialog"`
 * with `aria-labelledby`/`aria-describedby`; focus moves in on open and is
 * restored to the trigger on close; focus is trapped; ESC and outside-click
 * close it — EXCEPT while `pending` (the request is in flight), when it is
 * locked so the user can't dismiss a half-finished delete. No UI-kit dependency.
 */
export default function ConfirmDialog({
  title,
  description,
  confirmLabel = 'Delete',
  cancelLabel = 'Cancel',
  pendingLabel = 'Deleting…',
  pending = false,
  error = null,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const descId = useId();

  // Move focus into the dialog on open; restore it to the trigger on close.
  useEffect(() => {
    previouslyFocused.current = document.activeElement as HTMLElement | null;
    const firstButton = dialogRef.current?.querySelector<HTMLElement>('button');
    firstButton?.focus();
    return () => {
      previouslyFocused.current?.focus?.();
    };
  }, []);

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') {
      if (!pending) onCancel();
      return;
    }
    if (event.key !== 'Tab') return;

    // Focus trap: keep Tab / Shift+Tab cycling within the dialog's buttons.
    const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
      'button:not([disabled])',
    );
    if (!focusable || focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return (
    <div
      className="dialog-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !pending) onCancel();
      }}
    >
      <div
        ref={dialogRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descId}
        className="dialog"
        onKeyDown={handleKeyDown}
      >
        <h2 id={titleId}>{title}</h2>
        <p id={descId}>{description}</p>
        {error && (
          <p className="dialog__error" role="alert">
            {error}
          </p>
        )}
        <div className="dialog__actions">
          <button type="button" onClick={onCancel} disabled={pending}>
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={pending}
            aria-busy={pending}
          >
            {pending ? pendingLabel : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
