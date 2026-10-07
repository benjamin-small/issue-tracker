import { describe, expect, it } from 'vitest';
import { createJwtVerifier, type CryptoKey, type JsonWebKey } from './jwt.ts';

const ISS = 'https://auth.example.test';
const AUD = 'example:public';
const JWKS = `${ISS}/.well-known/jwks.json`;
const b64url = (b: ArrayBuffer | Uint8Array | string) =>
  Buffer.from(typeof b === 'string' ? b : new Uint8Array(b as ArrayBuffer)).toString('base64url');

async function keypair(kid: string) {
  const { privateKey, publicKey } = await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign', 'verify'],
  );
  const jwk = {
    ...(await crypto.subtle.exportKey('jwk', publicKey)),
    kid,
    alg: 'ES256',
    use: 'sig',
  };
  return { privateKey, jwk };
}

async function sign(privateKey: CryptoKey, header: object, claims: object) {
  const input = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(claims))}`;
  const sig = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    privateKey,
    new TextEncoder().encode(input),
  );
  return `${input}.${b64url(sig)}`;
}

const NOW = 1_800_000_000_000;
const claims = (over: object = {}) => ({
  iss: ISS,
  aud: AUD,
  sub: 'u1',
  role: 'user',
  name: 'Ada',
  sid: 's1',
  iat: NOW / 1000 - 10,
  exp: NOW / 1000 + 600,
  ...over,
});

function setup(keys: { kid: string; jwk: JsonWebKey }[], now = () => NOW) {
  let fetches = 0;
  const fetchImpl = (async (url: string) => {
    fetches++;
    expect(url).toBe(JWKS);
    return new Response(JSON.stringify({ keys: keys.map((k) => k.jwk) }));
  }) as typeof fetch;
  const verifier = createJwtVerifier({ jwksUrl: JWKS, issuer: ISS, audience: AUD, fetchImpl, now });
  return { verifier, fetches: () => fetches };
}

describe('createJwtVerifier', () => {
  it('accepts a valid ES256 token and caches the JWKS', async () => {
    const k = await keypair('k1');
    const { verifier, fetches } = setup([{ kid: 'k1', jwk: k.jwk }]);
    const token = await sign(k.privateKey, { alg: 'ES256', kid: 'k1' }, claims());
    expect(await verifier.verify(token)).toMatchObject({ sub: 'u1', name: 'Ada', role: 'user' });
    await verifier.verify(token);
    expect(fetches()).toBe(1);
  });

  it.each([
    ['wrong issuer', { iss: 'https://evil.test' }],
    ['wrong audience', { aud: 'other' }],
    ['expired', { exp: NOW / 1000 - 1 }],
    ['issued in the future', { iat: NOW / 1000 + 120 }],
    ['missing sub', { sub: undefined }],
  ])('rejects a token with %s', async (_label, over) => {
    const k = await keypair('k1');
    const { verifier } = setup([{ kid: 'k1', jwk: k.jwk }]);
    expect(
      await verifier.verify(await sign(k.privateKey, { alg: 'ES256', kid: 'k1' }, claims(over))),
    ).toBeNull();
  });

  it('rejects other algorithms, garbage and a bad signature', async () => {
    const k = await keypair('k1');
    const other = await keypair('k1');
    const { verifier } = setup([{ kid: 'k1', jwk: k.jwk }]);
    expect(
      await verifier.verify(await sign(k.privateKey, { alg: 'none', kid: 'k1' }, claims())),
    ).toBeNull();
    expect(await verifier.verify('not.a.jwt')).toBeNull();
    expect(await verifier.verify('nope')).toBeNull();
    expect(
      await verifier.verify(await sign(other.privateKey, { alg: 'ES256', kid: 'k1' }, claims())),
    ).toBeNull();
  });

  it('refetches once for an unknown kid, at most once a minute', async () => {
    const k = await keypair('k1');
    let t = NOW;
    const { verifier, fetches } = setup([{ kid: 'k1', jwk: k.jwk }], () => t);
    const bogus = await sign(k.privateKey, { alg: 'ES256', kid: 'k9' }, claims());
    expect(await verifier.verify(bogus)).toBeNull(); // initial fetch + forced refetch
    expect(await verifier.verify(bogus)).toBeNull(); // throttled
    expect(fetches()).toBe(2);
    t += 61_000;
    await verifier.verify(bogus);
    expect(fetches()).toBe(3);
  });

  it('times out a JWKS fetch that never answers', async () => {
    const fetchImpl = ((_url: string, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
      })) as unknown as typeof fetch;
    const verifier = createJwtVerifier({
      jwksUrl: JWKS,
      issuer: ISS,
      audience: AUD,
      fetchImpl,
      fetchTimeoutMs: 20,
    });
    const { privateKey } = await keypair('k1');
    const token = await sign(privateKey, { alg: 'ES256', kid: 'k1' }, claims());
    await expect(verifier.verify(token)).rejects.toThrow();
  });

  it('keeps cached keys when a refetch returns no usable keys', async () => {
    const k = await keypair('k1');
    let t = NOW;
    let empty = false;
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ keys: empty ? [] : [k.jwk] }))) as typeof fetch;
    const verifier = createJwtVerifier({
      jwksUrl: JWKS,
      issuer: ISS,
      audience: AUD,
      fetchImpl,
      now: () => t,
    });
    const token = await sign(k.privateKey, { alg: 'ES256', kid: 'k1' }, claims());
    expect(await verifier.verify(token)).not.toBeNull();
    empty = true;
    t += 2 * 3_600_000; // past the TTL, so the next verify refetches
    const later = await sign(
      k.privateKey,
      { alg: 'ES256', kid: 'k1' },
      claims({ iat: t / 1000 - 10, exp: t / 1000 + 600 }),
    );
    expect(await verifier.verify(later)).not.toBeNull();
  });
});
