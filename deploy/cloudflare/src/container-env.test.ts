import { describe, expect, it } from 'vitest';
import { containerEnv, type WorkerEnv } from './container-env.ts';

const env: WorkerEnv = {
  PUBLIC_ORIGIN: 'https://issues.poietic.tech',
  R2_ENDPOINT: 'https://acct.r2.cloudflarestorage.com',
  DB_BUCKET: 'poietic-issues-db',
  ATTACHMENTS_BUCKET: 'poietic-issues-attachments',
  SSO_NAME: 'poietic.tech',
  SSO_COOKIE: '__Secure-poietic-session',
  SSO_ISSUER: 'https://auth.poietic.tech',
  SSO_AUDIENCE: 'poietic:public',
  SSO_JWKS_URL: 'https://auth.poietic.tech/.well-known/jwks.json',
  SSO_LOGIN_URL: 'https://auth.poietic.tech/signin',
  SSO_REFRESH_URL: 'https://auth.poietic.tech/me',
  R2_ACCESS_KEY_ID: 'AKID',
  R2_SECRET_ACCESS_KEY: 'SECRET',
};

describe('containerEnv', () => {
  it('maps Worker bindings to the tracker and Litestream environment', () => {
    expect(containerEnv(env)).toEqual({
      TRACKER_DATABASE_URL: 'sqlite:/data/tracker.db',
      TRACKER_SECURE_COOKIES: '1',
      TRACKER_ALLOWED_ORIGINS: 'https://issues.poietic.tech',
      TRACKER_LOG_FORMAT: 'json',
      TRACKER_BLOB_STORE: 's3',
      TRACKER_S3_ENDPOINT: 'https://acct.r2.cloudflarestorage.com',
      TRACKER_S3_BUCKET: 'poietic-issues-attachments',
      TRACKER_S3_REGION: 'auto',
      TRACKER_S3_ACCESS_KEY_ID: 'AKID',
      TRACKER_S3_SECRET_ACCESS_KEY: 'SECRET',
      TRACKER_SSO_NAME: 'poietic.tech',
      TRACKER_SSO_COOKIE: '__Secure-poietic-session',
      TRACKER_SSO_ISSUER: 'https://auth.poietic.tech',
      TRACKER_SSO_AUDIENCE: 'poietic:public',
      TRACKER_SSO_JWKS_URL: 'https://auth.poietic.tech/.well-known/jwks.json',
      TRACKER_SSO_LOGIN_URL: 'https://auth.poietic.tech/signin',
      TRACKER_SSO_REFRESH_URL: 'https://auth.poietic.tech/me',
      LITESTREAM_ENDPOINT: 'https://acct.r2.cloudflarestorage.com',
      LITESTREAM_BUCKET: 'poietic-issues-db',
      LITESTREAM_ACCESS_KEY_ID: 'AKID',
      LITESTREAM_SECRET_ACCESS_KEY: 'SECRET',
    });
  });

  it('refuses to start without the R2 credentials', () => {
    expect(() => containerEnv({ ...env, R2_SECRET_ACCESS_KEY: '' })).toThrow(
      /R2_SECRET_ACCESS_KEY/,
    );
  });
});
