import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Webhook signatures follow the Standard Webhooks spec (https://www.standardwebhooks.com): the signed content is
 * `${webhook-id}.${webhook-timestamp}.${body}`, signed with HMAC-SHA256 using the base64-decoded part of the
 * `whsec_…` secret, and sent as `webhook-signature: v1,<base64>`. Any Standard Webhooks library can verify it.
 */
const PREFIX = 'whsec_';

export function generateWebhookSecret(): string {
  return `${PREFIX}${randomBytes(24).toString('base64')}`;
}

function secretKey(secret: string): Buffer {
  return Buffer.from(secret.startsWith(PREFIX) ? secret.slice(PREFIX.length) : secret, 'base64');
}

export function signWebhook(
  secret: string,
  id: string,
  timestampSeconds: number,
  body: string,
): string {
  const mac = createHmac('sha256', secretKey(secret))
    .update(`${id}.${timestampSeconds}.${body}`)
    .digest('base64');
  return `v1,${mac}`;
}

/** Headers for one delivery attempt. */
export function webhookHeaders(
  secret: string,
  id: string,
  timestampSeconds: number,
  body: string,
): Record<string, string> {
  return {
    'webhook-id': id,
    'webhook-timestamp': String(timestampSeconds),
    'webhook-signature': signWebhook(secret, id, timestampSeconds, body),
  };
}

export interface VerifyOptions {
  /** Maximum clock skew accepted, in seconds (default 300). */
  toleranceSeconds?: number;
  now?: Date;
}

/**
 * Verifies a received webhook (for receivers written in TypeScript, and our own tests). `headers` are the
 * request's headers (names lower-case). Throws when the signature or timestamp is invalid.
 */
export function verifyWebhook(
  secret: string,
  headers: Record<string, string | undefined>,
  body: string,
  options: VerifyOptions = {},
): void {
  const id = headers['webhook-id'];
  const timestamp = Number(headers['webhook-timestamp']);
  const signatures = headers['webhook-signature'];
  if (!id || !Number.isInteger(timestamp) || !signatures)
    throw new Error('Missing webhook headers');
  const now = Math.floor((options.now ?? new Date()).getTime() / 1000);
  if (Math.abs(now - timestamp) > (options.toleranceSeconds ?? 300))
    throw new Error('Webhook timestamp outside the tolerance window');
  const expected = Buffer.from(signWebhook(secret, id, timestamp, body).slice(3), 'base64');
  const match = signatures.split(' ').some((candidate) => {
    const [version, value] = candidate.split(',', 2);
    if (version !== 'v1' || !value) return false;
    const actual = Buffer.from(value, 'base64');
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  });
  if (!match) throw new Error('Webhook signature does not match');
}
