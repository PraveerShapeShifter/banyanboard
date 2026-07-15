import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { routes } from '../../routes';
import type { Board } from '../../api/types';
import * as client from '../../api/client';
import * as rulesApi from '../../api/rules';
import * as webhooksApi from '../../api/webhooks';

/**
 * TASK-006 Phase 4: the Automation page at `/boards/:id/automation`. Rendered
 * through the shared route table (single source of truth in `routes.tsx`) via a
 * MemoryRouter, exactly as `BoardListPage.test.tsx` does. The three seams
 * (`client`/`rules`/`webhooks`) are module-mocked. Covers reachability,
 * loading→ready, board 404 → NotFoundState, the Rules/History tablist switch,
 * and the Board/Automation nav.
 */
vi.mock('../../api/client');
vi.mock('../../api/rules');
vi.mock('../../api/webhooks');

const board: Board = {
  id: 1,
  name: 'Marketing Launch',
  description: null,
  created_at: '2026-07-01T00:00:00.000Z',
  updated_at: '2026-07-01T00:00:00.000Z',
};

function renderAppAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        {routes.map((route) => (
          <Route key={route.path} path={route.path} element={route.element} />
        ))}
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.mocked(rulesApi.getRules).mockResolvedValue({ ok: true, data: [] });
  vi.mocked(webhooksApi.getTriggerExecutions).mockResolvedValue({ ok: true, data: [] });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('AutomationPage', () => {
  it('is reachable at /boards/:id/automation and renders the board name + Rules tab', async () => {
    vi.mocked(client.getBoard).mockResolvedValue({ ok: true, data: board });

    renderAppAt('/boards/1/automation');

    expect(
      await screen.findByRole('heading', { name: 'Marketing Launch', level: 1 }),
    ).toBeInTheDocument();
    const rulesTab = screen.getByRole('tab', { name: 'Rules' });
    expect(rulesTab).toHaveAttribute('aria-selected', 'true');
    // The Rules panel (its form) is showing by default.
    expect(screen.getByRole('button', { name: /create rule/i })).toBeInTheDocument();
  });

  it('shows a distinct "board not found" state on a board 404 (no Retry)', async () => {
    vi.mocked(client.getBoard).mockResolvedValue({ ok: false, kind: 'http', status: 404 });

    renderAppAt('/boards/999/automation');

    expect(
      await screen.findByRole('heading', { name: /board not found/i }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
  });

  it('switches from the Rules panel to the History panel via the tablist', async () => {
    vi.mocked(client.getBoard).mockResolvedValue({ ok: true, data: board });

    renderAppAt('/boards/1/automation');

    await screen.findByRole('button', { name: /create rule/i });
    await userEvent.click(screen.getByRole('tab', { name: 'History' }));

    expect(screen.getByRole('tab', { name: 'History' })).toHaveAttribute('aria-selected', 'true');
    expect(
      await screen.findByText('No automation has fired yet on this board.'),
    ).toBeInTheDocument();
    // The Rules form is no longer mounted.
    expect(screen.queryByRole('button', { name: /create rule/i })).not.toBeInTheDocument();
  });

  it('offers a Board nav link back to the board view', async () => {
    vi.mocked(client.getBoard).mockResolvedValue({ ok: true, data: board });

    renderAppAt('/boards/1/automation');

    await screen.findByRole('heading', { name: 'Marketing Launch', level: 1 });
    const boardLink = screen.getByRole('link', { name: 'Board' });
    expect(boardLink).toHaveAttribute('href', '/boards/1');
    const automationLink = screen.getByRole('link', { name: 'Automation' });
    expect(automationLink).toHaveAttribute('aria-current', 'page');
  });
});
