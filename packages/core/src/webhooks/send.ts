import { lookup as dnsLookup, type LookupAddress } from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import { BlockList, isIP, type LookupFunction } from 'node:net';

/**
 * Outbound webhook requests, guarded against SSRF: a webhook URL must not reach the server's own network.
 * Hostnames are resolved once and every resolved address is checked, then the connection is pinned to the
 * checked address (so DNS rebinding cannot swap it). Redirects are not followed, time and response size are
 * capped. `allowPrivate` (development and tests) lifts the address checks and permits plain http.
 */
const blocked = new BlockList();
for (const [net, prefix] of [
  ['0.0.0.0', 8], // "this" network
  ['10.0.0.0', 8],
  ['100.64.0.0', 10], // carrier-grade NAT
  ['127.0.0.0', 8],
  ['169.254.0.0', 16], // link-local, including cloud metadata (169.254.169.254)
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15], // benchmarking
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reserved + broadcast
] as const)
  blocked.addSubnet(net, prefix, 'ipv4');
for (const [net, prefix] of [
  ['::', 128],
  ['::1', 128],
  ['fc00::', 7], // unique local
  ['fe80::', 10], // link-local
  ['ff00::', 8], // multicast
] as const)
  blocked.addSubnet(net, prefix, 'ipv6');

/** Whether an IP address is private, loopback, link-local or otherwise not publicly routable. */
export function isPrivateAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return blocked.check(address, 'ipv4');
  if (family !== 6) return true; // not an IP: refuse
  const lower = address.toLowerCase();
  // IPv4-mapped (::ffff:a.b.c.d or ::ffff:hhhh:hhhh) and NAT64 (64:ff9b::/96) embed an IPv4 address.
  const embedded =
    /^(?:::ffff:|64:ff9b::)(\d+\.\d+\.\d+\.\d+)$/.exec(lower)?.[1] ??
    (() => {
      const m = /^(?:::ffff:|64:ff9b::)([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(lower);
      if (!m) return undefined;
      const hi = parseInt(m[1]!, 16);
      const lo = parseInt(m[2]!, 16);
      return `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
    })();
  if (embedded) return blocked.check(embedded, 'ipv4');
  if (lower.startsWith('::ffff:') || lower.startsWith('64:ff9b::')) return true;
  return blocked.check(address, 'ipv6');
}

export class WebhookUrlError extends Error {
  override name = 'WebhookUrlError';
}

/**
 * Static checks on a webhook URL (at create/update time and before each attempt). Hostnames are resolved and
 * checked at send time.
 */
export function assertWebhookUrl(raw: string, allowPrivate: boolean): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new WebhookUrlError('Invalid URL');
  }
  if (url.protocol !== 'https:' && !(allowPrivate && url.protocol === 'http:'))
    throw new WebhookUrlError('Webhook URLs must use https');
  if (url.username || url.password)
    throw new WebhookUrlError('Webhook URLs must not contain credentials');
  if (!allowPrivate) {
    const host = url.hostname.replace(/^\[|\]$/g, '');
    if (isIP(host) && isPrivateAddress(host))
      throw new WebhookUrlError('Webhook URLs must not point to private or local addresses');
    if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal'))
      throw new WebhookUrlError('Webhook URLs must not point to private or local addresses');
  }
  return url;
}

/** DNS lookup that refuses private addresses and pins the connection to the address it checked. */
export const publicOnlyLookup: LookupFunction = (hostname, options, callback) => {
  dnsLookup(hostname, { ...options, all: true }, (error, addresses) => {
    if (error) return callback(error, '', 4);
    const list = addresses as LookupAddress[];
    const bad = list.find((a) => isPrivateAddress(a.address));
    if (bad || list.length === 0)
      return callback(
        Object.assign(new Error(`${hostname} resolves to a private address`), {
          code: 'EPRIVATE',
        }),
        '',
        4,
      );
    if (options.all) return callback(null, list as never);
    const first = list[0]!;
    return callback(null, first.address, first.family);
  });
};

export interface SendRequest {
  url: string;
  headers: Record<string, string>;
  body: string;
  allowPrivate: boolean;
  timeoutMs?: number;
  /** Response bytes kept (the rest is discarded). */
  maxResponseBytes?: number;
}

export interface SendResult {
  statusCode: number | null;
  /** Start of the response body. */
  response: string | null;
  error: string | null;
  durationMs: number;
}

export type WebhookSender = (request: SendRequest) => Promise<SendResult>;

/** POSTs a webhook. Never throws: network, SSRF and timeout failures come back as `error`. */
export const sendWebhookRequest: WebhookSender = async (req) => {
  const started = performance.now();
  const done = (partial: Omit<SendResult, 'durationMs'>): SendResult => ({
    ...partial,
    durationMs: Math.round(performance.now() - started),
  });
  let url: URL;
  try {
    url = assertWebhookUrl(req.url, req.allowPrivate);
  } catch (error) {
    return done({ statusCode: null, response: null, error: (error as Error).message });
  }
  const timeoutMs = req.timeoutMs ?? 10_000;
  const maxBytes = req.maxResponseBytes ?? 64 * 1024;
  const client = url.protocol === 'https:' ? https : http;
  return new Promise<SendResult>((resolve) => {
    const request = client.request(
      url,
      {
        method: 'POST',
        headers: {
          ...req.headers,
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(req.body),
          'user-agent': 'tracker-webhooks/1',
        },
        timeout: timeoutMs,
        ...(!req.allowPrivate && { lookup: publicOnlyLookup }),
      },
      (response) => {
        const chunks: Buffer[] = [];
        let size = 0;
        response.on('data', (chunk: Buffer) => {
          if (size < maxBytes) chunks.push(chunk.subarray(0, maxBytes - size));
          size += chunk.length;
          if (size >= maxBytes) response.destroy();
        });
        const finish = () =>
          resolve(
            done({
              statusCode: response.statusCode ?? null,
              response: Buffer.concat(chunks).toString('utf8'),
              error: null,
            }),
          );
        response.on('end', finish);
        response.on('close', finish);
        response.on('error', finish);
      },
    );
    const deadline = setTimeout(() => request.destroy(new Error('Timed out')), timeoutMs);
    request.on('timeout', () => request.destroy(new Error('Timed out')));
    request.on('error', (error) => {
      clearTimeout(deadline);
      resolve(done({ statusCode: null, response: null, error: error.message }));
    });
    request.on('close', () => clearTimeout(deadline));
    request.end(req.body);
  });
};
