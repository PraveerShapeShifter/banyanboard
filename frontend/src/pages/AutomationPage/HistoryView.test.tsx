import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import HistoryView from './HistoryView';
import * as webhooksApi from '../../api/webhooks';
import type { TriggerExecution, WebhookDelivery } from '../../api/types';

/**
 * TASK-006 Phase 4: the read-only history (master firings → detail deliveries).
 * The webhooks seam is mocked; there is deliberately NO EventSource here
 * (AC-ASYNC-3 — polled/refreshed, not pushed). Asserts loading/error+Retry/
 * empty, firing phrasing, lazy delivery load on expand, delivery status badges
 * BY TEXT (not color), the last_error reason, and Refresh.
 */
vi.mock('../../api/webhooks');

function execution(overrides: Partial<TriggerExecution> = {}): TriggerExecution {
  return {
    id: 100,
    rule_id: 5,
    card_id: 45,
    board_id: 1,
    from_status: 'in_progress',
    to_status: 'done',
    status: 'executed',
    created_at: '2026-07-15T10:00:00.000Z',
    ...overrides,
  };
}

function delivery(overrides: Partial<WebhookDelivery> = {}): WebhookDelivery {
  return {
    id: 200,
    trigger_execution_id: 100,
    rule_id: 5,
    url: 'https://hooks.example.test/abc',
    status: 'delivered',
    attempts: 1,
    last_status_code: 200,
    error: null,
    created_at: '2026-07-15T10:00:00.000Z',
    updated_at: '2026-07-15T10:00:01.000Z',
    delivered_at: '2026-07-15T10:00:01.000Z',
    ...overrides,
  };
}

beforeEach(() => {
  vi.mocked(webhooksApi.getWebhookDeliveries).mockResolvedValue({ ok: true, data: [] });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('HistoryView — top-level states', () => {
  it('shows the empty state when no automation has fired', async () => {
    vi.mocked(webhooksApi.getTriggerExecutions).mockResolvedValue({ ok: true, data: [] });

    render(<HistoryView boardId={1} />);

    expect(
      await screen.findByText('No automation has fired yet on this board.'),
    ).toBeInTheDocument();
  });

  it('shows an error with a working Retry when the history load fails', async () => {
    vi.mocked(webhooksApi.getTriggerExecutions)
      .mockResolvedValueOnce({ ok: false, kind: 'network', error: new Error('x') })
      .mockResolvedValueOnce({ ok: true, data: [execution()] });

    render(<HistoryView boardId={1} />);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/couldn.t load history/i);

    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));

    expect(await screen.findByRole('button', { name: /Moved/ })).toBeInTheDocument();
  });
});

describe('HistoryView — firings & deliveries', () => {
  it('renders a firing sentence and lazily loads its deliveries on expand, badging status by text', async () => {
    vi.mocked(webhooksApi.getTriggerExecutions).mockResolvedValue({ ok: true, data: [execution()] });
    vi.mocked(webhooksApi.getWebhookDeliveries).mockResolvedValue({ ok: true, data: [delivery()] });

    render(<HistoryView boardId={1} />);

    const firing = await screen.findByRole('button', { name: /Moved card #45 from In Progress to Done/ });
    // Deliveries are not fetched until expand.
    expect(webhooksApi.getWebhookDeliveries).not.toHaveBeenCalled();

    await userEvent.click(firing);

    expect(await screen.findByText('Delivered')).toBeInTheDocument();
    expect(webhooksApi.getWebhookDeliveries).toHaveBeenCalledWith({ triggerExecutionId: 100 });
  });

  it('shows the last_error reason for a failed delivery, badged "Failed" (text, not color)', async () => {
    vi.mocked(webhooksApi.getTriggerExecutions).mockResolvedValue({ ok: true, data: [execution()] });
    vi.mocked(webhooksApi.getWebhookDeliveries).mockResolvedValue({
      ok: true,
      data: [
        delivery({
          status: 'failed',
          last_status_code: 503,
          delivered_at: null,
          error: {
            code: 'WEBHOOK_NON_2XX',
            message: 'Webhook returned a non-2xx status',
            details: [{ field: 'status', error: '503 is not 2xx' }],
          },
        }),
      ],
    });

    render(<HistoryView boardId={1} />);
    await userEvent.click(await screen.findByRole('button', { name: /Moved/ }));

    expect(await screen.findByText('Failed')).toBeInTheDocument();
    expect(screen.getByText(/Webhook returned a non-2xx status/)).toBeInTheDocument();
    expect(screen.getByText(/503 is not 2xx/)).toBeInTheDocument();
  });

  it('renders an exhausted badge with its reason', async () => {
    vi.mocked(webhooksApi.getTriggerExecutions).mockResolvedValue({ ok: true, data: [execution()] });
    vi.mocked(webhooksApi.getWebhookDeliveries).mockResolvedValue({
      ok: true,
      data: [
        delivery({
          status: 'exhausted',
          delivered_at: null,
          error: {
            code: 'WEBHOOK_EXHAUSTED',
            message: 'Webhook delivery exhausted after 3 attempts',
            details: [{ field: 'attempts', error: '3 of 3 attempts failed' }],
          },
        }),
      ],
    });

    render(<HistoryView boardId={1} />);
    await userEvent.click(await screen.findByRole('button', { name: /Moved/ }));

    expect(await screen.findByText('Exhausted')).toBeInTheDocument();
    expect(screen.getByText(/exhausted after 3 attempts/)).toBeInTheDocument();
  });
});

describe('HistoryView — refresh', () => {
  it('re-fetches the firings when Refresh is clicked', async () => {
    vi.mocked(webhooksApi.getTriggerExecutions)
      .mockResolvedValueOnce({ ok: true, data: [] })
      .mockResolvedValueOnce({ ok: true, data: [execution()] });

    render(<HistoryView boardId={1} />);
    expect(await screen.findByText(/no automation has fired yet/i)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Refresh' }));

    expect(await screen.findByRole('button', { name: /Moved/ })).toBeInTheDocument();
  });
});
