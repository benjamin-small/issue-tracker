import { z } from 'zod';
import type { SsoOptions } from './env.ts';
import { createJwtVerifier } from './sso/jwt.ts';

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
    TRACKER_BLOB_STORE: z.enum(['local', 's3']).default('local'),
    TRACKER_BLOB_DIR: z.string().default('./data/blobs'),
    TRACKER_S3_ENDPOINT: z.string().optional(),
    TRACKER_S3_BUCKET: z.string().optional(),
    TRACKER_S3_REGION: z.string().optional(),
    TRACKER_S3_ACCESS_KEY_ID: z.string().optional(),
    TRACKER_S3_SECRET_ACCESS_KEY: z.string().optional(),
    TRACKER_S3_FORCE_PATH_STYLE: z.string().optional(),
    TRACKER_S3_PRESIGN: z.string().optional(),
    TRACKER_S3_PUBLIC_ENDPOINT: z.string().optional(),
    /** Run the background webhook worker in this process (turn off on replicas that should only serve API). */
    TRACKER_WEBHOOKS: bool(true),
    /** Let webhooks use http and reach private/loopback addresses. Never enable in production. */
    TRACKER_WEBHOOK_ALLOW_PRIVATE: bool(!production),
    TRACKER_LOG_LEVEL: z
      .enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent'])
      .default(process.env.VITEST ? 'silent' : 'info'),
    /** `json` for log collectors (production default); `pretty` for terminals. */
    TRACKER_LOG_FORMAT: z.enum(['json', 'pretty']).default(production ? 'json' : 'pretty'),
    /** How long shutdown waits for in-flight requests before closing connections. */
    TRACKER_SHUTDOWN_TIMEOUT_MS: z.coerce.number().int().min(0).default(10_000),
    TRACKER_MAX_UPLOAD_MB: z.coerce.number().positive().max(1024).default(25),
    TRACKER_ALLOWED_ORIGINS: z
      .string()
      .default('')
      .transform((v) =>
        v
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
      ),
    /** SSO: enabled when the issuer is set. See docs/deployment.md "Single sign-on". */
    TRACKER_SSO_ISSUER: z.url().optional(),
    TRACKER_SSO_NAME: z.string().optional(),
    TRACKER_SSO_COOKIE: z.string().optional(),
    TRACKER_SSO_AUDIENCE: z.string().optional(),
    TRACKER_SSO_JWKS_URL: z.url().optional(),
    TRACKER_SSO_LOGIN_URL: z.url().optional(),
    TRACKER_SSO_REFRESH_URL: z.url().optional(),
    TRACKER_SSO_ADMIN_ROLE: z.string().default('admin'),
  });
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid configuration:\n${lines}`);
  }
  if (production && parsed.data.TRACKER_AUTH_MODE === 'dev')
    throw new Error('TRACKER_AUTH_MODE=dev is not allowed when NODE_ENV=production');
  if (production && parsed.data.TRACKER_WEBHOOK_ALLOW_PRIVATE)
    throw new Error('TRACKER_WEBHOOK_ALLOW_PRIVATE is not allowed when NODE_ENV=production');
  if (parsed.data.TRACKER_BLOB_STORE === 's3')
    for (const name of [
      'TRACKER_S3_ENDPOINT',
      'TRACKER_S3_BUCKET',
      'TRACKER_S3_ACCESS_KEY_ID',
      'TRACKER_S3_SECRET_ACCESS_KEY',
    ] as const)
      if (!parsed.data[name]) throw new Error(`${name} is required when TRACKER_BLOB_STORE=s3`);
  if (parsed.data.TRACKER_SSO_ISSUER) {
    const missing = (
      [
        'TRACKER_SSO_COOKIE',
        'TRACKER_SSO_AUDIENCE',
        'TRACKER_SSO_JWKS_URL',
        'TRACKER_SSO_LOGIN_URL',
      ] as const
    ).filter((name) => !parsed.data[name]);
    if (missing.length)
      throw new Error(
        `${missing.join(', ')} ${missing.length > 1 ? 'are' : 'is'} required when TRACKER_SSO_ISSUER is set`,
      );
  }
  return parsed.data;
}

export type ServerConfig = ReturnType<typeof loadConfig>;

/** SSO options for the app, or undefined when SSO is off. */
export function ssoOptionsFromConfig(config: ServerConfig): SsoOptions | undefined {
  const issuer = config.TRACKER_SSO_ISSUER;
  if (!issuer) return undefined;
  const audience = config.TRACKER_SSO_AUDIENCE!;
  return {
    name: config.TRACKER_SSO_NAME ?? new URL(issuer).hostname,
    cookie: config.TRACKER_SSO_COOKIE!,
    issuer,
    loginUrl: config.TRACKER_SSO_LOGIN_URL!,
    refreshUrl: config.TRACKER_SSO_REFRESH_URL,
    adminRole: config.TRACKER_SSO_ADMIN_ROLE,
    verifier: createJwtVerifier({ jwksUrl: config.TRACKER_SSO_JWKS_URL!, issuer, audience }),
  };
}
