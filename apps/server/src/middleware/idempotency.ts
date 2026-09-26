import { createHash } from 'node:crypto';
import { fromJson, toJson, withWriteTx } from '@tracker/db';
import { createMiddleware } from 'hono/factory';
import type { AppEnv, ResolvedDeps } from '../env.ts';
import { problem } from '../problem.ts';

const TTL_MS = 24 * 60 * 60 * 1000;

/**
 * `Idempotency-Key` support for POST requests, so agents can retry safely after a network failure.
 * The key is claimed in its own transaction before the handler runs; the response (status < 500) is stored
 * and replayed for identical retries within 24h (`Idempotent-Replayed: true`). Reusing a key with a different
 * request body is an error; a retry while the first request is still running gets 409.
 */
export function idempotency(deps: ResolvedDeps) {
  return createMiddleware<AppEnv>(async (c, next) => {
    const key = c.req.header('idempotency-key');
    const actor = c.get('actor');
    if (c.req.method !== 'POST' || !key || !actor) return next();
    if (key.length > 255)
      return problem(c, 'VALIDATION_FAILED', 'Idempotency-Key must be at most 255 characters');

    const db = deps.getDb();
    const body = await c.req.raw.clone().text();
    const path = new URL(c.req.url).pathname;
    const hash = createHash('sha256').update(`${c.req.method}\n${path}\n${body}`).digest('hex');
    const now = (deps.clock ?? { now: () => new Date() }).now();

    const existing = await withWriteTx(db, async (tx) => {
      await tx.deleteFrom('idempotency_keys').where('expires_at', '<', now.toISOString()).execute();
      const row = await tx
        .selectFrom('idempotency_keys')
        .selectAll()
        .where('actor_id', '=', actor.id)
        .where('key', '=', key)
        .executeTakeFirst();
      if (row) return row;
      await tx
        .insertInto('idempotency_keys')
        .values({
          actor_id: actor.id,
          key,
          method: c.req.method,
          path,
          request_hash: hash,
          status_code: null,
          response: null,
          created_at: now.toISOString(),
          expires_at: new Date(now.getTime() + TTL_MS).toISOString(),
        })
        .execute();
      return undefined;
    });

    if (existing) {
      if (existing.request_hash !== hash)
        return problem(
          c,
          'IDEMPOTENCY_KEY_REUSED',
          'This Idempotency-Key was used with a different request',
        );
      if (existing.status_code === null)
        return problem(
          c,
          'IDEMPOTENCY_IN_PROGRESS',
          'A request with this Idempotency-Key is still in progress',
        );
      const stored = fromJson<{ body: string; contentType: string }>(existing.response, {
        body: '',
        contentType: '',
      });
      return new Response(stored.body || null, {
        status: existing.status_code,
        headers: {
          ...(stored.contentType && { 'content-type': stored.contentType }),
          'idempotent-replayed': 'true',
        },
      });
    }

    const release = () =>
      withWriteTx(db, (tx) =>
        tx
          .deleteFrom('idempotency_keys')
          .where('actor_id', '=', actor.id)
          .where('key', '=', key)
          .execute(),
      );
    try {
      await next();
    } catch (error) {
      await release();
      throw error;
    }
    const res = c.res;
    if (res.status >= 500) {
      await release();
      return;
    }
    const text = await res.clone().text();
    await withWriteTx(db, (tx) =>
      tx
        .updateTable('idempotency_keys')
        .set({
          status_code: res.status,
          response: toJson({ body: text, contentType: res.headers.get('content-type') ?? '' }),
        })
        .where('actor_id', '=', actor.id)
        .where('key', '=', key)
        .execute(),
    );
  });
}
