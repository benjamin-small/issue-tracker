import { z } from 'zod';

const bool = (fallback: boolean) =>
  z
    .enum(['1', '0', 'true', 'false'])
    .optional()
    .transform((v) => (v === undefined ? fallback : v === '1' || v === 'true'));

/**
 * Server configuration from environment variables (all prefixed `TRACKER_`). Validated at startup so a bad
 * deployment fails fast with a clear message. Defaults suit local development.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env) {
  const production = env.NODE_ENV === 'production';
  const schema = z.object({
    TRACKER_DATABASE_URL: z.string().default('sqlite:./data/dev.db'),
    TRACKER_HOST: z.string().default(production ? '0.0.0.0' : '127.0.0.1'),
    TRACKER_PORT: z.coerce.number().int().min(0).max(65535).default(3000),
    TRACKER_AUTH_MODE: z.enum(['dev', 'standard']).default(production ? 'standard' : 'dev'),
    TRACKER_AUTO_MIGRATE: bool(!production),
    TRACKER_SEED: bool(!production),
    TRACKER_WEB_DIR: z.string().optional(),
    TRACKER_SECURE_COOKIES: bool(production),
    TRACKER_ALLOWED_ORIGINS: z
      .string()
      .default('')
      .transform((v) =>
        v
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
      ),
  });
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid configuration:\n${lines}`);
  }
  if (production && parsed.data.TRACKER_AUTH_MODE === 'dev')
    throw new Error('TRACKER_AUTH_MODE=dev is not allowed when NODE_ENV=production');
  return parsed.data;
}

export type ServerConfig = ReturnType<typeof loadConfig>;
