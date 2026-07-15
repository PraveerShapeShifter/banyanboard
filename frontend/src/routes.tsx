import type { RouteObject } from 'react-router-dom';
import BoardListPage from './pages/BoardListPage/BoardListPage';
import BoardViewPage from './pages/BoardViewPage/BoardViewPage';
import NotFoundState from './components/NotFoundState';

/**
 * Single source of truth for the route table, shared by the app
 * (`createBrowserRouter`) and tests (`createMemoryRouter`). The board-view 404
 * (AC-ERROR-3, Phase 3) is data-driven inside BoardViewPage, distinct from this
 * catch-all route for genuinely unknown URLs.
 */
export const routes: RouteObject[] = [
  { path: '/', element: <BoardListPage /> },
  { path: '/boards/:id', element: <BoardViewPage /> },
  { path: '*', element: <NotFoundState /> },
];
