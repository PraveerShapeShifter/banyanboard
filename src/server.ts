import { createApp } from './app';
import { loadEnv } from './config/env';
import { log } from './config/logger';
import { createPool, checkConnection } from './db/pool';
import { PostgresBoardsRepository } from './boards/boards.repository';
import { PostgresCardsRepository } from './cards/cards.repository';
import { PostgresActivityRepository } from './activity/activity.repository';
import { InProcessActivityEmitter } from './activity/activity.emitter';
import type { ActivityStreamConfig } from './activity/activity.routes';
import { PostgresRulesRepository } from './rules/rules.repository';
import { CardRuleEngine } from './rules/rules.engine';
import { PostgresWebhooksRepository } from './webhooks/webhooks.repository';
import { HttpWebhookDispatcher } from './webhooks/webhooks.dispatcher';

const env = loadEnv();
const pool = createPool(env.databaseUrl);
const activityStreamConfig: ActivityStreamConfig = {
  backfillLimit: env.activityBackfillLimit,
  heartbeatMs: env.activityHeartbeatMs,
};

// Shared instances so the CRUD routes and the rule engine act on the same
// data-access + fan-out layer (the engine reuses the repositories directly,
// never re-entering the HTTP handler).
const cardsRepo = new PostgresCardsRepository(pool);
const activityRepo = new PostgresActivityRepository(pool);
const activityEmitter = new InProcessActivityEmitter();
const rulesRepo = new PostgresRulesRepository(pool);
const webhooksRepo = new PostgresWebhooksRepository(pool);
// Phase 3: the real outbound HTTP + bounded-retry dispatcher, driving delivery
// OFF the request path (global `fetch` + `AbortController` + `setTimeout`).
const webhookDispatcher = new HttpWebhookDispatcher(webhooksRepo, {
  timeoutMs: env.webhookTimeoutMs,
  maxAttempts: env.webhookMaxAttempts,
  retryBackoffMs: env.webhookRetryBackoffMs,
});
const ruleEngine = new CardRuleEngine({
  rulesRepo,
  cardsRepo,
  activityRepo,
  activityEmitter,
  webhooksRepo,
  webhookDispatcher,
});

const app = createApp({
  checkDb: () => checkConnection(pool),
  boardsRepo: new PostgresBoardsRepository(pool),
  cardsRepo,
  activityRepo,
  activityEmitter,
  activityStreamConfig,
  rulesRepo,
  ruleEngine,
  webhooksRepo,
});

app.listen(env.port, () => {
  log('info', 'server started', { port: env.port });
});
