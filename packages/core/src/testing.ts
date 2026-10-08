import { createTestDb, type TestDb } from '@poietic-tech/issues-db/testing';
import { newId } from '@poietic-tech/issues-schema';
import { type Actor, type Clock, type ServiceContext, SYSTEM_ACTOR, withActor } from './context.ts';
import { ensureBuiltins } from './services/bootstrap.ts';
import { createUserUnchecked, toActor } from './services/users.ts';

/** A clock that starts at a fixed instant and advances 1ms per call — deterministic and strictly increasing. */
export function steppingClock(
  start = '2026-01-01T00:00:00.000Z',
): Clock & { advance(ms: number): void } {
  let t = Date.parse(start);
  return {
    now: () => new Date(t++),
    advance(ms: number) {
      t += ms;
    },
  };
}

export interface TestContext {
  db: TestDb;
  /** Context acting as an admin human (`admin`). */
  ctx: ServiceContext;
  admin: Actor;
  /** Context acting as a member human (`member`). */
  member: ServiceContext;
  /** Context acting as an agent (`bot`). */
  agent: ServiceContext;
  destroy(): Promise<void>;
}

/** Migrated database (dialect from TEST_DB) with builtins and three users. */
export async function createTestContext(): Promise<TestContext> {
  const db = await createTestDb();
  const clock = steppingClock();
  await ensureBuiltins(db, clock);
  const base: ServiceContext = { db, actor: SYSTEM_ACTOR, clock, ids: newId };
  const admin = toActor(
    await createUserUnchecked(base, { handle: 'admin', name: 'Admin', role: 'admin' }),
  );
  const member = toActor(await createUserUnchecked(base, { handle: 'member', name: 'Member' }));
  const agent = toActor(
    await createUserUnchecked(base, { handle: 'bot', name: 'Bot', kind: 'agent' }),
  );
  return {
    db,
    ctx: withActor(base, admin),
    admin,
    member: withActor(base, member),
    agent: withActor(base, agent),
    destroy: () => db.destroy(),
  };
}
