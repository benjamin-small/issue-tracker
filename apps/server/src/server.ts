import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { serve } from '@hono/node-server';
import {
  blobStoreFromEnv,
  createContext,
  ensureBuiltins,
  EventTailer,
  seedDemoData,
  SYSTEM_ACTOR,
} from '@tracker/core';
import { createDb, type Db, migrateToLatest, migrationStatus, parseDatabaseUrl } from '@tracker/db';
import { createApp } from './app.ts';
import type { ServerConfig } from './config.ts';
import type { AppExtension } from './env.ts';

export interface RunningServer {
  url: string;
  db: Db;
  tailer: EventTailer;
  close(): Promise<void>;
}

/** Prepares the database (migrate, builtins, optional demo seed) according to config. */
export async function prepareDatabase(
  db: Db,
  config: Pick<ServerConfig, 'TRACKER_AUTO_MIGRATE' | 'TRACKER_SEED'>,
) {
  if (config.TRACKER_AUTO_MIGRATE) {
    const applied = await migrateToLatest(db);
    if (applied.length) console.log(`Applied migrations: ${applied.join(', ')}`);
  } else {
    const status = await migrationStatus(db);
    if (!status.upToDate)
      throw new Error(
        `Database is not migrated (pending: ${status.pending.join(', ')}). Run \`tracker db migrate\`.`,
      );
  }
  await ensureBuiltins(db);
  if (config.TRACKER_SEED) {
    const users = await db.kysely
      .selectFrom('users')
      .select((eb) => eb.fn.countAll<number>().as('n'))
      .where('kind', '!=', 'system')
      .executeTakeFirstOrThrow();
    if (Number(users.n) === 0) {
      const seeded = await seedDemoData(createContext(db, SYSTEM_ACTOR));
      console.log('Seeded demo data (users: ada [admin], grace, claude [agent]; project ENG).');
      console.log(`  admin token (ada):    ${seeded.adminToken}`);
      console.log(`  agent token (claude): ${seeded.agentToken}`);
    }
  }
}

/** Starts the HTTP server. Used by `node apps/server/src/main.ts` and `tracker serve`. */
export async function startServer(
  config: ServerConfig,
  extensions: AppExtension[] = [],
): Promise<RunningServer> {
  const dbConfig = parseDatabaseUrl(config.TRACKER_DATABASE_URL);
  if (dbConfig.dialect === 'sqlite' && dbConfig.filename !== ':memory:')
    mkdirSync(dirname(dbConfig.filename), { recursive: true });
  const db = createDb(dbConfig);
  await prepareDatabase(db, config);
  const tailer = new EventTailer(db);
  await tailer.start();

  const app = createApp({
    db,
    auth: {
      mode: 'standard',
      allowDevLogin: config.TRACKER_AUTH_MODE === 'dev',
      secureCookies: config.TRACKER_SECURE_COOKIES,
      allowedOrigins: config.TRACKER_ALLOWED_ORIGINS,
    },
    ...(config.TRACKER_WEB_DIR && { webDir: config.TRACKER_WEB_DIR }),
    tailer,
    blobStore: blobStoreFromEnv(config as unknown as Record<string, string | undefined>),
    maxUploadBytes: config.TRACKER_MAX_UPLOAD_MB * 1024 * 1024,
    extensions,
  });

  return new Promise((resolve) => {
    const server = serve(
      { fetch: app.fetch, hostname: config.TRACKER_HOST, port: config.TRACKER_PORT },
      (info) => {
        const url = `http://${info.address.includes(':') ? `[${info.address}]` : info.address}:${info.port}`;
        resolve({
          url,
          db,
          tailer,
          close: () =>
            new Promise<void>((done) => {
              // Open SSE streams would keep the server alive; drop connections before waiting for close().
              (server as unknown as { closeAllConnections?: () => void }).closeAllConnections?.();
              server.close(() => {
                void tailer
                  .stop()
                  .then(() => db.destroy())
                  .then(() => done());
              });
            }),
        });
      },
    );
  });
}
