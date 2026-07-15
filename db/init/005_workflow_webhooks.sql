-- 005_workflow_webhooks.sql — fifth schema for BanyanBoard (FEAT-006 / TASK-006).
--
-- Mounted read-only into the postgres container at
-- /docker-entrypoint-initdb.d/. Postgres runs every *.sql here in filename
-- order, but ONLY when the data directory is empty (a fresh volume). Numbered
-- `005_` so it runs AFTER `004_automation_rules.sql` — the `automation_rules`
-- FK target must exist first. To (re)apply after changing this file, recreate
-- the volume: `docker compose down -v`.
--
-- Two audit tables for the webhook/trigger subsystem, with a deliberate split
-- (frozen webhook architecture decision):
--   * `trigger_executions` — one row per rule firing (an applied auto-move hop);
--     `status` reflects whether the auto-move applied ('executed'|'failed').
--   * `webhook_deliveries` — one row per webhook attempt-lifecycle; `status`
--     ('pending'|'delivered'|'failed'|'exhausted') is tracked SEPARATELY from
--     `trigger_executions.status`. `payload` is a TEXT JSON snapshot (NOT JSONB,
--     consistent with the frozen `condition` decision); `last_error` stores the
--     serialized coded {code,message,details}.
--
-- `trigger_executions` is created BEFORE `webhook_deliveries` (the latter
-- FK-references the former). `rule_id`/`card_id` SET NULL so history survives
-- rule/card deletion (mirrors `card_activity`); `board_id` CASCADEs.

CREATE TABLE IF NOT EXISTS trigger_executions (
  id           INTEGER      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  rule_id      INTEGER      REFERENCES automation_rules(id) ON DELETE SET NULL,
  card_id      INTEGER      REFERENCES cards(id)            ON DELETE SET NULL,
  board_id     INTEGER      NOT NULL REFERENCES boards(id)  ON DELETE CASCADE,
  from_status  VARCHAR(20)  NOT NULL CHECK (from_status IN ('todo', 'in_progress', 'done')),
  to_status    VARCHAR(20)  NOT NULL CHECK (to_status   IN ('todo', 'in_progress', 'done')),
  status       VARCHAR(10)  NOT NULL CHECK (status IN ('executed', 'failed')),
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS trigger_executions_board_id_idx ON trigger_executions (board_id);
CREATE INDEX IF NOT EXISTS trigger_executions_rule_id_idx  ON trigger_executions (rule_id);

CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id                   INTEGER       GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  trigger_execution_id INTEGER       NOT NULL REFERENCES trigger_executions(id) ON DELETE CASCADE,
  rule_id              INTEGER       REFERENCES automation_rules(id) ON DELETE SET NULL,
  url                  VARCHAR(2048) NOT NULL,
  status               VARCHAR(10)   NOT NULL DEFAULT 'pending'
                         CHECK (status IN ('pending', 'delivered', 'failed', 'exhausted')),
  attempts             INTEGER       NOT NULL DEFAULT 0,
  last_status_code     INTEGER,
  last_error           TEXT,
  payload              TEXT          NOT NULL,
  created_at           TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ   NOT NULL DEFAULT now(),
  delivered_at         TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS webhook_deliveries_trigger_execution_id_idx ON webhook_deliveries (trigger_execution_id);
CREATE INDEX IF NOT EXISTS webhook_deliveries_rule_id_idx              ON webhook_deliveries (rule_id);
-- status index supports the ?status= read filter AND the optional startup
-- re-drive (findNonTerminalDeliveries: WHERE status IN ('pending','failed')).
CREATE INDEX IF NOT EXISTS webhook_deliveries_status_idx               ON webhook_deliveries (status);
