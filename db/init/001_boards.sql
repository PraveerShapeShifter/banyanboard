-- 001_boards.sql — first schema for BanyanBoard.
--
-- Mounted read-only into the postgres container at
-- /docker-entrypoint-initdb.d/. Postgres runs every *.sql here in filename
-- order, but ONLY when the data directory is empty (a fresh volume). To (re)apply
-- after changing this file, recreate the volume: `docker compose down -v`.
--
-- `boards` is the top-level container in BanyanBoard and the FK target for
-- FEAT-003's `cards.board_id` — hence the INTEGER identity primary key.

CREATE TABLE IF NOT EXISTS boards (
  id          INTEGER      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name        VARCHAR(120) NOT NULL,
  description TEXT,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);
