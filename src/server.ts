import { createApp } from './app';
import { loadEnv } from './config/env';
import { log } from './config/logger';
import { createPool, checkConnection } from './db/pool';
import { PostgresBoardsRepository } from './boards/boards.repository';
import { PostgresCardsRepository } from './cards/cards.repository';

const env = loadEnv();
const pool = createPool(env.databaseUrl);
const app = createApp({
  checkDb: () => checkConnection(pool),
  boardsRepo: new PostgresBoardsRepository(pool),
  cardsRepo: new PostgresCardsRepository(pool),
});

app.listen(env.port, () => {
  log('info', 'server started', { port: env.port });
});
