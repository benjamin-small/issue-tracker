import { createDb } from '@poietic-tech/issues-db';
import { testDialect } from '@poietic-tech/issues-db/testing';
import type { TrackerEvent } from '@poietic-tech/issues-schema';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EventTailer } from './events/tailer.ts';
import { createIssue, createProject } from './index.ts';
import { createTestContext, type TestContext } from './testing.ts';

let t: TestContext;
beforeAll(async () => {
  t = await createTestContext();
  await createProject(t.ctx, { key: 'LIVE', name: 'Live' });
});
afterAll(() => t.destroy());

async function until(predicate: () => boolean, ms: number): Promise<number> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > ms) throw new Error(`timed out after ${ms}ms`);
    await new Promise((r) => setTimeout(r, 5));
  }
  return Date.now() - start;
}

describe(`EventTailer (${testDialect()})`, () => {
  it('delivers local writes immediately, in order, without polling', async () => {
    const tailer = new EventTailer(t.db, { intervalMs: 60_000 });
    await tailer.start();
    const seen: TrackerEvent[] = [];
    tailer.subscribe((e) => seen.push(e));
    await createIssue(t.ctx, 'LIVE', { title: 'one' });
    await createIssue(t.ctx, 'LIVE', { title: 'two' });
    await until(() => seen.length >= 2, 1000);
    expect(seen.map((e) => (e.data.issue as { title: string }).title)).toEqual(['one', 'two']);
    expect(seen[0]!.seq).toBeLessThan(seen[1]!.seq);
    await tailer.stop();
  });

  it('starts from the end of the log (no replay of history)', async () => {
    const tailer = new EventTailer(t.db, { intervalMs: 60_000 });
    await tailer.start();
    const seen: TrackerEvent[] = [];
    tailer.subscribe((e) => seen.push(e));
    tailer.wake();
    await new Promise((r) => setTimeout(r, 50));
    expect(seen).toEqual([]);
    await tailer.stop();
  });

  it('picks up writes from another connection/process', async () => {
    const other = createDb(t.db.url);
    // Postgres: a second connection pool writes and LISTEN/NOTIFY wakes the tailer without polling.
    // SQLite: test databases are in-memory (one connection), so this exercises the polling path; cross-process
    // SQLite delivery is covered end-to-end (a CLI local-mode write appearing in the browser).
    const tailer = new EventTailer(t.db, {
      intervalMs: testDialect() === 'postgres' ? 60_000 : 20,
    });
    await tailer.start();
    const seen: TrackerEvent[] = [];
    tailer.subscribe((e) => seen.push(e));
    const writer = testDialect() === 'postgres' ? { ...t.ctx, db: other } : t.ctx;
    await createIssue(writer, 'LIVE', { title: 'from elsewhere' });
    const elapsed = await until(
      () => seen.some((e) => (e.data.issue as { title?: string })?.title === 'from elsewhere'),
      2000,
    );
    expect(elapsed).toBeLessThan(1000);
    await tailer.stop();
    await other.destroy();
  });
});
