// Host server entry point: open the database, run migrations, listen on the LAN (spec §7.9).
import { mkdirSync } from 'node:fs';
import path from 'node:path';

import { migrateDatabase, openDatabase } from '@whiteboard/db';

import { buildApp } from './app';
import { loadConfig } from './config';

const config = loadConfig();
mkdirSync(config.dataDir, { recursive: true });

const { db, close } = openDatabase(path.join(config.dataDir, 'whiteboard.db'));
migrateDatabase(db);

const app = buildApp({ db, logger: true });

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void app.close().finally(() => {
      close();
      process.exit(0);
    });
  });
}

await app.listen({ host: config.host, port: config.port });
