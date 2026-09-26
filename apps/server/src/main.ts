import { loadConfig } from './config.ts';
import { startServer } from './server.ts';

const config = loadConfig();
const server = await startServer(config);
console.log(
  `Tracker API listening on ${server.url}  (docs: ${server.url}/api/docs, auth mode: ${config.TRACKER_AUTH_MODE})`,
);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    console.log(`${signal} received, shutting down`);
    void server.close().then(() => process.exit(0));
  });
}
