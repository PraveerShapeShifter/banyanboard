-- 002_cards.sql — second schema for BanyanBoard (FEAT-003 / TASK-003).
--
-- Mounted read-only into the postgres container at
-- /docker-entrypoint-initdb.d/. Postgres runs every *.sql here in filename
-- order, but ONLY when the data directory is empty (a fresh volume). Numbered
-- `002_` so it runs AFTER `001_boards.sql` — the `boards` FK target must exist
-- first. To (re)apply after changing this file, recreate the volume:
-- `docker compose down -v`.
--
-- `cards` is the unit-of-work entity. Each card belongs to exactly one board;
-- deleting a board cascades to its cards (productBrief Data & Privacy: "board
-- deletion cascades to associated cards"). `status` models the fixed kanban
-- columns (To Do / In Progress / Done) that FEAT-004 groups cards into.

CREATE TABLE IF NOT EXISTS cards (
  id          INTEGER      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  board_id    INTEGER      NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  title       VARCHAR(200) NOT NULL,
  description TEXT,
  status      VARCHAR(20)  NOT NULL DEFAULT 'todo'
                           CHECK (status IN ('todo', 'in_progress', 'done')),
  due_date    DATE,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- `board_id` is the primary filter/lookup path (`GET /cards?board_id=`), so
-- index it to keep list queries within the p95 < 200ms NFR.
CREATE INDEX IF NOT EXISTS cards_board_id_idx ON cards (board_id);
