/** Worker bindings: `vars` in wrangler.jsonc (R2_ENDPOINT via `--var` at deploy) and secrets set by CI. */
export interface WorkerEnv {
  PUBLIC_ORIGIN: string;
  R2_ENDPOINT: string;
  DB_BUCKET: string;
  ATTACHMENTS_BUCKET: string;
  SSO_NAME: string;
  SSO_COOKIE: string;
  SSO_ISSUER: string;
  SSO_AUDIENCE: string;
  SSO_JWKS_URL: string;
  SSO_LOGIN_URL: string;
  SSO_REFRESH_URL: string;
  R2_ACCESS_KEY_ID: string;
  R2_SECRET_ACCESS_KEY: string;
}

const REQUIRED = [
  'PUBLIC_ORIGIN',
  'R2_ENDPOINT',
  'R2_ACCESS_KEY_ID',
  'R2_SECRET_ACCESS_KEY',
] as const;

/**
 * The container's environment. The tracker image's own defaults (NODE_ENV=production, port 3000, /data) stay;
 * this adds storage, the public origin (Containers rewrites Host to "container", so same-origin checks need it)
 * and SSO. Litestream reads the LITESTREAM_* values through litestream.yml.
 */
export function containerEnv(env: WorkerEnv): Record<string, string> {
  for (const name of REQUIRED)
    if (!env[name]) throw new Error(`${name} is not set on the poietic-issues Worker`);
  return {
    TRACKER_DATABASE_URL: 'sqlite:/data/tracker.db',
    TRACKER_SECURE_COOKIES: '1',
    TRACKER_ALLOWED_ORIGINS: env.PUBLIC_ORIGIN,
    TRACKER_LOG_FORMAT: 'json',
    TRACKER_BLOB_STORE: 's3',
    TRACKER_S3_ENDPOINT: env.R2_ENDPOINT,
    TRACKER_S3_BUCKET: env.ATTACHMENTS_BUCKET,
    TRACKER_S3_REGION: 'auto',
    TRACKER_S3_ACCESS_KEY_ID: env.R2_ACCESS_KEY_ID,
    TRACKER_S3_SECRET_ACCESS_KEY: env.R2_SECRET_ACCESS_KEY,
    TRACKER_SSO_NAME: env.SSO_NAME,
    TRACKER_SSO_COOKIE: env.SSO_COOKIE,
    TRACKER_SSO_ISSUER: env.SSO_ISSUER,
    TRACKER_SSO_AUDIENCE: env.SSO_AUDIENCE,
    TRACKER_SSO_JWKS_URL: env.SSO_JWKS_URL,
    TRACKER_SSO_LOGIN_URL: env.SSO_LOGIN_URL,
    TRACKER_SSO_REFRESH_URL: env.SSO_REFRESH_URL,
    LITESTREAM_ENDPOINT: env.R2_ENDPOINT,
    LITESTREAM_BUCKET: env.DB_BUCKET,
    LITESTREAM_ACCESS_KEY_ID: env.R2_ACCESS_KEY_ID,
    LITESTREAM_SECRET_ACCESS_KEY: env.R2_SECRET_ACCESS_KEY,
  };
}
