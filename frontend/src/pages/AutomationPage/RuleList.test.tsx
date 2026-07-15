import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import RuleList from './RuleList';
import { useRules } from '../../hooks/useRules';
import * as rulesApi from '../../api/rules';
import type { AutomationRule } from '../../api/types';

/**
 * TASK-006 Phase 4: the rule list. Driven through the REAL `useRules` hook (with
 * the `api/rules` seam mocked) via a small harness, so the toggle's optimistic
 * flip + rollback and the delete row-removal are exercised end-to-end through
 * the list UI — including the assertion that delete uses the accessible
 * `role="alertdialog"` and NEVER native `window.confirm`.
 */
vi.mock('../../api/rules');

function rule(id: number, overrides: Partial<AutomationRule> = {}): AutomationRule {
  return {
    id,
    board_id: 1,
    name: `Rule ${id}`,
    condition: { field: 'status', operator: 'eq', value: 'in_progress' },
    target_status: 'done',
    enabled: true,
    webhook_url: null,
    created_at: '2026-07-15T00:00:00.000Z',
    updated_at: '2026-07-15T00:00:00.000Z',
    ...overrides,
  };
}

function Harness() {
  const { status, rules, pendingIds, reload, toggle, remove } = useRules(1);
  return (
    <RuleList
      status={status}
      rules={rules}
      pendingIds={pendingIds}
      reload={reload}
      onToggle={toggle}
      onRemove={remove}
    />
  );
}

beforeEach(() => {
  vi.mocked(rulesApi.getRules).mockResolvedValue({ ok: true, data: [] });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('RuleList — states', () => {
  it('shows the empty state when there are no rules', async () => {
    render(<Harness />);
    expect(
      await screen.findByText('No rules yet. Create one above to auto-move cards.'),
    ).toBeInTheDocument();
  });

  it('renders the condition→target sentence and a webhook badge', async () => {
    vi.mocked(rulesApi.getRules).mockResolvedValue({
      ok: true,
      data: [rule(1, { webhook_url: 'https://hooks.example.test/abc' })],
    });

    render(<Harness />);

    expect(
      await screen.findByText('When status is In Progress, move to Done.'),
    ).toBeInTheDocument();
    expect(screen.getByText(/Webhook · hooks.example.test/)).toBeInTheDocument();
  });
});

describe('RuleList — toggle', () => {
  it('reflects the switch state via role=switch aria-checked, and disables it on success', async () => {
    vi.mocked(rulesApi.getRules).mockResolvedValue({ ok: true, data: [rule(1, { enabled: true })] });
    vi.mocked(rulesApi.updateRule).mockResolvedValue({ ok: true, data: rule(1, { enabled: false }) });

    render(<Harness />);
    const toggle = await screen.findByRole('switch');
    expect(toggle).toHaveAttribute('aria-checked', 'true');
    expect(toggle).toHaveTextContent('Enabled');

    await userEvent.click(toggle);

    await waitFor(() => expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'false'));
    expect(rulesApi.updateRule).toHaveBeenCalledWith(1, { enabled: false });
    expect(screen.getByRole('switch')).toHaveTextContent('Disabled');
  });

  it('rolls back the switch and shows an inline retry hint when the toggle fails', async () => {
    vi.mocked(rulesApi.getRules).mockResolvedValue({ ok: true, data: [rule(1, { enabled: true })] });
    vi.mocked(rulesApi.updateRule).mockResolvedValue({ ok: false, kind: 'http', status: 500 });

    render(<Harness />);
    const toggle = await screen.findByRole('switch');
    await userEvent.click(toggle);

    await waitFor(() => expect(screen.getByText(/couldn.t update/i)).toBeInTheDocument());
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'true');
  });
});

describe('RuleList — delete', () => {
  it('opens an accessible alertdialog (NOT window.confirm), and on confirm deletes + removes the row', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm');
    vi.mocked(rulesApi.getRules).mockResolvedValue({ ok: true, data: [rule(1)] });
    vi.mocked(rulesApi.deleteRule).mockResolvedValue({ ok: true, data: undefined });

    render(<Harness />);
    await userEvent.click(await screen.findByRole('button', { name: 'Delete' }));

    const dialog = screen.getByRole('alertdialog');
    expect(confirmSpy).not.toHaveBeenCalled();

    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));

    expect(rulesApi.deleteRule).toHaveBeenCalledWith(1);
    await waitFor(() =>
      expect(screen.getByText(/no rules yet/i)).toBeInTheDocument(),
    );
    confirmSpy.mockRestore();
  });

  it('treats a 404 (already gone) as success and removes the row', async () => {
    vi.mocked(rulesApi.getRules).mockResolvedValue({ ok: true, data: [rule(1)] });
    vi.mocked(rulesApi.deleteRule).mockResolvedValue({
      ok: false,
      kind: 'validation',
      error: { code: 'RULE_NOT_FOUND', message: 'Rule not found' },
    });

    render(<Harness />);
    await userEvent.click(await screen.findByRole('button', { name: 'Delete' }));
    await userEvent.click(
      within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Delete' }),
    );

    await waitFor(() => expect(screen.getByText(/no rules yet/i)).toBeInTheDocument());
  });
});
