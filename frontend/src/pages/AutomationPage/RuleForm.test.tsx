import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import RuleForm from './RuleForm';
import type { AutomationRule } from '../../api/types';
import type { MutationResult } from '../../api/client';

/**
 * TASK-006 Phase 4: the rule-creation form. `onCreate` (the `useRules().create`
 * seam) is a stub, so these tests drive the form's client validation, its
 * correct request body, success reset, and the mapping of server coded errors
 * back onto controls / the banner. Query by role/label, never by class.
 */

const createdRule: AutomationRule = {
  id: 7,
  board_id: 1,
  name: 'Auto-done',
  condition: { field: 'status', operator: 'eq', value: 'todo' },
  target_status: 'in_progress',
  enabled: true,
  webhook_url: null,
  created_at: '2026-07-15T00:00:00.000Z',
  updated_at: '2026-07-15T00:00:00.000Z',
};

afterEach(() => {
  vi.clearAllMocks();
});

function renderForm(onCreate: RuleFormOnCreate) {
  const onCreated = vi.fn();
  const utils = render(<RuleForm boardId={1} onCreate={onCreate} onCreated={onCreated} />);
  return { ...utils, onCreated };
}

type RuleFormOnCreate = (body: unknown) => Promise<MutationResult<AutomationRule>>;

describe('RuleForm — happy submit', () => {
  it('submits the correct rule body and, on 201, announces + resets the form', async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn().mockResolvedValue({ ok: true, data: createdRule });
    const { onCreated } = renderForm(onCreate);

    await user.type(screen.getByLabelText(/name/i), 'Auto-done');
    await user.click(screen.getByRole('button', { name: /create rule/i }));

    expect(onCreate).toHaveBeenCalledWith({
      board_id: 1,
      name: 'Auto-done',
      condition: { field: 'status', operator: 'eq', value: 'todo' },
      target_status: 'in_progress',
      enabled: true,
      webhook_url: null,
    });
    expect(onCreated).toHaveBeenCalledWith(createdRule);
    // Form reset: the name field is empty again.
    expect(screen.getByLabelText(/name/i)).toHaveValue('');
  });
});

describe('RuleForm — client validation (blocks the request)', () => {
  it('blocks a blank name with the exact inline string and never calls onCreate', async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn();
    renderForm(onCreate);

    await user.click(screen.getByRole('button', { name: /create rule/i }));

    expect(screen.getByText('name must not be blank')).toBeInTheDocument();
    expect(onCreate).not.toHaveBeenCalled();
  });

  it('blocks a self-loop (target equals condition value)', async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn();
    renderForm(onCreate);

    await user.type(screen.getByLabelText(/name/i), 'Loop');
    // Move-to → To Do, which equals the default condition value (To Do).
    await user.selectOptions(screen.getByLabelText(/move it to/i), 'todo');
    await user.click(screen.getByRole('button', { name: /create rule/i }));

    expect(
      screen.getByText('a rule cannot move a card to the status it is already in'),
    ).toBeInTheDocument();
    expect(onCreate).not.toHaveBeenCalled();
  });

  it('blocks a malformed webhook URL', async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn();
    renderForm(onCreate);

    await user.type(screen.getByLabelText(/name/i), 'Hooked');
    await user.type(screen.getByLabelText(/webhook url/i), 'not-a-url');
    await user.click(screen.getByRole('button', { name: /create rule/i }));

    expect(screen.getByText('webhook_url must be an absolute http(s) URL')).toBeInTheDocument();
    expect(onCreate).not.toHaveBeenCalled();
  });
});

describe('RuleForm — server coded errors', () => {
  it('maps INVALID_RULE details[].field onto the matching controls (aria-invalid)', async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn().mockResolvedValue({
      ok: false,
      kind: 'validation',
      error: {
        code: 'INVALID_RULE',
        message: 'Validation failed',
        details: [
          { field: 'target_status', error: 'target_status must be one of: todo, in_progress, done' },
          { field: 'webhook_url', error: 'webhook_url must be an absolute http(s) URL' },
        ],
      },
    });
    renderForm(onCreate);

    await user.type(screen.getByLabelText(/name/i), 'Server-checked');
    await user.click(screen.getByRole('button', { name: /create rule/i }));

    expect(await screen.findByText('target_status must be one of: todo, in_progress, done')).toBeInTheDocument();
    expect(screen.getByText('webhook_url must be an absolute http(s) URL')).toBeInTheDocument();
    expect(screen.getByLabelText(/move it to/i)).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText(/webhook url/i)).toHaveAttribute('aria-invalid', 'true');
  });

  it('shows a role=alert banner for BOARD_NOT_FOUND and retains the entered values', async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn().mockResolvedValue({
      ok: false,
      kind: 'validation',
      error: { code: 'BOARD_NOT_FOUND', message: 'board_id does not reference an existing board' },
    });
    renderForm(onCreate);

    await user.type(screen.getByLabelText(/name/i), 'Orphan');
    await user.click(screen.getByRole('button', { name: /create rule/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/does not reference an existing board/i);
    // Values retained (resubmit is the retry).
    expect(screen.getByLabelText(/name/i)).toHaveValue('Orphan');
  });

  it('shows a banner on a network failure', async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn().mockResolvedValue({ ok: false, kind: 'network', error: new Error('x') });
    renderForm(onCreate);

    await user.type(screen.getByLabelText(/name/i), 'Offline');
    await user.click(screen.getByRole('button', { name: /create rule/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/couldn.t create the rule/i);
  });
});

describe('RuleForm — submitting state', () => {
  it('disables the submit button with aria-busy while the request is in flight', async () => {
    const user = userEvent.setup();
    let resolve!: (value: MutationResult<AutomationRule>) => void;
    const onCreate = vi.fn().mockReturnValue(
      new Promise<MutationResult<AutomationRule>>((r) => {
        resolve = r;
      }),
    );
    renderForm(onCreate);

    await user.type(screen.getByLabelText(/name/i), 'Slow');
    await user.click(screen.getByRole('button', { name: /create rule/i }));

    const button = screen.getByRole('button', { name: /creating/i });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');

    resolve({ ok: true, data: createdRule });
    expect(await screen.findByRole('button', { name: /create rule/i })).toBeEnabled();
  });
});
