import { createIssue, createProject, createToken, EventTailer } from '@poietic-tech/issues-core';
import { createTestContext, type TestContext } from '@poietic-tech/issues-core/testing';
import { testDialect } from '@poietic-tech/issues-db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from './app.ts';

let t: TestContext;
let tailer: EventTailer;
let app: ReturnType<typeof createApp>;
let token: string;

beforeAll(async () => {
  t = await createTestContext();
  await createProject(t.ctx, { key: 'SSE', name: 'SSE' });
  await createProject(t.ctx, { key: 'OTH', name: 'Other' });
  tailer = new EventTailer(t.db, { intervalMs: 50 });
  await tailer.start();
  app = createApp({ db: t.db, tailer });
  token = (await createToken(t.ctx, 'admin', { name: 'sse' })).token;
});
afterAll(async () => {
  await tailer.stop();
  await t.destroy();
});

interface Message {
  id?: string;
  event?: string;
  data?: string;
}

/** Opens the stream and collects parsed SSE messages until `done` returns true. */
async function collect(
  query: string,
  headers: Record<string, string>,
  done: (m: Message[]) => boolean,
  act?: () => Promise<void>,
) {
  const controller = new AbortController();
  const res = await app.request(`http://t/api/v1/events/stream${query}`, {
    headers: { authorization: `Bearer ${token}`, ...headers },
    signal: controller.signal,
  });
  expect(res.status).toBe(200);
  expect(res.headers.get('content-type')).toContain('text/event-stream');
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  const messages: Message[] = [];
  let buffer = '';
  let acted = false;
  const deadline = Date.now() + 5000;
  while (!done(messages) && Date.now() < deadline) {
    const { value, done: end } = await reader.read();
    if (end) break;
    buffer += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buffer.indexOf('\n\n')) >= 0) {
      const block = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      const msg: Message = {};
      for (const line of block.split('\n')) {
        const [k, ...rest] = line.split(':');
        const v = rest.join(':').replace(/^ /, '');
        if (k === 'id' || k === 'event' || k === 'data') msg[k] = v;
      }
      if (msg.event || msg.data) messages.push(msg);
    }
    if (!acted && messages.some((m) => m.event === 'ready') && act) {
      acted = true;
      await act();
    }
  }
  controller.abort();
  await reader.cancel().catch(() => {});
  return messages;
}

describe(`SSE /events/stream (${testDialect()})`, () => {
  it('streams new events live, filtered by project', async () => {
    const messages = await collect(
      '?project=SSE',
      {},
      (m) => m.some((x) => x.event === 'issue.created'),
      async () => {
        await createIssue(t.ctx, 'OTH', { title: 'not for this stream' });
        await createIssue(t.ctx, 'SSE', { title: 'live!' });
      },
    );
    const created = messages.filter((m) => m.event === 'issue.created');
    expect(created).toHaveLength(1);
    const event = JSON.parse(created[0]!.data!);
    expect(event.data.issue.title).toBe('live!');
    expect(created[0]!.id).toBe(String(event.seq));
  });

  it('replays missed events after Last-Event-ID', async () => {
    const before = tailer.lastSeq;
    await createIssue(t.ctx, 'SSE', { title: 'missed 1' });
    await createIssue(t.ctx, 'SSE', { title: 'missed 2' });
    const messages = await collect(
      '',
      { 'last-event-id': String(before) },
      (m) => m.filter((x) => x.event === 'issue.created').length >= 2,
    );
    const titles = messages
      .filter((m) => m.event === 'issue.created')
      .map((m) => JSON.parse(m.data!).data.issue.title);
    expect(titles).toEqual(['missed 1', 'missed 2']);
  });

  it('requires authentication', async () => {
    const res = await app.request('http://t/api/v1/events/stream');
    expect(res.status).toBe(401);
  });
});
