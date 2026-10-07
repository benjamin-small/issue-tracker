import { describe, expect, it } from 'vitest';
import { loadConfig, ssoOptionsFromConfig } from './config.ts';

const SSO = {
  TRACKER_SSO_ISSUER: 'https://auth.example.test',
  TRACKER_SSO_COOKIE: '__Secure-example-session',
  TRACKER_SSO_AUDIENCE: 'example:public',
  TRACKER_SSO_JWKS_URL: 'https://auth.example.test/.well-known/jwks.json',
  TRACKER_SSO_LOGIN_URL: 'https://auth.example.test/',
};

describe('SSO configuration', () => {
  it('is off unless TRACKER_SSO_ISSUER is set', () => {
    expect(ssoOptionsFromConfig(loadConfig({}))).toBeUndefined();
  });

  it('requires the cookie, audience, JWKS and login URL with an issuer', () => {
    expect(() => loadConfig({ TRACKER_SSO_ISSUER: 'https://auth.example.test' })).toThrow(
      /TRACKER_SSO_COOKIE, TRACKER_SSO_AUDIENCE, TRACKER_SSO_JWKS_URL, TRACKER_SSO_LOGIN_URL are required/,
    );
    expect(() => loadConfig({ ...SSO, TRACKER_SSO_AUDIENCE: undefined })).toThrow(
      /TRACKER_SSO_AUDIENCE is required/,
    );
  });

  it('builds options with defaults', () => {
    const sso = ssoOptionsFromConfig(loadConfig(SSO))!;
    expect(sso).toMatchObject({
      name: 'auth.example.test',
      cookie: '__Secure-example-session',
      issuer: 'https://auth.example.test',
      loginUrl: 'https://auth.example.test/',
      adminRole: 'admin',
    });
    expect(sso.refreshUrl).toBeUndefined();
    expect(typeof sso.verifier.verify).toBe('function');
  });
});
