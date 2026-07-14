import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { routes } from '../../routes';
import type { Board, Card, CardStatus } from '../../api/types';
import * as client from '../../api/client';

/**
 * Phase 3 tests — board view + 3-column status grouping. The client (single I/O
 * seam) is module-mocked; the shared route table is driven through the
 * declarative router so the list→click→columns journey is exercised for real.
 * Covers AC-HAPPY-4/6, AC-ERROR-2/3, AC-ASYNC-1 (board).
 */
vi.mock('../../api/client');

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

const board: Board = {
  id: 1,
  name: 'Marketing Launch',
  description: null,
  created_at: '2026-07-01T00:00:00.000Z',
  updated_at: '2026-07-01T00:00:00.000Z',
};

function card(id: number, status: CardStatus, title: string): Card {
  return {
    id,
    board_id: 1,
    title,
    description: null,
    status,
    due_date: null,
    created_at: '2026-07-01T00:00:00.000Z',
    updated_at: '2026-07-01T00:00:00.000Z',
  };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('BoardViewPage', () => {
  it('renders each card under the column matching its status, each in exactly one column (AC-HAPPY-4)', async () => {
    vi.mocked(client.getBoard).mockResolvedValue({ ok: true, data: board });
    vi.mocked(client.getCards).mockResolvedValue({
      ok: true,
      data: [
        card(1, 'todo', 'Draft brief'),
        card(2, 'in_progress', 'Write copy'),
        card(3, 'done', 'Kickoff'),
        card(4, 'todo', 'Book venue'),
      ],
    });

    renderAppAt('/boards/1');

    const todo = await screen.findByRole('region', { name: /To Do/ });
    const inProgress = screen.getByRole('region', { name: /In Progress/ });
    const done = screen.getByRole('region', { name: /Done/ });

    expect(within(todo).getByText('Draft brief')).toBeInTheDocument();
    expect(within(todo).getByText('Book venue')).toBeInTheDocument();
    expect(within(inProgress).getByText('Write copy')).toBeInTheDocument();
    expect(within(done).getByText('Kickoff')).toBeInTheDocument();

    // A card appears in exactly one column, never leaks across.
    expect(within(inProgress).queryByText('Draft brief')).not.toBeInTheDocument();
    expect(within(done).queryByText('Write copy')).not.toBeInTheDocument();
  });

  it('renders all three columns even when a status has no cards, with an explicit empty indicator (AC-HAPPY-6)', async () => {
    vi.mocked(client.getBoard).mockResolvedValue({ ok: true, data: board });
    vi.mocked(client.getCards).mockResolvedValue({
      ok: true,
      data: [card(1, 'todo', 'Only todo')],
    });

    renderAppAt('/boards/1');

    const done = await screen.findByRole('region', { name: /Done \(0\)/ });
    expect(within(done).getByText('No cards')).toBeInTheDocument();
    expect(screen.getAllByRole('region')).toHaveLength(3);
  });

  it('shows an error with a working Retry when the board data fails, and no column silently empties (AC-ERROR-2)', async () => {
    vi.mocked(client.getBoard).mockResolvedValue({ ok: true, data: board });
    vi.mocked(client.getCards)
      .mockResolvedValueOnce({ ok: false, kind: 'network', error: new Error('x') })
      .mockResolvedValueOnce({ ok: true, data: [card(1, 'todo', 'Draft brief')] });

    renderAppAt('/boards/1');

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/couldn.t load this board/i);
    expect(screen.queryByRole('region')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));

    expect(await screen.findByText('Draft brief')).toBeInTheDocument();
  });

  it('shows a distinct "board not found" state on 404 with a way back and no Retry (AC-ERROR-3)', async () => {
    vi.mocked(client.getBoard).mockResolvedValue({ ok: false, kind: 'http', status: 404 });
    vi.mocked(client.getCards).mockResolvedValue({ ok: true, data: [] });

    renderAppAt('/boards/999');

    expect(
      await screen.findByRole('heading', { name: /board not found/i }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: /back to boards/i }),
    ).toBeInTheDocument();
  });

  it('shows a loading indicator while board data is in flight, then the content (AC-ASYNC-1)', async () => {
    let resolveBoard!: (value: { ok: true; data: Board }) => void;
    vi.mocked(client.getBoard).mockReturnValue(
      new Promise((r) => {
        resolveBoard = r;
      }),
    );
    vi.mocked(client.getCards).mockResolvedValue({ ok: true, data: [] });

    renderAppAt('/boards/1');

    expect(screen.getByText('Loading…')).toBeInTheDocument();

    resolveBoard({ ok: true, data: board });

    expect(
      await screen.findByRole('heading', { name: 'Marketing Launch' }),
    ).toBeInTheDocument();
  });

  it('journey: board list → click a board → its status columns render (entry→success)', async () => {
    vi.mocked(client.getBoards).mockResolvedValue({ ok: true, data: [board] });
    vi.mocked(client.getBoard).mockResolvedValue({ ok: true, data: board });
    vi.mocked(client.getCards).mockResolvedValue({
      ok: true,
      data: [card(1, 'todo', 'Draft brief')],
    });

    renderAppAt('/');

    const link = await screen.findByRole('link', { name: /Marketing Launch/ });
    await userEvent.click(link);

    expect(
      await screen.findByRole('region', { name: /To Do/ }),
    ).toBeInTheDocument();
    expect(screen.getByText('Draft brief')).toBeInTheDocument();
  });
});
