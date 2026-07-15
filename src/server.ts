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
import { PostgresWebhooksRepository } from './webhooks/webhooks.repository';

const env = loadEnv();
const pool = createPool(env.databaseUrl);
const activityStreamConfig: ActivityStreamConfig = {
  backfillLimit: env.activityBackfillLimit,
  heartbeatMs: env.activityHeartbeatMs,
};
const app = createApp({
  checkDb: () => checkConnection(pool),
  boardsRepo: new PostgresBoardsRepository(pool),
  cardsRepo: new PostgresCardsRepository(pool),
  activityRepo: new PostgresActivityRepository(pool),
  activityEmitter: new InProcessActivityEmitter(),
  activityStreamConfig,
  rulesRepo: new PostgresRulesRepository(pool),
  webhooksRepo: new PostgresWebhooksRepository(pool),
});

app.listen(env.port, () => {
  log('info', 'server started', { port: env.port });
});
