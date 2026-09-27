// Browser stand-in for the parts of `node:crypto` the server code uses (demo build only).
import { hmac } from '@noble/hashes/hmac.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { Buffer } from 'buffer';

class Hash {
  #chunks: Uint8Array[] = [];
  #key: Uint8Array | undefined;
  constructor(key?: Uint8Array) {
    this.#key = key;
  }
  update(data: string | Uint8Array) {
    this.#chunks.push(typeof data === 'string' ? new TextEncoder().encode(data) : data);
    return this;
  }
  digest(): Buffer;
  digest(encoding: 'hex' | 'base64' | 'base64url'): string;
  digest(encoding?: 'hex' | 'base64' | 'base64url'): Buffer | string {
    const input = Buffer.concat(this.#chunks);
    const out = Buffer.from(this.#key ? hmac(sha256, this.#key, input) : sha256(input));
    return encoding ? out.toString(encoding) : out;
  }
}

function checkAlgorithm(algorithm: string) {
  if (algorithm !== 'sha256') throw new Error(`Unsupported hash in demo: ${algorithm}`);
}

export function createHash(algorithm: string) {
  checkAlgorithm(algorithm);
  return new Hash();
}

export function createHmac(algorithm: string, key: string | Uint8Array) {
  checkAlgorithm(algorithm);
  return new Hash(typeof key === 'string' ? new TextEncoder().encode(key) : key);
}

export function randomBytes(size: number): Buffer {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(size)));
}

export function randomUUID(): string {
  return crypto.randomUUID();
}

export function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) throw new RangeError('Input buffers must have the same length');
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}

export default { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual };
