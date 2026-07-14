-- 003_card_activity.sql — third schema for BanyanBoard (FEAT-005 / TASK-005).
--
-- Mounted read-only into the postgres container at
-- /docker-entrypoint-initdb.d/. Postgres runs every *.sql here in filename
-- order, but ONLY when the data directory is empty (a fresh volume). Numbered
-- `003_` so it runs AFTER `001_boards.sql` and `002_cards.sql` — both FK
-- targets must exist first. To (re)apply after changing this file, recreate
-- the volume: `docker compose down -v`.
--
-- Records one row per real card status transition captured on
-- `PATCH /cards/:id` (TASK-005). The identity PK doubles as the realtime
-- event id / SSE `Last-Event-ID` cursor (see the architecture decision,
-- memory-bank/creative/TASK-005-realtime-activity-feed-architecture.md, Q3).
--
-- FK `ON DELETE` is a deliberate asymmetry: `board_id` CASCADEs (activity is
-- meaningless without its board — mirrors `cards.board_id`), while `card_id`
-- SETs NULL so movement history survives the card being deleted; `card_title`
-- is denormalized so the feed still reads afterward.

CREATE TABLE IF NOT EXISTS card_activity (
  id          INTEGER      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  board_id    INTEGER      NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  card_id     INTEGER               REFERENCES cards(id)  ON DELETE SET NULL,
  card_title  VARCHAR(200) NOT NULL,                        -- denormalized: survives card deletion
  from_status VARCHAR(20)  NOT NULL CHECK (from_status IN ('todo', 'in_progress', 'done')),
  to_status   VARCHAR(20)  NOT NULL CHECK (to_status   IN ('todo', 'in_progress', 'done')),
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- Serves both backfill (board_id, id DESC LIMIT n) and replay (board_id, id > cursor).
CREATE INDEX IF NOT EXISTS card_activity_board_id_id_idx ON card_activity (board_id, id);
