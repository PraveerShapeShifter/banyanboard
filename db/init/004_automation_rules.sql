-- 004_automation_rules.sql — fourth schema for BanyanBoard (FEAT-006 / TASK-006).
--
-- Mounted read-only into the postgres container at
-- /docker-entrypoint-initdb.d/. Postgres runs every *.sql here in filename
-- order, but ONLY when the data directory is empty (a fresh volume). Numbered
-- `004_` so it runs AFTER `001_boards.sql`, `002_cards.sql`, and
-- `003_card_activity.sql` — all FK targets must exist first. To (re)apply after
-- changing this file, recreate the volume: `docker compose down -v`.
--
-- An `automation_rule` is a board-scoped `condition -> target_status` mapping.
-- Per the frozen architecture decision (normalized typed columns, NOT JSONB),
-- the single-predicate condition is persisted as three CHECK-constrained
-- columns (`condition_field`/`condition_operator`/`condition_value`) that the
-- repository folds into a nested `condition: {field, operator, value}` object on
-- the wire. `target_status`/`condition_value` reuse the exact
-- `VARCHAR(20) CHECK (... IN (...))` status-enum idiom used by
-- `cards.status`/`card_activity`. `webhook_url` is nullable — an absolute
-- `http(s)` URL when set (validated in `rules.validation.ts`), NULL disables
-- delivery.
--
-- The `automation_rules` table is created BEFORE the `card_activity` ALTER that
-- FK-references it (same file, correct order). `board_id` CASCADEs (a rule is
-- meaningless without its board — mirrors `cards.board_id`); `card_activity`'s
-- new `rule_id` SETs NULL so movement history survives rule deletion.

CREATE TABLE IF NOT EXISTS automation_rules (
  id                 INTEGER      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  board_id           INTEGER      NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  name               VARCHAR(120) NOT NULL,
  condition_field    VARCHAR(20)  NOT NULL CHECK (condition_field    IN ('status')),
  condition_operator VARCHAR(10)  NOT NULL CHECK (condition_operator IN ('eq')),
  condition_value    VARCHAR(20)  NOT NULL CHECK (condition_value    IN ('todo', 'in_progress', 'done')),
  target_status      VARCHAR(20)  NOT NULL CHECK (target_status      IN ('todo', 'in_progress', 'done')),
  enabled            BOOLEAN      NOT NULL DEFAULT true,
  webhook_url        VARCHAR(2048),
  created_at         TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- `board_id` is the primary filter/lookup path (`GET /rules?board_id=` and the
-- engine's `findEnabledByBoard`), so index it to keep reads within p95 < 200ms.
CREATE INDEX IF NOT EXISTS automation_rules_board_id_idx ON automation_rules (board_id);

-- Extend `card_activity` so automated moves are distinguishable from manual ones
-- in the FEAT-005 feed. Both columns are additive with safe defaults so existing
-- rows/inserts are unaffected: `triggered_by` defaults to 'manual' (the existing
-- capture path), `rule_id` links the driving rule (SET NULL keeps history after
-- a rule is deleted, mirroring `card_activity.card_id`).
ALTER TABLE card_activity
  ADD COLUMN IF NOT EXISTS triggered_by VARCHAR(10) NOT NULL DEFAULT 'manual'
    CHECK (triggered_by IN ('manual', 'rule')),
  ADD COLUMN IF NOT EXISTS rule_id INTEGER REFERENCES automation_rules(id) ON DELETE SET NULL;
