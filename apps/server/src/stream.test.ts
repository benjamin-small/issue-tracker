import {
  addMember,
  createIssue,
  createLink,
  createProject,
  createToken,
  createUser,
  EventTailer,
  removeMember,
} from '@poietic-tech/issues-core';
import { createTestContext, type TestContext } from '@poietic-tech/issues-core/testing';
import { testDialect } from '@poietic-tech/issues-db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from './app.ts';

let t: TestContext;
let tailer: EventTailer;
let app: ReturnType<typeof createApp>;
let token: string;
let memberToken: string;

beforeAll(async () => {
  t = await createTestContext();
  await createProject(t.ctx, { key: 'SSE', name: 'SSE' });
  await createProject(t.ctx, { key: 'OTH', name: 'Other' });
  await createProject(t.ctx, { key: 'PUB', name: 'Public', visibility: 'public' });
  tailer = new EventTailer(t.db, { intervalMs: 50 });
  await tailer.start();
  app = createApp({ db: t.db, tailer });
  token = (await createToken(t.ctx, 'admin', { name: 'sse' })).token;
  memberToken = (await createToken(t.member, 'member', { name: 'sse' })).token;
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
  bearer: string | null = token,
) {
  const controller = new AbortController();
  const res = await app.request(`http://t/api/v1/events/stream${query}`, {
    headers: { ...(bearer && { authorization: `Bearer ${bearer}` }), ...headers },
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

  /** Issue titles of the `issue.created` messages received. */
  const titles = (messages: Message[]) =>
    messages
      .filter((m) => m.event === 'issue.created')
      .map((m) => JSON.parse(m.data!).data.issue.title as string);
  const sawTitle = (title: string) => (m: Message[]) => titles(m).includes(title);

  it('streams only what the viewer can read', async () => {
    let seq = 0;
    const act = async () => {
      const n = ++seq;
      const prv = await createIssue(t.ctx, 'OTH', { title: `private ${n}` });
      const pub = await createIssue(t.ctx, 'PUB', { title: `public ${n}` });
      await createLink(t.ctx, pub.key, { type: 'relates', target: prv.key });
      await createUser(t.ctx, { handle: `sse-user-${n}`, name: 'SSE', email: `u${n}@x.io` });
      await createIssue(t.ctx, 'PUB', { title: `done ${n}` });
    };

    const member = await collect('', {}, sawTitle('done 1'), act, memberToken);
    expect(titles(member)).toEqual(['public 1', 'done 1']);
    expect(member.some((m) => m.event?.startsWith('link.'))).toBe(false);
    const users = member.filter((m) => m.event === 'user.created');
    expect(users).toHaveLength(1);
    expect(JSON.parse(users[0]!.data!).data.user.email).toBeNull();

    const anonymous = await collect('', {}, sawTitle('done 2'), act, null);
    expect(titles(anonymous)).toEqual(['public 2', 'done 2']);
    expect(anonymous.some((m) => m.event?.startsWith('link.'))).toBe(false);
    expect(anonymous.some((m) => m.event?.startsWith('user.'))).toBe(false);

    const admin = await collect('', {}, sawTitle('done 3'), act);
    expect(titles(admin)).toEqual(['private 3', 'public 3', 'done 3']);
    expect(admin.some((m) => m.event === 'link.created')).toBe(true);
    const adminUsers = admin.filter((m) => m.event === 'user.created');
    expect(JSON.parse(adminUsers[0]!.data!).data.user.email).toBe('u3@x.io');
  });

  it('follows membership changes while the stream is open', async () => {
    const messages = await collect(
      '',
      {},
      sawTitle('after removal marker'),
      async () => {
        await createIssue(t.ctx, 'OTH', { title: 'before grant' });
        await addMember(t.ctx, 'OTH', { user: 'member', role: 'viewer' });
        await createIssue(t.ctx, 'OTH', { title: 'after grant' });
        await removeMember(t.ctx, 'OTH', 'member');
        await createIssue(t.ctx, 'OTH', { title: 'after removal' });
        await createIssue(t.ctx, 'PUB', { title: 'after removal marker' });
      },
      memberToken,
    );
    expect(titles(messages)).toEqual(['after grant', 'after removal marker']);
  });

  it('lets anonymous viewers stream public projects, and hides private ones', async () => {
    const res = await app.request('http://t/api/v1/events/stream?project=OTH');
    expect(res.status).toBe(404);
    const messages = await collect(
      '?project=PUB',
      {},
      sawTitle('anonymous live'),
      async () => {
        await createIssue(t.ctx, 'PUB', { title: 'anonymous live' });
      },
      null,
    );
    expect(titles(messages)).toEqual(['anonymous live']);
  });
});
