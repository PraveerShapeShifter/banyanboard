import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { routes } from '../../routes';
import type { Board } from '../../api/types';
import * as client from '../../api/client';

/**
 * Phase 2 tests — board list page. The API client (the single I/O seam) is
 * module-mocked; the full route table is rendered through a memory router so
 * click-through navigation is exercised for real (not asserted on href alone).
 * Covers AC-ENTRY-1, AC-HAPPY-2/3/5, AC-ERROR-1, AC-ASYNC-1.
 */
vi.mock('../../api/client');

// Drive the same route table (single source of truth in routes.tsx) through the
// declarative router: the data router (createMemoryRouter) constructs a fetch
// Request with an AbortSignal on navigation, which jsdom/undici reject across
// realms. These are loader-free component tests, so declarative routing exercises
// the same path matching + Link navigation without that issue.
function renderAppAt(path = '/') {
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

const boards: Board[] = [
  {
    id: 1,
    name: 'Marketing Launch',
    description: 'Q3 campaign planning',
    created_at: '2026-07-01T00:00:00.000Z',
    updated_at: '2026-07-01T00:00:00.000Z',
  },
  {
    id: 2,
    name: 'Engineering Sprint 12',
    description: null,
    created_at: '2026-07-01T00:00:00.000Z',
    updated_at: '2026-07-01T00:00:00.000Z',
  },
];

afterEach(() => {
  vi.clearAllMocks();
});

describe('BoardListPage', () => {
  it('renders as the landing view with every board and a matching count (AC-ENTRY-1, AC-HAPPY-2)', async () => {
    vi.mocked(client.getBoards).mockResolvedValue({ ok: true, data: boards });

    renderAppAt('/');

    expect(
      await screen.findByRole('heading', { name: 'Boards' }),
    ).toBeInTheDocument();
    const items = await screen.findAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(screen.getByText('Marketing Launch')).toBeInTheDocument();
    expect(screen.getByText('Engineering Sprint 12')).toBeInTheDocument();
  });

  it('navigates to the board view when a board is activated (AC-HAPPY-3)', async () => {
    vi.mocked(client.getBoards).mockResolvedValue({ ok: true, data: boards });
    vi.mocked(client.getBoard).mockResolvedValue({ ok: true, data: boards[0] });
    vi.mocked(client.getCards).mockResolvedValue({ ok: true, data: [] });

    renderAppAt('/');

    const link = await screen.findByRole('link', { name: /Marketing Launch/ });
    await userEvent.click(link);

    // Landed on the board view: its `<h1>` (board name) and columns render.
    expect(
      await screen.findByRole('heading', { name: 'Marketing Launch', level: 1 }),
    ).toBeInTheDocument();
    expect(screen.getByRole('region', { name: /To Do/ })).toBeInTheDocument();
  });

  it('shows an explicit empty state when there are no boards (AC-HAPPY-5)', async () => {
    vi.mocked(client.getBoards).mockResolvedValue({ ok: true, data: [] });

    renderAppAt('/');

    expect(await screen.findByText('No boards yet.')).toBeInTheDocument();
  });

  it('shows an error with a working Retry when the fetch fails (AC-ERROR-1)', async () => {
    vi.mocked(client.getBoards)
      .mockResolvedValueOnce({ ok: false, kind: 'network', error: new Error('x') })
      .mockResolvedValueOnce({ ok: true, data: boards });

    renderAppAt('/');

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/couldn.t load boards/i);

    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));

    expect(await screen.findByText('Marketing Launch')).toBeInTheDocument();
  });

  it('shows a loading indicator while the fetch is in flight, then the content (AC-ASYNC-1)', async () => {
    let resolve!: (value: { ok: true; data: Board[] }) => void;
    vi.mocked(client.getBoards).mockReturnValue(
      new Promise((r) => {
        resolve = r;
      }),
    );

    renderAppAt('/');

    expect(screen.getByText('Loading…')).toBeInTheDocument();

    resolve({ ok: true, data: boards });

    expect(await screen.findByText('Marketing Launch')).toBeInTheDocument();
    expect(screen.queryByText('Loading…')).not.toBeInTheDocument();
  });

  it('renders a not-found page for an unknown route', async () => {
    renderAppAt('/nonexistent');

    expect(
      await screen.findByRole('heading', { name: /page not found/i }),
    ).toBeInTheDocument();
  });
});
