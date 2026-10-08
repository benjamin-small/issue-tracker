import { applyLegacyEnv, legacyEnvWarning } from '@poietic-tech/issues-core';
import { loadConfig } from './config.ts';
import { startServer } from './server.ts';

const legacyWarning = legacyEnvWarning(applyLegacyEnv(process.env));
if (legacyWarning) console.warn(legacyWarning);

let config;
try {
  config = loadConfig();
} catch (error) {
  console.error((error as Error).message);
  process.exit(2);
}
const server = await startServer(config).catch((error: unknown) => {
  console.error(`poietic-issues failed to start: ${(error as Error).message}`);
  process.exit(1);
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    server.logger.info({ signal }, 'signal received');
    server.close().then(
      () => process.exit(0),
      (error: unknown) => {
        server.logger.error({ err: error }, 'shutdown failed');
        process.exit(1);
      },
    );
  });
}
